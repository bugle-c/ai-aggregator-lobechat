CREATE TABLE "user_onboarding" (
	"user_id" text PRIMARY KEY NOT NULL,
	"first_login_seen" boolean DEFAULT false NOT NULL,
	"first_message_seen" boolean DEFAULT false NOT NULL,
	"first_toast_seen" boolean DEFAULT false NOT NULL,
	"banner_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
