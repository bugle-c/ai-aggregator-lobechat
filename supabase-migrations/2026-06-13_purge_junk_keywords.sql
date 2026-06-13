-- Quarantine the junk pending keyword queue (AI-pivot 2026-06-13).
-- status=skipped (reversible). Mirrors scripts/blog/lib/vpn-guard.sh::is_vpn_keyword.
-- Junk = VPN/brands, circumvention/adult, branded-nav, keyboard-layout
-- gibberish (all-Latin + no aeiou + no AI token), and zero/low volume.
UPDATE ai_aggregator.blog_keywords SET status='skipped'
WHERE status='pending' AND (
     keyword ~* '(vpn|впн|vless|v2ray|xray|amnezi|амнези|shadowsocks|wireguard|hiddify|outline|прокси|proxy|обход|обойти|блокировк|разблок|dpi|byebyedpi|дядя ?ваня|дядяваня|хапп|happ|щука|shchuka|shuka|радмин|radmin|windscribe|hidemy|зугвпн|zoog|bebra|бебра|catserver|lagom|fkey|octohide|onevps|prstovpn|psysovet|planet ?vpn|планет ?впн|browsec|hotspot ?shield|zenmate|betternet|psiphon|lantern|туннел|tunnel)'
  OR keyword ~* '(без ?цензур|без ?ограничен|снят[а-я]* ?ограничен|раздев|секс|взросл|порно|грубог|18\+|adult|nsfw|jailbreak|взлом|цензур|не работает в росс|перестал[а-я]* быть доступ|перестан[а-я]* быть доступ)'
  OR keyword ~* '(wegpt|gpt ?web|личный кабинет)'
  OR (keyword !~ '[а-яёА-ЯЁ]' AND keyword !~* '[aeiou]'
        AND keyword !~* '(gpt|claude|gemini|grok|llama|qwen|ai|api|seo)')
  OR coalesce(impressions,0) < 30
);
