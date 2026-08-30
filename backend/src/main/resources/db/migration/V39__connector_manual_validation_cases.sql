CREATE TABLE local_connector_validation_cases (
    id UUID PRIMARY KEY,
    local_connector_device_id UUID NOT NULL REFERENCES local_connector_devices(id),
    action_type VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL,
    prerequisites TEXT NOT NULL,
    expected_result VARCHAR(500) NOT NULL,
    page_evidence_digest VARCHAR(64),
    last_failure_reason VARCHAR(500),
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_local_connector_validation_device_action UNIQUE (local_connector_device_id, action_type),
    CONSTRAINT ck_local_connector_validation_action CHECK (action_type IN ('SEND_MESSAGE','REQUEST_RESUME','EXCHANGE_WECHAT','EXCHANGE_PHONE')),
    CONSTRAINT ck_local_connector_validation_status CHECK (status IN ('PREPARED','WAITING_REAL_PAGE','MANUAL_TEST_RUNNING','PASSED','FAILED','CANCELLED'))
);
