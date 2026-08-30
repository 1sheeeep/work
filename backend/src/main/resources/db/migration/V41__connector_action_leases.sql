ALTER TABLE local_connector_action_tasks DROP CONSTRAINT ck_local_connector_action_status;
ALTER TABLE local_connector_action_tasks ADD CONSTRAINT ck_local_connector_action_status
    CHECK (status IN ('BLOCKED_UNVERIFIED','WAITING_MANUAL_TEST','READY','LEASED','CANCELLED','SUCCEEDED','FAILED','UNKNOWN'));

CREATE TABLE local_connector_action_leases (
    id UUID PRIMARY KEY,
    action_task_id UUID NOT NULL UNIQUE REFERENCES local_connector_action_tasks(id),
    local_connector_device_id UUID NOT NULL REFERENCES local_connector_devices(id),
    lease_token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(24) NOT NULL,
    leased_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL,
    receipt_digest VARCHAR(64),
    result_reason VARCHAR(300),
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_connector_action_lease_status CHECK (status IN ('CLAIMED','SUCCEEDED','FAILED','UNKNOWN','EXPIRED'))
);

CREATE INDEX idx_connector_action_lease_expiry ON local_connector_action_leases(status, lease_until);
