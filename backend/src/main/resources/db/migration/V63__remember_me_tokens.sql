CREATE TABLE auth_remember_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES system_users(id),
    token_hash VARCHAR(64) NOT NULL,
    previous_token_hash VARCHAR(64),
    previous_valid_until TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_auth_remember_token_hash CHECK (token_hash ~ '^[a-f0-9]{64}$'),
    CONSTRAINT ck_auth_remember_previous_hash CHECK (
        previous_token_hash IS NULL OR previous_token_hash ~ '^[a-f0-9]{64}$'
    )
);

CREATE INDEX idx_auth_remember_tokens_user ON auth_remember_tokens(user_id);
CREATE INDEX idx_auth_remember_tokens_expiry ON auth_remember_tokens(expires_at) WHERE revoked_at IS NULL;
