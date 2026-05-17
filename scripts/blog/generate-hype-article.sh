#!/usr/bin/env bash
# generate-hype-article.sh — Generate ONE hype-news article per day.
#
# This script is COMPLETELY INDEPENDENT of generate-article.sh:
# - It always queries agent-news-007 for the freshest hype event
# - It does NOT touch blog_keywords / cluster-builder / Wordstat
# - It does NOT participate in the round-robin category logic
# - It always publishes into the existing 'news' category
# - It runs once per day from blog-hype.timer
#
# Idempotent within a day: refuses to run if a hype-source post (source='hype')
# was already created for today.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
LOG_FILE="/home/deploy/.claude/logs/blog-hype.log"
API_URL="https://ask.gptweb.ru/admin"
CLAUDE_CMD="/home/deploy/.local/bin/claude"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

source "${SCRIPT_DIR}/notify.sh"

# Rotate log
if [[ -f "$LOG_FILE" ]] && (( $(wc -l < "$LOG_FILE") > 2000 )); then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

log "=== Hype article generation started ==="

# Load env
if [[ -f "$BLOG_ENV_FILE" ]]; then
    set -a; source "$BLOG_ENV_FILE"; set +a
fi

for v in CRON_SECRET SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY AGENT_NEWS_URL AGENT_NEWS_API_KEY; do
    if [[ -z "${!v:-}" ]]; then
        log "ERROR: $v not set"
        notify_failure "generate-hype-article" "$v not set" "$LOG_FILE"
        exit 1
    fi
done

unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT 2>/dev/null || true

SUPA_HDRS=(-H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" -H "Accept-Profile: ai_aggregator")
TODAY_UTC=$(date -u +%Y-%m-%d)

# Step 0: Find the 'news' category id (constant; we always publish here)
NEWS_CAT_RESP=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_categories?select=id,name&slug=eq.news&is_active=eq.true&limit=1" "${SUPA_HDRS[@]}" 2>/dev/null)
NEWS_CAT_ID=$(echo "$NEWS_CAT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['id'] if d else '')" 2>/dev/null)
NEWS_CAT_NAME=$(echo "$NEWS_CAT_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0]['name'] if d else '')" 2>/dev/null)
if [[ -z "$NEWS_CAT_ID" ]]; then
    log "ERROR: 'news' category not found in blog_categories"
    notify_failure "generate-hype-article" "'news' category missing or inactive" "$LOG_FILE"
    exit 1
fi
log "Target category: news (${NEWS_CAT_NAME}) id=${NEWS_CAT_ID:0:8}"

# Step 0.5: Idempotence — cap at 2 hype-source posts per UTC day, and
# require ≥6 hours between them so the morning (09:30 МСК) and evening
# (19:30 МСК) timers don't double-fire after a system delay.
# We mark our posts with source='hype' in the meta_keywords field as a tag.
DAILY_HYPE=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_posts?select=created_at&category_id=eq.${NEWS_CAT_ID}&meta_keywords=ilike.*source:hype*&created_at=gte.${TODAY_UTC}T00:00:00Z&order=created_at.desc" "${SUPA_HDRS[@]}" 2>/dev/null)
DAILY_GATE=$(echo "$DAILY_HYPE" | python3 -c "
import json, sys
from datetime import datetime, timezone
try:
    rows = json.load(sys.stdin)
except Exception:
    print(''); sys.exit(0)
if not isinstance(rows, list) or not rows:
    print(''); sys.exit(0)
if len(rows) >= 2:
    print('cap-reached'); sys.exit(0)
last = rows[0].get('created_at','')
try:
    last_dt = datetime.fromisoformat(last.replace('Z','+00:00'))
    delta_h = (datetime.now(timezone.utc) - last_dt).total_seconds() / 3600
    if delta_h < 6:
        print(f'too-soon:{delta_h:.1f}h-since-last')
    else:
        print('')
except Exception:
    print('')
" 2>/dev/null)
if [[ -n "$DAILY_GATE" ]]; then
    log "Idempotent skip — $DAILY_GATE"
    log "=== Hype article generation complete (idempotent skip) ==="
    exit 0
fi

# Step 1: Pull freshest hype news from agent-news-007.
# We try a high-relevance pass first (>=70), then fall back to >=60 if the
# strict pass yields nothing. Long timeout because the service may need to
# classify previously-unseen events on demand (LLM call per event).
fetch_news() {
    local min_score="$1"
    # limit=15 instead of 5 — gives the freshness picker enough candidates
    # to pick a genuinely hot+fresh event over a stale-but-high-score one.
    curl -sf --max-time 90 -X POST "${AGENT_NEWS_URL}/api/v1/get-news-for-project" \
        -H "x-api-key: ${AGENT_NEWS_API_KEY}" \
        -H "content-type: application/json" \
        -d "{\"project_id\":\"gptweb\",\"limit\":15,\"min_score\":${min_score},\"min_hype\":0,\"exclude_delivered\":true}" 2>/dev/null
}

log "Querying agent-news-007 (min_score=70 — strict pass)..."
AN_RESP=$(fetch_news 70) || AN_RESP=""

if [[ -z "$AN_RESP" ]]; then
    log "ERROR: agent-news-007 unreachable (network/timeout on first pass)"
    notify_failure "generate-hype-article" "agent-news-007 unreachable" "$LOG_FILE"
    exit 1
fi

# If strict pass returned ok but empty news, try relaxed pass (60)
EMPTY_OK=$(echo "$AN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print('1' if d.get('status')=='ok' and not d.get('news') else '')" 2>/dev/null)
if [[ -n "$EMPTY_OK" ]]; then
    log "Strict pass returned no news — retrying with min_score=60..."
    AN_RESP_FALLBACK=$(fetch_news 60) || AN_RESP_FALLBACK=""
    if [[ -n "$AN_RESP_FALLBACK" ]]; then
        AN_RESP="$AN_RESP_FALLBACK"
    fi
fi

NEWS_EVENT_ID=""
NEWS_TITLE=""
NEWS_SUMMARY=""
NEWS_ANGLE=""
NEWS_PRIMARY_URL=""
NEWS_SOURCES=""
NEWS_REL=""
NEWS_HYPE=""

eval "$(echo "$AN_RESP" | python3 -c "
# Freshness-weighted picker. Combined score = relevance × hype × freshness,
# where freshness decays exponentially from first_seen_at:
#   ~1.0 at 0h,  0.85 at 2h,  0.55 at 6h,  0.37 at 12h,  0.14 at 24h.
# A stale-but-high-score event from yesterday loses to a fresher one
# even if its raw hype is 2x higher. Half-life ~12 hours.
import json, sys, shlex, math
from datetime import datetime, timezone
try:
    d = json.load(sys.stdin)
    if d.get('status') == 'ok' and d.get('news'):
        now = datetime.now(timezone.utc)
        def fresh_factor(iso):
            if not iso: return 0.5  # unknown — middle weight
            try:
                t = datetime.fromisoformat(iso.replace('Z','+00:00'))
                age_h = (now - t).total_seconds() / 3600
                return math.exp(-age_h / 12.0)
            except Exception:
                return 0.5
        ranked = []
        for n in d['news']:
            rel = n.get('relevance_score', 0) or 0
            hype = n.get('hype_score', 0) or 0
            ff = fresh_factor(n.get('first_seen_at') or '')
            score = (rel / 100.0) * (hype / 100.0) * ff
            ranked.append((score, ff, n))
        ranked.sort(key=lambda x: -x[0])
        score, ff, n = ranked[0]
        sources = n.get('all_sources', []) or []
        sources_str = ' | '.join(f\"{s.get('name','?')}: {s.get('url','')}\" for s in sources[:5])
        print(f'NEWS_EVENT_ID={shlex.quote(n.get(\"event_id\",\"\"))}')
        print(f'NEWS_TITLE={shlex.quote(n.get(\"title\",\"\"))}')
        print(f'NEWS_SUMMARY={shlex.quote(n.get(\"summary\") or \"\")}')
        print(f'NEWS_ANGLE={shlex.quote(n.get(\"suggested_angle\") or \"\")}')
        print(f'NEWS_PRIMARY_URL={shlex.quote(n.get(\"primary_url\") or \"\")}')
        print(f'NEWS_SOURCES={shlex.quote(sources_str)}')
        print(f'NEWS_REL={n.get(\"relevance_score\",0)}')
        print(f'NEWS_HYPE={n.get(\"hype_score\",0):.0f}')
        print(f'NEWS_FRESHNESS={ff:.2f}')
        print(f'NEWS_COMBINED={score:.3f}')
    elif d.get('status') in ('need_profile','profile_expired'):
        print('# profile-required', file=sys.stderr)
except Exception as e:
    print(f'# parse error: {e}', file=sys.stderr)
")"

if [[ -z "$NEWS_EVENT_ID" ]]; then
    PROFILE_REQ=$(echo "$AN_RESP" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('status',''))" 2>/dev/null)
    if [[ "$PROFILE_REQ" == "need_profile" || "$PROFILE_REQ" == "profile_expired" ]]; then
        log "ERROR: agent-news-007 needs profile registration for project 'gptweb' (status=$PROFILE_REQ)"
        notify_failure "generate-hype-article" "Profile expired for gptweb. Re-register via register_project_profile." "$LOG_FILE"
        exit 1
    fi
    log "No suitable hype news today (relevance >= 70). Nothing to publish."
    log "=== Hype article generation complete (no news) ==="
    exit 0
fi

log "Selected hype event: '${NEWS_TITLE:0:90}' (event=${NEWS_EVENT_ID:0:8}, rel=${NEWS_REL}, hype=${NEWS_HYPE}, freshness=${NEWS_FRESHNESS:-?}, combined=${NEWS_COMBINED:-?})"

# Step 1.5: Title-overlap dedup against last 30 days of news posts
EXISTING_TITLES=$(curl -sf "${SUPABASE_URL}/rest/v1/blog_posts?select=title&status=eq.published&category_id=eq.${NEWS_CAT_ID}&created_at=gte.$(date -u -d '30 days ago' +%Y-%m-%d)T00:00:00Z&order=created_at.desc&limit=60" "${SUPA_HDRS[@]}" 2>/dev/null | python3 -c "
import json, sys
try:
    rows = json.load(sys.stdin)
    for r in rows:
        t = r.get('title','').strip()
        if t: print(f'- {t}')
except Exception:
    pass
" 2>/dev/null)
[[ -n "$EXISTING_TITLES" ]] && log "Loaded $(echo "$EXISTING_TITLES" | wc -l) recent news titles for dedup context"

if [[ -n "$EXISTING_TITLES" ]]; then
    DUP_CHECK=$(echo "$EXISTING_TITLES" | python3 -c "
import sys, re
kw = '''${NEWS_TITLE}'''.lower()
kw_words = set(re.findall(r'[а-яёa-z0-9]{4,}', kw))
if len(kw_words) < 2: sys.exit(0)
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
        log "SKIP: hype event too similar to recent news article: $DUP_CHECK"
        # Mark consumed so we don't re-suggest this event
        curl -sf --max-time 10 -X POST "${AGENT_NEWS_URL}/api/v1/mark-consumed" \
            -H "x-api-key: ${AGENT_NEWS_API_KEY}" \
            -H "content-type: application/json" \
            -d "{\"project_id\":\"gptweb\",\"event_ids\":[\"${NEWS_EVENT_ID}\"]}" >/dev/null 2>&1 || true
        log "=== Hype article skipped (topical duplicate) ==="
        exit 0
    fi
fi

# Step 2: Generate article via Claude CLI
log "Generating article with Claude Code..."

PROMPT="You are an expert SEO copywriter for WebGPT (ask.gptweb.ru), a Russian-language platform that provides access to AI tools like ChatGPT, Claude, Gemini, and DeepSeek.

CRITICAL BRAND RULES:
- The brand is ALWAYS spelled \"WebGPT\" (capital W, lowercase eb, capital GPT). Never \"WeGPT\", \"Web GPT\", \"Wegpt\", \"WEBGPT\", or any other variation.
- Canonical domains: ask.gptweb.ru (app), gptweb.ru (marketing).

HYPE NEWS CONTEXT — this article is news-driven from a real, currently-trending event tracked across multiple sources by the news aggregator:
- Original event title: ${NEWS_TITLE}
- Краткое содержание: ${NEWS_SUMMARY:-(нет)}
- Suggested angle: ${NEWS_ANGLE}
- Primary source: ${NEWS_PRIMARY_URL}
- All tracked sources: ${NEWS_SOURCES}

Your task: write a fresh, current Russian-language news article on this event, framed for WebGPT users. Translate the topic into Russian, expand on what happened, why it matters specifically for users of AI tools in Russia/СНГ, and give practical implications. Cite at least 2 of the listed sources directly with descriptive anchor text (NOT 'тут', 'здесь', 'подробнее'). Use the suggested angle as a starting frame but feel free to expand or refocus.

Requirements:
- 2000-3500 words of focused, current-events content in Russian (lighter than evergreen articles — this is a news piece, not a guide)
- Use HTML markup: h2, h3, p, ul, ol, blockquote (NO h1 — title is set separately)
- Include 3-5 image placeholders using this exact format:
  <figure data-image-query=\"english search query for stock photo\"><figcaption>Описание на русском</figcaption></figure>
- Naturally mention WebGPT (ask.gptweb.ru) 2-3 times where relevant — \"в WebGPT уже доступна эта модель\" или \"через WebGPT можно протестировать\"
- News-style intro: lead with the main fact (что случилось) in the very first paragraph, then unpack
- Include direct quotes or paraphrased statements from the listed sources where applicable
- Avoid generic filler — every paragraph should advance the story or add useful context

SEO/GEO STRUCTURE REQUIREMENTS:
1. ANSWER-FIRST INTRO: First <p> must lead with what happened in 80-150 words: 'X выпустил Y. Это означает Z. В этой статье разбираем подробности.'
2. QUESTION-LED H2: At least 3 H2 must be question-style: 'Что произошло?', 'Почему это важно?', 'Как это повлияет на пользователей?', 'Когда станет доступно?', 'Что делать прямо сейчас?'
3. FAQ SECTION AT THE END: Final H2 must be 'Часто задаваемые вопросы' with 3-5 H3 questions and 2-4 sentence answers each.
4. SOURCES: Include 3-5 outbound links to authoritative sources from the list above. Anchor text must describe the destination, never 'тут'/'здесь'/'подробнее'.
5. INTERNAL LINKS: Include 1-2 internal links '/blog/news/<placeholder-slug>' an editor will fix.
6. REGIONAL SIGNAL: Mention how this affects users in Russia/СНГ at least once in the first 500 words.
7. AUTHORITY SIGNAL: Quote at least one statistic or direct claim with source attribution: 'по данным <source>'.
8. PARAGRAPH BALANCE: Avoid paragraphs > 100 words. Mix prose with lists every 2-3 paragraphs.
9. META DESCRIPTION: Include the primary topic + clear hook. < 60% word overlap with title.
10. IMPORTANT: Add 'source:hype' tag at end of meta_keywords (comma-separated) — used for downstream tracking. Example: 'deepseek,новые модели,ai,source:hype'

CRITICAL: Return ONLY a valid JSON object. No markdown code blocks, no extra text.
{
  \"title\": \"news-style headline in Russian (≤80 chars)\",
  \"slug\": \"url-friendly-slug-in-english\",
  \"description\": \"1-2 sentence preview in Russian\",
  \"content\": \"full HTML article body\",
  \"category\": \"news\",
  \"meta_title\": \"SEO title ≤60 chars in Russian\",
  \"meta_description\": \"SEO description ≤160 chars in Russian\",
  \"meta_keywords\": \"comma,separated,keywords,source:hype\"
}"

# Try Claude CLI + JSON parse up to 2 times. A non-zero exit (transient
# rate-limit / API error) typically returns within seconds with a tiny
# error-shaped JSON that the parser can't extract; retrying after a short
# backoff catches the common case. Parse failures on a successful exit also
# get retried because the LLM occasionally returns non-JSON wrapper text.
RAW_OUTPUT=""
CLI_STDERR=""
CLI_EXIT=0
ARTICLE_JSON=""
PARSE_EXIT=0
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

    if [[ $CLI_EXIT -ne 0 || -z "$RAW_OUTPUT" ]]; then
        log "Claude CLI try ${try}/${MAX_CLAUDE_ATTEMPTS} failed (exit=$CLI_EXIT, bytes=$(printf '%s' "$RAW_OUTPUT" | wc -c))"
        [[ -n "$CLI_STDERR" ]] && log "Stderr: ${CLI_STDERR:0:500}"
        if [[ $try -lt $MAX_CLAUDE_ATTEMPTS ]]; then
            log "Sleeping 30s before retry..."
            sleep 30
        fi
        ARTICLE_JSON=""
        continue
    fi

    log "Claude returned $(echo "$RAW_OUTPUT" | wc -c) bytes on try ${try}"

    ARTICLE_JSON=$(echo "$RAW_OUTPUT" | python3 -c "
import json, sys, re
data = json.load(sys.stdin)
result = data.get('result', '').strip()
result = re.sub(r'^\`\`\`(?:json)?\s*\n?', '', result)
result = re.sub(r'\n?\`\`\`\s*\$', '', result)
result = result.strip()
start = result.find('{')
end = result.rfind('}')
if start == -1 or end == -1 or end <= start:
    print('ERROR: No JSON object found', file=sys.stderr); sys.exit(1)
article = json.loads(result[start:end+1])
article['category'] = 'news'
# Ensure source:hype tag is present in meta_keywords
mk = article.get('meta_keywords','') or ''
if 'source:hype' not in mk:
    article['meta_keywords'] = (mk + ',source:hype').lstrip(',') if mk else 'source:hype'
required = ['title','slug','content','category']
missing = [f for f in required if not article.get(f)]
if missing:
    print(f'ERROR: Missing fields: {missing}', file=sys.stderr); sys.exit(1)
print(json.dumps(article, ensure_ascii=False))
" 2>&1)
    PARSE_EXIT=$?

    if [[ $PARSE_EXIT -eq 0 && -n "$ARTICLE_JSON" && "$ARTICLE_JSON" != ERROR:* ]]; then
        break
    fi

    log "Parse failed on try ${try}/${MAX_CLAUDE_ATTEMPTS} (exit=$PARSE_EXIT): ${ARTICLE_JSON:0:200}"
    ARTICLE_JSON=""
    if [[ $try -lt $MAX_CLAUDE_ATTEMPTS ]]; then
        log "Sleeping 30s before retry..."
        sleep 30
    fi
done

if [[ -z "$ARTICLE_JSON" ]]; then
    log "ERROR: Failed to obtain valid article JSON after ${MAX_CLAUDE_ATTEMPTS} attempts (last cli_exit=$CLI_EXIT, last parse_exit=$PARSE_EXIT)"
    notify_failure "generate-hype-article" "Claude failed after ${MAX_CLAUDE_ATTEMPTS} attempts (cli=$CLI_EXIT, parse=$PARSE_EXIT). Event: ${NEWS_EVENT_ID:0:8}. Stderr: ${CLI_STDERR:0:200}" "$LOG_FILE"
    exit 1
fi

log "Article generated successfully"

# Step 3: Save as draft
log "Saving article via API as draft..."

TMPFILE=$(mktemp /tmp/blog-hype-XXXXXX.json)
echo "$ARTICLE_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
data['keyword_id'] = None
data['cluster_id'] = None
data['auto_publish'] = False
print(json.dumps(data, ensure_ascii=False))
" > "$TMPFILE" 2>/dev/null

if [[ ! -s "$TMPFILE" ]]; then
    log "ERROR: Failed to prepare article JSON"
    rm -f "$TMPFILE"
    notify_failure "generate-hype-article" "Failed to prepare article JSON" "$LOG_FILE"
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
    notify_failure "generate-hype-article" "API HTTP $HTTP_CODE. Event: ${NEWS_EVENT_ID:0:8}. Body: ${RESPONSE_BODY:0:200}" "$LOG_FILE"
    exit 1
fi

POST_ID=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id','?'))" 2>/dev/null) || true
POST_SLUG=$(echo "$RESPONSE_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin).get('slug',''))" 2>/dev/null) || true
log "Draft saved. Post ID: ${POST_ID:-unknown} slug=${POST_SLUG}"

if [[ -z "$POST_ID" || "$POST_ID" = "?" ]]; then
    log "ERROR: Post ID missing — aborting before audit"
    notify_failure "generate-hype-article" "Post ID missing from response" "$LOG_FILE"
    exit 1
fi

# Step 4: Pre-publish SEO audit gate (same as generate-article.sh)
if [[ -z "${BLOG_PREVIEW_TOKEN:-}" ]]; then
    log "WARN: BLOG_PREVIEW_TOKEN not set — leaving as draft for manual review"
    notify_failure "generate-hype-article" "BLOG_PREVIEW_TOKEN missing; post ${POST_ID} stays draft" "$LOG_FILE"
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
        log "Pre-publish gate PASSED — promoting to published"
        PUB_RESPONSE=$(curl -s -X POST "${API_URL}/api/cron/blog-publish" \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            -H "Content-Type: application/json" \
            -w "\n%{http_code}" \
            -d "{\"post_id\":\"${POST_ID}\"}" 2>>"$LOG_FILE") || true
        PUB_HTTP=$(echo "$PUB_RESPONSE" | tail -1)
        PUB_BODY=$(echo "$PUB_RESPONSE" | sed '$d')
        if [[ "$PUB_HTTP" != "200" && "$PUB_HTTP" != "201" ]]; then
            log "ERROR: blog-publish HTTP $PUB_HTTP — post ${POST_ID} stays draft"
            log "Response: ${PUB_BODY:0:300}"
            notify_failure "generate-hype-article" "blog-publish HTTP $PUB_HTTP for post ${POST_ID}" "$LOG_FILE"
            exit 1
        fi
        log "Post ${POST_ID} published. URL: https://gptweb.ru/blog/news/${POST_SLUG}"

        # Mark hype event as consumed in agent-news-007
        curl -sf --max-time 10 -X POST "${AGENT_NEWS_URL}/api/v1/mark-consumed" \
            -H "x-api-key: ${AGENT_NEWS_API_KEY}" \
            -H "content-type: application/json" \
            -d "{\"project_id\":\"gptweb\",\"event_ids\":[\"${NEWS_EVENT_ID}\"],\"used_for_article_url\":\"https://gptweb.ru/blog/news/${POST_SLUG}\"}" >/dev/null 2>&1 \
            && log "agent-news-007: marked event ${NEWS_EVENT_ID:0:8} as consumed" \
            || log "WARN: agent-news-007 mark_consumed failed (non-blocking)"
        ;;
    1)
        log "Pre-publish gate FAILED — post ${POST_ID} stays as draft for manual review"
        notify_failure "generate-hype-article" \
            "Hype post ${POST_ID} (${POST_SLUG}) failed pre-publish SEO audit. Event: ${NEWS_EVENT_ID:0:8}. Review at https://ask.gptweb.ru/admin/blog/${POST_ID}" \
            "$LOG_FILE"
        ;;
    *)
        log "Pre-publish auditor errored (exit ${GATE_EXIT}) — post ${POST_ID} stays as draft"
        notify_failure "generate-hype-article" \
            "Pre-publish auditor errored for hype post ${POST_ID} (exit ${GATE_EXIT})" \
            "$LOG_FILE"
        ;;
esac

log "=== Hype article generation complete ==="
