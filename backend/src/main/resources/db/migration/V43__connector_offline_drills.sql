CREATE TABLE local_connector_offline_drills (
    id UUID PRIMARY KEY,
    local_connector_device_id UUID NOT NULL REFERENCES local_connector_devices(id),
    action_type VARCHAR(32) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    evidence_source VARCHAR(24) NOT NULL,
    before_digest VARCHAR(64) NOT NULL,
    after_digest VARCHAR(64) NOT NULL,
    receipt_digest VARCHAR(64) NOT NULL,
    failure_reason VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_connector_drill_action CHECK(action_type IN ('SEND_MESSAGE','REQUEST_RESUME','EXCHANGE_WECHAT','EXCHANGE_PHONE')),
    CONSTRAINT ck_connector_drill_outcome CHECK(outcome IN ('PASSED','FAILED')),
    CONSTRAINT ck_connector_drill_source CHECK(evidence_source='FIXTURE_ONLY')
);

CREATE INDEX idx_connector_drills_device_created ON local_connector_offline_drills(local_connector_device_id, created_at DESC);
