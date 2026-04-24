#!/usr/bin/env bash
# track-positions.sh — Daily per-URL traffic tracking for gptweb.ru blog.
#
# Uses Yandex Metrika (counter 106801684) as the per-URL attribution source
# since Webmaster API doesn't expose per-URL queries. We pull organic-search
# pageviews + visits for each /blog/* URL across two windows:
#   * "current"  — last 7 days
#   * "baseline" — days 8..30 (23-day rolling window before current)
# and flag URLs whose daily-normalized visits dropped >=50% into
# reoptimize_queue.
#
# Repurposed columns in blog_positions:
#   impressions  = pageviews (Metrika ym:s:pageviews, organic only)
#   clicks       = visits    (Metrika ym:s:visits,    organic only)
#   avg_position = NULL  (site-level avg_position proxy abandoned)
#   ctr          = NULL
#   top_query    = NULL  (Metrika doesn't expose per-URL top query reliably)
#
# Fires daily via blog-positions.timer at 04:00 MSK +600s jitter.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
METRIKA_TOKEN_FILE="/home/deploy/.config/yandex-metrika/token"
LOG_FILE="/home/deploy/.claude/logs/track-positions.log"
COUNTER_ID=106801684

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
source "${SCRIPT_DIR}/notify.sh"

[[ -f "$BLOG_ENV_FILE" ]] && {
    set -a
    source "$BLOG_ENV_FILE"
    set +a
}

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    [[ -z "${!v:-}" ]] && {
        log "ERROR: $v not set"
        exit 1
    }
done

if [[ ! -f "$METRIKA_TOKEN_FILE" ]]; then
    log "ERROR: Metrika token file missing: $METRIKA_TOKEN_FILE"
    notify_failure "track-positions" "Metrika token missing — re-auth via device flow" "$LOG_FILE"
    exit 1
fi
METRIKA_TOKEN=$(cat "$METRIKA_TOKEN_FILE")

# Rotate log
if [[ -f "$LOG_FILE" ]] && (( $(wc -l < "$LOG_FILE") > 2000 )); then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

log "=== position tracking started ==="

# Token freshness check (guards against 401 silently zeroing everything)
TEST_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://api-metrika.yandex.net/management/v1/counters" -H "Authorization: OAuth ${METRIKA_TOKEN}")
if [[ "$TEST_CODE" != "200" ]]; then
    log "ERROR: Metrika token invalid (HTTP $TEST_CODE) — refresh via device flow"
    notify_failure "track-positions" "Metrika token invalid (HTTP $TEST_CODE) — re-auth via device flow" "$LOG_FILE"
    exit 1
fi

TODAY=$(date -u +%Y-%m-%d)
SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Accept-Profile: ai_aggregator")

# Fetch current 7d traffic (organic search only, ym:s:trafficSourceID==1)
# NOTE: use ym:s:pageviews (session metric), NOT ym:pv:pageviews — the pv:*
# prefix is incompatible with ym:s:* dimensions/filters in the same query.
CURRENT=$(curl -s --max-time 30 -G "https://api-metrika.yandex.net/stat/v1/data" \
    --data-urlencode "ids=${COUNTER_ID}" \
    --data-urlencode "metrics=ym:s:pageviews,ym:s:visits" \
    --data-urlencode "dimensions=ym:s:startURLPath" \
    --data-urlencode "filters=ym:s:startURLPath=~'^/blog/' AND ym:s:trafficSourceID==1" \
    --data-urlencode "date1=7daysAgo" --data-urlencode "date2=yesterday" \
    --data-urlencode "limit=500" --data-urlencode "sort=-ym:s:visits" \
    --data-urlencode "accuracy=low" \
    -H "Authorization: OAuth ${METRIKA_TOKEN}")
if [[ -z "$CURRENT" ]] || echo "$CURRENT" | grep -q '"errors"'; then
    log "ERROR: Metrika current-window fetch failed: ${CURRENT:0:200}"
    notify_failure "track-positions" "Metrika API error (current window)" "$LOG_FILE"
    exit 1
fi

# Fetch baseline 23d window (days 8..30)
BASELINE=$(curl -s --max-time 30 -G "https://api-metrika.yandex.net/stat/v1/data" \
    --data-urlencode "ids=${COUNTER_ID}" \
    --data-urlencode "metrics=ym:s:pageviews,ym:s:visits" \
    --data-urlencode "dimensions=ym:s:startURLPath" \
    --data-urlencode "filters=ym:s:startURLPath=~'^/blog/' AND ym:s:trafficSourceID==1" \
    --data-urlencode "date1=30daysAgo" --data-urlencode "date2=8daysAgo" \
    --data-urlencode "limit=500" --data-urlencode "sort=-ym:s:visits" \
    --data-urlencode "accuracy=low" \
    -H "Authorization: OAuth ${METRIKA_TOKEN}")
if [[ -z "$BASELINE" ]] || echo "$BASELINE" | grep -q '"errors"'; then
    log "WARN: Metrika baseline fetch failed — drop detection will be skipped"
    BASELINE='{"data":[]}'
fi

# Fetch all published posts (for mapping URL → post_id)
POSTS=$(curl -sf --max-time 30 \
    "${SUPABASE_URL}/rest/v1/blog_posts?select=id,slug,blog_categories(slug)&status=eq.published" \
    "${SUPA_HDRS[@]}")
if [[ -z "$POSTS" ]]; then
    log "ERROR: supabase blog_posts fetch failed"
    notify_failure "track-positions" "supabase blog_posts fetch failed" "$LOG_FILE"
    exit 1
fi

export CURRENT BASELINE POSTS SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY
export SNAPSHOT_DATE="$TODAY"

python3 - <<'PYEOF' 2>>"$LOG_FILE"
import json
import os
import sys
import urllib.request
from datetime import date

def log_err(msg):
    print(f"[py] {msg}", file=sys.stderr)

try:
    current = json.loads(os.environ['CURRENT'])
    baseline = json.loads(os.environ['BASELINE'])
    posts = json.loads(os.environ['POSTS'])
except Exception as e:
    log_err(f"parse payload failed: {e}")
    sys.exit(2)

supa = os.environ['SUPABASE_URL']
key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
today = os.environ['SNAPSHOT_DATE']

def idx_by_path(payload):
    out = {}
    for row in payload.get('data', []):
        dims = row.get('dimensions') or []
        if not dims:
            continue
        path = dims[0].get('name', '')
        metrics = row.get('metrics') or []
        if not path or len(metrics) < 2:
            continue
        out[path] = {
            'pageviews': int(metrics[0] or 0),
            'visits': int(metrics[1] or 0),
        }
    return out

cur_by_path = idx_by_path(current)
base_by_path = idx_by_path(baseline)
log_err(f"metrika: current_paths={len(cur_by_path)} baseline_paths={len(base_by_path)} posts={len(posts)}")

rows, drops = [], []
for p in posts:
    cat = (p.get('blog_categories') or {}).get('slug') or 'uncategorized'
    path = f"/blog/{cat}/{p['slug']}"
    url = f"https://gptweb.ru{path}"
    cur = cur_by_path.get(path, {'pageviews': 0, 'visits': 0})
    rows.append({
        'post_id': p['id'],
        'url': url,
        'snapshot_date': today,
        'avg_position': None,
        'impressions': cur['pageviews'],
        'clicks': cur['visits'],
        'ctr': None,
        'top_query': None,
    })
    # Drop detection: 7d current vs 23d baseline, both daily-normalized.
    base_raw = base_by_path.get(path, {'visits': 0})
    base_visits_per_day = base_raw['visits'] / 23.0
    cur_visits_per_day = cur['visits'] / 7.0
    # Flag only if baseline was meaningful (>=1 visit/day ≈ 23 visits/23d)
    # AND current dropped >=50%.
    if base_visits_per_day >= 1.0 and cur_visits_per_day < base_visits_per_day * 0.5:
        drops.append({
            'post_id': p['id'],
            'url': url,
            'baseline_visits_per_day': round(base_visits_per_day, 2),
            'current_visits_per_day': round(cur_visits_per_day, 2),
            'drop_pct': round((1.0 - (cur_visits_per_day / max(base_visits_per_day, 0.01))) * 100, 1),
        })

# Batch upsert blog_positions
req = urllib.request.Request(
    f"{supa}/rest/v1/blog_positions?on_conflict=post_id,snapshot_date",
    method='POST',
    data=json.dumps(rows).encode('utf-8'),
    headers={
        'apikey': key,
        'Authorization': f'Bearer {key}',
        'Accept-Profile': 'ai_aggregator',
        'Content-Profile': 'ai_aggregator',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    },
)
try:
    urllib.request.urlopen(req, timeout=30).read()
    log_err(f"upserted {len(rows)} position snapshots")
except Exception as e:
    log_err(f"upsert failed: {e}")
    sys.exit(3)

# For each drop, insert into reoptimize_queue only if no pending row exists
# for this post already (idempotent across re-runs).
flagged = 0
for d in drops:
    existing_url = (
        f"{supa}/rest/v1/reoptimize_queue"
        f"?post_id=eq.{d['post_id']}&status=eq.pending&limit=1"
    )
    hreq = urllib.request.Request(
        existing_url,
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Accept-Profile': 'ai_aggregator',
        },
    )
    try:
        existing = json.loads(urllib.request.urlopen(hreq, timeout=10).read())
    except Exception:
        existing = []
    if existing:
        continue

    payload = {
        'post_id': d['post_id'],
        'reason': (
            f"Metrika organic visits dropped {d['drop_pct']}% "
            f"(7d={d['current_visits_per_day']:.2f}/d vs "
            f"23d={d['baseline_visits_per_day']:.2f}/d)"
        ),
        'prev_position': d['baseline_visits_per_day'],
        'current_position': d['current_visits_per_day'],
        'position_delta': round(
            d['current_visits_per_day'] - d['baseline_visits_per_day'], 2
        ),
        'status': 'pending',
    }
    req = urllib.request.Request(
        f"{supa}/rest/v1/reoptimize_queue",
        method='POST',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'apikey': key,
            'Authorization': f'Bearer {key}',
            'Accept-Profile': 'ai_aggregator',
            'Content-Profile': 'ai_aggregator',
            'Content-Type': 'application/json',
        },
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        flagged += 1
        log_err(f"flagged drop: {d['url']} ({d['drop_pct']}%)")
    except Exception as e:
        log_err(f"flag failed {d['url']}: {e}")

# Summary to stderr (captured into log via 2>>"$LOG_FILE"); bash later greps it.
summary = {
    'upserted': len(rows),
    'drops': len(drops),
    'flagged': flagged,
    'drop_urls': [d['url'] for d in drops[:10]],
    'total_visits_7d': sum(r['clicks'] for r in rows),
    'total_pv_7d': sum(r['impressions'] for r in rows),
}
print(json.dumps(summary), file=sys.stderr)
PYEOF
PY_EXIT=$?

if [[ $PY_EXIT -ne 0 ]]; then
    log "ERROR: python position processing failed (exit=$PY_EXIT)"
    notify_failure "track-positions" "python position processing failed exit=$PY_EXIT" "$LOG_FILE"
    exit 1
fi

# Pull the summary JSON out of the log (Python printed it to stderr, which was
# redirected to the log file above). Match the most recent line.
SUMMARY_LINE=$(grep -oE '\{"upserted":[^}]*\}(\}|)?' "$LOG_FILE" | tail -1)
# Re-grep with a more permissive pattern if the above missed nested objects
if [[ -z "$SUMMARY_LINE" ]]; then
    SUMMARY_LINE=$(tac "$LOG_FILE" | grep -m1 -oE '\{"upserted".*\}$' || true)
fi

log "summary: ${SUMMARY_LINE:-(no summary)}"

DROP_COUNT=$(echo "$SUMMARY_LINE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d.get('drops', 0))
except Exception:
    print(0)
" 2>/dev/null || echo 0)

if [[ "${DROP_COUNT:-0}" -gt 0 ]]; then
    DROP_URLS=$(echo "$SUMMARY_LINE" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print('\n'.join(d.get('drop_urls', [])))
except Exception:
    pass
" 2>/dev/null)
    BODY="<h2>Blog traffic drops (&ge; 50% vs 23-day baseline)</h2><p>${DROP_COUNT} URL(s) flagged for re-optimize:</p><ul>"
    while IFS= read -r u; do
        [[ -n "$u" ]] && BODY+="<li><a href=\"${u}\">${u}</a></li>"
    done <<< "$DROP_URLS"
    BODY+="</ul><p><a href=\"https://ask.gptweb.ru/admin/blog/reoptimize\">Open reoptimize queue</a></p>"
    notify_email "[Blog traffic] ${DROP_COUNT} drop(s) flagged" "$BODY"
    log "digest email sent — ${DROP_COUNT} drops"
fi

log "=== position tracking complete ==="
