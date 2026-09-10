INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '94000000-0000-0000-0000-000000000001',
    'settings.parameter.write',
    'settings',
    '管理业务参数',
    '维护租户级订单与业务处理参数'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'settings.parameter.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_shipping_deadline_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    deadline_days INTEGER NOT NULL,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_shipping_deadline_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_shipping_deadline_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_shipping_deadline_days CHECK (deadline_days BETWEEN 1 AND 365),
    CONSTRAINT ck_shipping_deadline_display_name CHECK (
        updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_shipping_deadline_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_shipping_deadline_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_shipping_deadline_version CHECK (version >= 0),
    CONSTRAINT ck_shipping_deadline_timestamps CHECK (updated_at >= created_at)
);
