/**
 * Guard for the hourly WaveSpeed rate sync (`api/cron/sync-wavespeed-rates`).
 * Lives outside the route module because Next.js route files may only export
 * HTTP handlers.
 *
 * WaveSpeed's `unit_price` is the average cost per RUN. That equals our
 * `per_unit` only when the row is priced per run (`image`). For per-second
 * rows (video) a run is `seconds × per_unit × resolution factor`, so copying
 * the per-run average into `per_unit` inflates the rate by the clip length
 * (2026-05-31: Veo 3.1 Fast $0.12/s → $1.20/s = 8 s × 0.15; Lite 0.0375 →
 * 0.30). Those rows are reported for manual review instead of overwritten.
 */
export type PricingUnit = 'tokens' | 'image' | 'second';

export function isSyncablePricingUnit(unit: PricingUnit): boolean {
  return unit === 'image';
}
