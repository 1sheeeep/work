-- Strengthen tenant isolation for the identity tables created by V1.
-- The composite keys make a mismatched tenant_id impossible in assignment and
-- audit records, even if an application query is implemented incorrectly.
ALTER TABLE users
    ADD CONSTRAINT uq_users_id_tenant UNIQUE (id, tenant_id);

ALTER TABLE roles
    ADD CONSTRAINT uq_roles_id_tenant UNIQUE (id, tenant_id);

ALTER TABLE user_roles
    ADD CONSTRAINT fk_user_roles_user_tenant
        FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
    ADD CONSTRAINT fk_user_roles_role_tenant
        FOREIGN KEY (role_id, tenant_id) REFERENCES roles (id, tenant_id);

ALTER TABLE role_permissions
    ADD CONSTRAINT fk_role_permissions_role_tenant
        FOREIGN KEY (role_id, tenant_id) REFERENCES roles (id, tenant_id);

ALTER TABLE audit_logs
    ADD CONSTRAINT fk_audit_logs_actor_tenant
        FOREIGN KEY (actor_user_id, tenant_id) REFERENCES users (id, tenant_id);

ALTER TABLE permissions
    ADD CONSTRAINT ck_permissions_code_format
        CHECK (
            code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'
            OR code ~ '^[a-z][a-z0-9_]*(:[a-z][a-z0-9_]*)+$'
        );

CREATE TABLE auth_sessions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_auth_sessions_user_tenant
        FOREIGN KEY (user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_auth_sessions_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_auth_sessions_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_auth_sessions_revocation
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE INDEX idx_auth_sessions_tenant_user
    ON auth_sessions (tenant_id, user_id);

CREATE INDEX idx_auth_sessions_expiry
    ON auth_sessions (expires_at)
    WHERE revoked_at IS NULL;
