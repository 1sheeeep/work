INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '77000000-0000-0000-0000-000000000001',
    'logistics.tracking_number.write',
    'logistics',
    '管理预置运单号',
    '导入、停用租户内预置运单号并在仓库交接时安全核销'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.tracking_number.write'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_tracking_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    import_batch_id UUID NOT NULL,
    tracking_type VARCHAR(32) NOT NULL,
    logistics_channel VARCHAR(100) NOT NULL,
    tracking_reference VARCHAR(160) NOT NULL,
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    used_plan_id UUID,
    used_package_id UUID,
    used_at TIMESTAMPTZ,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_logistics_tracking_numbers_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_logistics_tracking_numbers_reference
        UNIQUE (tenant_id, tracking_reference),
    CONSTRAINT uq_tenant_logistics_tracking_numbers_package
        UNIQUE (tenant_id, used_package_id),
    CONSTRAINT fk_tenant_logistics_tracking_numbers_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_logistics_tracking_numbers_plan
        FOREIGN KEY (tenant_id, used_plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_tenant_logistics_tracking_numbers_package
        FOREIGN KEY (tenant_id, used_package_id)
        REFERENCES tenant_fulfillment_packages (tenant_id, id),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_type CHECK (
        tracking_type IN ('DOMESTIC_EXPRESS', 'CUSTOM_LOGISTICS')
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_channel CHECK (
        logistics_channel = btrim(logistics_channel)
        AND char_length(logistics_channel) BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_reference CHECK (
        tracking_reference = btrim(tracking_reference)
        AND char_length(tracking_reference) BETWEEN 1 AND 160
        AND tracking_reference !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_usage CHECK (
        (used_plan_id IS NULL AND used_package_id IS NULL AND used_at IS NULL)
        OR (used_plan_id IS NOT NULL AND used_package_id IS NOT NULL AND used_at IS NOT NULL)
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_archive CHECK (
        lifecycle_status = 'ACTIVE' OR used_package_id IS NULL
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_tenant_logistics_tracking_numbers_version CHECK (version >= 0)
);

CREATE INDEX idx_tenant_logistics_tracking_numbers_list
    ON tenant_logistics_tracking_numbers (
        tenant_id, tracking_type, lifecycle_status, created_at DESC, id DESC
    );
