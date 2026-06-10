#!/usr/bin/env bash
# Canonical VPN / circumvention guard — SINGLE SOURCE OF TRUTH.
#
# WHY THIS FILE EXISTS (2026-06-10 RKN incident):
#   Roskomnadzor ordered VPN content off gptweb.ru; publishing more risks a
#   whole-domain block. The generator (generate-article.sh::is_valid_keyword)
#   and the cluster-expansion producer (track-positions.sh) each carried their
#   OWN copy of a VPN regex. They DRIFTED: the producer copy was hardened with
#   VPN-service brand names (дядя ваня, щука, happ…), the generator copy was
#   not. Result — keywords like "дядя ваня личный кабинет" (a VPN service, no
#   literal "впн" token) passed the generator guard and 100+ VPN articles got
#   auto-published. The fix is ONE regex both scripts source. Edit it HERE.
#
# MATCHING MODEL: unanchored, case-insensitive substring (bash =~ on a lower-
# cased string; PostgreSQL ~* directly). `[[:space:]]?` and `?` quantifiers
# work in both bash ERE and PostgreSQL regex, so the same string serves SQL
# (`primary_keyword !~* '${VPN_RE}'`) and shell (`is_vpn_keyword "$kw"`).
#
# SAFE DIRECTION: over-blocking only skips a keyword (next candidate is tried)
# or drops an expansion seed. A false-NEGATIVE publishes RKN-forbidden content.
# So when in doubt about a distinctive brand token, ADD it. Common-word brands
# (огонь, дед, батя, planet, turbo, super, proton) are intentionally NOT bare-
# listed — their keywords carry a literal vpn/впн token which the base set
# already catches, and bare-listing them would block legit articles.

# shellcheck disable=SC2034  # VPN_RE is consumed by sourcing scripts
VPN_RE='(vpn|впн|vless|v2ray|xray|amnezia|amneziawg|amnezi|амнези|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход[[:space:]]*блок|разблок|dpi|byebyedpi|дядя[[:space:]]?ваня|дядяваня|хапп|happ|щука|shchuka|shuka|радмин|radmin|windscribe|hidemy|зугвпн|zoog|bebra|бебра|catserver|lagom|fkey|octohide|onevps|prstovpn|psysovet|planet[[:space:]]?vpn|планет[[:space:]]?впн)'

# is_vpn_keyword <keyword> → exit 0 if the keyword is VPN/circumvention.
# Lowercases first because bash =~ is case-sensitive (Cyrillic included).
is_vpn_keyword() {
    local kw_lc="${1,,}"
    [[ "$kw_lc" =~ $VPN_RE ]]
}
