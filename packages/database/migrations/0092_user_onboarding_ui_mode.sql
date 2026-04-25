ALTER TABLE "user_onboarding" ADD COLUMN "ui_mode" varchar(8) DEFAULT 'light' NOT NULL;
--> statement-breakpoint
ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_ui_mode_check" CHECK ("ui_mode" IN ('light', 'pro'));
--> statement-breakpoint
UPDATE "user_onboarding" SET "ui_mode" = 'light' WHERE "ui_mode" IS NULL;
