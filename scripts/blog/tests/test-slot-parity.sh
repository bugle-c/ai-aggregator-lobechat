#!/usr/bin/env bash
# Table test for is_expansion_slot(): exactly 4 expansion / 4 normal across
# the 8 generation hours, deterministic for off-cadence hours.
set -uo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../lib/slot-parity.sh"

fail=0
check() {  # check <hour> <expected 1|0>
  local got; is_expansion_slot "$1"; got=$?
  # is_expansion_slot returns 0 (true) for expansion, 1 for normal — map to 1/0
  local got_bin=0; [[ $got -eq 0 ]] && got_bin=1
  if [[ "$got_bin" != "$2" ]]; then
    echo "FAIL hour=$1 expected=$2 got=$got_bin"; fail=1
  fi
}

# The 8 real slots
check 08 1; check 10 0; check 12 1; check 14 0
check 16 1; check 18 0; check 20 1; check 22 0
# Off-cadence hours must still be deterministic. Under (n/2)%2==0:
#   09 → 09/2=4, 4%2=0 → expansion (1)
#   00 → 00/2=0, 0%2=0 → expansion (1)
#   23 → 23/2=11, 11%2=1 → normal (0)
check 09 1; check 00 1; check 23 0

if [[ $fail -eq 0 ]]; then echo "PASS: slot-parity table test (4/4 split)"; else exit 1; fi
