ALTER TABLE local_connector_validation_cases
    ADD COLUMN control_evidence_digest VARCHAR(64),
    ADD COLUMN evidence_observed_at TIMESTAMPTZ,
    ADD COLUMN test_started_at TIMESTAMPTZ,
    ADD COLUMN test_expires_at TIMESTAMPTZ,
    ADD COLUMN completed_at TIMESTAMPTZ,
    ADD COLUMN completed_by UUID REFERENCES system_users(id),
    ADD COLUMN result_note VARCHAR(500);

CREATE INDEX idx_connector_validation_status_expiry
    ON local_connector_validation_cases(status, test_expires_at);
