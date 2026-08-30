ALTER TABLE job_positions
    ADD COLUMN capture_source VARCHAR(32) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN capture_completeness SMALLINT,
    ADD COLUMN captured_at TIMESTAMPTZ;

ALTER TABLE job_positions
    ADD CONSTRAINT ck_job_positions_capture_source CHECK (capture_source IN ('MANUAL', 'VISIBLE_PAGE')),
    ADD CONSTRAINT ck_job_positions_capture_completeness CHECK (capture_completeness IS NULL OR capture_completeness BETWEEN 5 AND 6);
