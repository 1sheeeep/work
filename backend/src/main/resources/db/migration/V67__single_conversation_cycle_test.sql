ALTER TABLE local_connector_unread_observations
    ADD COLUMN cycle_test_status VARCHAR(32) NOT NULL DEFAULT 'NOT_STARTED',
    ADD COLUMN resume_review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN selected_conversation_unread BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN cycle_test_started_at TIMESTAMPTZ,
    ADD COLUMN cycle_test_updated_at TIMESTAMPTZ,
    ADD COLUMN resume_requested_at TIMESTAMPTZ,
    ADD COLUMN resume_approved_at TIMESTAMPTZ,
    ADD COLUMN contact_exchanged_at TIMESTAMPTZ,
    ADD COLUMN human_takeover_at TIMESTAMPTZ;

CREATE INDEX idx_connector_observation_cycle_test
    ON local_connector_unread_observations (cycle_test_status, last_seen_at DESC);
