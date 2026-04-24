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
