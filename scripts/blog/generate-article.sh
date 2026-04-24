#!/usr/bin/env bash
# generate-article.sh — Generate an SEO article using Claude Code CLI
# Runs via systemd timer in multiple slots per day. Each invocation picks
# the first active category that hasn't received a post today and writes
# exactly one article into it. Idempotent: re-running within the same day
# after all categories are served is a no-op.

set -uo pipefail
# NOTE: -e intentionally NOT set — we handle errors explicitly to avoid silent failures

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/blog-generate.log"
API_URL="https://ask.gptweb.ru/admin"
CRON_SECRET="${CRON_SECRET:-}"
CLAUDE_CMD="/home/deploy/.local/bin/claude"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Load notification helper
source "${SCRIPT_DIR}/notify.sh"

# Rotate log
if [[ -f "$LOG_FILE" ]] && (( $(wc -l < "$LOG_FILE") > 2000 )); then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

log "=== Article generation started ==="

# Load env vars
if [[ -f "$BLOG_ENV_FILE" ]]; then
    set -a; source "$BLOG_ENV_FILE"; set +a
fi

for v in CRON_SECRET SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
    if [[ -z "${!v:-}" ]]; then
        log "ERROR: $v not set"
        notify_failure "generate-article" "$v not set" "$LOG_FILE"
        exit 1
    fi
done

# Ensure Claude CLI doesn't detect nested session
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Accept-Profile: ai_aggregator")

# Step 0: Pick today's unfilled category — idempotent round-robin.
TODAY_UTC=$(date -u +%Y-%m-%d)
ACTIVE_CATS=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_categories?select=slug,name,id&is_active=eq.true&order=sort_order" "${SUPA_HDRS[@]}" 2>/dev/null)
if [[ -z "$ACTIVE_CATS" || "$ACTIVE_CATS" == "[]" ]]; then
    log "ERROR: no active categories"
    notify_failure "generate-article" "no active categories" "$LOG_FILE"
    exit 1
fi

TARGET_CAT=""
TARGET_CAT_ID=""
TARGET_CAT_NAME=""
while IFS=$'\t' read -r slug cname cid; do
    [[ -z "$slug" ]] && continue
    count_resp=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_posts?select=id&category_id=eq.${cid}&created_at=gte.${TODAY_UTC}T00:00:00Z&limit=1" "${SUPA_HDRS[@]}" 2>/dev/null)
    if [[ "$count_resp" == "[]" ]]; then
        TARGET_CAT="$slug"
        TARGET_CAT_ID="$cid"
        TARGET_CAT_NAME="$cname"
        break
    fi
done < <(echo "$ACTIVE_CATS" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(f\"{r['slug']}\t{r['name']}\t{r['id']}\")
")

if [[ -z "$TARGET_CAT" ]]; then
    log "All active categories already have a post for $TODAY_UTC — nothing to do."
    log "=== Article generation complete (nothing to do) ==="
    exit 0
fi

log "Target category for today: $TARGET_CAT ($TARGET_CAT_NAME)"

# Step 1: Get next keyword — prefer one hinted for this category, else fall back to /next.
KEYWORD=""
KEYWORD_ID=""
KW_CAT_MATCH=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword&status=eq.pending&category_slug=eq.${TARGET_CAT}&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}" 2>/dev/null)
if [[ -n "$KW_CAT_MATCH" && "$KW_CAT_MATCH" != "[]" ]]; then
    KEYWORD=$(echo "$KW_CAT_MATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['keyword'] if d else '')")
    KEYWORD_ID=$(echo "$KW_CAT_MATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
    log "Keyword (category-hinted): '$KEYWORD' (id=$KEYWORD_ID)"
else
    log "No category-hinted keyword for '$TARGET_CAT', falling back to global queue"
    KEYWORD_JSON=$(curl -sf "${API_URL}/api/cron/blog-keywords/next" \
        -H "Authorization: Bearer ${CRON_SECRET}" || echo "")
    if [[ -z "$KEYWORD_JSON" || "$KEYWORD_JSON" == "null" ]]; then
        log "No pending keywords at all. Triggering collection..."
        curl -sf -X POST "${API_URL}/api/cron/blog-keywords" \
            -H "Authorization: Bearer ${CRON_SECRET}" || true
        exit 0
    fi
    KEYWORD=$(echo "$KEYWORD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('keyword',''))" 2>/dev/null)
    KEYWORD_ID=$(echo "$KEYWORD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
    log "Keyword (fallback): '$KEYWORD' (id=$KEYWORD_ID)"
fi

if [[ -z "${KEYWORD:-}" ]]; then
    log "ERROR: Failed to obtain keyword"
    notify_failure "generate-article" "Failed to obtain keyword for category $TARGET_CAT" "$LOG_FILE"
    exit 1
fi

# Step 1.75: Build or reuse cluster for this keyword (Wordstat + LLM relevance filter)
CLUSTER_ID=$("${SCRIPT_DIR}/cluster-builder.sh" "$KEYWORD" "$TARGET_CAT" 2>>"$LOG_FILE" || echo "")
if [[ -z "$CLUSTER_ID" ]]; then
    log "WARN: cluster-builder failed for keyword '$KEYWORD', falling back to single-keyword mode"
fi

RELATED_LIST=""
if [[ -n "$CLUSTER_ID" ]]; then
    RELATED_LIST=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_clusters?id=eq.${CLUSTER_ID}&select=related_keywords" \
        "${SUPA_HDRS[@]}" 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    for r in (d[0].get('related_keywords', []) if d else []):
        print(f'- {r}')
except Exception:
    pass
" 2>/dev/null)
    [[ -n "$RELATED_LIST" ]] && log "using cluster id=$CLUSTER_ID, primary='$KEYWORD', related=$(echo "$RELATED_LIST" | wc -l)"
fi

# Step 1.5: Dedup guard — fetch titles in TARGET category so LLM avoids topical duplicates
EXISTING_TITLES=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_posts?select=title&status=eq.published&category_id=eq.${TARGET_CAT_ID}&order=created_at.desc&limit=60" "${SUPA_HDRS[@]}" 2>/dev/null | python3 -c "
import json, sys
try:
    rows = json.load(sys.stdin)
    for r in rows:
        t = r.get('title', '').strip()
        if t: print(f'- {t}')
except Exception:
    pass
" 2>/dev/null)
[[ -n "$EXISTING_TITLES" ]] && log "Loaded $(echo "$EXISTING_TITLES" | wc -l) existing titles in $TARGET_CAT for dedup context"

# Pre-check: is the keyword an obvious dupe of an existing title in THIS category?
if [[ -n "$EXISTING_TITLES" ]]; then
    DUP_CHECK=$(echo "$EXISTING_TITLES" | python3 -c "
import sys, re
kw = '''${KEYWORD}'''.lower()
kw_words = set(re.findall(r'[а-яёa-z0-9]{4,}', kw))
if len(kw_words) < 2:
    sys.exit(0)
for line in sys.stdin:
    title = line.strip().lstrip('- ').lower()
    title_words = set(re.findall(r'[а-яёa-z0-9]{4,}', title))
    if not title_words: continue
    overlap = len(kw_words & title_words)
    if overlap >= max(2, int(len(kw_words) * 0.8)):
        print(line.strip())
        sys.exit(0)
" 2>/dev/null)
    if [[ -n "$DUP_CHECK" ]]; then
        log "SKIP: keyword '$KEYWORD' too similar to existing article in $TARGET_CAT: $DUP_CHECK"
        curl -sf -X PATCH "${SUPABASE_URL}/rest/v1/blog_keywords?id=eq.${KEYWORD_ID}" \
            "${SUPA_HDRS[@]}" \
            -H "Content-Profile: ai_aggregator" \
            -H "Content-Type: application/json" \
            -d "{\"status\":\"duplicate\",\"updated_at\":\"$(date -u +%FT%TZ)\"}" >/dev/null 2>&1 || true
        log "=== Article generation skipped (duplicate) ==="
        exit 0
    fi
fi

# Step 2: Generate article via Claude Code — category is FORCED to target.
log "Generating article with Claude Code for category '$TARGET_CAT'..."

PROMPT="You are an expert SEO copywriter for WebGPT (ask.gptweb.ru), a Russian-language platform that provides access to AI tools like ChatGPT, Claude, Gemini, and DeepSeek.

CRITICAL BRAND RULES:
- The brand is ALWAYS spelled \"WebGPT\" (capital W, lowercase eb, capital GPT). Never \"WeGPT\", \"Web GPT\", \"Wegpt\", \"WEBGPT\", or any other variation.
- If the keyword contains a misspelling of the brand (e.g. \"wegpt ru\", \"web gpt\", \"вебгпт\") — treat it as a misspelled search for WebGPT. Write the article in Russian using the correct brand \"WebGPT\" throughout. DO NOT invent a separate product called \"WeGPT\".
- Canonical domains: ask.gptweb.ru (app), gptweb.ru (marketing).

Write a comprehensive SEO article in Russian for the keyword: \"${KEYWORD}\"

PRIMARY KEYWORD: \"${KEYWORD}\"

RELATED LONG-TAILS (article MUST naturally cover these — at least 60% should appear as h2/h3 headings or paragraph topics):
${RELATED_LIST:-(none — fallback to single-keyword mode)}

REQUIRED CATEGORY: ${TARGET_CAT} — ${TARGET_CAT_NAME}
You MUST return category=\"${TARGET_CAT}\". Shape the article to fit this category:
- reviews: обзор возможностей, плюсы/минусы, кому подойдёт
- prompts: конкретные промпты и шаблоны с объяснением
- news: свежие события и их анализ
- cases: реальные кейсы использования с результатами
- guides: пошаговая инструкция 'как сделать X'
- business: применение в продажах/маркетинге/HR с цифрами и ROI
- education: для школьников, студентов, абитуриентов, рефератов, дипломов

EXISTING PUBLISHED ARTICLES IN THIS CATEGORY (avoid duplicating their angle — pick a fresh perspective, a narrower sub-topic, or a more specific use case):
${EXISTING_TITLES:-(none)}

Requirements:
- 3000-5000 words of deep, expert-level content in Russian
- Use HTML markup: h2, h3, p, ul, ol, blockquote (NO h1 — it will be the title)
- Include 5-7 image placeholders using this exact format:
  <figure data-image-query=\"english search query for stock photo\"><figcaption>Описание на русском</figcaption></figure>
- Naturally mention WebGPT (ask.gptweb.ru) 2-3 times as a tool recommendation
- Write engaging, practical content with real examples and actionable advice
- Avoid generic filler text — every paragraph should have value

CRITICAL: Return ONLY a valid JSON object. No markdown code blocks, no extra text before or after.
{
  \"title\": \"SEO-optimized headline in Russian\",
  \"slug\": \"url-friendly-slug-in-english\",
  \"description\": \"1-2 sentence preview in Russian\",
  \"content\": \"full HTML article body\",
  \"category\": \"${TARGET_CAT}\",
  \"meta_title\": \"SEO title ≤60 chars in Russian\",
  \"meta_description\": \"SEO description ≤160 chars in Russian\",
  \"meta_keywords\": \"comma,separated,keywords,in,russian\"
}"

STDOUT_FILE=$(mktemp /tmp/claude-stdout-XXXXXX.txt)
STDERR_FILE=$(mktemp /tmp/claude-stderr-XXXXXX.txt)

timeout 480 "$CLAUDE_CMD" --print -p "$PROMPT" --output-format json \
    > "$STDOUT_FILE" 2> "$STDERR_FILE"
CLI_EXIT=$?

RAW_OUTPUT=$(cat "$STDOUT_FILE")
CLI_STDERR=$(cat "$STDERR_FILE")
rm -f "$STDOUT_FILE" "$STDERR_FILE"

if [[ $CLI_EXIT -ne 0 ]]; then
    log "ERROR: Claude CLI exited with code $CLI_EXIT"
    [[ -n "$CLI_STDERR" ]] && log "Stderr: ${CLI_STDERR:0:500}"
fi

if [[ -z "$RAW_OUTPUT" ]]; then
    log "ERROR: Claude Code returned empty response"
    [[ -n "$CLI_STDERR" ]] && log "Stderr: ${CLI_STDERR:0:500}"
    notify_failure "generate-article" "Claude Code returned empty response (exit=$CLI_EXIT). Keyword: ${KEYWORD:-unknown}" "$LOG_FILE"
    exit 1
fi

log "Claude CLI returned $(echo "$RAW_OUTPUT" | wc -c) bytes"

# Extract the article JSON from Claude CLI wrapper (--output-format json wraps in {"result": "..."})
ARTICLE_JSON=$(echo "$RAW_OUTPUT" | python3 -c "
import json, sys, re
data = json.load(sys.stdin)
result = data.get('result', '').strip()
result = re.sub(r'^\`\`\`(?:json)?\s*\n?', '', result)
result = re.sub(r'\n?\`\`\`\s*$', '', result)
result = result.strip()
start = result.find('{')
end = result.rfind('}')
if start == -1 or end == -1 or end <= start:
    print('ERROR: No JSON object found in result', file=sys.stderr); sys.exit(1)
article = json.loads(result[start:end+1])
# Force category in case LLM ignored the instruction
article['category'] = '${TARGET_CAT}'
required = ['title', 'slug', 'content', 'category']
missing = [f for f in required if not article.get(f)]
if missing:
    print(f'ERROR: Missing fields: {missing}', file=sys.stderr); sys.exit(1)
print(json.dumps(article, ensure_ascii=False))
" 2>&1)

PARSE_EXIT=$?
if [[ $PARSE_EXIT -ne 0 || -z "$ARTICLE_JSON" || "$ARTICLE_JSON" == ERROR:* ]]; then
    log "ERROR: Failed to extract article JSON from Claude output (exit=$PARSE_EXIT)"
    log "Parse output: ${ARTICLE_JSON:0:300}"
    notify_failure "generate-article" "Failed to parse article JSON from Claude output. Keyword: ${KEYWORD:-unknown}" "$LOG_FILE"
    exit 1
fi

log "Article generated successfully"

# Step 3: Send to API for processing (images + DB insert + auto-publish)
log "Saving article via API (auto_publish=true)..."

TMPFILE=$(mktemp /tmp/blog-article-XXXXXX.json)
echo "$ARTICLE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['keyword_id'] = '${KEYWORD_ID}'
data['cluster_id'] = int('${CLUSTER_ID}') if '${CLUSTER_ID}' else None
data['auto_publish'] = True
print(json.dumps(data, ensure_ascii=False))
" > "$TMPFILE" 2>/dev/null

if [[ ! -s "$TMPFILE" ]]; then
    log "ERROR: Failed to prepare article JSON with keyword_id"
    rm -f "$TMPFILE"
    notify_failure "generate-article" "Failed to prepare article JSON. Keyword: ${KEYWORD:-unknown}" "$LOG_FILE"
    exit 1
fi

RESPONSE=$(curl -s -X POST "${API_URL}/api/cron/blog-generate" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    -H "Content-Type: application/json" \
    -w "\n%{http_code}" \
    -d @"$TMPFILE" 2>>"$LOG_FILE") || true
rm -f "$TMPFILE"

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

if [[ "$HTTP_CODE" != "201" && "$HTTP_CODE" != "200" ]]; then
    log "ERROR: API returned HTTP $HTTP_CODE"
    log "Response: ${RESPONSE_BODY:0:500}"
    notify_failure "generate-article" "API returned HTTP $HTTP_CODE. Keyword: ${KEYWORD:-unknown}. Response: ${RESPONSE_BODY:0:200}" "$LOG_FILE"
    exit 1
fi

POST_ID=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null) || true
POST_STATUS=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null) || true
log "Article saved. Post ID: ${POST_ID:-unknown}  status=${POST_STATUS:-unknown}  category=${TARGET_CAT}"
log "=== Article generation complete ==="
