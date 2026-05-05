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

# Step 1: Find a non-duplicate keyword. Loop with limited attempts so a single
# duplicate hit doesn't waste the slot. Each iteration: fetch a candidate, run
# the dedup pre-check; if dup, mark skipped (using a status value that satisfies
# the blog_keywords_status_check constraint) and try the next candidate. Cluster
# build is deferred until a non-dup candidate is chosen so we don't build clusters
# for keywords we'll immediately discard.
KEYWORD=""
KEYWORD_ID=""
CLUSTER_ID=""
RELATED_LIST=""
MAX_KEYWORD_ATTEMPTS=5

# Pre-load published titles in target category once — same dedup corpus for all attempts.
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

# Mark a keyword as skipped so the queue advances. Surfaces non-2xx HTTP codes
# in the log so a future schema change (e.g., status enum revision) doesn't go
# unnoticed and re-trigger the duplicate-keyword loop bug.
mark_keyword_skipped() {
    local kw_id="$1"
    local reason="$2"
    local http_code body_file
    body_file=$(mktemp /tmp/skip-resp-XXXXXX.txt)
    http_code=$(curl -s -o "$body_file" -w "%{http_code}" -X PATCH "${SUPABASE_URL}/rest/v1/blog_keywords?id=eq.${kw_id}" \
        "${SUPA_HDRS[@]}" \
        -H "Content-Profile: ai_aggregator" \
        -H "Content-Type: application/json" \
        -d "{\"status\":\"skipped\",\"updated_at\":\"$(date -u +%FT%TZ)\"}" 2>/dev/null)
    if [[ "$http_code" =~ ^2 ]]; then
        log "Marked keyword id=${kw_id} as skipped (${reason}, HTTP ${http_code})"
    else
        local body
        body=$(cat "$body_file" 2>/dev/null)
        log "WARN: failed to mark keyword id=${kw_id} skipped (HTTP ${http_code}, reason=${reason}): ${body:0:200}"
    fi
    rm -f "$body_file"
}

for attempt in $(seq 1 $MAX_KEYWORD_ATTEMPTS); do
    CANDIDATE_KEYWORD=""
    CANDIDATE_ID=""

    KW_CAT_MATCH=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_keywords?select=id,keyword&status=eq.pending&category_slug=eq.${TARGET_CAT}&order=priority.asc,impressions.desc&limit=1" "${SUPA_HDRS[@]}" 2>/dev/null)
    if [[ -n "$KW_CAT_MATCH" && "$KW_CAT_MATCH" != "[]" ]]; then
        CANDIDATE_KEYWORD=$(echo "$KW_CAT_MATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['keyword'] if d else '')")
        CANDIDATE_ID=$(echo "$KW_CAT_MATCH" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
        log "Attempt ${attempt}/${MAX_KEYWORD_ATTEMPTS} keyword (category-hinted): '$CANDIDATE_KEYWORD' (id=$CANDIDATE_ID)"
    else
        [[ $attempt -eq 1 ]] && log "No category-hinted keyword for '$TARGET_CAT', falling back to global queue"
        KEYWORD_JSON=$(curl -sf "${API_URL}/api/cron/blog-keywords/next" \
            -H "Authorization: Bearer ${CRON_SECRET}" || echo "")
        if [[ -z "$KEYWORD_JSON" || "$KEYWORD_JSON" == "null" ]]; then
            log "No pending keywords at all. Triggering collection..."
            curl -sf -X POST "${API_URL}/api/cron/blog-keywords" \
                -H "Authorization: Bearer ${CRON_SECRET}" || true
            exit 0
        fi
        CANDIDATE_KEYWORD=$(echo "$KEYWORD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('keyword',''))" 2>/dev/null)
        CANDIDATE_ID=$(echo "$KEYWORD_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
        log "Attempt ${attempt}/${MAX_KEYWORD_ATTEMPTS} keyword (fallback): '$CANDIDATE_KEYWORD' (id=$CANDIDATE_ID)"
    fi

    if [[ -z "$CANDIDATE_KEYWORD" || -z "$CANDIDATE_ID" ]]; then
        log "ERROR: Failed to obtain keyword on attempt ${attempt}"
        notify_failure "generate-article" "Failed to obtain keyword for category $TARGET_CAT" "$LOG_FILE"
        exit 1
    fi

    # Pre-check: is the candidate an obvious dupe of an existing title in THIS category?
    DUP_CHECK=""
    if [[ -n "$EXISTING_TITLES" ]]; then
        DUP_CHECK=$(echo "$EXISTING_TITLES" | KW="$CANDIDATE_KEYWORD" python3 -c "
import sys, re, os
kw = os.environ.get('KW', '').lower()
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
    fi
    if [[ -n "$DUP_CHECK" ]]; then
        log "DUP: keyword '$CANDIDATE_KEYWORD' too similar to existing in $TARGET_CAT: $DUP_CHECK"
        mark_keyword_skipped "$CANDIDATE_ID" "duplicate vs ${TARGET_CAT}"
        continue
    fi

    # Candidate passed dedup. Lock in keyword and build cluster.
    KEYWORD="$CANDIDATE_KEYWORD"
    KEYWORD_ID="$CANDIDATE_ID"

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
    break
done

if [[ -z "${KEYWORD:-}" ]]; then
    log "All ${MAX_KEYWORD_ATTEMPTS} keyword candidates were duplicates — slot exhausted, queue advanced"
    log "=== Article generation skipped (all candidates duplicates) ==="
    exit 0
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

SEO/GEO STRUCTURE REQUIREMENTS (mandatory, audited automatically after publish):
1. ANSWER-FIRST INTRO: The very first <p> after no heading must be a 80-150 word definitional answer block. It MUST start with the topic followed by 'это', 'представляет собой', 'означает', 'помогает', 'позволяет' or 'это сервис/инструмент/способ'. Example: 'X — это <определение>. Он помогает <задача>. В этом материале мы разбираем <план>.'
2. QUESTION-LED H2 HEADINGS: At least 4 of the H2 headings must be question-style. Use Russian patterns like: 'Что такое X?', 'Как X работает?', 'Почему X важно?', 'Сколько стоит X?', 'Кому подойдёт X?', 'Когда использовать X?'. Avoid declarative-only H2.
3. FAQ SECTION AT THE END: The final H2 must be 'Часто задаваемые вопросы' with 3-5 H3 subheadings, each phrased as a real user question, followed by a 2-4 sentence answer. This will be auto-wrapped into FAQPage JSON-LD by the publishing pipeline.
4. SOURCES: Include 3-5 outbound links to authoritative sources (official documentation, research, OpenAI/Anthropic blog, RBC, Habr, Ведомости). Use anchor text that describes the destination — never 'тут', 'здесь', 'подробнее', 'далее', 'читать'.
5. INTERNAL LINKS: Include 2-3 internal links to other relevant blog posts using descriptive anchors (slugs unknown to you — use placeholder pattern '/blog/<category>/<slug>' that an editor will fix; describe in anchor what the linked article is about).
6. DEFINITION LIST WHERE APPLICABLE: When comparing 3+ items or listing terminology, prefer <dl><dt>термин</dt><dd>пояснение</dd></dl> over <ul>. AI answer engines extract <dl> blocks well.
7. REGIONAL SIGNAL: Mention that the service/topic works in Russia/СНГ at least once in the first 500 words — this is a Yandex regional signal.
8. AUTHORITY SIGNAL: Include at least one quoted statistic with a source attribution like 'по данным <источник>'.
9. PARAGRAPH BALANCE: Avoid paragraphs longer than 100 words. Mix prose with lists every 2-3 paragraphs.
10. META DESCRIPTION: Must include the primary keyword AND a clear value proposition. Word-overlap with title should be <60% (avoid duplicating title).

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

# Try Claude CLI up to 2 times. A non-zero exit (e.g. transient API/rate-limit
# error) typically returns within seconds with a tiny error JSON that the parser
# can't extract — retrying once after a short backoff catches the common case
# without lengthening the slot. The next scheduled timer slot is the long-tail
# retry path if both attempts here fail.
RAW_OUTPUT=""
CLI_STDERR=""
CLI_EXIT=0
MAX_CLAUDE_ATTEMPTS=2
for try in $(seq 1 $MAX_CLAUDE_ATTEMPTS); do
    STDOUT_FILE=$(mktemp /tmp/claude-stdout-XXXXXX.txt)
    STDERR_FILE=$(mktemp /tmp/claude-stderr-XXXXXX.txt)
    timeout 480 "$CLAUDE_CMD" --print -p "$PROMPT" --output-format json \
        > "$STDOUT_FILE" 2> "$STDERR_FILE"
    CLI_EXIT=$?
    RAW_OUTPUT=$(cat "$STDOUT_FILE")
    CLI_STDERR=$(cat "$STDERR_FILE")
    rm -f "$STDOUT_FILE" "$STDERR_FILE"

    if [[ $CLI_EXIT -eq 0 && -n "$RAW_OUTPUT" ]]; then
        break
    fi
    log "Claude CLI try ${try}/${MAX_CLAUDE_ATTEMPTS} failed (exit=$CLI_EXIT, bytes=$(printf '%s' "$RAW_OUTPUT" | wc -c))"
    [[ -n "$CLI_STDERR" ]] && log "Stderr: ${CLI_STDERR:0:500}"
    if [[ $try -lt $MAX_CLAUDE_ATTEMPTS ]]; then
        log "Sleeping 30s before retry..."
        sleep 30
    fi
done

if [[ $CLI_EXIT -ne 0 || -z "$RAW_OUTPUT" ]]; then
    log "ERROR: Claude CLI exhausted ${MAX_CLAUDE_ATTEMPTS} attempts (last exit=$CLI_EXIT)"
    notify_failure "generate-article" "Claude CLI failed after ${MAX_CLAUDE_ATTEMPTS} attempts (exit=$CLI_EXIT). Keyword: ${KEYWORD:-unknown}. Stderr: ${CLI_STDERR:0:200}" "$LOG_FILE"
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

# Step 3: Send to API as DRAFT first. We pre-publish-audit the rendered
# preview URL, and only flip to published when it passes the SEO gate.
log "Saving article via API as draft (auto_publish=false)..."

TMPFILE=$(mktemp /tmp/blog-article-XXXXXX.json)
echo "$ARTICLE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['keyword_id'] = '${KEYWORD_ID}'
data['cluster_id'] = int('${CLUSTER_ID}') if '${CLUSTER_ID}' else None
data['auto_publish'] = False
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
POST_SLUG=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('slug',''))" 2>/dev/null) || true
log "Draft saved. Post ID: ${POST_ID:-unknown}  status=${POST_STATUS:-unknown}  slug=${POST_SLUG}  category=${TARGET_CAT}"

# Step 4: Pre-publish SEO audit gate. Only promote draft → published if the
# auditor passes (score >= threshold AND zero FAIL findings). Otherwise the
# row stays as draft and an admin can review/fix manually.
if [[ -z "$POST_ID" || "$POST_ID" = "?" ]]; then
    log "ERROR: Post ID missing from API response — aborting before audit"
    notify_failure "generate-article" "Post ID missing from blog-generate response" "$LOG_FILE"
    exit 1
fi

if [[ -z "${BLOG_PREVIEW_TOKEN:-}" ]]; then
    log "WARN: BLOG_PREVIEW_TOKEN not set — skipping pre-publish gate, leaving as draft"
    notify_failure "generate-article" "BLOG_PREVIEW_TOKEN missing; post ${POST_ID} left as draft" "$LOG_FILE"
    exit 1
fi

PREVIEW_URL="https://gptweb.ru/blog/preview/${POST_ID}?token=${BLOG_PREVIEW_TOKEN}"
log "Running pre-publish SEO audit on $PREVIEW_URL"

set +e
"${SCRIPT_DIR}/seo-audit-pre.sh" "$PREVIEW_URL" "$POST_ID"
GATE_EXIT=$?
set -e

case "$GATE_EXIT" in
    0)
        log "Pre-publish gate PASSED — promoting draft to published"
        PUB_RESPONSE=$(curl -s -X POST "${API_URL}/api/cron/blog-publish" \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            -H "Content-Type: application/json" \
            -w "\n%{http_code}" \
            -d "{\"post_id\":\"${POST_ID}\"}" 2>>"$LOG_FILE") || true
        PUB_HTTP=$(echo "$PUB_RESPONSE" | tail -1)
        PUB_BODY=$(echo "$PUB_RESPONSE" | sed '$d')
        if [[ "$PUB_HTTP" != "200" && "$PUB_HTTP" != "201" ]]; then
            log "ERROR: blog-publish returned HTTP $PUB_HTTP — post ${POST_ID} stays as draft"
            log "Response: ${PUB_BODY:0:300}"
            notify_failure "generate-article" "blog-publish HTTP $PUB_HTTP for post ${POST_ID}. Body: ${PUB_BODY:0:200}" "$LOG_FILE"
            exit 1
        fi
        log "Post ${POST_ID} published. URL: https://gptweb.ru/blog/${TARGET_CAT}/${POST_SLUG}"
        ;;
    1)
        log "Pre-publish gate FAILED — post ${POST_ID} left as draft for human review"
        notify_failure "generate-article" \
            "Post ${POST_ID} (${POST_SLUG}) failed pre-publish SEO audit. Title: ${ARTICLE_TITLE:-unknown}. Review at https://ask.gptweb.ru/admin/blog/${POST_ID}" \
            "$LOG_FILE"
        ;;
    *)
        log "Pre-publish auditor errored (exit ${GATE_EXIT}) — post ${POST_ID} left as draft"
        notify_failure "generate-article" \
            "Pre-publish auditor errored for post ${POST_ID} (exit ${GATE_EXIT}). Manually review." \
            "$LOG_FILE"
        ;;
esac

log "=== Article generation complete ==="
