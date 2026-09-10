-- V84: tenant-scoped custom logistics label templates.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '84840000-0000-0000-0000-000000000001',
    'logistics.label_template.write',
    'logistics',
    'Manage logistics label templates',
    'Create and archive tenant custom logistics label templates'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.label_template.write'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_label_templates (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    name VARCHAR(120) NOT NULL,
    document_category VARCHAR(80) NOT NULL,
    width_mm INTEGER NOT NULL,
    height_mm INTEGER NOT NULL,
    template_content VARCHAR(4000) NOT NULL,
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
    CONSTRAINT uq_tenant_logistics_label_templates_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT fk_logistics_label_templates_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_label_templates_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_label_templates_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_label_templates_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_label_templates_name CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 120
    ),
    CONSTRAINT ck_logistics_label_templates_category CHECK (
        document_category = btrim(document_category)
        AND char_length(document_category) BETWEEN 1 AND 80
    ),
    CONSTRAINT ck_logistics_label_templates_dimensions CHECK (
        width_mm BETWEEN 20 AND 300 AND height_mm BETWEEN 20 AND 300
    ),
    CONSTRAINT ck_logistics_label_templates_content CHECK (
        template_content = btrim(template_content)
        AND char_length(template_content) BETWEEN 1 AND 4000
    ),
    CONSTRAINT ck_logistics_label_templates_note CHECK (
        note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 500)
    ),
    CONSTRAINT ck_logistics_label_templates_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_logistics_label_templates_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_label_templates_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_label_templates_display_name CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_logistics_label_templates_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_label_templates_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_label_templates_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_logistics_label_templates_active_name
    ON tenant_logistics_label_templates (tenant_id, lower(name))
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_logistics_label_templates_list
    ON tenant_logistics_label_templates (
        tenant_id, lifecycle_status, updated_at DESC, id DESC
    );
