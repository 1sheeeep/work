CREATE TABLE browser_pairing_codes (
    id UUID PRIMARY KEY,
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE browser_companion_devices (
    id UUID PRIMARY KEY,
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    display_name VARCHAR(100) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    status VARCHAR(16) NOT NULL,
    runtime_state VARCHAR(24) NOT NULL,
    stop_reason VARCHAR(300),
    last_heartbeat_at TIMESTAMPTZ,
    paired_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT ck_browser_device_status CHECK (status IN ('ACTIVE','REVOKED')),
    CONSTRAINT ck_browser_device_runtime CHECK (runtime_state IN ('DISABLED','RUNNING','PAUSED','OFFLINE'))
);

CREATE TABLE browser_conversation_bindings (
    id UUID PRIMARY KEY,
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    contact_id UUID NOT NULL UNIQUE REFERENCES candidate_job_contacts(id),
    external_chat_key VARCHAR(64) NOT NULL,
    display_hint VARCHAR(120),
    created_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (boss_account_id, external_chat_key)
);

CREATE INDEX idx_browser_pairing_expiry ON browser_pairing_codes(expires_at) WHERE used_at IS NULL;
CREATE INDEX idx_browser_device_heartbeat ON browser_companion_devices(status,last_heartbeat_at);
CREATE UNIQUE INDEX uq_browser_active_device_per_account ON browser_companion_devices(boss_account_id) WHERE status='ACTIVE';
