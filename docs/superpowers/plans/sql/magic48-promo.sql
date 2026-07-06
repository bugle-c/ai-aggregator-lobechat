-- MAGIC48 intro-offer promo: +1000 credits on the first payment made within
-- 48h after the earned-magic claim. Run once against prod (operator step).
INSERT INTO promo_codes (code, type, token_amount, max_uses, is_active, created_by) VALUES ('MAGIC48', 'token_bonus', 1000, 100000, true, 'magic-flow') ON CONFLICT (code) DO NOTHING;
