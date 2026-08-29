ALTER TABLE browser_unread_observations
    ADD COLUMN observed_job_title VARCHAR(120),
    ADD COLUMN draft_mode VARCHAR(24),
    ADD COLUMN draft_content TEXT,
    ADD COLUMN draft_reason VARCHAR(200),
    ADD COLUMN draft_generated_at TIMESTAMPTZ;

