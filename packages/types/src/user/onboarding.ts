import { z } from 'zod';

export interface UserOnboarding {
  /** Current step number (1-based), for resuming onboarding */
  currentStep?: number;
  /** Timestamp when onboarding was completed (ISO 8601) */
  finishedAt?: string;
  /** Whether the user has sent their first message from onboarding/home. */
  firstMessageSeen?: boolean;
  /** Onboarding flow version for future upgrades */
  version: number;
}

export const MAX_ONBOARDING_STEPS = 5;

export const UserOnboardingSchema = z.object({
  currentStep: z.number().min(1).max(MAX_ONBOARDING_STEPS).optional(),
  firstMessageSeen: z.boolean().optional(),
  finishedAt: z.string().optional(),
  version: z.number(),
});
