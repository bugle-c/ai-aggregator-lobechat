'use client';

/**
 * Banner CTA destination. Server endpoint mints an HMAC token bound
 * to the current session's user_id, then 302's the browser to the
 * bot's deep-link: `https://t.me/gptwebrubot?start=link_<token>`.
 *
 * The bot handles the actual linkage (its /start handler decodes the
 * token, shows an inline "Подтвердить привязку" button, on confirm
 * POSTs to /api/billing/tg-link-confirm which stamps the link + grants
 * the +100 bonus). Bot replies with a URL button back to the site;
 * useClaimOnReturn handles the `?tg_linked=1` arrival.
 *
 * Why bot-mediated instead of OAuth via oauth.telegram.org:
 *   1. OAuth path never opens the bot chat, so bot.sendMessage() 403's
 *      until the user manually /start's it later. This way they're
 *      already in the chat by step 1.
 *   2. Safari user-gesture chain: a direct `<a href>` to our server
 *      endpoint is sync user-gesture nav; the prior `oauth2.link()`
 *      async fetch broke Safari's popup-block heuristic.
 *
 * Returned URL also receives `return` so the bot can include the right
 * site URL in its "Open WebGPT" follow-up button.
 */
export function tgLinkHref(): string {
  return '/api/billing/tg-link-start';
}

/** Plain `<a href={tgLinkHref()}>` is sufficient — no JS hijack. */
export function onTgLinkClick() {
  // Intentionally empty: the anchor's native navigation does the work.
  // Kept as an export so consumer JSX doesn't break if it was passing
  // a handler previously.
}
