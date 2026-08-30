CREATE TABLE local_connector_production_approvals (
    id UUID PRIMARY KEY,
    local_connector_device_id UUID NOT NULL REFERENCES local_connector_devices(id),
    action_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    hourly_limit INTEGER NOT NULL,
    daily_limit INTEGER NOT NULL,
    requested_by UUID NOT NULL REFERENCES system_users(id),
    requested_at TIMESTAMPTZ NOT NULL,
    approved_by UUID REFERENCES system_users(id),
    approved_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES system_users(id),
    revoked_at TIMESTAMPTZ,
    reason VARCHAR(300) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uq_connector_production_device_action UNIQUE(local_connector_device_id, action_type),
    CONSTRAINT ck_connector_production_action CHECK(action_type IN ('SEND_MESSAGE','REQUEST_RESUME','EXCHANGE_WECHAT','EXCHANGE_PHONE')),
    CONSTRAINT ck_connector_production_status CHECK(status IN ('PENDING_SECOND_APPROVAL','APPROVED','REVOKED','EXPIRED')),
    CONSTRAINT ck_connector_production_hourly_limit CHECK(hourly_limit BETWEEN 1 AND 5),
    CONSTRAINT ck_connector_production_daily_limit CHECK(daily_limit BETWEEN 1 AND 20),
    CONSTRAINT ck_connector_production_limits CHECK(hourly_limit <= daily_limit)
);

CREATE INDEX idx_connector_production_status_expiry ON local_connector_production_approvals(status, expires_at);
