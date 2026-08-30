ALTER TABLE job_positions DROP CONSTRAINT ck_job_positions_capture_completeness;
ALTER TABLE job_positions ADD CONSTRAINT ck_job_positions_capture_completeness
    CHECK (capture_completeness IS NULL OR capture_completeness BETWEEN 1 AND 12);
