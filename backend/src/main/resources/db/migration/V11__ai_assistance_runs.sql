CREATE TABLE ai_assistance_runs (
    id UUID PRIMARY KEY,
    assistance_type VARCHAR(24) NOT NULL,
    job_position_id UUID REFERENCES job_positions(id),
    candidate_contact_id UUID REFERENCES candidate_job_contacts(id),
    provider VARCHAR(40) NOT NULL,
    model_version VARCHAR(80) NOT NULL,
    prompt_version VARCHAR(80) NOT NULL,
    input_hash CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    outcome VARCHAR(16),
    rationale TEXT,
    structured_result TEXT,
    error_message VARCHAR(1000),
    created_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_ai_assistance_type CHECK (assistance_type IN ('JOB_PARSE', 'CANDIDATE_SCREEN')),
    CONSTRAINT ck_ai_assistance_status CHECK (status IN ('SUCCEEDED', 'FAILED')),
    CONSTRAINT ck_ai_assistance_outcome CHECK (outcome IS NULL OR outcome IN ('PASS', 'REJECT', 'REVIEW'))
);
CREATE INDEX idx_ai_runs_job_created ON ai_assistance_runs(job_position_id, created_at DESC);
CREATE INDEX idx_ai_runs_contact_created ON ai_assistance_runs(candidate_contact_id, created_at DESC);
