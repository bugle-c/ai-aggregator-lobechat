import crypto from 'node:crypto';

/**
 * HMAC-signed token used in bot-issued recovery URLs. Carries enough
 * info to restart a purchase server-side without a session — the bot
 * vouches for the (paymentId, userId, method) tuple via its server-
 * controlled secret.
 *
 * Format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`. Both
 * halves use base64url (RFC 4648 §5) so the token is URL-safe.
 */

export interface RecoveryPayload {
  exp: number; // unix seconds
  method: 'sbp' | 'any';
  paymentId: string;
  /**
   * Optional — identifies which channel issued the token, used to
   * stamp `metadata.recovery_method_used` on the new payment.
   * Undefined for legacy (pre-2026-05-23) tokens.
   */
  source?: 'tg_dm' | 'email_stage1' | 'email_stage2';
  userId: string;
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

export function signRecoveryToken(payload: RecoveryPayload, secret: string): string {
  const json = JSON.stringify(payload);
  const pl = b64urlEncode(Buffer.from(json, 'utf8'));
  const sig = hmac(pl, secret);
  return `${pl}.${sig}`;
}

export function verifyRecoveryToken(token: string, secret: string): RecoveryPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [pl, sig] = parts;
  if (!pl || !sig) return null;

  const expected = hmac(pl, secret);
  // constant-time compare to avoid timing oracle
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;

  let payload: RecoveryPayload;
  try {
    payload = JSON.parse(b64urlDecode(pl).toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
