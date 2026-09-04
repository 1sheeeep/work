ALTER TABLE companies
    ADD COLUMN ai_auto_analysis_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN ai_auto_analysis_authorized_at TIMESTAMPTZ,
    ADD COLUMN ai_auto_analysis_authorized_by UUID REFERENCES system_users(id);

ALTER TABLE resume_intakes
    ADD COLUMN analysis_status VARCHAR(32) NOT NULL DEFAULT 'NOT_REQUESTED',
    ADD COLUMN analysis_failure_code VARCHAR(80),
    ADD COLUMN analysis_failure_reason VARCHAR(300),
    ADD COLUMN analysis_completed_at TIMESTAMPTZ;

ALTER TABLE resume_intakes ADD CONSTRAINT ck_resume_intakes_analysis_status
    CHECK (analysis_status IN ('NOT_REQUESTED', 'ANALYZING', 'SUCCEEDED', 'FAILED', 'NOT_AUTHORIZED', 'NOT_CONFIGURED'));

ALTER TABLE ai_assistance_runs ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE ai_assistance_runs ADD COLUMN origin VARCHAR(24) NOT NULL DEFAULT 'MANUAL';
ALTER TABLE ai_assistance_runs ADD CONSTRAINT ck_ai_assistance_runs_origin
    CHECK (origin IN ('MANUAL', 'UNATTENDED'));
