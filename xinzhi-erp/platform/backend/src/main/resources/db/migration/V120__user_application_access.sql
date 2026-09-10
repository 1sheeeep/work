CREATE TABLE user_application_access_sets (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    PRIMARY KEY (tenant_id, user_id),
    CONSTRAINT fk_user_application_access_set_user
        FOREIGN KEY (user_id, tenant_id) REFERENCES users(id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_user_application_access_set_actor
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users(id, tenant_id),
    CONSTRAINT ck_user_application_access_set_version CHECK (version >= 0),
    CONSTRAINT ck_user_application_access_set_actor CHECK (
        updated_by_user_id IS NULL
        OR updated_by_system_admin_id IS NULL
    )
);

CREATE TABLE user_enabled_applications (
    tenant_id UUID NOT NULL,
    user_id UUID NOT NULL,
    application_code VARCHAR(40) NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, user_id, application_code),
    CONSTRAINT fk_user_enabled_application_set
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES user_application_access_sets(tenant_id, user_id)
        ON DELETE CASCADE,
    CONSTRAINT ck_user_enabled_application_code CHECK (
        application_code IN ('ERP', 'CHAT', 'ZHAOYAOJING', 'ASSET_REGISTRY')
    )
);

CREATE INDEX idx_user_enabled_applications_lookup
    ON user_enabled_applications (tenant_id, application_code, user_id);

-- Preserve current behavior for existing employees. New employees start with
-- no business application access until an enterprise administrator assigns it.
INSERT INTO user_application_access_sets (tenant_id, user_id, version, updated_at)
SELECT account.tenant_id, account.id, 0, now()
FROM users account
ON CONFLICT (tenant_id, user_id) DO NOTHING;

INSERT INTO user_enabled_applications (
    tenant_id, user_id, application_code, enabled_at
)
SELECT account.tenant_id, account.id, enabled.application_code, now()
FROM users account
JOIN (
    SELECT DISTINCT tenant_id, application_code
    FROM tenant_enabled_application_modules
) enabled ON enabled.tenant_id = account.tenant_id
ON CONFLICT (tenant_id, user_id, application_code) DO NOTHING;
