/**
 * Pure decision logic for the post-YooKassa landing on a chat route
 * (`/agent/<id>?topic=<id>&recoveryFor=<paymentId>`). Kept free of React
 * so it can be unit-tested without the tRPC client.
 *
 * Mirrors the state machine in `Plans.tsx` (recoveryFor handling): poll
 * the payment row for a few seconds because YooKassa redirects before our
 * webhook lands, then either celebrate or hand the user to the recovery
 * flow.
 */

/** ~10 s of polling at 1.5 s — same budget Plans.tsx uses. */
export const MAX_PENDING_ATTEMPTS = 7;

/** Poll interval while the payment row is still `pending`. */
export const POLL_INTERVAL_MS = 1500;

export type PaymentStatusLike = 'succeeded' | 'pending' | 'canceled' | 'failed' | (string & {});

export type PaymentReturnDecision =
  /** Row not loaded yet, or still pending within the polling budget. */
  | { kind: 'poll' }
  /** Webhook landed — plan is active. */
  | { kind: 'succeeded' }
  /** Terminal failure or polling timed out — reuse the recovery flow. */
  | { kind: 'recover'; reason: 'canceled' | 'failed' | 'timeout' | 'unknown' };

/**
 * `status === undefined` — the row has not been fetched yet (keep polling).
 * `status === null` — the query resolved but the row does not exist for
 * this user (foreign / bogus id): hand over to the plans page rather than
 * spinning forever.
 */
export const decidePaymentReturn = (params: {
  attempts: number;
  status: PaymentStatusLike | null | undefined;
}): PaymentReturnDecision => {
  const { attempts, status } = params;
  if (status === undefined) return { kind: 'poll' };
  if (status === null) return { kind: 'recover', reason: 'unknown' };
  if (status === 'succeeded') return { kind: 'succeeded' };
  if (status === 'pending') {
    return attempts >= MAX_PENDING_ATTEMPTS
      ? { kind: 'recover', reason: 'timeout' }
      : { kind: 'poll' };
  }
  if (status === 'canceled') return { kind: 'recover', reason: 'canceled' };
  if (status === 'failed') return { kind: 'recover', reason: 'failed' };
  return { kind: 'recover', reason: 'unknown' };
};

/**
 * `/settings/plans` keeps its own recoveryFor handler (polling + the
 * RecoveryModal with retry / promo / support). The global handler must
 * stay out of its way.
 */
export const isPlansPath = (pathname: string | null | undefined): boolean =>
  /^\/settings\/plans(?:\/|$)/.test(pathname ?? '');

/** Agent id from `/agent/<id>[/...]`; null on any other route. */
export const agentIdFromPath = (pathname: string | null | undefined): string | null => {
  const m = /^\/agent\/([^/?#]+)/.exec(pathname ?? '');
  return m ? decodeURIComponent(m[1]) : null;
};

/**
 * Where a non-successful return is sent: the plans page re-runs its own
 * recoveryFor flow (re-polls, then opens the RecoveryModal) — one recovery
 * UI, no duplicated logic on the chat route.
 */
export const recoveryPlansPath = (paymentId: string): string =>
  `/settings/plans?recoveryFor=${encodeURIComponent(paymentId)}`;
