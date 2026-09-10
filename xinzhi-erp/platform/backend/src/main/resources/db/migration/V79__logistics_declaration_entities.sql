INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '79000000-0000-0000-0000-000000000001',
    'logistics.declaration_entity.write',
    'logistics',
    '管理企业申报信息',
    '新增、编辑和停用租户内生产销售企业及店铺绑定'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.declaration_entity.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_declaration_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name VARCHAR(200) NOT NULL,
    enterprise_code VARCHAR(100) NOT NULL,
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_logistics_declaration_entities_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_logistics_declaration_entities_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_logistics_declaration_entities_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_logistics_declaration_entities_name CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 200
        AND name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_logistics_declaration_entities_code CHECK (
        enterprise_code = upper(btrim(enterprise_code))
        AND enterprise_code ~ '^[A-Z0-9][A-Z0-9._:/ -]{0,99}$'
    ),
    CONSTRAINT ck_tenant_logistics_declaration_entities_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_tenant_logistics_declaration_entities_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_tenant_logistics_declaration_entities_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_tenant_logistics_declaration_entities_version CHECK (version >= 0)
);

CREATE TABLE tenant_logistics_declaration_entity_shops (
    tenant_id UUID NOT NULL,
    declaration_entity_id UUID NOT NULL,
    shop_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (declaration_entity_id, shop_id),
    CONSTRAINT fk_logistics_declaration_entity_shops_entity
        FOREIGN KEY (tenant_id, declaration_entity_id)
        REFERENCES tenant_logistics_declaration_entities (tenant_id, id),
    CONSTRAINT fk_logistics_declaration_entity_shops_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id)
);

CREATE UNIQUE INDEX uq_tenant_logistics_declaration_entities_active_code
    ON tenant_logistics_declaration_entities (tenant_id, enterprise_code)
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_tenant_logistics_declaration_entities_list
    ON tenant_logistics_declaration_entities (
        tenant_id, lifecycle_status, updated_at DESC, id DESC
    );

CREATE INDEX idx_logistics_declaration_entity_shops_tenant_shop
    ON tenant_logistics_declaration_entity_shops (tenant_id, shop_id);
