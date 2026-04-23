#!/usr/bin/env bash
# sync-blog.sh — Import blog posts from blog.chadgpt.ru
# Runs via systemd timer daily at 06:00 UTC

set -euo pipefail

LOG_FILE="/home/deploy/.claude/logs/blog-sync.log"
API_URL="https://ask.gptweb.ru/admin"
CRON_SECRET="${CRON_SECRET:-}"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Load notification helper
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/notify.sh"

# Rotate log
if [[ -f "$LOG_FILE" ]] && (( $(wc -l < "$LOG_FILE") > 2000 )); then
    tail -n 1000 "$LOG_FILE" > "${LOG_FILE}.tmp"
    mv "${LOG_FILE}.tmp" "$LOG_FILE"
fi

# Load env
BLOG_ENV_FILE="/home/deploy/.config/blog-autogen/env"
if [[ -f "$BLOG_ENV_FILE" ]]; then
    set -a; source "$BLOG_ENV_FILE"; set +a
fi

if [[ -z "$CRON_SECRET" ]]; then
    log "ERROR: CRON_SECRET not set"
    notify_failure "sync-blog" "CRON_SECRET not set" "$LOG_FILE"
    exit 1
fi

log "=== Blog sync started ==="

if RESPONSE=$(curl -sf -X POST "${API_URL}/api/cron/blog-sync" \
    -H "Authorization: Bearer ${CRON_SECRET}" \
    --max-time 300 2>>"$LOG_FILE"); then
    IMPORTED=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('imported',0))" 2>/dev/null)
    SKIPPED=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('skipped',0))" 2>/dev/null)
    ERRORS=$(echo "$RESPONSE" | python3 -c "import json,sys; print(len(json.load(sys.stdin).get('errors',[])))" 2>/dev/null)
    log "Done: imported=$IMPORTED, skipped=$SKIPPED, errors=$ERRORS"
    # Notify if there were import errors
    if [[ "${ERRORS:-0}" -gt 0 ]]; then
        notify_failure "sync-blog" "Blog sync completed with ${ERRORS} errors. Imported=${IMPORTED:-0}, Skipped=${SKIPPED:-0}" "$LOG_FILE"
    fi
else
    log "ERROR: API call failed"
    notify_failure "sync-blog" "API call to blog-sync endpoint failed" "$LOG_FILE"
fi

log "=== Blog sync complete ==="
