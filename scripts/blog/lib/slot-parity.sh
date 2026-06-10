#!/usr/bin/env bash
# slot-parity.sh — deterministic expansion/normal slot split for the
# cluster-expansion consumer. 8 generation slots/day (08,10,…,22 MSK).
# Expansion on 08,12,16,20; normal on 10,14,18,22 → exactly 50%.
#
# is_expansion_slot <hour>  -> exit 0 (expansion) | exit 1 (normal)
# Pure function of the hour; no DB, no env. Off-cadence hours resolve
# deterministically via the same formula so a manual run is predictable.
is_expansion_slot() {
  local h="$1"
  # 10# forces base-10 so leading-zero hours (08,09) don't parse as octal.
  local n=$((10#$h))
  if (( (n / 2) % 2 == 0 )); then
    return 0   # expansion
  else
    return 1   # normal
  fi
}
