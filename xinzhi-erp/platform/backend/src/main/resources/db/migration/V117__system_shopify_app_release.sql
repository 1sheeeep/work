CREATE TABLE system_shopify_app_release (
    singleton_id SMALLINT PRIMARY KEY DEFAULT 1,
    token_key_version VARCHAR(16) NOT NULL,
    token_nonce BYTEA NOT NULL,
    token_ciphertext BYTEA NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'CONFIGURED',
    release_version VARCHAR(120),
    release_message VARCHAR(4000),
    released_at TIMESTAMPTZ,
    updated_by_system_admin_id UUID NOT NULL
        REFERENCES system_admins(id),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_shopify_app_release_singleton
        CHECK (singleton_id = 1),
    CONSTRAINT ck_system_shopify_app_release_status
        CHECK (status IN ('CONFIGURED', 'RUNNING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT ck_system_shopify_app_release_token_nonce
        CHECK (octet_length(token_nonce) = 12),
    CONSTRAINT ck_system_shopify_app_release_token_ciphertext
        CHECK (octet_length(token_ciphertext) >= 17),
    CONSTRAINT ck_system_shopify_app_release_version
        CHECK (version >= 0)
);
