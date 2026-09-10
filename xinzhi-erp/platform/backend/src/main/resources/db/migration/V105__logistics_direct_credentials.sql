-- V105: encrypted, provider-specific logistics authorization credentials.

ALTER TABLE tenant_logistics_authorizations
    ADD COLUMN provider_code VARCHAR(64);

UPDATE tenant_logistics_authorizations
SET provider_code = CASE
    WHEN lower(provider_name) IN ('云途', 'yunexpress', 'yun express') THEN 'YUNEXPRESS'
    ELSE 'CUSTOM'
END
WHERE provider_code IS NULL;

ALTER TABLE tenant_logistics_authorizations
    ALTER COLUMN provider_code SET NOT NULL;

ALTER TABLE tenant_logistics_authorizations
    ADD CONSTRAINT ck_logistics_authorizations_provider_code CHECK (
        provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
    );

ALTER TABLE tenant_logistics_authorizations
    DROP CONSTRAINT ck_logistics_authorizations_mode,
    DROP CONSTRAINT ck_logistics_authorizations_connection;

ALTER TABLE tenant_logistics_authorizations
    ADD CONSTRAINT ck_logistics_authorizations_mode CHECK (
        integration_mode IN ('MANUAL', 'CREDENTIAL_REFERENCE', 'DIRECT_CREDENTIALS')
    ),
    ADD CONSTRAINT ck_logistics_authorizations_connection CHECK (
        (
            integration_mode = 'MANUAL'
            AND credential_reference IS NULL
            AND lifecycle_status IN ('ACTIVE', 'ARCHIVED')
        )
        OR (
            integration_mode = 'CREDENTIAL_REFERENCE'
            AND credential_reference ~ '^(vault|credential)://[A-Za-z0-9][A-Za-z0-9._/-]*(#[A-Za-z0-9._-]+)?$'
            AND lifecycle_status IN ('PENDING', 'ACTIVE', 'ARCHIVED')
        )
        OR (
            integration_mode = 'DIRECT_CREDENTIALS'
            AND credential_reference IS NULL
            AND lifecycle_status IN ('PENDING', 'ACTIVE', 'ARCHIVED')
        )
    );

CREATE TABLE tenant_logistics_authorization_credentials (
    authorization_id UUID NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    key_version VARCHAR(32) NOT NULL,
    nonce BYTEA NOT NULL,
    ciphertext BYTEA NOT NULL,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (authorization_id),
    CONSTRAINT fk_logistics_credentials_authorization
        FOREIGN KEY (authorization_id, tenant_id)
        REFERENCES tenant_logistics_authorizations (id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_logistics_credentials_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_credentials_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_credentials_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_credentials_key_version CHECK (
        key_version ~ '^[A-Za-z0-9._-]{1,32}$'
    ),
    CONSTRAINT ck_logistics_credentials_nonce CHECK (octet_length(nonce) = 12),
    CONSTRAINT ck_logistics_credentials_ciphertext CHECK (
        octet_length(ciphertext) BETWEEN 17 AND 4096
    )
);

CREATE INDEX idx_logistics_credentials_tenant
    ON tenant_logistics_authorization_credentials (tenant_id, authorization_id);
