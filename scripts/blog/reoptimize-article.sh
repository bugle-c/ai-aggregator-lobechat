#!/usr/bin/env bash
# reoptimize-article.sh — Rewrite title + meta_description + first
# paragraph for a blog post flagged in reoptimize_queue. Pulls the
# post's current content and the top queries that used to rank for it
# (from Yandex Webmaster), asks Claude to rewrite for better coverage,
# updates Supabase, marks the queue row 'done'.
#
# Usage:
#   reoptimize-article.sh <post_id>        # rewrite a specific post
#   reoptimize-article.sh --next           # pick oldest pending, rewrite it
#
# Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
# YANDEX_WEBMASTER_*, CLAUDE_CMD. BREVO_API_KEY+NOTIFY_EMAIL optional.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/reoptimize-article.log"
CLAUDE_CMD="${CLAUDE_CMD:-/home/deploy/.local/bin/claude}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE" >&2; }

# Load env
if [[ -f "$BLOG_ENV_FILE" ]]; then
  set -a; source "$BLOG_ENV_FILE"; set +a
fi

# Load notification helper (depends on env being loaded)
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/notify.sh"

for v in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY; do
  if [[ -z "${!v:-}" ]]; then
    log "ERROR: $v not set"
    exit 1
  fi
done

# Rotate log
if [[ -f "$LOG_FILE" ]] && (( $(wc -l < "$LOG_FILE") > 2000 )); then
  tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Accept-Profile: ai_aggregator")
SUPA_WRITE_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Content-Profile: ai_aggregator" -H "Content-Type: application/json")

MODE="${1:?post_id or --next required}"

# Step 1: Resolve target post_id and queue_id
POST_ID=""
QUEUE_ID=""
if [[ "$MODE" == "--next" ]]; then
  ROW=$(curl -sf "${SUPABASE_URL}/rest/v1/reoptimize_queue?status=eq.pending&order=flagged_at.asc&limit=1&select=id,post_id" "${SUPA_HDRS[@]}")
  POST_ID=$(echo "$ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['post_id'] if d else '')")
  QUEUE_ID=$(echo "$ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
  if [[ -z "$POST_ID" ]]; then
    log "No pending reoptimize rows."
    echo '{"status":"idle","message":"queue is empty"}'
    exit 0
  fi
else
  POST_ID="$MODE"
  ROW=$(curl -sf "${SUPABASE_URL}/rest/v1/reoptimize_queue?post_id=eq.${POST_ID}&status=eq.pending&limit=1&select=id" "${SUPA_HDRS[@]}")
  QUEUE_ID=$(echo "$ROW" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
fi

log "=== reoptimize post_id=$POST_ID queue_id=${QUEUE_ID:-n/a} ==="

# Mark queue row in_progress (if exists)
if [[ -n "$QUEUE_ID" ]]; then
  curl -sf -X PATCH "${SUPABASE_URL}/rest/v1/reoptimize_queue?id=eq.${QUEUE_ID}" \
    "${SUPA_WRITE_HDRS[@]}" \
    -d '{"status":"in_progress"}' >/dev/null 2>&1 || true
fi

# Revert queue row to pending on failure
revert_queue() {
  local note="${1:-unknown failure}"
  if [[ -n "$QUEUE_ID" ]]; then
    curl -sf -X PATCH "${SUPABASE_URL}/rest/v1/reoptimize_queue?id=eq.${QUEUE_ID}" \
      "${SUPA_WRITE_HDRS[@]}" \
      -d "$(python3 -c "import json,sys; print(json.dumps({'status':'pending','notes':sys.argv[1]}))" "$note")" \
      >/dev/null 2>&1 || true
  fi
}

# Step 2: Pull the post
POST=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_posts?id=eq.${POST_ID}&select=id,slug,title,description,content,meta_title,meta_description,category_id,blog_categories(slug)" "${SUPA_HDRS[@]}")
if [[ -z "$POST" || "$POST" == "[]" ]]; then
  log "ERROR: post $POST_ID not found"
  revert_queue "post not found"
  notify_failure "reoptimize-article" "post $POST_ID not found" "$LOG_FILE"
  exit 1
fi

TITLE=$(echo "$POST" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['title'])")
DESC=$(echo "$POST" | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d.get('meta_description') or d.get('description') or '')")
CONTENT_FIRST=$(echo "$POST" | python3 -c "
import json,sys,re
c = json.load(sys.stdin)[0]['content'] or ''
m = re.search(r'<p[^>]*>(.+?)</p>', c, re.DOTALL)
print((m.group(0) if m else c[:800]).strip())
")
CAT_SLUG=$(echo "$POST" | python3 -c "import json,sys; p=json.load(sys.stdin)[0]; c=p.get('blog_categories'); print(c.get('slug') if c else 'uncategorized')")
POST_SLUG=$(echo "$POST" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['slug'])")
URL="https://gptweb.ru/blog/${CAT_SLUG}/${POST_SLUG}"

# Step 3: Pull top queries from Webmaster (host-wide — per-URL not exposed on popular endpoint).
# Best-effort: if Webmaster fails, we just feed empty list and rewrite from current content only.
TOP_QUERIES=""
if [[ -n "${YANDEX_WEBMASTER_TOKEN:-}" && -n "${YANDEX_WEBMASTER_USER_ID:-}" && -n "${YANDEX_WEBMASTER_HOST_ID:-}" ]]; then
  TOP_QUERIES=$(curl -sf "https://api.webmaster.yandex.net/v4/user/${YANDEX_WEBMASTER_USER_ID}/hosts/${YANDEX_WEBMASTER_HOST_ID}/search-queries/popular/?query_indicator=TOTAL_SHOWS&query_indicator=TOTAL_CLICKS&order_by=TOTAL_SHOWS&limit=50" \
    -H "Authorization: OAuth ${YANDEX_WEBMASTER_TOKEN}" 2>/dev/null | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    out = []
    for q in (d.get('queries') or [])[:20]:
        text = q.get('query_text') or ''
        shows = (q.get('indicators') or {}).get('TOTAL_SHOWS', 0) or 0
        if text:
            out.append(f'- {text} ({shows} shows)')
    print('\n'.join(out))
except Exception:
    pass
" 2>/dev/null)
fi
log "Pulled top queries: $(echo "$TOP_QUERIES" | grep -c . || echo 0) entries"

# Step 4: LLM rewrite
unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

PROMPT="You are an SEO editor improving an existing Russian-language article for WebGPT (ask.gptweb.ru).

CRITICAL BRAND RULES: Brand is ALWAYS 'WebGPT'. Never 'WeGPT'.

Current article
- URL: ${URL}
- Current title: \"${TITLE}\"
- Current meta description: \"${DESC}\"
- Current first paragraph (HTML):
${CONTENT_FIRST}

TOP SEARCH QUERIES ON THE SITE (for context — sorted by impressions):
${TOP_QUERIES:-(none — Webmaster returned no query data)}

Task: rewrite ONLY the title, meta_description, and first paragraph to better cover search intent. Body stays untouched.

Rules
- Keep the factual claims — do not invent new numbers or products.
- Title: 50-65 chars, include primary semantic of the article topic.
- Meta description: 130-160 chars, natural Russian, one concrete hook.
- First paragraph: 2-4 sentences, cover the main intent; return a single <p>...</p> block.
- Respect the existing voice and tone.

Return ONLY a valid JSON object (no markdown fences, no commentary):
{
  \"title\": \"...\",
  \"meta_description\": \"...\",
  \"first_paragraph_html\": \"<p>...</p>\"
}"

STDOUT_FILE=$(mktemp /tmp/claude-reopt-XXXXXX.txt)
STDERR_FILE=$(mktemp /tmp/claude-reopt-err-XXXXXX.txt)
timeout 240 "$CLAUDE_CMD" --print -p "$PROMPT" --output-format json > "$STDOUT_FILE" 2> "$STDERR_FILE"
CLI_EXIT=$?
RAW=$(cat "$STDOUT_FILE")
CLI_STDERR=$(cat "$STDERR_FILE")
rm -f "$STDOUT_FILE" "$STDERR_FILE"

if [[ $CLI_EXIT -ne 0 || -z "$RAW" ]]; then
  log "ERROR: Claude CLI exit=$CLI_EXIT stderr=${CLI_STDERR:0:300}"
  revert_queue "Claude CLI failed"
  notify_failure "reoptimize-article" "Claude CLI failed for $POST_ID (exit=$CLI_EXIT)" "$LOG_FILE"
  exit 1
fi

REWRITE=$(echo "$RAW" | python3 -c "
import json, sys, re
data = json.load(sys.stdin)
result = data.get('result', '').strip()
result = re.sub(r'^\`\`\`(?:json)?\s*\n?', '', result)
result = re.sub(r'\n?\`\`\`\s*\$', '', result).strip()
s = result.find('{'); e = result.rfind('}')
if s == -1 or e == -1: print('{}'); sys.exit(0)
rewrite = json.loads(result[s:e+1])
for f in ('title', 'meta_description', 'first_paragraph_html'):
    if not rewrite.get(f): print('{}'); sys.exit(0)
print(json.dumps(rewrite, ensure_ascii=False))
" 2>/dev/null || echo '{}')

if [[ "$REWRITE" == "{}" ]]; then
  log "ERROR: failed to parse rewrite JSON"
  revert_queue "LLM parse failed"
  notify_failure "reoptimize-article" "failed to parse LLM rewrite for $POST_ID" "$LOG_FILE"
  exit 1
fi

NEW_TITLE=$(echo "$REWRITE" | python3 -c "import json,sys; print(json.load(sys.stdin)['title'])")
NEW_META=$(echo "$REWRITE" | python3 -c "import json,sys; print(json.load(sys.stdin)['meta_description'])")
NEW_FIRST=$(echo "$REWRITE" | python3 -c "import json,sys; print(json.load(sys.stdin)['first_paragraph_html'])")

log "New title: $NEW_TITLE"

# Step 5: Build updated content — swap first <p> block
UPDATED_CONTENT=$(ORIG_POST="$POST" NEW_FIRST="$NEW_FIRST" python3 -c "
import json, os, re, sys
orig = json.loads(os.environ['ORIG_POST'])[0]['content'] or ''
new_p = os.environ['NEW_FIRST']
if re.search(r'<p[^>]*>.+?</p>', orig, re.DOTALL):
    updated = re.sub(r'<p[^>]*>.+?</p>', lambda m: new_p, orig, count=1, flags=re.DOTALL)
else:
    updated = new_p + '\n' + orig
sys.stdout.write(updated)
")

# Update blog_posts directly via PostgREST (service role bypasses RLS).
# We cannot use admin PUT /api/blog/posts — that route requires cookie auth.
UPDATE_PAYLOAD=$(POST_ID="$POST_ID" NEW_TITLE="$NEW_TITLE" NEW_META="$NEW_META" UPDATED_CONTENT="$UPDATED_CONTENT" python3 -c "
import json, os, datetime
print(json.dumps({
  'title': os.environ['NEW_TITLE'],
  'meta_title': os.environ['NEW_TITLE'],
  'meta_description': os.environ['NEW_META'],
  'content': os.environ['UPDATED_CONTENT'],
  'updated_at': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
}, ensure_ascii=False))
")

PUT_RESP=$(curl -s -X PATCH "${SUPABASE_URL}/rest/v1/blog_posts?id=eq.${POST_ID}" \
  "${SUPA_WRITE_HDRS[@]}" \
  -H "Prefer: return=representation" \
  -w "\n%{http_code}" \
  -d "$UPDATE_PAYLOAD")
HTTP_CODE=$(echo "$PUT_RESP" | tail -1)
BODY=$(echo "$PUT_RESP" | sed '$d')
if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "204" ]]; then
  log "ERROR: PATCH blog_posts HTTP $HTTP_CODE — ${BODY:0:300}"
  revert_queue "Supabase update failed (HTTP $HTTP_CODE)"
  notify_failure "reoptimize-article" "Supabase PATCH blog_posts HTTP $HTTP_CODE" "$LOG_FILE"
  exit 1
fi

# Step 6: Mark queue row 'done'
if [[ -n "$QUEUE_ID" ]]; then
  curl -sf -X PATCH "${SUPABASE_URL}/rest/v1/reoptimize_queue?id=eq.${QUEUE_ID}" \
    "${SUPA_WRITE_HDRS[@]}" \
    -d "$(python3 -c "import json,datetime; print(json.dumps({'status':'done','resolved_at':datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),'notes':'auto-rewritten'}))")" \
    >/dev/null 2>&1 || true
fi

log "=== reoptimize done post=$POST_ID ==="
echo "{\"status\":\"ok\",\"post_id\":\"$POST_ID\",\"queue_id\":${QUEUE_ID:-null},\"new_title\":\"$(echo "$NEW_TITLE" | sed 's/"/\\"/g')\"}"
