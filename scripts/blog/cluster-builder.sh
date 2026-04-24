#!/usr/bin/env bash
# cluster-builder.sh — Given a seed keyword, build a cluster of 10-15
# related long-tails via Yandex Wordstat (xmlriver) + LLM relevance filter,
# save to ai_aggregator.blog_clusters, print cluster id (plain integer) to stdout.
#
# Usage:
#   CLUSTER_ID=$(cluster-builder.sh "чем заменить midjourney" "reviews")
#
# Requires in env: XMLRIVER_USER, XMLRIVER_API_KEY, SUPABASE_URL,
# SUPABASE_SERVICE_ROLE_KEY, CLAUDE_CMD (optional, defaults to /home/deploy/.local/bin/claude).
#
# Idempotent: if a pending cluster already exists for primary_keyword=$SEED,
# returns that id instead of creating a new one.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/cluster-builder.log"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2
}

[[ -f "$BLOG_ENV_FILE" ]] && {
  set -a
  source "$BLOG_ENV_FILE"
  set +a
}

CLAUDE_CMD="${CLAUDE_CMD:-/home/deploy/.local/bin/claude}"

SEED="${1:?seed required}"
CATEGORY="${2:-}"

log "cluster-builder seed='$SEED' category='$CATEGORY'"

# Sanity-check required env vars
for v in XMLRIVER_USER XMLRIVER_API_KEY SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if [[ -z "${!v:-}" ]]; then
    log "ERROR: $v not set"
    exit 1
  fi
done

SUPA_HDRS=(
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}"
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
  -H "Accept-Profile: ai_aggregator"
)

# Idempotency: check if a pending cluster for this seed already exists
SEED_ENC=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$SEED")
EXISTING=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_clusters?primary_keyword=eq.${SEED_ENC}&status=eq.pending&select=id&limit=1" \
  "${SUPA_HDRS[@]}" 2>/dev/null || echo "[]")
EXISTING_ID=$(echo "$EXISTING" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    print(d[0]['id'] if d else '')
except Exception:
    print('')
" 2>/dev/null)
if [[ -n "$EXISTING_ID" ]]; then
  log "reusing existing pending cluster id=$EXISTING_ID"
  echo "$EXISTING_ID"
  exit 0
fi

# Step A: Wordstat expansion on seed
log "Wordstat lookup on '$SEED'"
WS_RAW=$(
  # shellcheck disable=SC1091
  source "${SCRIPT_DIR}/wordstat.sh"
  wordstat "$SEED" 2>/dev/null || echo '{}'
)

# Parse the actual xmlriver response shape:
#   { "associations": [{isAssociations, value, text}, ...],
#     "popular":      [{isAssociations, value, text}, ...] }
# `value` is a STRING, coerce with int(). Use popular as seed deepening,
# associations as siblings; union both.
RELATED_RAW=$(echo "$WS_RAW" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
out = []
for bucket_name in ('popular', 'associations'):
    for item in d.get(bucket_name, []) or []:
        phrase = (item.get('text') or '').strip()
        freq_raw = item.get('value', 0)
        try:
            freq = int(freq_raw) if isinstance(freq_raw, str) else int(freq_raw or 0)
        except (TypeError, ValueError):
            freq = 0
        if phrase and freq > 0:
            out.append({'phrase': phrase, 'freq': freq})
# Dedupe by phrase (max freq wins)
seen = {}
for it in out:
    if it['phrase'] not in seen or it['freq'] > seen[it['phrase']]['freq']:
        seen[it['phrase']] = it
top = sorted(seen.values(), key=lambda x: -x['freq'])[:30]
print(json.dumps(top, ensure_ascii=False))
" 2>/dev/null)

if [[ -z "$RELATED_RAW" ]]; then
  RELATED_RAW="[]"
fi

CANDIDATE_COUNT=$(echo "$RELATED_RAW" | python3 -c "
import json, sys
try:
    print(len(json.load(sys.stdin)))
except Exception:
    print(0)
" 2>/dev/null)
log "Wordstat produced $CANDIDATE_COUNT candidates"

# Step B: LLM relevance filter — keep 10-15 most coherent for a single article
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

FILTER_OUT="[]"
if [[ "$CANDIDATE_COUNT" -ge 5 ]]; then
  CAND_LIST=$(echo "$RELATED_RAW" | python3 -c "
import json, sys
for it in json.load(sys.stdin):
    print(f\"- {it['phrase']} ({it['freq']}/mo)\")
")

  FILTER_PROMPT="You are filtering Yandex search queries for topical coherence.

Primary keyword: \"${SEED}\"
Candidates (phrase + monthly frequency):
${CAND_LIST}

Task: select 10-15 candidates that form a COHERENT single-topic cluster — they should all be answerable by one well-written article targeting the primary keyword. Exclude:
- queries that drift to unrelated topics
- queries that would need a totally different angle than the primary
- navigational queries (people searching for a specific brand/site)

Return ONLY a JSON array of selected phrases, e.g. [\"phrase 1\", \"phrase 2\", ...]. No other text."

  LLM_RAW=$(timeout 120 "$CLAUDE_CMD" --print -p "$FILTER_PROMPT" --output-format json 2>/dev/null || echo "")
  if [[ -n "$LLM_RAW" ]]; then
    FILTER_OUT=$(echo "$LLM_RAW" | python3 -c "
import json, sys, re
try:
    wrapper = json.load(sys.stdin)
    result = (wrapper.get('result', '') or '').strip()
    result = re.sub(r'^\`\`\`(?:json)?\s*\n?', '', result)
    result = re.sub(r'\n?\`\`\`\s*$', '', result).strip()
    start = result.find('[')
    end = result.rfind(']')
    if start == -1 or end == -1 or end <= start:
        print('[]')
    else:
        phrases = json.loads(result[start:end+1])
        if not isinstance(phrases, list):
            print('[]')
        else:
            phrases = [p for p in phrases if isinstance(p, str) and p.strip()]
            print(json.dumps(phrases, ensure_ascii=False))
except Exception:
    print('[]')
" 2>/dev/null)
  fi
fi

FILTER_COUNT=$(echo "$FILTER_OUT" | python3 -c "
import json, sys
try:
    print(len(json.load(sys.stdin)))
except Exception:
    print(0)
" 2>/dev/null)

# Fallback: if LLM returned empty / failed, take top 15 phrases by frequency
if [[ "${FILTER_COUNT:-0}" -lt 1 ]]; then
  log "LLM filter empty/failed — falling back to top 15 by frequency"
  FILTER_OUT=$(echo "$RELATED_RAW" | python3 -c "
import json, sys
arr = json.load(sys.stdin)
top = [x['phrase'] for x in arr[:15]]
print(json.dumps(top, ensure_ascii=False))
" 2>/dev/null || echo "[]")
  FILTER_COUNT=$(echo "$FILTER_OUT" | python3 -c "
import json, sys
try:
    print(len(json.load(sys.stdin)))
except Exception:
    print(0)
" 2>/dev/null)
fi

log "cluster contains $FILTER_COUNT related phrases"

# Step C: total_impressions = sum of freqs across SELECTED phrases
TOTAL_IMPRESSIONS=$(python3 -c "
import json
arr = json.loads('''${RELATED_RAW}''')
selected = set(json.loads('''${FILTER_OUT}'''))
print(sum(x['freq'] for x in arr if x['phrase'] in selected))
" 2>/dev/null || echo 0)

# Step D: Insert cluster row
INSERT_PAYLOAD=$(SEED="$SEED" CATEGORY="$CATEGORY" FILTER_OUT="$FILTER_OUT" TOTAL_IMPRESSIONS="$TOTAL_IMPRESSIONS" python3 -c "
import json, os
payload = {
  'primary_keyword':   os.environ['SEED'],
  'related_keywords':  json.loads(os.environ['FILTER_OUT']),
  'avg_competition':   0.5,
  'total_impressions': int(os.environ.get('TOTAL_IMPRESSIONS') or '0'),
  'category_slug':     (os.environ.get('CATEGORY') or None) or None,
  'status':            'pending',
}
print(json.dumps(payload, ensure_ascii=False))
")

NEW_ROW=$(curl -sf -X POST "${SUPABASE_URL}/rest/v1/blog_clusters" \
  -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Accept-Profile: ai_aggregator" \
  -H "Content-Profile: ai_aggregator" \
  -H "Content-Type: application/json" \
  -H "Prefer: return=representation" \
  -d "$INSERT_PAYLOAD" 2>/dev/null)

NEW_ID=$(echo "$NEW_ROW" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    if isinstance(d, list) and d:
        print(d[0].get('id') or '')
    elif isinstance(d, dict):
        print(d.get('id') or '')
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null)

if [[ -z "$NEW_ID" ]]; then
  log "ERROR: could not insert cluster row. Response: ${NEW_ROW:0:300}"
  exit 1
fi

log "cluster created id=$NEW_ID primary='$SEED' related_count=$FILTER_COUNT total_impressions=$TOTAL_IMPRESSIONS"
echo "$NEW_ID"
