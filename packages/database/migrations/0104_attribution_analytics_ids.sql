ALTER TABLE user_attribution
  ADD COLUMN first_ym_client_id   text,
  ADD COLUMN first_ga_client_id   text,
  ADD COLUMN first_roistat_visit  text,
  ADD COLUMN first_analytics_ids  jsonb,
  ADD COLUMN last_ym_client_id    text,
  ADD COLUMN last_ga_client_id    text,
  ADD COLUMN last_roistat_visit   text,
  ADD COLUMN last_analytics_ids   jsonb;
