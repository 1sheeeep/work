CREATE TABLE local_connector_capabilities (
    id UUID PRIMARY KEY,
    local_connector_device_id UUID NOT NULL REFERENCES local_connector_devices(id),
    capability VARCHAR(40) NOT NULL,
    status VARCHAR(32) NOT NULL,
    evidence_digest VARCHAR(64),
    reason VARCHAR(300),
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_local_connector_device_capability UNIQUE (local_connector_device_id, capability),
    CONSTRAINT ck_local_connector_capability CHECK (capability IN ('CHAT_LIST_READ','CONVERSATION_DETAIL_READ','JOB_LIST_READ','SEND_MESSAGE','REQUEST_RESUME','EXCHANGE_WECHAT','EXCHANGE_PHONE')),
    CONSTRAINT ck_local_connector_capability_status CHECK (status IN ('UNVERIFIED','READ_ONLY_VERIFIED','READY_FOR_MANUAL_TEST','PRODUCTION_APPROVED','BLOCKED'))
);

CREATE TABLE local_connector_action_tasks (
    id UUID PRIMARY KEY,
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    unread_observation_id UUID REFERENCES local_connector_unread_observations(id),
    action_type VARCHAR(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    requested_by UUID NOT NULL REFERENCES system_users(id),
    reason VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_local_connector_action_type CHECK (action_type IN ('SEND_MESSAGE','REQUEST_RESUME','EXCHANGE_WECHAT','EXCHANGE_PHONE')),
    CONSTRAINT ck_local_connector_action_status CHECK (status IN ('BLOCKED_UNVERIFIED','WAITING_MANUAL_TEST','READY','CANCELLED','SUCCEEDED','FAILED'))
);

CREATE INDEX idx_local_connector_actions_account_created
    ON local_connector_action_tasks(boss_account_id, created_at DESC);
