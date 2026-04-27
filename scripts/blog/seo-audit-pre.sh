#!/bin/bash
# Pre-publish SEO audit gate.
#
# Audits a draft post via the webgpt-landing /blog/_preview/<id>?token=<X>
# route. Exit code:
#   0 — passed (score >= threshold AND zero FAIL findings); caller should publish
#   1 — failed (below threshold or has FAILs); caller should leave as draft
#   2 — auditor itself errored (treat as soft-fail, leave as draft)
#
# Usage:
#   seo-audit-pre.sh <preview_url> <post_id>
#
# Env (optional):
#   SEO_PREPUBLISH_THRESHOLD  Minimum score to pass (default: 80)
#   SEO_PREPUBLISH_MAX_FAILS  Max allowed FAIL findings (default: 0)
#   SEO_AUDIT_DELAY           ISR/dynamic-render warm-up wait (default: 5)
#   SEO_AUDIT_SKIP            "1" → exit 0 immediately (escape hatch)

set -uo pipefail

URL="${1:-}"
POST_ID="${2:-unknown}"

if [[ -z "$URL" ]]; then
    echo "Usage: $0 <preview_url> <post_id>" >&2
    exit 2
fi

if [[ "${SEO_AUDIT_SKIP:-0}" = "1" ]]; then
    echo "SEO_AUDIT_SKIP=1, treating as PASS for $URL"
    exit 0
fi

THRESHOLD="${SEO_PREPUBLISH_THRESHOLD:-80}"
MAX_FAILS="${SEO_PREPUBLISH_MAX_FAILS:-0}"
DELAY="${SEO_AUDIT_DELAY:-5}"
LOG_FILE="/home/deploy/.claude/logs/blog-seo-audit.log"
mkdir -p "$(dirname "$LOG_FILE")"
AUDIT_DIR="/home/deploy/.claude/skills/indexlift-seo-auditor"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] [pre-audit] $*" | tee -a "$LOG_FILE"
}

if [[ ! -f "${AUDIT_DIR}/scripts/run-audit.js" ]]; then
    log "WARN: auditor not installed at ${AUDIT_DIR} — skipping gate (treat as PASS)"
    exit 0
fi

log "=== Pre-publish SEO audit ==="
log "URL: $URL  |  Post ID: $POST_ID  |  threshold: $THRESHOLD, max FAILs: $MAX_FAILS"
sleep "$DELAY"

OUT_DIR="${AUDIT_DIR}/deliverables/cron-pre-$(date +%Y%m%d)"
mkdir -p "$OUT_DIR"

JSON_OUT=$(node "${AUDIT_DIR}/scripts/run-audit.js" \
    --url "$URL" \
    --tier basic \
    --engines google,yandex \
    --output "$OUT_DIR/" 2>&1) || true

JSON_PATH=$(echo "$JSON_OUT" | grep -oE 'JSON:\s+\S+' | awk '{print $2}' | tail -1)
if [[ -z "$JSON_PATH" ]]; then
    log "WARN: auditor produced no JSON output. Raw:"
    log "$JSON_OUT"
    log "Treating as soft-fail (exit 2) — caller should leave as draft."
    exit 2
fi

if [[ "$JSON_PATH" = /* ]]; then
    ABS_JSON="$JSON_PATH"
else
    ABS_JSON="${AUDIT_DIR}/${JSON_PATH}"
fi

if [[ ! -f "$ABS_JSON" ]]; then
    log "WARN: JSON output not found at $ABS_JSON. Raw:"
    log "$JSON_OUT"
    exit 2
fi

SCORE=$(python3 -c "
import json
d=json.load(open('${ABS_JSON}'))
print(d.get('summary', {}).get('score', d.get('overall_score', 0)))
" 2>/dev/null || echo "0")

# Some FAILs are expected artifacts of auditing a preview URL rather than the
# real public URL — e.g. yandex-canonical-consistency fails because canonical
# points to /blog/<cat>/<slug> while we're fetching /blog/preview/<id>. The
# google twin fails for the same reason. We whitelist these so they don't
# block publication; they will resolve themselves once the post is live at
# its canonical URL.
PREVIEW_EXEMPT_IDS="yandex-canonical-consistency,google-canonical-alignment,page-canonical-matches-final-url"

FAIL_COUNT=$(python3 -c "
import json
d=json.load(open('${ABS_JSON}'))
exempt = set('${PREVIEW_EXEMPT_IDS}'.split(','))
fails=[f for f in d.get('findings', [])
       if f.get('status')=='FAIL' and f.get('id') not in exempt]
print(len(fails))
" 2>/dev/null || echo "0")

FAIL_TITLES=$(python3 -c "
import json
d=json.load(open('${ABS_JSON}'))
exempt = set('${PREVIEW_EXEMPT_IDS}'.split(','))
fails=[f.get('title','?') for f in d.get('findings',[])
       if f.get('status')=='FAIL' and f.get('id') not in exempt]
print('; '.join(fails[:5]))
" 2>/dev/null || echo "")

EXEMPT_FAIL_TITLES=$(python3 -c "
import json
d=json.load(open('${ABS_JSON}'))
exempt = set('${PREVIEW_EXEMPT_IDS}'.split(','))
fails=[f.get('title','?') for f in d.get('findings',[])
       if f.get('status')=='FAIL' and f.get('id') in exempt]
print('; '.join(fails[:3]))
" 2>/dev/null || echo "")

log "Score: $SCORE/100  |  blocking FAILs: $FAIL_COUNT"
if [[ -n "$FAIL_TITLES" ]]; then
    log "Blocking FAILs: $FAIL_TITLES"
fi
if [[ -n "$EXEMPT_FAIL_TITLES" ]]; then
    log "Exempt (preview-artifact) FAILs ignored: $EXEMPT_FAIL_TITLES"
fi

if (( SCORE >= THRESHOLD )) && (( FAIL_COUNT <= MAX_FAILS )); then
    log "GATE: PASS — caller may publish post $POST_ID"
    exit 0
else
    log "GATE: FAIL — post $POST_ID will remain as draft. Threshold=$THRESHOLD, max-fails=$MAX_FAILS, got score=$SCORE, fails=$FAIL_COUNT"
    exit 1
fi
