ALTER TABLE "user_onboarding" ADD COLUMN "intent" text;
ALTER TABLE "user_billing" ADD COLUMN "magic_bonus_claimed_at" timestamp with time zone;
