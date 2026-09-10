-- V91: tenant-scoped internal announcements.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '91900000-0000-0000-0000-000000000001',
    'settings.notice.write',
    'settings',
    'Manage internal notices',
    'Publish, pin, archive, and restore tenant internal notices'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'settings.notice.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_internal_notices (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    title VARCHAR(160) NOT NULL,
    content VARCHAR(4000) NOT NULL,
    pinned BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    archived_at TIMESTAMPTZ,
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_internal_notices_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_internal_notices_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_internal_notices_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_internal_notices_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_internal_notices_text CHECK (
        title = btrim(title)
        AND char_length(title) BETWEEN 1 AND 160
        AND title !~ '[[:cntrl:]]'
        AND content = btrim(content)
        AND char_length(content) BETWEEN 1 AND 4000
        AND created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_internal_notices_status CHECK (
        status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_internal_notices_lifecycle CHECK (
        (status = 'ARCHIVED') = (archived_at IS NOT NULL)
        AND (status = 'ACTIVE' OR pinned = false)
    ),
    CONSTRAINT ck_internal_notices_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_internal_notices_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_internal_notices_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_internal_notices_version CHECK (version >= 0),
    CONSTRAINT ck_internal_notices_timestamps CHECK (
        updated_at >= created_at
        AND published_at >= created_at
        AND (archived_at IS NULL OR archived_at >= created_at)
    )
);

CREATE INDEX idx_internal_notices_list
    ON tenant_internal_notices (
        tenant_id, status, pinned DESC, published_at DESC, id DESC
    );
CREATE INDEX idx_internal_notices_title
    ON tenant_internal_notices (tenant_id, lower(title));
