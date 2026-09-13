const YM_COUNTER_ID = 106_801_684;

/**
 * Fire a Yandex Metrika goal. Safe to call anywhere on the client:
 * silently no-ops when the Metrika tag is blocked or not yet loaded.
 *
 * `callback` (optional) is invoked by Metrika once the hit is sent — use
 * it when the page navigates away right after the goal (checkout
 * redirects), otherwise the request may be cancelled by the unload. It
 * is NOT called when the tag is missing/blocked, so always pair it with
 * a timeout fallback.
 */
export const reachGoal = (
  goal: string,
  params?: Record<string, unknown>,
  callback?: () => void,
) => {
  try {
    (window as any).ym?.(YM_COUNTER_ID, 'reachGoal', goal, params, callback);
  } catch {
    /* noop */
  }
};
