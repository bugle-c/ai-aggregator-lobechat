#!/usr/bin/env bash
# notify.sh — Shared notification functions for blog automation scripts.
#
# Migrated 2026-05-31 from Brevo email → Telegram bot. Email was burning
# ~25 of our 300/day Brevo quota on routine publish-OK pings that we only
# read on the phone anyway. Telegram is unlimited for outbound messages
# and instant.
#
# Required env (sourced from /home/deploy/.config/blog-autogen/env):
#   NOTIFY_TG_BOT_TOKEN — Telegram bot token (we reuse @gptwebrubot)
#   NOTIFY_TG_CHAT_ID   — Admin chat_id to send to
#
# If either is unset, notify_* functions skip silently — never fail the
# parent script over a missing notification channel.

notify_telegram() {
    local subject="$1"
    local body="$2"
    local bot_token="${NOTIFY_TG_BOT_TOKEN:-}"
    local chat_id="${NOTIFY_TG_CHAT_ID:-}"

    if [[ -z "$bot_token" || -z "$chat_id" ]]; then
        echo "[notify] Skipping TG: NOTIFY_TG_BOT_TOKEN or NOTIFY_TG_CHAT_ID not set" >&2
        return 1
    fi

    # Strip HTML tags + collapse whitespace. Plain text mode is the
    # safest — no MarkdownV2 escaping headaches for arbitrary CLI errors
    # and log paths that show up in failure bodies.
    local plain
    plain=$(echo -e "${subject}\n\n${body}" | sed -e 's/<[^>]*>//g' -e 's/&nbsp;/ /g' -e 's/&amp;/\&/g')

    # Telegram message limit is 4096 chars. Truncate with a marker if
    # we're over — better to ship a clipped message than nothing.
    if (( ${#plain} > 4000 )); then
        plain="${plain:0:3900}"$'\n\n[…truncated]'
    fi

    curl -s -X POST "https://api.telegram.org/bot${bot_token}/sendMessage" \
        --data-urlencode "chat_id=${chat_id}" \
        --data-urlencode "text=${plain}" \
        --data-urlencode "disable_web_page_preview=true" >/dev/null 2>&1

    return $?
}

notify_failure() {
    local script_name="$1"
    local error_msg="$2"
    local log_file="${3:-}"

    local body="Error: ${error_msg}"
    body+=$'\n'"Server: $(hostname)"
    body+=$'\n'"Time: $(date '+%Y-%m-%d %H:%M:%S %Z')"
    if [[ -n "$log_file" ]]; then
        body+=$'\n'"Log: ${log_file}"
    fi

    notify_telegram "❌ [Blog FAIL] ${script_name}" "$body"
}

notify_success() {
    local script_name="$1"
    local details="$2"

    notify_telegram "✅ [Blog OK] ${script_name}" "$details"
}
