#!/usr/bin/env bash
# Table test for is_vpn_keyword (the canonical keyword junk guard).
# Fixtures are shared with the webgpt-admin TS test (drift guard).
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$DIR/lib/vpn-guard.sh"
fail=0
while IFS=$'\t' read -r verdict kw; do
  [ -z "$verdict" ] && continue
  if is_vpn_keyword "$kw"; then got=BLOCK; else got=PASS; fi
  if [ "$got" = "$verdict" ]; then
    echo "OK    $verdict  $kw"
  else
    echo "WRONG want=$verdict got=$got  $kw"
    fail=1
  fi
done < "$DIR/tests/keyword-fixtures.txt"
[ "$fail" = 0 ] && echo "PASS keyword-guard" || { echo "FAIL keyword-guard"; exit 1; }
