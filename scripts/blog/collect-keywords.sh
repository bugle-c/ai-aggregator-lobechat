#!/usr/bin/env bash
# collect-keywords.sh — Collect SEO keywords from Yandex Webmaster
# Runs via systemd timer daily at 03:00 UTC

set -euo pipefail

LOG_FILE="/home/deploy/.claude/logs/blog-keywords.log"
API_URL="https://ask.gptweb.ru/admin"
CRON_SECRET="${CRON_SECRET:-}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load notification helper
source "${SCRIPT_DIR}/notify.sh"

# Load env
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
if [[ -f "$BLOG_ENV_FILE" ]]; then
    set -a; source "$BLOG_ENV_FILE"; set +a
fi

if [[ -z "$CRON_SECRET" ]]; then
    log "ERROR: CRON_SECRET not set"
    notify_failure "collect-keywords" "CRON_SECRET not set" "$LOG_FILE"
    exit 1
fi

log "=== Keyword collection started ==="

if RESPONSE=$(curl -sf -X POST "${API_URL}/api/cron/blog-keywords" \
    -H "Authorization: Bearer ${CRON_SECRET}" 2>>"$LOG_FILE"); then
    ADDED=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('added',0))" 2>/dev/null)
    SKIPPED=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('skipped',0))" 2>/dev/null)
    TOTAL=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('total_from_api',0))" 2>/dev/null)
    log "Done: added=${ADDED:-0}, skipped=${SKIPPED:-0}, from_api=${TOTAL:-0}"
else
    log "ERROR: API call failed"
    notify_failure "collect-keywords" "API call to blog-keywords endpoint failed" "$LOG_FILE"
fi

log "=== Keyword collection complete ==="
