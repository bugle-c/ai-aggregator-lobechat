-- Phase 2.3 — Subscription lifecycle hooks
-- Adds:
--   1. user_billing.expiry_reminder_sent_at — set when "subscription expires
--      in 3 days" email is sent, reset to NULL on plan change / renewal so
--      the reminder fires again next cycle.
--   2. cancellation_surveys — captures user-supplied reason when a paid
--      subscription is cancelled. Optional UX (reasons CTA), referenced by
--      admin /admin/finance/cancellation-surveys for retention analysis.

ALTER TABLE "user_billing"
  ADD COLUMN IF NOT EXISTS "expiry_reminder_sent_at" timestamp with time zone;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "cancellation_surveys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "reason_code" text NOT NULL,
  "reason_text" text,
  "plan_id_before" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cancellation_surveys_reason_code_check" CHECK (
    "reason_code" IN ('too_expensive', 'not_using_enough', 'switched_to_other', 'other')
  )
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cancellation_surveys" ADD CONSTRAINT "cancellation_surveys_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cancellation_surveys" ADD CONSTRAINT "cancellation_surveys_plan_id_before_billing_plans_id_fk"
    FOREIGN KEY ("plan_id_before") REFERENCES "public"."billing_plans"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cancellation_surveys_user_idx" ON "cancellation_surveys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_surveys_reason_idx" ON "cancellation_surveys" USING btree ("reason_code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancellation_surveys_created_idx" ON "cancellation_surveys" USING btree ("created_at" DESC);
