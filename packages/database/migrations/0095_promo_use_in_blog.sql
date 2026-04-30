ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "use_in_blog" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_use_in_blog_unique_idx" ON "promo_codes" USING btree ("use_in_blog") WHERE "use_in_blog" = true;
