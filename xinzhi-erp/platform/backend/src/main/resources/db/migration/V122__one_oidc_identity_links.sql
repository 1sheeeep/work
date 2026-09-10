-- Stable One subject links and short-lived, one-time browser login grants.

ALTER TABLE tenants
    ADD COLUMN one_tenant_id UUID;

CREATE UNIQUE INDEX uq_tenants_one_tenant_id
    ON tenants (one_tenant_id)
    WHERE one_tenant_id IS NOT NULL;

ALTER TABLE users
    ADD COLUMN one_subject_id UUID;

CREATE UNIQUE INDEX uq_users_one_subject_id
    ON users (one_subject_id)
    WHERE one_subject_id IS NOT NULL;

ALTER TABLE system_admins
    ADD COLUMN one_subject_id UUID;

CREATE UNIQUE INDEX uq_system_admins_one_subject_id
    ON system_admins (one_subject_id)
    WHERE one_subject_id IS NOT NULL;

CREATE TABLE one_oidc_login_grants (
    id UUID PRIMARY KEY,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    tenant_id UUID,
    user_id UUID,
    system_admin_id UUID REFERENCES system_admins(id),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_one_oidc_grant_user_tenant
        FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_one_oidc_grant_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_one_oidc_grant_subject
        CHECK (
            (tenant_id IS NOT NULL AND user_id IS NOT NULL
                AND system_admin_id IS NULL)
            OR
            (tenant_id IS NULL AND user_id IS NULL
                AND system_admin_id IS NOT NULL)
        ),
    CONSTRAINT ck_one_oidc_grant_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_one_oidc_grant_consumed
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_one_oidc_login_grants_expiry
    ON one_oidc_login_grants (expires_at)
    WHERE consumed_at IS NULL;
