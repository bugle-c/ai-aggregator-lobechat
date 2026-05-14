-- Mobile-redesign Phase 1: upsell tracking tables.
--
-- `upsell_impressions` is written every time we render an upgrade CTA
-- (PlanLimitExceeded inline, locked-model bottom-sheet, balance nudge,
-- home pill, welcome-email link). `upsell_clicks` is written when the
-- user actually taps through. The /admin/finance/pricing-experiments
-- page joins both against `billing_payments` to compute the
-- impression → click → paid funnel per source.
--
-- Both tables are append-only event logs. Consumers should aggregate
-- with date filters; never DELETE rows.

CREATE TABLE IF NOT EXISTS "upsell_impressions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" varchar(32) NOT NULL,
  "model_blocked" text,
  "plan_offered" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_imp_user_idx" ON "upsell_impressions" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_imp_source_idx" ON "upsell_impressions" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_imp_created_idx" ON "upsell_impressions" ("created_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "upsell_clicks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "source" varchar(32) NOT NULL,
  "target_plan" text,
  "clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_click_user_idx" ON "upsell_clicks" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_click_source_idx" ON "upsell_clicks" ("source");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upsell_click_created_idx" ON "upsell_clicks" ("clicked_at");
