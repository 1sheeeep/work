-- Global platform system administrators and trusted tenant-entry sessions.
-- System administrators are deliberately not tenant users.

ALTER TABLE tenants
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0,
    ADD CONSTRAINT ck_tenants_code_format
        CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
    ADD CONSTRAINT ck_tenants_name
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
    ADD CONSTRAINT ck_tenants_version
        CHECK (version >= 0);

CREATE TABLE system_admin_state_guard (
    singleton BOOLEAN PRIMARY KEY DEFAULT true,
    active_count INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT ck_system_admin_state_guard_singleton CHECK (singleton),
    CONSTRAINT ck_system_admin_state_guard_count CHECK (active_count >= 0)
);

INSERT INTO system_admin_state_guard (singleton, active_count)
VALUES (true, 0);

CREATE TABLE system_admins (
    id UUID PRIMARY KEY,
    username VARCHAR(120) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    password_hash VARCHAR(255),
    status VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_system_admins_username_format
        CHECK (username ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$'),
    CONSTRAINT ck_system_admins_display_name
        CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 160),
    CONSTRAINT ck_system_admins_status
        CHECK (status IN (
            'PENDING_ACTIVATION', 'ACTIVE', 'DISABLED', 'DELETED'
        )),
    CONSTRAINT ck_system_admins_password_state
        CHECK (
            status = 'PENDING_ACTIVATION'
            OR password_hash IS NOT NULL
            OR status = 'DELETED'
        ),
    CONSTRAINT ck_system_admins_version CHECK (version >= 0),
    CONSTRAINT ck_system_admins_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_system_admins_username_ci
    ON system_admins (lower(username));
CREATE INDEX idx_system_admins_list
    ON system_admins (status, lower(username), id);

CREATE OR REPLACE FUNCTION enforce_system_admin_state()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'system administrators must be soft deleted'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' AND NEW.status = 'ACTIVE' THEN
        UPDATE system_admin_state_guard
        SET active_count = active_count + 1
        WHERE singleton = true;
    ELSIF TG_OP = 'UPDATE'
            AND OLD.status <> 'ACTIVE'
            AND NEW.status = 'ACTIVE' THEN
        UPDATE system_admin_state_guard
        SET active_count = active_count + 1
        WHERE singleton = true;
    ELSIF TG_OP = 'UPDATE'
            AND OLD.status = 'ACTIVE'
            AND NEW.status <> 'ACTIVE' THEN
        UPDATE system_admin_state_guard
        SET active_count = active_count - 1
        WHERE singleton = true
          AND active_count > 1;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'at least one active system administrator is required'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_system_admin_state
BEFORE INSERT OR UPDATE OR DELETE ON system_admins
FOR EACH ROW EXECUTE FUNCTION enforce_system_admin_state();

CREATE TABLE platform_admin_password_credentials (
    id UUID PRIMARY KEY,
    system_admin_id UUID NOT NULL REFERENCES system_admins(id),
    purpose VARCHAR(32) NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    created_at TIMESTAMPTZ NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT ck_platform_admin_credential_purpose
        CHECK (purpose IN ('ACTIVATION', 'RESET')),
    CONSTRAINT ck_platform_admin_credential_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_platform_admin_credential_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_platform_admin_credential_terminal
        CHECK (
            (consumed_at IS NULL OR consumed_at >= created_at)
            AND (revoked_at IS NULL OR revoked_at >= created_at)
            AND NOT (consumed_at IS NOT NULL AND revoked_at IS NOT NULL)
        ),
    CONSTRAINT ck_platform_admin_credential_version CHECK (version >= 0)
);

CREATE UNIQUE INDEX uq_platform_admin_credential_open_purpose
    ON platform_admin_password_credentials (system_admin_id, purpose)
    WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX idx_platform_admin_credentials_admin
    ON platform_admin_password_credentials
    (system_admin_id, created_at DESC);

CREATE TABLE platform_admin_sessions (
    id UUID PRIMARY KEY,
    system_admin_id UUID NOT NULL REFERENCES system_admins(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_platform_admin_sessions_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_platform_admin_sessions_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_platform_admin_sessions_revocation
        CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CONSTRAINT uq_platform_admin_sessions_id_admin
        UNIQUE (id, system_admin_id)
);

CREATE INDEX idx_platform_admin_sessions_admin
    ON platform_admin_sessions (system_admin_id, created_at DESC);
CREATE INDEX idx_platform_admin_sessions_expiry
    ON platform_admin_sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE platform_admin_tenant_sessions (
    id UUID PRIMARY KEY,
    platform_session_id UUID NOT NULL,
    system_admin_id UUID NOT NULL REFERENCES system_admins(id),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_platform_admin_tenant_sessions_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_platform_admin_tenant_sessions_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_platform_admin_tenant_sessions_revocation
        CHECK (revoked_at IS NULL OR revoked_at >= created_at),
    CONSTRAINT fk_platform_admin_tenant_session_base_actor
        FOREIGN KEY (platform_session_id, system_admin_id)
        REFERENCES platform_admin_sessions (id, system_admin_id)
);

CREATE INDEX idx_platform_admin_tenant_sessions_admin
    ON platform_admin_tenant_sessions (system_admin_id, tenant_id, created_at DESC);
CREATE INDEX idx_platform_admin_tenant_sessions_base
    ON platform_admin_tenant_sessions (platform_session_id);
CREATE INDEX idx_platform_admin_tenant_sessions_expiry
    ON platform_admin_tenant_sessions (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE platform_admin_login_throttles (
    system_admin_id UUID PRIMARY KEY REFERENCES system_admins(id),
    failed_count INTEGER NOT NULL,
    window_started_at TIMESTAMPTZ NOT NULL,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_platform_admin_login_throttle_count
        CHECK (failed_count >= 0),
    CONSTRAINT ck_platform_admin_login_throttle_lock
        CHECK (locked_until IS NULL OR locked_until > window_started_at),
    CONSTRAINT ck_platform_admin_login_throttle_updated
        CHECK (updated_at >= window_started_at)
);

CREATE INDEX idx_platform_admin_login_throttles_locked
    ON platform_admin_login_throttles (locked_until)
    WHERE locked_until IS NOT NULL;

CREATE TABLE platform_admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_system_admin_id UUID REFERENCES system_admins(id),
    tenant_id UUID REFERENCES tenants(id),
    action VARCHAR(160) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(160),
    request_id VARCHAR(100),
    source_ip INET,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_platform_admin_audit_action
        CHECK (action ~ '^[a-z][a-z0-9_.-]{1,159}$'),
    CONSTRAINT ck_platform_admin_audit_resource_type
        CHECK (resource_type ~ '^[a-z][a-z0-9_-]{0,99}$')
);

CREATE INDEX idx_platform_admin_audit_created
    ON platform_admin_audit_logs (created_at DESC, id DESC);
CREATE INDEX idx_platform_admin_audit_actor
    ON platform_admin_audit_logs
    (actor_system_admin_id, created_at DESC, id DESC);
CREATE INDEX idx_platform_admin_audit_tenant
    ON platform_admin_audit_logs
    (tenant_id, created_at DESC, id DESC);

ALTER TABLE audit_logs
    ADD COLUMN actor_system_admin_id UUID REFERENCES system_admins(id);

CREATE INDEX idx_audit_logs_system_admin_actor
    ON audit_logs
    (actor_system_admin_id, created_at DESC, id DESC)
    WHERE actor_system_admin_id IS NOT NULL;

ALTER TABLE password_credentials
    ALTER COLUMN created_by_user_id DROP NOT NULL,
    ADD COLUMN created_by_system_admin_id UUID REFERENCES system_admins(id),
    ADD CONSTRAINT ck_password_credentials_creator
        CHECK (
            (created_by_user_id IS NOT NULL)::integer
            + (created_by_system_admin_id IS NOT NULL)::integer = 1
        );
