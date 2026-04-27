-- ====== users: referral columns ====== --
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(8);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_l1" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referred_by_l2" text;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE ("referral_code");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_l1_users_id_fk"
    FOREIGN KEY ("referred_by_l1") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "users" ADD CONSTRAINT "users_referred_by_l2_users_id_fk"
    FOREIGN KEY ("referred_by_l2") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_referred_by_l1_idx" ON "users" USING btree ("referred_by_l1");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_referred_by_l2_idx" ON "users" USING btree ("referred_by_l2");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_referral_code_idx" ON "users" USING btree ("referral_code");--> statement-breakpoint

-- ====== referrals ====== --
CREATE TABLE IF NOT EXISTS "referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"referrer_user_id" text NOT NULL,
	"referred_user_id" text NOT NULL,
	"level" smallint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credits_awarded" integer DEFAULT 0,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rewarded_at" timestamp with time zone,
	CONSTRAINT "referrals_level_check" CHECK ("level" IN (1, 2)),
	CONSTRAINT "referrals_status_check" CHECK ("status" IN ('pending', 'rewarded', 'rejected_abuse', 'rejected_no_payment')),
	CONSTRAINT "referrals_unique_referrer_referred_level" UNIQUE ("referrer_user_id", "referred_user_id", "level")
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_user_id_users_id_fk"
    FOREIGN KEY ("referrer_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referred_user_id_users_id_fk"
    FOREIGN KEY ("referred_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "referrals_status_idx" ON "referrals" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_referrer_idx" ON "referrals" USING btree ("referrer_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "referrals_referred_idx" ON "referrals" USING btree ("referred_user_id");--> statement-breakpoint

-- ====== cashout_requests ====== --
CREATE TABLE IF NOT EXISTS "cashout_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"credits_requested" integer NOT NULL,
	"rate_rub_per_credit" numeric(8, 4) DEFAULT 0.05 NOT NULL,
	"amount_rub" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text,
	"payment_details" text,
	"admin_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"processed_by" text,
	CONSTRAINT "cashout_requests_credits_min_check" CHECK ("credits_requested" >= 5000),
	CONSTRAINT "cashout_requests_status_check" CHECK ("status" IN ('pending', 'approved', 'paid', 'rejected'))
);--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "cashout_requests" ADD CONSTRAINT "cashout_requests_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "cashout_requests_status_idx" ON "cashout_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cashout_requests_user_idx" ON "cashout_requests" USING btree ("user_id");
