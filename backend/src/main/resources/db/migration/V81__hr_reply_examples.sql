CREATE TABLE hr_reply_examples (
    id UUID PRIMARY KEY,
    job_position_id UUID NOT NULL REFERENCES job_positions(id),
    intent VARCHAR(40) NOT NULL,
    candidate_message VARCHAR(1000) NOT NULL,
    hr_reply VARCHAR(500) NOT NULL,
    source_hash VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX idx_hr_reply_examples_job_intent_created
    ON hr_reply_examples(job_position_id, intent, created_at DESC);
