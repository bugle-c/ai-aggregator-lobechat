-- Source-aware technical-error refunds. No historical balance is modified here.
CREATE TABLE IF NOT EXISTS refund_credit_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 campaign text NOT NULL,
 fix_cutoff timestamptz NOT NULL,
 granted integer NOT NULL CHECK (granted > 0),
 remaining integer NOT NULL CHECK (remaining >= 0 AND remaining <= granted),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refund_credit_lots_user_expiry_idx ON refund_credit_lots(user_id, expires_at);
CREATE TABLE IF NOT EXISTS usage_credit_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 usage_id uuid NOT NULL REFERENCES usage_logs(id),
 lot_id uuid NOT NULL REFERENCES refund_credit_lots(id),
 campaign text NOT NULL,
 original_credits integer NOT NULL,
 corrected_credits integer NOT NULL CHECK (corrected_credits >= 0 AND corrected_credits < original_credits),
 evidence jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_credit_corrections_campaign_usage_idx ON usage_credit_corrections(campaign, usage_id);
ALTER TABLE credit_holds ADD COLUMN IF NOT EXISTS ordinary_amount integer;
ALTER TABLE credit_holds ADD COLUMN IF NOT EXISTS usage_period timestamptz;
ALTER TABLE credit_holds ADD COLUMN IF NOT EXISTS refund_allocations jsonb NOT NULL DEFAULT '[]'::jsonb;
-- Capture legacy hold periods before the next usage reset. Already-reset holds deliberately
-- retain their creation timestamp, so they cannot refund the new period's counter.
UPDATE credit_holds h SET ordinary_amount = h.amount,
 usage_period = CASE WHEN h.created_at >= b.month_start THEN b.month_start ELSE h.created_at END
 FROM user_billing b WHERE h.user_id=b.user_id AND h.ordinary_amount IS NULL;
