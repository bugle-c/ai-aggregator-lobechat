import crypto from 'node:crypto';

/**
 * Short-lived HMAC token used in the bot-mediated TG-link flow.
 *
 * Flow:
 *  1. Logged-in user clicks "Привязать" on the bonus banner.
 *  2. Server mints a token containing the lobechat user_id + 10-min exp.
 *  3. Browser is 302'd to `t.me/gptwebrubot?start=link_<token>`.
 *  4. Bot's /start handler decodes the token, calls the aggregator's
 *     internal link-confirm endpoint with both user IDs.
 *  5. Aggregator verifies token, stamps user_billing.tg_bot_chat_id,
 *     grants the +100 bonus, returns success.
 *  6. Bot replies "Готово, +100 кредитов" with a URL button back to
 *     the site, which then shows the post-link modal.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`.
 */
export interface TgLinkPayload {
  exp: number; // unix seconds
  userId: string; // lobechat user id
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replaceAll(/=+$/g, '').replaceAll('+', '-').replaceAll('/', '_');
}

function b64urlDecode(s: string): Buffer {
  const padded = s.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((s.length + 3) % 4);
  return Buffer.from(padded, 'base64');
}

function hmac(payload: string, secret: string): string {
  return b64urlEncode(crypto.createHmac('sha256', secret).update(payload).digest());
}

export function signTgLinkToken(payload: TgLinkPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const pl = b64urlEncode(Buffer.from(json, 'utf8'));
  const sig = hmac(pl, secret);
  return `${pl}.${sig}`;
}

export function verifyTgLinkToken(token: string, secret: string): TgLinkPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [pl, sig] = parts;
  if (!pl || !sig) return null;

  const expected = hmac(pl, secret);
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;

  let payload: TgLinkPayload;
  try {
    payload = JSON.parse(b64urlDecode(pl).toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.userId !== 'string' || !payload.userId) return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}
