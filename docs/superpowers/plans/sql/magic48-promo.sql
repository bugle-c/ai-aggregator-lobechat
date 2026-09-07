-- MAGIC48 intro-offer promo: +1000 credits on the first payment made within
-- 48h after the earned-magic claim. Run once against prod (operator step).
INSERT INTO promo_codes (code, type, token_amount, max_uses, is_active, created_by) VALUES ('MAGIC48', 'token_bonus', 1000, 100000, true, 'magic-flow') ON CONFLICT (code) DO NOTHING;

-- 2026-09-07 (owner decision): 500 instead of 1000, and the grant now lands in
-- the expiring bonus pool (7 days) — see src/server/modules/billing/intro-offer.ts.
-- Operator step, run once against prod after that code is deployed:
UPDATE promo_codes SET token_amount = 500 WHERE code = 'MAGIC48';
