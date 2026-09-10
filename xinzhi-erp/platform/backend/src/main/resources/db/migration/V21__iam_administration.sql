-- IAM phase two: administrative aggregates, optimistic concurrency and
-- query indexes. This migration intentionally creates no users, roles,
-- permissions or grants.
ALTER TABLE users
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_users_status
        CHECK (status IN ('ACTIVE', 'DISABLED')),
    ADD CONSTRAINT ck_users_username_format
        CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$'),
    ADD CONSTRAINT ck_users_display_name
        CHECK (length(btrim(display_name)) BETWEEN 1 AND 160),
    ADD CONSTRAINT ck_users_version
        CHECK (version >= 0);

ALTER TABLE roles
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_roles_code_format
        CHECK (code ~ '^[a-z][a-z0-9_-]{0,99}$'),
    ADD CONSTRAINT ck_roles_name
        CHECK (length(btrim(name)) BETWEEN 1 AND 160),
    ADD CONSTRAINT ck_roles_version
        CHECK (version >= 0);

ALTER TABLE tenants
    ADD CONSTRAINT ck_tenants_status
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DISABLED'));

ALTER TABLE audit_logs
    ADD CONSTRAINT ck_audit_logs_action_format
        CHECK (action ~ '^[a-z][a-z0-9_.-]{1,159}$'),
    ADD CONSTRAINT ck_audit_logs_resource_type_format
        CHECK (resource_type ~ '^[a-z][a-z0-9_-]{0,99}$');

CREATE INDEX idx_user_roles_tenant_user
    ON user_roles (tenant_id, user_id, role_id);

CREATE INDEX idx_role_permissions_tenant_role
    ON role_permissions (tenant_id, role_id, permission_id);

CREATE INDEX idx_audit_logs_tenant_action_created
    ON audit_logs (tenant_id, action, created_at DESC, id DESC);

CREATE INDEX idx_audit_logs_tenant_type_created
    ON audit_logs (tenant_id, resource_type, created_at DESC, id DESC);
