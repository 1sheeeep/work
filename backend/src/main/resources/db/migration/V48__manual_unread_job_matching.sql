ALTER TABLE local_connector_unread_observations
    ADD COLUMN manual_match_job_position_id UUID REFERENCES job_positions(id),
    ADD COLUMN manual_match_title_key VARCHAR(160),
    ADD COLUMN manual_matched_at TIMESTAMPTZ;

CREATE INDEX idx_unread_observation_manual_job
    ON local_connector_unread_observations(manual_match_job_position_id)
    WHERE manual_match_job_position_id IS NOT NULL;
