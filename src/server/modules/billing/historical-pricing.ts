import { z } from 'zod';

/** Request-time archives are evidence; writer-time snapshots alone are not. */
export const historicalPricingSchema = z.object({
  source: z.string().min(1),
  sourceReference: z.string().min(1),
  capturedAt: z.string().datetime(),
  captureStage: z.enum(['request_charge', 'usage_log_write', 'reviewed_historical_archive']),
  markup: z.number().finite().positive(),
  exchangeRate: z.number().finite().positive(),
  creditValueRub: z.number().finite().positive(),
  minimumCredits: z.number().int().nonnegative(),
  zeroCostCredits: z.literal(0),
  rounding: z.literal('ceil'),
});
export type HistoricalPricing = z.infer<typeof historicalPricingSchema>;
