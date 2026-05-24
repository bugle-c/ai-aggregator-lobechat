-- 0106_referrals_unique.sql
--
-- Prevent two referrers from claiming the same referee at the same level.
-- Partial index excludes 'rejected' rows so admins can mark fraud
-- referrals rejected without locking out a legit re-attempt.
CREATE UNIQUE INDEX IF NOT EXISTS referrals_referred_level_unique
  ON referrals (referred_user_id, level)
  WHERE status != 'rejected';
