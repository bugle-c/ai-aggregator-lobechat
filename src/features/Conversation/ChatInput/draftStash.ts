/**
 * Draft preservation across the paywall round-trip.
 *
 * `ChatInput` clears the editor before `sendMessage`. When the send fails
 * with the credits-exhausted error the store puts the text back into the
 * editor — but the paywall then sends the user to YooKassa and back, which
 * reloads the page and loses it. We keep the outgoing text in
 * `sessionStorage` keyed by conversation so the input can be refilled on
 * return, and drop it as soon as a send goes through.
 *
 * Deliberately tiny and store-free: no schema changes, no persistence
 * beyond the tab session.
 */

const PREFIX = 'wgpt:draft:';

export const draftStashKey = (agentId: string, topicId?: string | null): string =>
  `${PREFIX}${agentId}:${topicId || 'new'}`;

const storage = (): Storage | null => {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage;
  } catch {
    // Private mode / disabled storage — the feature degrades to "no restore".
    return null;
  }
};

export const stashDraft = (key: string, text: string): void => {
  const s = storage();
  if (!s) return;
  try {
    if (text.trim()) s.setItem(key, text);
    else s.removeItem(key);
  } catch {
    /* quota — non-fatal */
  }
};

export const readDraft = (key: string): string | null => {
  const s = storage();
  if (!s) return null;
  try {
    return s.getItem(key);
  } catch {
    return null;
  }
};

export const clearDraft = (key: string): void => {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(key);
  } catch {
    /* non-fatal */
  }
};

/** The server-side message users get when the monthly / top-up budget is gone. */
export const CREDITS_EXHAUSTED_MARKER = 'Кредиты закончились';

export const isCreditsExhaustedError = (message: string | null | undefined): boolean =>
  !!message && message.includes(CREDITS_EXHAUSTED_MARKER);
