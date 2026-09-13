/**
 * `wg_attr` — first-touch attribution cookie written by the marketing landing
 * (gptweb.ru, `landing/lib/attribution-cookie.ts`) on domain `.gptweb.ru`, so
 * ask.gptweb.ru receives it on every request.
 *
 * Shape (JSON, URI-encoded):
 *   { lp: "/blog/article?x=1", ref: "https://yandex.ru/...", ts: ISO, ym?: "1712..." }
 *
 * - `lp`  = pathname+search of the FIRST landing page the visitor saw
 * - `ref` = document.referrer on that first page (full URL, may be "")
 * - `ts`  = when it was captured
 * - `ym`  = Yandex Metrika client id (arrives asynchronously, may be absent)
 *
 * This module is pure (no DB / Node imports) so it can be used from the edge
 * middleware as well as the better-auth signup hook.
 */

export const WG_ATTR_COOKIE = 'wg_attr';

/** Defensive cap — the landing already truncates, but never trust a cookie. */
const MAX_FIELD_LEN = 1000;

export interface WgAttr {
  lp: string | null;
  /**
   * `''` means the landing captured an EMPTY document.referrer (a direct
   * visit) — a real value that must win over any later fallback. `null`
   * means the cookie did not carry the field at all.
   */
  ref: string | null;
  ts: string | null;
  ym: string | null;
}

const clamp = (s: string) => (s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN) : s);

const asString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? clamp(s) : null;
};

/**
 * Parse the raw cookie value. Returns null for missing / malformed / empty
 * payloads — callers fall back to whatever the current request tells them.
 */
export function parseWgAttr(raw: string | null | undefined): WgAttr | null {
  if (!raw) return null;

  let obj: unknown;
  try {
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      /* not URI-encoded — try as-is */
    }
    obj = JSON.parse(decoded);
  } catch {
    return null;
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;

  const lp = asString(o.lp);
  const ref = typeof o.ref === 'string' ? clamp(o.ref.trim()) : null;
  const ym = asString(o.ym);
  let ts = asString(o.ts);
  if (ts && Number.isNaN(Date.parse(ts))) ts = null;

  // A cookie that carries nothing useful is treated as absent.
  if (!lp && !ref && !ym) return null;

  return { lp, ref, ts, ym };
}

/**
 * Read one cookie out of a raw `Cookie:` header. Returns the still-encoded
 * value (callers decode as appropriate for the cookie's format).
 */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const value = part.slice(eq + 1).trim();
    return value || null;
  }
  return null;
}
