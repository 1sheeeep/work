CREATE TABLE job_reply_templates (
    id UUID PRIMARY KEY,
    job_position_id UUID NOT NULL REFERENCES job_positions(id) ON DELETE CASCADE,
    intent VARCHAR(48) NOT NULL,
    template_text VARCHAR(1000) NOT NULL,
    required_fact_keys VARCHAR(500) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_job_reply_templates_job_intent UNIQUE (job_position_id, intent)
);

CREATE INDEX idx_job_reply_templates_job_intent
    ON job_reply_templates(job_position_id, intent);
