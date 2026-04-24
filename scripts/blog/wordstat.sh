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

# xmlriver Search XML (top SERP). Returns JSON array of hostnames.
# Uses a temp file to avoid shell-escaping surprises when the XML contains
# special characters.
search_serp() {
  local query="${1:?query required}"
  local user="${XMLRIVER_USER:?XMLRIVER_USER missing}"
  local key="${XMLRIVER_API_KEY:?XMLRIVER_API_KEY missing}"
  local q
  q=$(python3 -c "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1]))" "$query")
  local tmp
  tmp=$(mktemp /tmp/xmlriver-serp-XXXXXX.xml)
  if ! curl -sf --max-time 30 "https://xmlriver.com/search/xml?user=${user}&key=${key}&query=${q}&groupby=10" > "$tmp"; then
    rm -f "$tmp"
    return 1
  fi
  XML_PATH="$tmp" python3 - <<'PYEOF'
import os, sys, json, xml.etree.ElementTree as ET, urllib.parse
try:
    tree = ET.parse(os.environ['XML_PATH'])
    root = tree.getroot()
    domains = []
    for group in root.iter('group'):
        doc = group.find('.//doc')
        if doc is None:
            continue
        url_el = doc.find('url')
        if url_el is None or not url_el.text:
            continue
        host = urllib.parse.urlparse(url_el.text).netloc.lower()
        if host.startswith('www.'):
            host = host[4:]
        domains.append(host)
    print(json.dumps(domains, ensure_ascii=False))
except Exception as e:
    print('[]', file=sys.stderr)
    sys.exit(1)
PYEOF
  local rc=$?
  rm -f "$tmp"
  return $rc
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  wordstat "$1"
fi
