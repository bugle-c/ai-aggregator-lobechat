ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS actual_provider_cost_usd numeric;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS provider_request_id text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS provider_cost_status text NOT NULL DEFAULT 'unknown';
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS provider_cost_source text;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS provider_cost_evidence jsonb;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS provider_cost_reconciled_at timestamptz;
CREATE INDEX IF NOT EXISTS usage_logs_provider_request_idx ON usage_logs(provider, provider_request_id);
-- Existing charged and estimated expense fields deliberately remain immutable.
CREATE TABLE IF NOT EXISTS provider_expense_revisions (
  id bigserial PRIMARY KEY,
  usage_log_id uuid NOT NULL,
  original_row jsonb NOT NULL,
  reconciled_row jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION archive_provider_expense_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(OLD.actual_provider_cost_usd, OLD.provider_cost_status, OLD.provider_cost_evidence)
     IS DISTINCT FROM ROW(NEW.actual_provider_cost_usd, NEW.provider_cost_status, NEW.provider_cost_evidence) THEN
    INSERT INTO provider_expense_revisions(usage_log_id, original_row, reconciled_row)
    VALUES (OLD.id, to_jsonb(OLD), to_jsonb(NEW));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS archive_provider_expense_revision ON usage_logs;
CREATE TRIGGER archive_provider_expense_revision BEFORE UPDATE ON usage_logs
FOR EACH ROW EXECUTE FUNCTION archive_provider_expense_revision();
CREATE OR REPLACE FUNCTION reject_expense_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Provider expense revisions are immutable';
END;
$$;
DROP TRIGGER IF EXISTS provider_expense_revisions_immutable ON provider_expense_revisions;
CREATE TRIGGER provider_expense_revisions_immutable BEFORE UPDATE OR DELETE ON provider_expense_revisions
FOR EACH ROW EXECUTE FUNCTION reject_expense_revision_mutation();
CREATE TABLE IF NOT EXISTS provider_expense_daily (
  provider text NOT NULL,
  day date NOT NULL,
  scope text NOT NULL,
  actual_usd numeric NOT NULL,
  status text NOT NULL,
  verified_requests integer NOT NULL,
  unresolved_requests integer NOT NULL,
  evidence jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, day, scope)
);
