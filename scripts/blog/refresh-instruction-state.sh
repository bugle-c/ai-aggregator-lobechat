#!/usr/bin/env bash
# refresh-instruction-state.sh — regenerate the LIVE-STATE block inside
# docs/seo_blog_instruction.md from the live system. NO LLM calls — pure
# SQL + systemctl + a profile-expiry check. Cheap enough to run daily.
#
# The instruction doc has two parts:
#   - prose (hand-authored by agents/humans, NOT touched here)
#   - a <!-- LIVE-STATE:BEGIN/END --> block (overwritten by this script)
#
# This is the "auto-update" half of the maintenance rule: timers, table
# counts, last-run status, and the news-profile expiry date stay current
# without anyone editing markdown.
#
# Timer: blog-instruction-refresh.timer — daily 04:00 UTC (07:00 MSK).

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOC="${SCRIPT_DIR}/../../docs/seo_blog_instruction.md"
ENV_FILE="/home/deploy/.config/blog-autogen/env"
PG="docker exec supabase-db psql -U postgres -d postgres -t -A -F| "
LOG_FILE="/home/deploy/.claude/logs/blog-instruction-refresh.log"

mkdir -p "$(dirname "$LOG_FILE")"
log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"; }

[[ -f "$DOC" ]] || { log "ERROR: doc not found at $DOC"; exit 1; }
[[ -f "$ENV_FILE" ]] && { set -a; source "$ENV_FILE"; set +a; }

# Strip the psql noise (collation warnings) once.
pg() { docker exec supabase-db psql -U postgres -d postgres -t -A -F'|' -c "$1" 2>/dev/null | grep -vE 'WARNING|DETAIL|HINT|collation'; }

NOW_MSK=$(TZ=Europe/Moscow date '+%Y-%m-%d %H:%M МСК')

# --- 1. Content counts -------------------------------------------------
read_count() { pg "$1" | head -1; }
PUBLISHED=$(read_count "SELECT COUNT(*) FROM ai_aggregator.blog_posts WHERE status='published';")
ARCHIVED=$(read_count "SELECT COUNT(*) FROM ai_aggregator.blog_posts WHERE status='archived';")
DRAFT=$(read_count "SELECT COUNT(*) FROM ai_aggregator.blog_posts WHERE status='draft';")
KW_PENDING=$(read_count "SELECT COUNT(*) FROM ai_aggregator.blog_keywords WHERE status='pending';")
KW_VPN_PENDING=$(read_count "SELECT COUNT(*) FROM ai_aggregator.blog_keywords WHERE status='pending' AND (keyword ILIKE '%vpn%' OR keyword ILIKE '%впн%' OR keyword ILIKE '%vless%' OR keyword ILIKE '%прокси%' OR keyword ILIKE '%proxy%');")
CLUSTERS_USED=$(read_count "SELECT COUNT(*) FROM ai_aggregator.blog_clusters WHERE status='used';")
REOPT_PENDING=$(read_count "SELECT COUNT(*) FROM ai_aggregator.reoptimize_queue WHERE status='pending';")
REOPT_STUCK=$(read_count "SELECT COUNT(*) FROM ai_aggregator.reoptimize_queue WHERE status='in_progress' AND flagged_at < now() - interval '1 day';")

# --- 2. Last 7 days publish cadence -----------------------------------
CADENCE=$(pg "SELECT d || ' — ' || c || ' постов' FROM (SELECT published_at::date AS d, COUNT(*) AS c FROM ai_aggregator.blog_posts WHERE status='published' AND published_at > now() - interval '7 days' GROUP BY published_at::date ORDER BY published_at::date DESC) t;")

# --- 3. News profile expiry -------------------------------------------
PROFILE_EXPIRES=$(pg "SELECT (profile_filled_at + (ttl_days||' days')::interval)::date::text FROM agent_news_007.project_profiles WHERE project_id='gptweb';" | head -1)
PROFILE_DAYS_LEFT=$(pg "SELECT GREATEST(0, EXTRACT(DAY FROM (profile_filled_at + (ttl_days||' days')::interval) - now()))::int::text FROM agent_news_007.project_profiles WHERE project_id='gptweb';" | head -1)

# --- 4. Timer last-run status -----------------------------------------
timer_line() {
  local svc="$1"
  local state exit_ts exit_code
  state=$(systemctl show "${svc}.service" --property=ActiveState --value 2>/dev/null)
  exit_code=$(systemctl show "${svc}.service" --property=ExecMainStatus --value 2>/dev/null)
  exit_ts=$(systemctl show "${svc}.service" --property=ExecMainExitTimestamp --value 2>/dev/null | sed 's/^[A-Za-z]* //')
  local mark="🟢"
  [[ "$exit_code" != "0" ]] && mark="🔴"
  echo "| \`${svc}\` | ${mark} exit=${exit_code:-?} | ${exit_ts:-?} |"
}

TIMERS=""
for svc in blog-generate blog-hype blog-keywords blog-positions blog-sync blog-reoptimize; do
  TIMERS+="$(timer_line "$svc")"$'\n'
done

# --- 5. News pipeline health probe ------------------------------------
NEWS_HEALTH="не проверено"
if [[ -n "${AGENT_NEWS_URL:-}" && -n "${AGENT_NEWS_API_KEY:-}" ]]; then
  NEWS_STATUS=$(curl -sf --max-time 30 -X POST "${AGENT_NEWS_URL}/api/v1/get-news-for-project" \
    -H "x-api-key: ${AGENT_NEWS_API_KEY}" -H "Content-Type: application/json" \
    -d '{"project_id":"gptweb","limit":1,"min_score":60,"min_hype":0,"exclude_delivered":false}' 2>/dev/null \
    | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo "unreachable")
  case "$NEWS_STATUS" in
    ok) NEWS_HEALTH="🟢 ok (профиль активен)";;
    profile_expired|need_profile) NEWS_HEALTH="🔴 $NEWS_STATUS — продли профиль (§6.1)";;
    *) NEWS_HEALTH="🟡 $NEWS_STATUS";;
  esac
fi

# --- 6. Assemble the LIVE-STATE markdown ------------------------------
TMP_BLOCK="$(mktemp)"
{
  echo "<!-- LIVE-STATE:BEGIN — этот блок перезаписывается cron-скриптом"
  echo "     refresh-instruction-state.sh раз в сутки. Руками НЕ редактировать,"
  echo "     изменения затрутся. -->"
  echo ""
  echo "### 📊 LIVE STATE (auto, обновлено ${NOW_MSK})"
  echo ""
  echo "**Контент:** published **${PUBLISHED}** · archived ${ARCHIVED} · draft ${DRAFT}"
  echo "  · keywords pending **${KW_PENDING}** (из них VPN: ${KW_VPN_PENDING} — должно быть ~0)"
  echo "  · clusters used ${CLUSTERS_USED} · reoptimize pending ${REOPT_PENDING}$([[ "${REOPT_STUCK:-0}" -gt 0 ]] && echo " · ⚠️ застряло in_progress: ${REOPT_STUCK} (см. §8)")"
  echo ""
  echo "**Новости:** профиль истекает **${PROFILE_EXPIRES:-?}** (осталось ${PROFILE_DAYS_LEFT:-?} дн.) · pipeline ${NEWS_HEALTH}"
  echo ""
  echo "**Кадэнс публикаций (7 дней):**"
  if [[ -n "$CADENCE" ]]; then
    echo "$CADENCE" | while IFS= read -r line; do [[ -n "$line" ]] && echo "  - $line"; done
  else
    echo "  - _нет публикаций за 7 дней (проверь blog-generate)_"
  fi
  echo ""
  echo "**Таймеры (последний запуск):**"
  echo ""
  echo "| Сервис | Статус | Когда |"
  echo "|---|---|---|"
  printf "%s" "$TIMERS"
  echo ""
  echo "<!-- LIVE-STATE:END -->"
} > "$TMP_BLOCK"

# --- 7. Splice into the doc (replace between markers) ------------------
python3 - "$DOC" "$TMP_BLOCK" <<'PY'
import re, sys
doc_path, block_path = sys.argv[1], sys.argv[2]
with open(doc_path, encoding='utf-8') as f: doc = f.read()
with open(block_path, encoding='utf-8') as f: block = f.read().rstrip() + "\n"
pattern = re.compile(r"<!-- LIVE-STATE:BEGIN.*?LIVE-STATE:END -->", re.DOTALL)
if not pattern.search(doc):
    print("ERROR: LIVE-STATE markers not found in doc", file=sys.stderr); sys.exit(1)
doc = pattern.sub(block.rstrip(), doc, count=1)
with open(doc_path, 'w', encoding='utf-8') as f: f.write(doc)
PY
rc=$?
rm -f "$TMP_BLOCK"

if [[ $rc -eq 0 ]]; then
  log "LIVE-STATE refreshed: published=$PUBLISHED kw_pending=$KW_PENDING(vpn=$KW_VPN_PENDING) news=$NEWS_HEALTH profile_expires=$PROFILE_EXPIRES"
  # Auto-commit the doc so the refresh is versioned (best-effort, never fails the run).
  ( cd "${SCRIPT_DIR}/../.." && git add docs/seo_blog_instruction.md 2>/dev/null \
      && git diff --cached --quiet docs/seo_blog_instruction.md 2>/dev/null \
      || git -c user.name='blog-bot' -c user.email='blog@gptweb.ru' commit -q \
           -m "chore(blog): refresh seo_blog_instruction LIVE STATE [skip ci]" docs/seo_blog_instruction.md 2>/dev/null ) || true
else
  log "ERROR: failed to splice LIVE-STATE block (rc=$rc)"
fi
