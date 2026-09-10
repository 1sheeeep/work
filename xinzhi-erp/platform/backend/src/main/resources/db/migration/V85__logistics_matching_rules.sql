-- V85: tenant-scoped logistics matching rules.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '85850000-0000-0000-0000-000000000001',
    'logistics.matching_rule.write',
    'logistics',
    'Manage logistics matching rules',
    'Create and archive tenant logistics matching rules'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.matching_rule.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_matching_rules (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    name VARCHAR(100) NOT NULL,
    priority INTEGER NOT NULL,
    platform_name VARCHAR(100),
    shop_name VARCHAR(160),
    channel_name VARCHAR(160) NOT NULL,
    warehouse_name VARCHAR(160),
    auto_handover BOOLEAN NOT NULL DEFAULT false,
    no_handover_start TIME,
    no_handover_end TIME,
    note VARCHAR(500),
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_logistics_matching_rules_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_logistics_matching_rules_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_matching_rules_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_matching_rules_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_matching_rules_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_matching_rules_name CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_logistics_matching_rules_priority CHECK (priority BETWEEN 1 AND 9999),
    CONSTRAINT ck_logistics_matching_rules_channel CHECK (
        channel_name = btrim(channel_name) AND char_length(channel_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_logistics_matching_rules_optional CHECK (
        (platform_name IS NULL OR (platform_name = btrim(platform_name) AND char_length(platform_name) BETWEEN 1 AND 100))
        AND (shop_name IS NULL OR (shop_name = btrim(shop_name) AND char_length(shop_name) BETWEEN 1 AND 160))
        AND (warehouse_name IS NULL OR (warehouse_name = btrim(warehouse_name) AND char_length(warehouse_name) BETWEEN 1 AND 160))
        AND (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 500))
    ),
    CONSTRAINT ck_logistics_matching_rules_handover_window CHECK (
        (no_handover_start IS NULL) = (no_handover_end IS NULL)
    ),
    CONSTRAINT ck_logistics_matching_rules_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_logistics_matching_rules_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_matching_rules_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_matching_rules_display_name CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_logistics_matching_rules_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_matching_rules_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_matching_rules_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_logistics_matching_rules_active_name
    ON tenant_logistics_matching_rules (tenant_id, lower(name))
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_logistics_matching_rules_list
    ON tenant_logistics_matching_rules (
        tenant_id, lifecycle_status, priority, updated_at DESC, id DESC
    );
