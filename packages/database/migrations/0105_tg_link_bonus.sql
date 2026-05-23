ALTER TABLE "user_billing"
  ADD COLUMN "bonus_balance" integer DEFAULT 0 NOT NULL,
  ADD COLUMN "bonus_balance_expires_at" timestamp with time zone,
  ADD COLUMN "tg_bonus_claimed_at" timestamp with time zone;
