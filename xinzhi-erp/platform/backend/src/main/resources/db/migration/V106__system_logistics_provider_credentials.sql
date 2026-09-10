-- V106: platform-managed, encrypted credentials shared by logistics connectors.

CREATE TABLE system_logistics_provider_credentials (
    provider_code VARCHAR(64) PRIMARY KEY,
    key_version VARCHAR(32) NOT NULL,
    nonce BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    updated_by_system_admin_id UUID NOT NULL REFERENCES system_admins (id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_logistics_provider_code CHECK (
        provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
    ),
    CONSTRAINT ck_system_logistics_provider_key_version CHECK (
        key_version ~ '^[A-Za-z0-9._-]{1,32}$'
    ),
    CONSTRAINT ck_system_logistics_provider_nonce CHECK (
        octet_length(nonce) = 12
    ),
    CONSTRAINT ck_system_logistics_provider_ciphertext CHECK (
        octet_length(ciphertext) BETWEEN 17 AND 8192
    ),
    CONSTRAINT ck_system_logistics_provider_version CHECK (version > 0)
);

CREATE INDEX idx_system_logistics_provider_updated
    ON system_logistics_provider_credentials (updated_at DESC, provider_code);
