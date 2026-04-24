#!/usr/bin/env bash
# track-positions.sh — Daily job: for each published blog post, store a
# snapshot row in ai_aggregator.blog_positions. Detect drops (Δ ≥ 10) vs the
# 7-day rolling best position, push flagged posts to reoptimize_queue, and
# emit a digest email (see trailing block).
#
# Aggregate-position proxy: Yandex Webmaster's /search-queries/popular/ does
# NOT attach a URL per query. So the per-URL "avg_position" we store is the
# site-wide weighted-average position (Σ pos*shows / Σ shows). This is a
# known limitation — every post gets the same position value on a given day.
# Drop detection still works (same site-level trend flags the whole corpus).
# Per-URL attribution would require Metrika search-phrases with URL dimension,
# tracked as open item #1 in the plan.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/track-positions.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
source "${SCRIPT_DIR}/notify.sh"

[[ -f "$BLOG_ENV_FILE" ]] && {
    set -a
    source "$BLOG_ENV_FILE"
    set +a
}

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY YANDEX_WEBMASTER_TOKEN YANDEX_WEBMASTER_USER_ID YANDEX_WEBMASTER_HOST_ID; do
    [[ -z "${!v:-}" ]] && {
        log "ERROR: $v not set"
        exit 1
    }
done

log "=== position tracking started ==="
TODAY=$(date -u +%Y-%m-%d)
WM_BASE="https://api.webmaster.yandex.net/v4/user/${YANDEX_WEBMASTER_USER_ID}/hosts/${YANDEX_WEBMASTER_HOST_ID}"

# Pull top 500 queries with position data from Webmaster
WM_RESP=$(curl -sf --max-time 30 \
    "${WM_BASE}/search-queries/popular/?query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&query_indicator=AVG_SHOW_POSITION&order_by=TOTAL_CLICKS&limit=500" \
    -H "Authorization: OAuth ${YANDEX_WEBMASTER_TOKEN}")
if [[ -z "$WM_RESP" ]]; then
    log "ERROR: webmaster fetch failed"
    notify_failure "track-positions" "webmaster API unreachable" "$LOG_FILE"
    exit 1
fi

# Pull all published blog posts
POSTS=$(curl -sf --max-time 30 \
    "${SUPABASE_URL}/rest/v1/blog_posts?select=id,slug,blog_categories(slug)&status=eq.published" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Accept-Profile: ai_aggregator")
if [[ -z "$POSTS" ]]; then
    log "ERROR: supabase blog_posts fetch failed"
    notify_failure "track-positions" "supabase blog_posts fetch failed" "$LOG_FILE"
    exit 1
fi

# Pipe JSON payloads via stdin (as a JSON envelope) — avoids shell interpolation
# of untrusted JSON into a heredoc. Python reads envelope from stdin, snapshot
# date from env, Supabase creds from env.
export WM_JSON="$WM_RESP"
export POSTS_JSON="$POSTS"
export SNAPSHOT_DATE="$TODAY"

SUMMARY_LINE=$(python3 - <<'PYEOF'
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

def log_err(msg):
    print(msg, file=sys.stderr)

try:
    wm = json.loads(os.environ['WM_JSON'])
    posts = json.loads(os.environ['POSTS_JSON'])
except Exception as e:
    log_err(f"parse payload failed: {e}")
    sys.exit(2)

supa_url = os.environ['SUPABASE_URL']
supa_key = os.environ['SUPABASE_SERVICE_ROLE_KEY']
today_s = os.environ['SNAPSHOT_DATE']

# Compute site-level weighted average position across all queries
queries = wm.get('queries', []) or []
total_shows = 0
total_clicks = 0
pos_weighted_num = 0.0
for q in queries:
    ind = q.get('indicators', {}) or {}
    shows = int(ind.get('TOTAL_SHOWS', 0) or 0)
    clicks = int(ind.get('TOTAL_CLICKS', 0) or 0)
    pos = float(ind.get('AVG_SHOW_POSITION', 0) or 0)
    total_shows += shows
    total_clicks += clicks
    pos_weighted_num += pos * shows

avg_pos = (pos_weighted_num / total_shows) if total_shows > 0 else None
log_err(f"site: queries={len(queries)} total_shows={total_shows} total_clicks={total_clicks} avg_pos={avg_pos}")

# Build one snapshot per published post (site-level proxy)
rows = []
for p in posts:
    cat = (p.get('blog_categories') or {}).get('slug') or 'uncategorized'
    url = f"https://gptweb.ru/blog/{cat}/{p['slug']}"
    rows.append({
        'post_id': p['id'],
        'url': url,
        'snapshot_date': today_s,
        'avg_position': round(avg_pos, 2) if avg_pos is not None else None,
        'impressions': 0,
        'clicks': 0,
        'ctr': None,
        'top_query': None,
    })

# Batch upsert
req = urllib.request.Request(
    f"{supa_url}/rest/v1/blog_positions?on_conflict=post_id,snapshot_date",
    method='POST',
    data=json.dumps(rows).encode('utf-8'),
    headers={
        'apikey': supa_key,
        'Authorization': f'Bearer {supa_key}',
        'Accept-Profile': 'ai_aggregator',
        'Content-Profile': 'ai_aggregator',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    },
)
try:
    urllib.request.urlopen(req, timeout=30).read()
    log_err(f'upserted {len(rows)} position snapshots')
except Exception as e:
    log_err(f'upsert failed: {e}')
    sys.exit(3)

# Detect drops: compare today's position against 7-day rolling best (min)
drops = []
if avg_pos is not None:
    from_date = (date.fromisoformat(today_s) - timedelta(days=8)).isoformat()
    for p in posts:
        cat = (p.get('blog_categories') or {}).get('slug') or 'uncategorized'
        url = f"https://gptweb.ru/blog/{cat}/{p['slug']}"
        hist_url = (
            f"{supa_url}/rest/v1/blog_positions"
            f"?post_id=eq.{p['id']}"
            f"&snapshot_date=gte.{from_date}"
            f"&snapshot_date=lt.{today_s}"
            f"&select=snapshot_date,avg_position"
            f"&order=snapshot_date.asc"
        )
        hreq = urllib.request.Request(
            hist_url,
            headers={
                'apikey': supa_key,
                'Authorization': f'Bearer {supa_key}',
                'Accept-Profile': 'ai_aggregator',
            },
        )
        try:
            hist = json.loads(urllib.request.urlopen(hreq, timeout=10).read())
        except Exception:
            hist = []
        past = [h['avg_position'] for h in hist if h.get('avg_position') is not None]
        if not past:
            continue
        prev_best = min(past)  # best = lowest position number
        delta = avg_pos - prev_best
        if delta >= 10:
            drops.append({
                'post_id': p['id'],
                'url': url,
                'prev': prev_best,
                'current': avg_pos,
                'delta': round(delta, 2),
            })

# Flag drops into reoptimize_queue
for d in drops:
    payload = {
        'post_id': d['post_id'],
        'reason': f"avg_position dropped from {d['prev']:.1f} to {d['current']:.1f} (Δ{d['delta']:+.1f})",
        'prev_position': d['prev'],
        'current_position': d['current'],
        'position_delta': d['delta'],
        'status': 'pending',
    }
    req = urllib.request.Request(
        f"{supa_url}/rest/v1/reoptimize_queue",
        method='POST',
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'apikey': supa_key,
            'Authorization': f'Bearer {supa_key}',
            'Accept-Profile': 'ai_aggregator',
            'Content-Profile': 'ai_aggregator',
            'Content-Type': 'application/json',
        },
    )
    try:
        urllib.request.urlopen(req, timeout=10)
        log_err(f'flagged drop: {d["url"]} Δ{d["delta"]}')
    except Exception as e:
        log_err(f'flag failed {d["url"]}: {e}')

# Emit a single JSON summary line on stdout (captured by shell)
print(json.dumps({
    'upserted': len(rows),
    'drops': len(drops),
    'drop_urls': [d['url'] for d in drops[:10]],
}))
PYEOF
)
PY_EXIT=$?

if [[ $PY_EXIT -ne 0 ]]; then
    log "ERROR: python position processing failed (exit=$PY_EXIT)"
    notify_failure "track-positions" "python position processing failed exit=$PY_EXIT" "$LOG_FILE"
    exit 1
fi

log "summary: ${SUMMARY_LINE}"
log "=== position tracking complete ==="

# --- Task 5: Daily digest email on drops -----------------------------------
# The Python block emits a single-line JSON summary as its final stdout print,
# captured into $SUMMARY_LINE. Re-grep from the log as a resilience fallback.
SUMMARY_JSON="$SUMMARY_LINE"
if [[ -z "$SUMMARY_JSON" ]]; then
    SUMMARY_JSON=$(grep -oE '\{"upserted":[^}]*\}' "$LOG_FILE" | tail -1)
fi
DROP_COUNT=$(echo "$SUMMARY_JSON" | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print(d.get('drops', 0))
except Exception:
    print(0)
" 2>/dev/null || echo 0)

if [[ "${DROP_COUNT:-0}" -gt 0 ]]; then
    DROP_URLS=$(echo "$SUMMARY_JSON" | python3 -c "import json,sys
try:
    d = json.load(sys.stdin)
    print('\n'.join(d.get('drop_urls', [])))
except Exception:
    pass
" 2>/dev/null)
    BODY="<h2>Blog position drops (Δ ≥ 10)</h2><p>${DROP_COUNT} URL(s) flagged for re-optimize:</p><ul>"
    while IFS= read -r u; do
        [[ -n "$u" ]] && BODY+="<li><a href=\"${u}\">${u}</a></li>"
    done <<< "$DROP_URLS"
    BODY+="</ul><p><a href=\"https://ask.gptweb.ru/admin/blog/reoptimize\">Open reoptimize queue</a></p>"
    notify_email "[Blog positions] ${DROP_COUNT} drop(s) flagged" "$BODY"
    log "digest email sent — ${DROP_COUNT} drops"
fi
