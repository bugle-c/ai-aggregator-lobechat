#!/usr/bin/env bash
# generate-article.sh — Generate an SEO article using Claude Code CLI
# Runs via systemd timer at 22:00 and 01:00 UTC (01:00 and 04:00 MSK)

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

if [[ -z "$CRON_SECRET" ]]; then
    log "ERROR: CRON_SECRET not set"
    notify_failure "generate-article" "CRON_SECRET not set" "$LOG_FILE"
    exit 1
fi

# Ensure Claude CLI doesn't detect nested session
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

# Step 1: Get next keyword via API
log "Fetching next keyword..."
KEYWORD_JSON=$(curl -sf "${API_URL}/api/cron/blog-keywords/next" \
    -H "Authorization: Bearer ${CRON_SECRET}" || echo "")

if [[ -z "$KEYWORD_JSON" || "$KEYWORD_JSON" == "null" ]]; then
    log "No pending keywords found. Triggering keyword collection..."
    curl -sf -X POST "${API_URL}/api/cron/blog-keywords" \
        -H "Authorization: Bearer ${CRON_SECRET}" || true
    log "Keywords collected. Will generate article on next run."
    exit 0
fi

KEYWORD=$(echo "$KEYWORD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['keyword'])" 2>/dev/null) || true
KEYWORD_ID=$(echo "$KEYWORD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])" 2>/dev/null) || true

if [[ -z "${KEYWORD:-}" ]]; then
    log "ERROR: Failed to parse keyword from response: ${KEYWORD_JSON:0:200}"
    notify_failure "generate-article" "Failed to parse keyword from API response" "$LOG_FILE"
    exit 1
fi

log "Keyword: '$KEYWORD' (id=$KEYWORD_ID)"

# Step 2: Generate article via Claude Code
log "Generating article with Claude Code..."

PROMPT="You are an expert SEO copywriter for WebGPT (ask.gptweb.ru), a Russian-language platform that provides access to AI tools like ChatGPT, Claude, Gemini, and DeepSeek.

Write a comprehensive SEO article in Russian for the keyword: \"${KEYWORD}\"

Requirements:
- 3000-5000 words of deep, expert-level content in Russian
- Use HTML markup: h2, h3, p, ul, ol, blockquote (NO h1 — it will be the title)
- Include 5-7 image placeholders using this exact format:
  <figure data-image-query=\"english search query for stock photo\"><figcaption>Описание на русском</figcaption></figure>
- Naturally mention WebGPT (ask.gptweb.ru) 2-3 times as a tool recommendation
- Pick the best category: reviews (обзоры AI), prompts (промпты и гайды), news (новости AI), cases (кейсы использования)
- Write engaging, practical content with real examples and actionable advice
- Avoid generic filler text — every paragraph should have value

CRITICAL: Return ONLY a valid JSON object. No markdown code blocks, no extra text before or after.
{
  \"title\": \"SEO-optimized headline in Russian\",
  \"slug\": \"url-friendly-slug-in-english\",
  \"description\": \"1-2 sentence preview in Russian\",
  \"content\": \"full HTML article body\",
  \"category\": \"reviews|prompts|news|cases\",
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
result = data.get('result', '')

# Strip leading/trailing whitespace
result = result.strip()

# Strip markdown code blocks if present (e.g., \`\`\`json ... \`\`\`)
result = re.sub(r'^\`\`\`(?:json)?\s*\n?', '', result)
result = re.sub(r'\n?\`\`\`\s*$', '', result)
result = result.strip()

# Find the JSON object: first { to last }
start = result.find('{')
end = result.rfind('}')
if start == -1 or end == -1 or end <= start:
    print('ERROR: No JSON object found in result', file=sys.stderr)
    sys.exit(1)

json_str = result[start:end+1]
article = json.loads(json_str)

# Validate required fields
required = ['title', 'slug', 'content', 'category']
missing = [f for f in required if not article.get(f)]
if missing:
    print(f'ERROR: Missing fields: {missing}', file=sys.stderr)
    sys.exit(1)

print(json.dumps(article, ensure_ascii=False))
" 2>&1)

PARSE_EXIT=$?
if [[ $PARSE_EXIT -ne 0 || -z "$ARTICLE_JSON" || "$ARTICLE_JSON" == ERROR:* ]]; then
    log "ERROR: Failed to extract article JSON from Claude output (exit=$PARSE_EXIT)"
    log "Parse output: ${ARTICLE_JSON:0:300}"
    # Log raw Claude result for debugging
    RESULT_PREVIEW=$(echo "$RAW_OUTPUT" | python3 -c "
import json, sys
data = json.load(sys.stdin)
r = data.get('result', '')
print(r[:500])
" 2>/dev/null) || true
    log "Raw result preview: ${RESULT_PREVIEW:0:500}"
    notify_failure "generate-article" "Failed to parse article JSON from Claude output. Keyword: ${KEYWORD:-unknown}" "$LOG_FILE"
    exit 1
fi

log "Article generated successfully"

# Step 3: Send to API for processing (images + DB insert)
log "Saving article via API..."

# Add keyword_id to the JSON and save to temp file (avoids shell expansion issues with large payloads)
TMPFILE=$(mktemp /tmp/blog-article-XXXXXX.json)
echo "$ARTICLE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['keyword_id'] = '${KEYWORD_ID}'
print(json.dumps(data, ensure_ascii=False))
" > "$TMPFILE" 2>/dev/null

if [[ ! -s "$TMPFILE" ]]; then
    log "ERROR: Failed to prepare article JSON with keyword_id"
    rm -f "$TMPFILE"
    notify_failure "generate-article" "Failed to prepare article JSON with keyword_id. Keyword: ${KEYWORD:-unknown}" "$LOG_FILE"
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
log "Article saved as draft. Post ID: ${POST_ID:-unknown}"
log "=== Article generation complete ==="
