#!/bin/bash
# Post-publish SEO audit for newly-generated blog articles.
#
# Runs the indexlift-seo-auditor skill on a freshly-published URL ~60s after
# IndexNow ping (gives ISR/revalidate time to settle). Logs the JSON summary,
# alerts via notify.sh on FAIL findings or score < threshold.
#
# Called from generate-article.sh after a successful publish; safe to invoke
# manually for ad-hoc audits.
#
# Usage:
#   seo-audit-post.sh <url> [post_id]
#
# Env (optional):
#   SEO_AUDIT_THRESHOLD  Minimum acceptable overall score (default: 80)
#   SEO_AUDIT_DELAY      Seconds to wait before audit (default: 60)
#   SEO_AUDIT_SKIP       If "1", exit 0 immediately (escape hatch for dev)

set -uo pipefail

URL="${1:-}"
POST_ID="${2:-unknown}"

if [[ -z "$URL" ]]; then
    echo "Usage: $0 <url> [post_id]" >&2
    exit 2
fi

if [[ "${SEO_AUDIT_SKIP:-0}" = "1" ]]; then
    echo "SEO_AUDIT_SKIP=1, skipping audit for $URL"
    exit 0
fi

THRESHOLD="${SEO_AUDIT_THRESHOLD:-80}"
DELAY="${SEO_AUDIT_DELAY:-60}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/home/deploy/.claude/logs/blog-seo-audit.log"
mkdir -p "$(dirname "$LOG_FILE")"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Best-effort notify_failure (silently continue if notify.sh missing)
if [[ -f "${SCRIPT_DIR}/notify.sh" ]]; then
    # shellcheck disable=SC1091
    source "${SCRIPT_DIR}/notify.sh"
else
    notify_failure() { :; }
fi

AUDIT_DIR="/home/deploy/.claude/skills/indexlift-seo-auditor"
if [[ ! -f "${AUDIT_DIR}/scripts/run-audit.js" ]]; then
    log "WARN: auditor not found at ${AUDIT_DIR} — skipping audit for $URL"
    exit 0
fi

log "=== Post-publish SEO audit ==="
log "URL: $URL"
log "Post ID: $POST_ID"
log "Waiting ${DELAY}s for ISR revalidate..."
sleep "$DELAY"

OUT_DIR="${AUDIT_DIR}/deliverables/cron-$(date +%Y%m%d)"
mkdir -p "$OUT_DIR"

JSON_OUT=$(node "${AUDIT_DIR}/scripts/run-audit.js" \
    --url "$URL" \
    --tier basic \
    --engines google,yandex \
    --output "$OUT_DIR/" 2>&1) || true

# run-audit.js prints "JSON: <path>" line — extract that file
JSON_PATH=$(echo "$JSON_OUT" | grep -oE 'JSON:\s+\S+' | awk '{print $2}' | tail -1)
if [[ -z "$JSON_PATH" || ! -f "$AUDIT_DIR/$JSON_PATH" ]]; then
    log "WARN: audit produced no JSON output. Raw:"
    log "$JSON_OUT"
    exit 0
fi

ABS_JSON="${AUDIT_DIR}/${JSON_PATH}"
SCORE=$(python3 -c "import json,sys;d=json.load(open('${ABS_JSON}'));print(d.get('overall_score', d.get('score', 0)))" 2>/dev/null || echo "0")
FAIL_COUNT=$(python3 -c "
import json,sys
d=json.load(open('${ABS_JSON}'))
findings=d.get('findings', [])
fails=[f for f in findings if f.get('status')=='FAIL']
print(len(fails))
" 2>/dev/null || echo "0")

FAIL_TITLES=$(python3 -c "
import json
d=json.load(open('${ABS_JSON}'))
fails=[f.get('title','?') for f in d.get('findings',[]) if f.get('status')=='FAIL']
print('; '.join(fails[:5]))
" 2>/dev/null || echo "")

log "Score: $SCORE / 100  |  FAIL findings: $FAIL_COUNT"
if [[ -n "$FAIL_TITLES" ]]; then
    log "FAILs: $FAIL_TITLES"
fi

# Alert if score drops below threshold OR there are critical failures
if (( SCORE < THRESHOLD )) || (( FAIL_COUNT > 1 )); then
    notify_failure "seo-audit-post" \
        "Post $POST_ID ($URL) scored $SCORE/100 with $FAIL_COUNT critical issues. Top: $FAIL_TITLES" \
        "$LOG_FILE" || true
fi

log "=== Audit complete ==="
exit 0
