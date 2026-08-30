ALTER TABLE job_positions
    ADD COLUMN observed_source_key VARCHAR(64),
    ADD COLUMN last_observed_at TIMESTAMPTZ,
    ADD COLUMN observation_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE job_positions DROP CONSTRAINT ck_job_positions_capture_source;
ALTER TABLE job_positions ADD CONSTRAINT ck_job_positions_capture_source
    CHECK (capture_source IN ('MANUAL', 'VISIBLE_PAGE', 'UNREAD_OBSERVATION'));

ALTER TABLE job_positions DROP CONSTRAINT ck_job_positions_capture_completeness;
ALTER TABLE job_positions ADD CONSTRAINT ck_job_positions_capture_completeness
    CHECK (capture_completeness IS NULL OR capture_completeness BETWEEN 1 AND 6);

ALTER TABLE job_positions ADD CONSTRAINT ck_job_positions_observation_count
    CHECK (observation_count >= 0);

CREATE UNIQUE INDEX uq_job_positions_account_observed_source
    ON job_positions(boss_account_id, observed_source_key)
    WHERE observed_source_key IS NOT NULL;
