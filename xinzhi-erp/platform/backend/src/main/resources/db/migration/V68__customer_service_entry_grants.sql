-- Short-lived, one-time handoff from an authenticated ERP session to the
-- imported customer-service runtime. Only the SHA-256 grant hash is stored.
ALTER TABLE auth_sessions
    ADD CONSTRAINT uq_auth_sessions_id_tenant_user
        UNIQUE (id, tenant_id, user_id);

CREATE TABLE customer_service_entry_grants (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    auth_session_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    target_origin VARCHAR(512) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_customer_service_entry_grants_session
        FOREIGN KEY (auth_session_id, tenant_id, user_id)
        REFERENCES auth_sessions (id, tenant_id, user_id),
    CONSTRAINT ck_customer_service_entry_grants_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_customer_service_entry_grants_target_origin
        CHECK (target_origin ~ '^https?://[^/?#]+$'),
    CONSTRAINT ck_customer_service_entry_grants_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_customer_service_entry_grants_consumption
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_customer_service_entry_grants_active
    ON customer_service_entry_grants (expires_at)
    WHERE consumed_at IS NULL;

CREATE INDEX idx_customer_service_entry_grants_session
    ON customer_service_entry_grants (
        tenant_id,
        user_id,
        auth_session_id,
        created_at DESC
    );
