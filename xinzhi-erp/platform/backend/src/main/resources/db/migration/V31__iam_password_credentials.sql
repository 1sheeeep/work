-- IAM phase three: one-time activation and password reset credentials.
-- Only SHA-256 token hashes are persisted; this migration creates no data.
CREATE TABLE password_credentials (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_password_credentials_user_tenant
        FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_password_credentials_creator_tenant
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_password_credentials_purpose
        CHECK (purpose IN ('ACTIVATION', 'PASSWORD_RESET')),
    CONSTRAINT ck_password_credentials_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_password_credentials_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_password_credentials_terminal_state
        CHECK (
            (consumed_at IS NULL OR consumed_at >= created_at)
            AND (revoked_at IS NULL OR revoked_at >= created_at)
            AND NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)
        ),
    CONSTRAINT ck_password_credentials_version
        CHECK (version >= 0)
);

CREATE UNIQUE INDEX uq_password_credentials_active_purpose
    ON password_credentials (tenant_id, user_id, purpose)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE INDEX idx_password_credentials_tenant_user
    ON password_credentials (tenant_id, user_id, created_at DESC);

CREATE INDEX idx_password_credentials_expiry
    ON password_credentials (expires_at)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;
