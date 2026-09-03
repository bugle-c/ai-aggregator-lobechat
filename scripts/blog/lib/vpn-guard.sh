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
#
# 2026-09-03 leak: transliterated / misspelled forms bypassed the guard and 8
# VPN/DPI articles auto-published (slugs skachat-vrn-*, bye-bye-dpi-*,
# ai-bez-ogranicheniy-*). Added: врн/vrn (ВПН typed as ВРН), дпай/dpai + a
# word-bounded дпи (bare "дпи" would hit "подписка"), bye-bye/байбай/byedpi/
# goodbyedpi (ByeByeDPI tool), zapret (DPI tool), v2raytun. The circumvention
# set below already has bez-ogranich* translit; keep both sides in sync with
# webgpt-admin/lib/keyword-junk.ts and the landing 404 regex
# (webgpt-landing app/blog/[category]/[slug]/page.tsx).

# shellcheck disable=SC2034  # VPN_RE is consumed by sourcing scripts (incl. SQL ~*)
VPN_RE='(vpn|впн|vless|v2ray|xray|amnezia|amneziawg|amnezi|амнези|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход[[:space:]]*блок|разблок|dpi|byebyedpi|дядя[[:space:]]?ваня|дядяваня|хапп|happ|щука|shchuka|shuka|радмин|radmin|windscribe|hidemy|зугвпн|zoog|bebra|бебра|catserver|lagom|fkey|octohide|onevps|prstovpn|psysovet|planet[[:space:]]?vpn|планет[[:space:]]?впн|vipien|випиэн|browsec|hotspot[[:space:]]?shield|zenmate|betternet|psiphon|lantern|туннел|tunnel|врн|vrn|дпай|dpai|(^|[^а-яё])дпи([^а-яё]|$)|bye[[:space:]_-]?bye|байбай|бай[[:space:]_-]?бай|byedpi|goodbyedpi|zapret|v2raytun)'

# AI tokens that must never be treated as keyboard-layout gibberish.
VPN_GUARD_AI_RE='(gpt|chatgpt|claude|gemini|grok|llama|qwen|deepseek|midjourney|openai|google|telegram|\bai\b|api|seo)'

# Keyboard-layout gibberish: a keyword that is all-Latin (no Cyrillic), contains
# ZERO aeiou vowels, and carries no AI token — the signature of Russian typed in
# the Latin layout (`dgy yf gr` = "впн на пк"), because the Russian→Latin layout
# maps almost every Russian vowel to a Latin consonant. Legit English AI tools
# (stable diffusion, perplexity, copilot…) have normal vowels → never match;
# Russian AI keywords have Cyrillic → never match. Conservative on purpose: it
# misses gibberish that happens to contain a vowel, but never blocks legit AI.
is_layout_gibberish() {
    local lc="${1,,}"
    [[ "$lc" =~ [а-яё] ]] && return 1            # has Cyrillic → not gibberish
    [[ "$lc" =~ $VPN_GUARD_AI_RE ]] && return 1  # protected AI term
    local letters="${lc//[^a-z]/}"               # strip non-Latin-letters
    (( ${#letters} < 5 )) && return 1            # too short to judge
    local vow="${letters//[^aeiou]/}"
    (( ${#vow} == 0 )) && return 0               # all-Latin, no vowels → gibberish
    return 1
}

# is_vpn_keyword <keyword> → exit 0 if the keyword is junk (VPN / circumvention /
# adult / branded-nav / layout-gibberish). Lowercases first (bash =~ is CS).
# Over-blocking is the safe direction — a skipped keyword just yields the next.
is_vpn_keyword() {
    local kw_lc="${1,,}"
    [[ "$kw_lc" =~ $VPN_RE ]] && return 0                                                                                          # 1) VPN / brands
    [[ "$kw_lc" =~ (без[[:space:]]*цензур|без[[:space:]]*ограничен|без[[:space:]]*правил|без[[:space:]]*фильтр|снят[а-я]*[[:space:]]*ограничен|раздев|секс|взросл|порно|porn|грубог|18\+|adult|nsfw|jailbreak|взлом|цензур|обход|обойти|блокировк|bez[[:space:]_-]*(cenzur|tsenzur|pravil|ogranich|filtr)|без[[:space:]]*цензуры[[:space:]]*и[[:space:]]*фильтр|не[[:space:]]работает[[:space:]]в[[:space:]]росс|перестал[а-я]*[[:space:]]быть[[:space:]]доступ|перестан[а-я]*[[:space:]]быть[[:space:]]доступ) ]] && return 0  # 2) circumvention / adult / geo-bypass (incl. "без правил/фильтров" + translit slugs)
    [[ "$kw_lc" =~ (wegpt|gpt[[:space:]]?web|личный[[:space:]]+кабинет) ]] && return 0                                             # 3) branded-navigational
    is_layout_gibberish "$kw_lc" && return 0                                                                                       # 4) layout gibberish
    return 1
}
