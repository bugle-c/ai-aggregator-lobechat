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

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/wordstat.sh"

CLAUDE_CMD="${CLAUDE_CMD:-/home/deploy/.local/bin/claude}"

SEED="${1:?seed required}"
CATEGORY="${2:-}"

# Domains to exclude from competition count (generic portals / aggregators /
# forums — not "real" SEO competitors). Matched as substring in hostname.
GENERIC_PATTERNS=(
  "wikipedia.org" "wikimedia.org" "dzen.ru" "zen.yandex" "vk.com" "vk.ru"
  "avito.ru" "ok.ru" "yandex.ru" "yandex.com" "google.com" "google.ru"
  "youtube.com" "t.me" "telegram.me" "rutube.ru" "pikabu.ru" "reddit.com"
  "habr.com" "habrahabr.ru" "stackoverflow.com" "quora.com"
  "mail.ru" "rambler.ru" "sputnik.ru"
)

is_generic_domain() {
  local host="$1"
  for pat in "${GENERIC_PATTERNS[@]}"; do
    if [[ "$host" == *"$pat"* ]]; then return 0; fi
  done
  return 1
}

# get_competition(phrase, freq) -> score in [0.0, 1.0] printed to stdout.
# If freq < 100 -> 0.10 (no SERP fetch, treat as low-competition long-tail).
# Else: fetch SERP via xmlriver, count unique non-generic domains in top 10,
# normalize to 0..1 (count/10).
get_competition() {
  local phrase="$1"
  local freq="$2"
  if [[ "$freq" -lt 100 ]]; then
    echo "0.10"
    return 0
  fi
  local domains_json
  domains_json=$(search_serp "$phrase" 2>/dev/null) || { echo "0.50"; return 0; }
  if [[ -z "$domains_json" ]]; then
    echo "0.50"
    return 0
  fi
  DOMAINS_JSON="$domains_json" python3 <<'PYEOF'
import os, json, sys
try:
    domains = json.loads(os.environ.get('DOMAINS_JSON') or '[]')
except Exception:
    print("0.50")
    sys.exit(0)
generic = ['wikipedia.org','wikimedia.org','dzen.ru','zen.yandex','vk.com','vk.ru',
           'avito.ru','ok.ru','yandex.ru','yandex.com','google.com','google.ru',
           'youtube.com','t.me','telegram.me','rutube.ru','pikabu.ru','reddit.com',
           'habr.com','habrahabr.ru','stackoverflow.com','quora.com',
           'mail.ru','rambler.ru','sputnik.ru']
seen = set()
count = 0
for host in domains:
    if not host or host in seen:
        continue
    seen.add(host)
    if any(g in host for g in generic):
        continue
    count += 1
count = max(0, min(count, 10))
print(f"{count/10.0:.2f}")
PYEOF
}

# shorten_seed(seed) -> up to 3 most "information-dense" words from seed.
# Strips stop-words, prefers longer tokens, restores their natural order.
shorten_seed() {
  SEED_ARG="$1" python3 <<'PYEOF'
import os, re
seed = os.environ.get('SEED_ARG', '')
stopwords = {
    'как','что','где','когда','почему','чем','зачем','для','про','при',
    'какой','какая','какое','какие','каким','каких','какую',
    'без','все','этот','эта','это','мой','наш','свой',
    'в','на','с','по','к','о','об','от','до','из','за','под','над',
    'и','или','а','но','же','ли','не','ни','бы','ведь',
    'год','году','лет','месяц','2026','2025','2024',
    'работает','работают','работа','делать','сделать','можно',
}
words = re.findall(r'[а-яёa-z0-9]+', seed.lower())
filtered = [w for w in words if w not in stopwords and len(w) >= 3]
filtered_unique = []
seen = set()
for w in filtered:
    if w not in seen:
        seen.add(w)
        filtered_unique.append(w)
filtered_unique.sort(key=lambda w: (-len(w), w))
top = set(filtered_unique[:3])
# Restore seed-order
order = []
seen2 = set()
for w in words:
    if w in top and w not in seen2:
        seen2.add(w)
        order.append(w)
print(' '.join(order))
PYEOF
}

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

# Step A: Wordstat expansion on seed (with short-seed retry on thin results)
try_wordstat() {
  local try_seed="$1"
  local ws
  ws=$(wordstat "$try_seed" 2>/dev/null || echo '{}')
  echo "$ws" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print('[]')
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
seen = {}
for it in out:
    if it['phrase'] not in seen or it['freq'] > seen[it['phrase']]['freq']:
        seen[it['phrase']] = it
top = sorted(seen.values(), key=lambda x: -x['freq'])[:30]
print(json.dumps(top, ensure_ascii=False))
" 2>/dev/null || echo "[]"
}

log "Wordstat lookup on '$SEED'"
RELATED_RAW=$(try_wordstat "$SEED")
if [[ -z "$RELATED_RAW" ]]; then RELATED_RAW="[]"; fi

CANDIDATE_COUNT=$(echo "$RELATED_RAW" | python3 -c "
import json, sys
try:
    print(len(json.load(sys.stdin)))
except Exception:
    print(0)
" 2>/dev/null)
log "Wordstat produced $CANDIDATE_COUNT candidates on primary seed"

# If too few and seed is long, retry with shortened version
WORD_COUNT=$(SEED_ARG="$SEED" python3 -c "import os,re; print(len(re.findall(r'[а-яёa-z0-9]+', os.environ['SEED_ARG'].lower())))")
if [[ "$CANDIDATE_COUNT" -lt 5 ]] && [[ "$WORD_COUNT" -ge 4 ]]; then
  SHORT_SEED=$(shorten_seed "$SEED")
  if [[ -n "$SHORT_SEED" ]] && [[ "$SHORT_SEED" != "$SEED" ]]; then
    log "Seed too long (${WORD_COUNT} words, ${CANDIDATE_COUNT} candidates), retrying with short seed: '$SHORT_SEED'"
    RELATED_RAW=$(try_wordstat "$SHORT_SEED")
    if [[ -z "$RELATED_RAW" ]]; then RELATED_RAW="[]"; fi
    CANDIDATE_COUNT=$(echo "$RELATED_RAW" | python3 -c "
import json, sys
try:
    print(len(json.load(sys.stdin)))
except Exception:
    print(0)
" 2>/dev/null)
    log "Wordstat returned $CANDIDATE_COUNT candidates on short seed '$SHORT_SEED'"
  fi
fi

if [[ "$CANDIDATE_COUNT" -lt 3 ]]; then
  log "WARN: still only $CANDIDATE_COUNT candidates after retry — minimal cluster ahead"
fi

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
TOTAL_IMPRESSIONS=$(RELATED_RAW="$RELATED_RAW" FILTER_OUT="$FILTER_OUT" python3 -c "
import json, os
arr = json.loads(os.environ.get('RELATED_RAW') or '[]')
selected = set(json.loads(os.environ.get('FILTER_OUT') or '[]'))
print(sum(x['freq'] for x in arr if x['phrase'] in selected))
" 2>/dev/null || echo 0)

# Step C2: avg_competition across selected phrases. Sample top-5 by freq to
# cap SERP fetches per cluster.
AVG_COMPETITION="0.10"
if [[ "${FILTER_COUNT:-0}" -gt 0 ]]; then
  SAMPLED=$(RELATED_RAW="$RELATED_RAW" FILTER_OUT="$FILTER_OUT" python3 -c "
import json, os
selected = json.loads(os.environ.get('FILTER_OUT') or '[]')
arr = json.loads(os.environ.get('RELATED_RAW') or '[]')
freq_map = {x['phrase']: x['freq'] for x in arr}
ranked = sorted(selected, key=lambda p: -freq_map.get(p, 0))[:5]
print(json.dumps([[p, freq_map.get(p, 0)] for p in ranked], ensure_ascii=False))
")
  SCORES=()
  while IFS=$'\t' read -r phrase freq; do
    [[ -z "$phrase" ]] && continue
    score=$(get_competition "$phrase" "$freq")
    log "competition: phrase='$phrase' freq=$freq score=$score"
    SCORES+=("$score")
  done < <(SAMPLED="$SAMPLED" python3 -c "
import json, os
for p, f in json.loads(os.environ.get('SAMPLED') or '[]'):
    print(f'{p}\t{f}')
")
  if [[ ${#SCORES[@]} -gt 0 ]]; then
    AVG_COMPETITION=$(SCORES="${SCORES[*]}" python3 -c "
import os
parts = os.environ.get('SCORES','').split()
vals = [float(x) for x in parts if x]
if not vals:
    print('0.50')
else:
    print(f'{sum(vals)/len(vals):.2f}')
")
  else
    AVG_COMPETITION="0.50"
  fi
fi
log "avg_competition across cluster: $AVG_COMPETITION"

# Step D: Insert cluster row
INSERT_PAYLOAD=$(SEED="$SEED" CATEGORY="$CATEGORY" FILTER_OUT="$FILTER_OUT" TOTAL_IMPRESSIONS="$TOTAL_IMPRESSIONS" AVG_COMPETITION="$AVG_COMPETITION" python3 -c "
import json, os
payload = {
  'primary_keyword':   os.environ['SEED'],
  'related_keywords':  json.loads(os.environ['FILTER_OUT']),
  'avg_competition':   float(os.environ.get('AVG_COMPETITION') or '0.5'),
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
