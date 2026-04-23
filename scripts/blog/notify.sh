#!/usr/bin/env bash
# notify.sh — Shared email notification functions for blog automation scripts
# Uses Brevo REST API. Requires BREVO_API_KEY and NOTIFY_EMAIL in env.

notify_email() {
    local subject="$1"
    local body="$2"
    local api_key="${BREVO_API_KEY:-}"
    local recipient="${NOTIFY_EMAIL:-}"

    if [[ -z "$api_key" || -z "$recipient" ]]; then
        echo "[notify] Skipping email: BREVO_API_KEY or NOTIFY_EMAIL not set" >&2
        return 1
    fi

    curl -s -X POST "https://api.brevo.com/v3/smtp/email" \
        -H "api-key: ${api_key}" \
        -H "Content-Type: application/json" \
        -d "$(python3 -c "
import json, sys
print(json.dumps({
    'sender': {'email': 'noreply@pashavin.ru', 'name': 'WebGPT Blog'},
    'to': [{'email': sys.argv[3]}],
    'subject': sys.argv[1],
    'htmlContent': sys.argv[2]
}))
" "$subject" "$body" "$recipient")" > /dev/null 2>&1

    return $?
}

notify_failure() {
    local script_name="$1"
    local error_msg="$2"
    local log_file="${3:-}"

    local body="<h2>Script failed: ${script_name}</h2>"
    body+="<p><strong>Error:</strong> ${error_msg}</p>"
    body+="<p><strong>Server:</strong> $(hostname)</p>"
    body+="<p><strong>Time:</strong> $(date '+%Y-%m-%d %H:%M:%S %Z')</p>"
    if [[ -n "$log_file" ]]; then
        body+="<p><strong>Log:</strong> ${log_file}</p>"
    fi

    notify_email "[Blog FAIL] ${script_name}" "$body"
}

notify_success() {
    local script_name="$1"
    local details="$2"

    notify_email "[Blog OK] ${script_name}" "<p>${details}</p>"
}
