#!/usr/bin/env bash
# wordstat.sh — xmlriver Wordstat client for Yandex.
# Returns raw JSON from xmlriver. Typical top-level keys: `content.including[]`,
# `content.related[]` (new format), each item {phrase, number}.
#
# Usage:
#   source /home/deploy/.config/blog-autogen/env
#   ./wordstat.sh "gemini обход"
# or sourced:
#   source wordstat.sh
#   wordstat "gemini обход" | jq '.content.related'

set -euo pipefail

wordstat() {
  local seed="${1:?seed required}"
  local user="${XMLRIVER_USER:?XMLRIVER_USER missing}"
  local key="${XMLRIVER_API_KEY:?XMLRIVER_API_KEY missing}"
  local q
  q=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$seed")
  curl -sf --max-time 30 "https://xmlriver.com/wordstat/new/json?user=${user}&key=${key}&query=${q}"
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  wordstat "$1"
fi
