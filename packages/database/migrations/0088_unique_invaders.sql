CREATE TABLE IF NOT EXISTS "billing_plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(32) NOT NULL,
	"price_rub" integer DEFAULT 0 NOT NULL,
	"token_limit" integer DEFAULT 50000 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
INSERT INTO "billing_plans" ("id", "name", "slug", "price_rub", "token_limit") VALUES
	(1, 'Free', 'free', 0, 50000),
	(2, 'Basic', 'basic', 490, 500000),
	(3, 'Pro', 'pro', 1490, 5000000)
ON CONFLICT ("slug") DO NOTHING;
--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('billing_plans', 'id'), GREATEST((SELECT COALESCE(MAX("id"), 1) FROM "billing_plans"), 1), true);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "billing_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"type" varchar(16) NOT NULL,
	"amount_rub" integer NOT NULL,
	"yookassa_payment_id" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"plan_id" integer,
	"tokens_amount" integer,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"bot_notify_pending" boolean DEFAULT false NOT NULL,
	"bot_notified_at" timestamp with time zone,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_payments_yookassa_payment_id_unique" UNIQUE("yookassa_payment_id"),
	CONSTRAINT "billing_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "billing_payments_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_billing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"plan_id" integer DEFAULT 1 NOT NULL,
	"token_balance" integer DEFAULT 0 NOT NULL,
	"tokens_used_month" integer DEFAULT 0 NOT NULL,
	"month_start" timestamp with time zone DEFAULT now() NOT NULL,
	"subscription_expires_at" timestamp with time zone,
	"tg_bot_chat_id" bigint,
	"bot_notify_pending" boolean DEFAULT false NOT NULL,
	"bot_notify_type" text,
	"zero_credits_notified_at" timestamp with time zone,
	"expiry_warning_sent_at" timestamp with time zone,
	"upgrade_hint_sent_at" timestamp with time zone,
	"low_credits_hint_sent_at" timestamp with time zone,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"payment_method_id" text,
	"cancelled_at" timestamp with time zone,
	"cancel_reason_code" text,
	"accessed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_billing_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "user_billing_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "user_billing_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_user_id_idx" ON "billing_payments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_yookassa_id_idx" ON "billing_payments" USING btree ("yookassa_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_status_idx" ON "billing_payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_billing_user_id_idx" ON "user_billing" USING btree ("user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promo_codes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" text NOT NULL,
	"plan_id" integer,
	"token_amount" integer,
	"duration_days" integer,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"use_in_blog" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code"),
	CONSTRAINT "promo_codes_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "promo_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"promo_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promo_redemptions_promo_user_idx" ON "promo_redemptions" USING btree ("promo_id","user_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "message_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"rating" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_feedback_user_msg_idx" ON "message_feedback" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE TABLE "billing_subscription_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"from_plan_id" integer,
	"to_plan_id" integer,
	"mrr_delta_rub" integer DEFAULT 0 NOT NULL,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily_rollup" (
	"user_id" text NOT NULL,
	"day" date NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer DEFAULT 0 NOT NULL,
	"cost_rub" numeric(14, 4) DEFAULT '0' NOT NULL,
	CONSTRAINT "usage_daily_rollup_user_id_day_model_pk" PRIMARY KEY("user_id","day","model")
);
--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"credits_charged" integer NOT NULL,
	"cost_usd" numeric(10, 6) NOT NULL,
	"cost_rub" numeric(10, 4) NOT NULL,
	"exchange_rate" numeric(8, 4) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_attribution" (
	"user_id" text PRIMARY KEY NOT NULL,
	"first_utm_source" text,
	"first_utm_medium" text,
	"first_utm_campaign" text,
	"first_utm_content" text,
	"first_referrer" text,
	"first_landing_page" text,
	"first_seen_at" timestamp with time zone,
	"last_utm_source" text,
	"last_utm_medium" text,
	"last_utm_campaign" text,
	"last_utm_content" text,
	"last_referrer" text,
	"last_landing_page" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_subscription_events" ADD CONSTRAINT "billing_subscription_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription_events" ADD CONSTRAINT "billing_subscription_events_from_plan_id_billing_plans_id_fk" FOREIGN KEY ("from_plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription_events" ADD CONSTRAINT "billing_subscription_events_to_plan_id_billing_plans_id_fk" FOREIGN KEY ("to_plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_subscription_events" ADD CONSTRAINT "billing_subscription_events_payment_id_billing_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."billing_payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily_rollup" ADD CONSTRAINT "usage_daily_rollup_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD CONSTRAINT "user_attribution_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bse_user_idx" ON "billing_subscription_events" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bse_created_idx" ON "billing_subscription_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bse_type_idx" ON "billing_subscription_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "usage_daily_rollup_day_idx" ON "usage_daily_rollup" USING btree ("day");--> statement-breakpoint
CREATE INDEX "usage_logs_user_created_idx" ON "usage_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_logs_created_idx" ON "usage_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_model_idx" ON "usage_logs" USING btree ("model");--> statement-breakpoint
CREATE INDEX "usage_logs_kind_idx" ON "usage_logs" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "user_attribution_first_source_idx" ON "user_attribution" USING btree ("first_utm_source");--> statement-breakpoint
CREATE INDEX "user_attribution_last_source_idx" ON "user_attribution" USING btree ("last_utm_source");
