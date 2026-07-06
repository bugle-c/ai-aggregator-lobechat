const YM_COUNTER_ID = 106_801_684;

/**
 * Fire a Yandex Metrika goal. Safe to call anywhere on the client:
 * silently no-ops when the Metrika tag is blocked or not yet loaded.
 */
export const reachGoal = (goal: string, params?: Record<string, unknown>) => {
  try {
    (window as any).ym?.(YM_COUNTER_ID, 'reachGoal', goal, params);
  } catch {
    /* noop */
  }
};
