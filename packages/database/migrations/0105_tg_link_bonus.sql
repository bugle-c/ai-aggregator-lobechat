CREATE TABLE "upsell_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"target_plan" text,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upsell_impressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"model_blocked" text,
	"plan_offered" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_feedback" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"rating" text NOT NULL,
	"source" text DEFAULT 'web' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
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
	CONSTRAINT "promo_codes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "promo_redemptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"promo_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"channels" text[] DEFAULT '{"email"}' NOT NULL,
	"audience" text DEFAULT 'all' NOT NULL,
	"email_subject" text,
	"email_body_html" text,
	"email_from_name" text DEFAULT 'WebGPT',
	"email_from_addr" text DEFAULT 'noreply@gptweb.ru',
	"bot_message_md" text,
	"bot_image_urls" text[] DEFAULT '{}',
	"promo_code" text,
	"promo_bonus_credits" integer DEFAULT 0,
	"promo_window_hours" integer DEFAULT 24,
	"daily_cap" integer DEFAULT 150 NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcast_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer,
	"recipient_id" integer,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "broadcast_recipients" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"tg_chat_id" integer,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"brevo_message_id" text,
	"tg_message_id" integer,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"click_count" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"payment_id" text,
	"payment_amount_rub" integer,
	"promo_redeemed_at" timestamp with time zone,
	"bonus_credits_granted" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "broadcast_recipients_uniq" UNIQUE("campaign_id","user_id","channel")
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"amount" integer NOT NULL,
	"async_task_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cancellation_surveys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text,
	"plan_id_before" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "presets" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"modality" text NOT NULL,
	"recommended_model_id" text,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"prompt_template" text NOT NULL,
	"params_lock" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"preview_url" text NOT NULL,
	"badges" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "presets_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "cashout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"credits_requested" integer NOT NULL,
	"rate_rub_per_credit" numeric(8, 4) DEFAULT '0.05' NOT NULL,
	"amount_rub" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text,
	"payment_details" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by" text,
	CONSTRAINT "cashout_requests_credits_min_check" CHECK ("cashout_requests"."credits_requested" >= 5000),
	CONSTRAINT "cashout_requests_status_check" CHECK ("cashout_requests"."status" IN ('pending', 'approved', 'paid', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"level" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credits_awarded" integer DEFAULT 0,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rewarded_at" timestamp with time zone,
	CONSTRAINT "referrals_unique_referrer_referred_level" UNIQUE("referrer_user_id","referred_user_id","level"),
	CONSTRAINT "referrals_level_check" CHECK ("referrals"."level" IN (1, 2)),
	CONSTRAINT "referrals_status_check" CHECK ("referrals"."status" IN ('pending', 'rewarded', 'rejected_abuse', 'rejected_no_payment'))
);
--> statement-breakpoint
CREATE TABLE "user_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"first_login_seen" boolean DEFAULT false NOT NULL,
	"first_message_seen" boolean DEFAULT false NOT NULL,
	"first_toast_seen" boolean DEFAULT false NOT NULL,
	"ui_mode" varchar(8) DEFAULT 'light' NOT NULL,
	"banner_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "cache_write_5m_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "cache_write_1h_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_logs" ADD COLUMN "cache_read_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "first_ym_client_id" text;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "first_ga_client_id" text;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "first_roistat_visit" text;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "first_analytics_ids" jsonb;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "last_ym_client_id" text;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "last_ga_client_id" text;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "last_roistat_visit" text;--> statement-breakpoint
ALTER TABLE "user_attribution" ADD COLUMN "last_analytics_ids" jsonb;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "bot_notify_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_payments" ADD COLUMN "bot_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "tg_bot_chat_id" bigint;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "bot_notify_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "bot_notify_type" text;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "zero_credits_notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "expiry_warning_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "expiry_reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "upgrade_hint_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "low_credits_hint_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "auto_renew" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "payment_method_id" text;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "cancel_reason_code" text;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "bonus_balance" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "bonus_balance_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_billing" ADD COLUMN "tg_bonus_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar(8);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_l1" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by_l2" text;--> statement-breakpoint
ALTER TABLE "upsell_clicks" ADD CONSTRAINT "upsell_clicks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upsell_impressions" ADD CONSTRAINT "upsell_impressions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_promo_id_promo_codes_id_fk" FOREIGN KEY ("promo_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_redemptions" ADD CONSTRAINT "promo_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_events" ADD CONSTRAINT "broadcast_events_campaign_id_broadcast_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."broadcast_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_events" ADD CONSTRAINT "broadcast_events_recipient_id_broadcast_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."broadcast_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "broadcast_recipients" ADD CONSTRAINT "broadcast_recipients_campaign_id_broadcast_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."broadcast_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_surveys" ADD CONSTRAINT "cancellation_surveys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_surveys" ADD CONSTRAINT "cancellation_surveys_plan_id_before_billing_plans_id_fk" FOREIGN KEY ("plan_id_before") REFERENCES "public"."billing_plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk" FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk" FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upsell_click_user_idx" ON "upsell_clicks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upsell_click_source_idx" ON "upsell_clicks" USING btree ("source");--> statement-breakpoint
CREATE INDEX "upsell_click_created_idx" ON "upsell_clicks" USING btree ("clicked_at");--> statement-breakpoint
CREATE INDEX "upsell_imp_user_idx" ON "upsell_impressions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upsell_imp_source_idx" ON "upsell_impressions" USING btree ("source");--> statement-breakpoint
CREATE INDEX "upsell_imp_created_idx" ON "upsell_impressions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "message_feedback_user_msg_idx" ON "message_feedback" USING btree ("user_id","message_id");--> statement-breakpoint
CREATE INDEX "promo_redemptions_promo_user_idx" ON "promo_redemptions" USING btree ("promo_id","user_id");--> statement-breakpoint
CREATE INDEX "bc_recipients_pending_idx" ON "broadcast_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "bc_recipients_user_idx" ON "broadcast_recipients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_holds_user_idx" ON "credit_holds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_holds_async_task_idx" ON "credit_holds" USING btree ("async_task_id");--> statement-breakpoint
CREATE INDEX "credit_holds_active_idx" ON "credit_holds" USING btree ("user_id","released_at");--> statement-breakpoint
CREATE INDEX "cancellation_surveys_user_idx" ON "cancellation_surveys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cancellation_surveys_reason_idx" ON "cancellation_surveys" USING btree ("reason_code");--> statement-breakpoint
CREATE INDEX "cancellation_surveys_created_idx" ON "cancellation_surveys" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "presets_modality_model_idx" ON "presets" USING btree ("modality","recommended_model_id","category","sort_order");--> statement-breakpoint
CREATE INDEX "cashout_requests_status_idx" ON "cashout_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cashout_requests_user_idx" ON "cashout_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "referrals_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX "referrals_referred_idx" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint
CREATE INDEX "users_referred_by_l1_idx" ON "users" USING btree ("referred_by_l1");--> statement-breakpoint
CREATE INDEX "users_referred_by_l2_idx" ON "users" USING btree ("referred_by_l2");--> statement-breakpoint
CREATE INDEX "users_referral_code_idx" ON "users" USING btree ("referral_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");