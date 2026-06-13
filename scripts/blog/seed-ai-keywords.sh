#!/usr/bin/env bash
# Bootstrap clean, RKN-safe AI keywords for the blog content machine.
#
# Reads ai-seed-topics.txt, expands each head via Wordstat (xmlriver), keeps
# RU-volume survivors that pass the keyword guard (lib/vpn-guard.sh), and POSTs
# them as high-priority manual seeds to the collection route's import mode.
# Re-runnable + idempotent (the route upserts by keyword).
#
# WHY: the auto-collect harvests the queries the site ALREADY ranks for
# (historically VPN); it cannot bootstrap a NEW topic. This seeds the AI
# topics from scratch so the generator + cluster-expansion have clean fuel.
#
# Usage: bash scripts/blog/seed-ai-keywords.sh
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/vpn-guard.sh"
set -a; source /home/deploy/.config/blog-autogen/env; set +a

# webgpt-admin (the collection route) lives under /admin — NOT the bare host.
SEED_API_URL="${BLOG_ADMIN_URL:-https://ask.gptweb.ru/admin}"
FLOOR="${SEED_VOLUME_FLOOR:-300}"   # RU Wordstat monthly shows; AI heads are huge

batch='[]'; seen=" "
add() {  # phrase shows
  local p="$1" s="$2"
  is_vpn_keyword "$p" && return
  (( ${#p} < 3 || ${#p} > 160 )) && return
  [[ "$seen" == *" $p "* ]] && return
  seen+="$p "
  batch=$(jq -c --arg k "$p" --argjson s "$s" \
    '. += [{keyword:$k, source:"manual", priority:"high", impressions:$s}]' <<<"$batch")
}

while IFS= read -r topic; do
  [ -z "$topic" ] && continue
  json=$(timeout 40 "$DIR/wordstat.sh" "$topic" 2>/dev/null)
  # New xmlriver format: {associations:[{text, value}]}. Each value = monthly shows.
  while IFS=$'\t' read -r shows phrase; do
    [ -z "$phrase" ] && continue
    [[ "$shows" =~ ^[0-9]+$ ]] || continue
    (( shows < FLOOR )) && continue
    add "$phrase" "$shows"
  done < <(jq -r '.associations[]? | "\(.value)\t\(.text)"' <<<"$json" 2>/dev/null)
  # also seed the head itself if it has volume (use its max association as proxy is overkill; skip)
done < "$DIR/ai-seed-topics.txt"

n=$(jq 'length' <<<"$batch")
echo "seeding $n AI keywords (floor=$FLOOR) → $SEED_API_URL"
[ "$n" -eq 0 ] && { echo "nothing to seed — check wordstat output / env"; exit 1; }
curl -sf -X POST "${SEED_API_URL}/api/cron/blog-keywords" \
  -H "Authorization: Bearer ${CRON_SECRET}" -H 'Content-Type: application/json' \
  -d "{\"keywords\": $batch}" | jq . || { echo "POST failed"; exit 1; }
