-- Phase 4: subscription auto-renew loop.
--
-- Adds the columns the renew-due-subscriptions cron + cancel-subscription
-- mutation need:
--   * auto_renew         — renew loop respects this flag; true by default
--                          so existing paid subs continue renewing.
--   * payment_method_id  — saved YooKassa payment method (set by webhook
--                          on the first subscription payment when the
--                          create-payment call passed save_payment_method=true).
--   * cancelled_at       — wall-clock when the user clicked "Cancel".
--   * cancel_reason_code — code from the cancellation survey.
ALTER TABLE "user_billing"
  ADD COLUMN IF NOT EXISTS "auto_renew" boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "payment_method_id" text,
  ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "cancel_reason_code" text;

CREATE INDEX IF NOT EXISTS "user_billing_auto_renew_due_idx"
  ON "user_billing" ("subscription_expires_at")
  WHERE auto_renew = true AND payment_method_id IS NOT NULL;
