-- V86: tenant-scoped logistics provider authorization profiles.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '86860000-0000-0000-0000-000000000001',
    'logistics.authorization.write',
    'logistics',
    'Manage logistics provider connections',
    'Create and archive logistics provider authorization profiles'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.authorization.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_authorizations (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    category VARCHAR(24) NOT NULL,
    provider_name VARCHAR(120) NOT NULL,
    account_label VARCHAR(160) NOT NULL,
    integration_mode VARCHAR(32) NOT NULL,
    credential_reference VARCHAR(512),
    contact_name VARCHAR(120),
    note VARCHAR(500),
    lifecycle_status VARCHAR(16) NOT NULL,
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_logistics_authorizations_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_logistics_authorizations_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_authorizations_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_authorizations_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_authorizations_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_authorizations_category CHECK (
        category IN ('PLATFORM', 'SELF_FULFILLED', 'FIRST_MILE',
                     'OVERSEAS', 'CLOUD_FACTORY', 'CUSTOM')
    ),
    CONSTRAINT ck_logistics_authorizations_provider CHECK (
        provider_name = btrim(provider_name)
        AND char_length(provider_name) BETWEEN 1 AND 120
        AND provider_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_logistics_authorizations_account CHECK (
        account_label = btrim(account_label)
        AND char_length(account_label) BETWEEN 1 AND 160
        AND account_label !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_logistics_authorizations_optional CHECK (
        (contact_name IS NULL OR (
            contact_name = btrim(contact_name)
            AND char_length(contact_name) BETWEEN 1 AND 120
            AND contact_name !~ '[[:cntrl:]]'))
        AND (note IS NULL OR (
            note = btrim(note)
            AND char_length(note) BETWEEN 1 AND 500
            AND note !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_logistics_authorizations_mode CHECK (
        integration_mode IN ('MANUAL', 'CREDENTIAL_REFERENCE')
    ),
    CONSTRAINT ck_logistics_authorizations_connection CHECK (
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
    ),
    CONSTRAINT ck_logistics_authorizations_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_authorizations_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_authorizations_display_name CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_logistics_authorizations_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_authorizations_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_authorizations_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_logistics_authorizations_current_account
    ON tenant_logistics_authorizations (
        tenant_id, category, lower(provider_name), lower(account_label)
    )
    WHERE lifecycle_status <> 'ARCHIVED';

CREATE INDEX idx_logistics_authorizations_list
    ON tenant_logistics_authorizations (
        tenant_id, category, lifecycle_status, updated_at DESC, id DESC
    );
