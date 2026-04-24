#!/usr/bin/env bash
# check-api-delta.sh — Daily API-costs delta anomaly check.
#
# Why this exists:
#   Throughout April 2026 a writeUsageLog bug silently swallowed ~99% of
#   billing entries. We only caught it a month later when the provider
#   invoice arrived. This script recomputes the same "invoiced vs booked"
#   delta the admin UI (/admin/finance/api-costs) shows, and fires an
#   email alert if any provider drifts beyond tolerance. An early alarm
#   turns "one-month silent bug" into "one-day delivery".
#
# What it does (for the current month, MSK timezone):
#   1. booked_usd  per provider = SUM(usage_logs.cost_usd)
#      provider bucketing mirrors admin: anthropic/openai/wavespeed/
#      huggingface as-is, everything else -> openrouter.
#   2. invoiced_usd per provider = SUM(ai_aggregator.manual_expenses WHERE category='api')
#      - amount_original when currency_original='USD'
#      - else amount_rub/100 as rough USD fallback (matches admin code).
#   3. For each provider with invoiced_usd > 0:
#         delta_pct = (booked - invoiced) / invoiced * 100
#      If |delta_pct| > 30 AND booked_usd > 0.5  -> append to alert list.
#   4. If alert list non-empty -> send Brevo email to NOTIFY_EMAIL.
#
# Install (run as root on VPS#1):
#   cp /home/deploy/projects/ai-aggregator-lobechat/scripts/monitoring/api-delta-check.service  /etc/systemd/system/
#   cp /home/deploy/projects/ai-aggregator-lobechat/scripts/monitoring/api-delta-check.timer    /etc/systemd/system/
#   systemctl daemon-reload
#   systemctl enable --now api-delta-check.timer
#   systemctl list-timers api-delta-check.timer
#
# Manual run (as deploy):
#   bash /home/deploy/projects/ai-aggregator-lobechat/scripts/monitoring/check-api-delta.sh
#
# Env requirements (sourced from /home/deploy/.config/blog-autogen/env):
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_API_KEY, NOTIFY_EMAIL
#
# LobeChat PG access: `docker exec lobe-postgres psql ...`, no password needed
# because we exec inside the container as the postgres role.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/check-api-delta.log"
THRESHOLD_PCT=30
THRESHOLD_BOOKED_USD=0.5
PG_CONTAINER="lobe-postgres"
PG_DB="lobechat"
PG_USER="postgres"

mkdir -p "$(dirname "$LOG_FILE")"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
source "${SCRIPT_DIR}/../blog/notify.sh"

[[ -f "$BLOG_ENV_FILE" ]] && {
    set -a
    # shellcheck disable=SC1090
    source "$BLOG_ENV_FILE"
    set +a
}

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    if [[ -z "${!v:-}" ]]; then
        log "ERROR: $v not set in $BLOG_ENV_FILE"
        exit 1
    fi
done

if ! docker ps --format '{{.Names}}' | grep -qx "$PG_CONTAINER"; then
    log "ERROR: PG container '$PG_CONTAINER' not running"
    notify_failure "check-api-delta" "PG container '$PG_CONTAINER' not running" "$LOG_FILE"
    exit 1
fi

# Rotate log
if [[ -f "$LOG_FILE" ]] && (( $(wc -l < "$LOG_FILE") > 2000 )); then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

log "=== api-costs delta check started ==="

# Month range in MSK.
MONTH=$(TZ=Europe/Moscow date +%Y-%m)
FIRST_DAY="${MONTH}-01"
# Lower bound for usage_logs (inclusive) + upper bound (next-month first-day exclusive)
FIRST_DAY_NEXT=$(TZ=Europe/Moscow date -d "${FIRST_DAY} +1 month" +%Y-%m-%d)
log "window: ${FIRST_DAY} .. ${FIRST_DAY_NEXT} (exclusive), MSK"

# ------- 1) booked_usd per provider from LobeChat usage_logs -------
# Raw rows out of PG, provider mapping happens in python (matches admin logic).
BOOKED_CSV=$(docker exec "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -At -F $'\t' -c "
SELECT coalesce(provider, '') AS provider,
       coalesce(sum(cost_usd), 0)::float8 AS cost_usd
  FROM usage_logs
 WHERE created_at >= '${FIRST_DAY}'::timestamptz AT TIME ZONE 'Europe/Moscow'
   AND created_at <  '${FIRST_DAY_NEXT}'::timestamptz AT TIME ZONE 'Europe/Moscow'
 GROUP BY 1
" 2>>"$LOG_FILE")
BOOKED_EXIT=$?
if [[ $BOOKED_EXIT -ne 0 ]]; then
    log "ERROR: booked query failed (exit=$BOOKED_EXIT)"
    notify_failure "check-api-delta" "booked query failed (exit=$BOOKED_EXIT)" "$LOG_FILE"
    exit 1
fi

# ------- 2) invoiced per provider from Supabase ai_aggregator.manual_expenses -------
SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
           -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
           -H "Accept-Profile: ai_aggregator")
MANUAL=$(curl -sf --max-time 30 \
    "${SUPABASE_URL}/rest/v1/manual_expenses?select=provider,amount_original,currency_original,amount_rub,date&category=eq.api&date=gte.${FIRST_DAY}&date=lt.${FIRST_DAY_NEXT}" \
    "${SUPA_HDRS[@]}")
if [[ -z "$MANUAL" ]]; then
    log "ERROR: supabase manual_expenses fetch failed"
    notify_failure "check-api-delta" "supabase manual_expenses fetch failed" "$LOG_FILE"
    exit 1
fi

export BOOKED_CSV MANUAL MONTH THRESHOLD_PCT THRESHOLD_BOOKED_USD

# Compute deltas in python — matches src/lib/provider-mapping.ts bucketing.
ALERT_JSON=$(python3 - <<'PYEOF' 2>>"$LOG_FILE"
import json, os, sys

def bucket(raw):
    v = (raw or '').strip().lower()
    if v == 'anthropic':   return 'anthropic'
    if v == 'openai':      return 'openai'
    if v == 'wavespeed':   return 'wavespeed'
    if v in ('huggingface', 'hf'): return 'huggingface'
    return 'openrouter'

BUCKETS = ['anthropic', 'huggingface', 'openai', 'openrouter', 'wavespeed']
booked   = {b: 0.0 for b in BUCKETS}
invoiced = {b: 0.0 for b in BUCKETS}

# --- booked ---
raw = os.environ.get('BOOKED_CSV', '').strip()
if raw:
    for line in raw.splitlines():
        parts = line.split('\t')
        if len(parts) < 2: continue
        prov_raw, cost = parts[0], parts[1]
        try:
            booked[bucket(prov_raw)] += float(cost)
        except ValueError:
            pass

# --- invoiced ---
try:
    rows = json.loads(os.environ['MANUAL'])
except Exception as e:
    print(f'manual_expenses parse failed: {e}', file=sys.stderr)
    rows = []
for r in rows:
    b = bucket(r.get('provider'))
    cur = (r.get('currency_original') or '').upper()
    amt_orig = r.get('amount_original')
    if cur == 'USD' and amt_orig is not None:
        try:
            invoiced[b] += float(amt_orig)
        except (TypeError, ValueError):
            pass
    else:
        # rough RUB->USD fallback, same as admin code
        try:
            invoiced[b] += float(r.get('amount_rub') or 0) / 100.0
        except (TypeError, ValueError):
            pass

threshold_pct    = float(os.environ['THRESHOLD_PCT'])
threshold_booked = float(os.environ['THRESHOLD_BOOKED_USD'])

rows_out = []
alerts   = []
for b in BUCKETS:
    inv, bkd = invoiced[b], booked[b]
    delta_usd = bkd - inv
    if inv > 0:
        delta_pct = (bkd - inv) / inv * 100.0
    else:
        delta_pct = None
    rows_out.append({
        'provider': b,
        'invoiced_usd': round(inv, 2),
        'booked_usd':   round(bkd, 2),
        'delta_usd':    round(delta_usd, 2),
        'delta_pct':    None if delta_pct is None else round(delta_pct, 1),
    })
    if delta_pct is not None and abs(delta_pct) > threshold_pct and bkd > threshold_booked:
        alerts.append(rows_out[-1])

print(json.dumps({
    'month':   os.environ['MONTH'],
    'rows':    rows_out,
    'alerts':  alerts,
}))
PYEOF
)
PY_EXIT=$?
if [[ $PY_EXIT -ne 0 ]] || [[ -z "$ALERT_JSON" ]]; then
    log "ERROR: python delta computation failed (exit=$PY_EXIT)"
    notify_failure "check-api-delta" "python delta computation failed (exit=$PY_EXIT)" "$LOG_FILE"
    exit 1
fi

log "rows: $(echo "$ALERT_JSON" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["rows"]))')"

ALERT_COUNT=$(echo "$ALERT_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["alerts"]))')

if [[ "${ALERT_COUNT:-0}" -eq 0 ]]; then
    log "no anomalies (month=${MONTH}, threshold=±${THRESHOLD_PCT}% @ booked>\$${THRESHOLD_BOOKED_USD})"
    log "=== api-costs delta check complete ==="
    exit 0
fi

BODY=$(echo "$ALERT_JSON" | python3 -c '
import json, sys, html
d = json.load(sys.stdin)
out = [f"<h2>API-costs Δ% anomaly — month {html.escape(d[\"month\"])}</h2>"]
out.append(f"<p>Threshold: |Δ%| &gt; {int(float(\"'"$THRESHOLD_PCT"'\"))}% AND booked &gt; ${float(\"'"$THRESHOLD_BOOKED_USD"'\"):.2f}.</p>")
out.append("<table border=1 cellpadding=6 cellspacing=0 style=\"border-collapse:collapse\">")
out.append("<tr><th>Provider</th><th>Invoiced USD</th><th>Booked USD</th><th>Δ USD</th><th>Δ %</th></tr>")
for r in d["alerts"]:
    out.append(
        f"<tr><td>{html.escape(r[\"provider\"])}</td>"
        f"<td align=right>{r[\"invoiced_usd\"]:.2f}</td>"
        f"<td align=right>{r[\"booked_usd\"]:.2f}</td>"
        f"<td align=right>{r[\"delta_usd\"]:+.2f}</td>"
        f"<td align=right>{r[\"delta_pct\"]:+.1f}%</td></tr>"
    )
out.append("</table>")
out.append("<p><a href=\"https://admin.gptweb.ru/admin/finance/api-costs\">Open API-costs page</a></p>")
out.append("<p>Source: ai-aggregator-lobechat/scripts/monitoring/check-api-delta.sh</p>")
print("".join(out))
')

notify_email "[webgpt-alert] API-costs Δ% anomaly" "$BODY"
log "alert email sent (${ALERT_COUNT} provider(s) beyond threshold)"
log "=== api-costs delta check complete ==="
