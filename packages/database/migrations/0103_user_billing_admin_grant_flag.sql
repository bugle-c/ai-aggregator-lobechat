-- Mark subscriptions handed out by an admin so finance dashboards can
-- exclude them from MRR/active-customer math. The admin "Назначить
-- тариф" action sets this flag; real paid subscriptions clear it via
-- fulfillPayment().

ALTER TABLE user_billing
  ADD COLUMN IF NOT EXISTS is_admin_granted boolean NOT NULL DEFAULT false;

-- Back-fill: the only known admin-granted active sub at the moment is
-- the user with subscription_expires_at far in 2027. Operators can flip
-- the flag manually for older grants if needed.
UPDATE user_billing
SET is_admin_granted = true
WHERE subscription_expires_at > now() + interval '6 months'
  AND plan_id != 1;
