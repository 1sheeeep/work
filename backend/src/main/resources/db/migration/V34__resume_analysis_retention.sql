ALTER TABLE ai_assistance_runs
    ADD COLUMN result_expires_at TIMESTAMPTZ,
    ADD COLUMN result_purged_at TIMESTAMPTZ;

UPDATE ai_assistance_runs
SET result_expires_at = created_at + INTERVAL '90 days'
WHERE assistance_type = 'RESUME_ANALYSIS'
  AND status = 'SUCCEEDED'
  AND result_expires_at IS NULL;

CREATE INDEX idx_ai_runs_resume_result_retention
    ON ai_assistance_runs(result_expires_at)
    WHERE assistance_type = 'RESUME_ANALYSIS' AND result_purged_at IS NULL;
