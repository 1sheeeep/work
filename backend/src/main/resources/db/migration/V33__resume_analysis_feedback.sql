CREATE TABLE resume_analysis_feedback (
    id UUID PRIMARY KEY,
    analysis_run_id UUID NOT NULL REFERENCES ai_assistance_runs(id),
    feedback_type VARCHAR(24) NOT NULL,
    note VARCHAR(1000) NOT NULL,
    created_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_resume_analysis_feedback_type CHECK (feedback_type IN ('ADOPTED', 'AMENDED', 'NOT_USED'))
);

CREATE INDEX idx_resume_analysis_feedback_run_created
    ON resume_analysis_feedback(analysis_run_id, created_at DESC);
