-- The full output of a step, encrypted with the installation key. Run history keeps a
-- redacted copy (output_payload); a run that resumes after a long delay needs the real
-- values, or later steps would receive "[REDACTED]" instead of a token or an API key.
ALTER TABLE node_executions ADD COLUMN IF NOT EXISTS output_sealed JSONB;
