-- Tenant-scoped manual procurement plans. This migration creates no purchase
-- order, supplier, finance, receiving, or recommendation capability.

ALTER TABLE tenant_warehouse_locations
    ADD CONSTRAINT uq_tenant_warehouse_locations_tenant_warehouse_id
        UNIQUE (tenant_id, warehouse_id, id);

CREATE TABLE procurement_plans (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    plan_no VARCHAR(40) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'UNPURCHASED',
    source VARCHAR(16) NOT NULL DEFAULT 'MANUAL',
    sku_id UUID NOT NULL,
    sku_code_snapshot VARCHAR(64) NOT NULL,
    sku_name_snapshot VARCHAR(200) NOT NULL,
    sku_variant_snapshot VARCHAR(1000),
    warehouse_id UUID NOT NULL,
    warehouse_code_snapshot VARCHAR(64) NOT NULL,
    warehouse_name_snapshot VARCHAR(200) NOT NULL,
    location_id UUID NOT NULL,
    location_code_snapshot VARCHAR(64) NOT NULL,
    location_name_snapshot VARCHAR(200) NOT NULL,
    quantity BIGINT NOT NULL,
    note VARCHAR(500),
    applicant_display_name VARCHAR(160) NOT NULL,
    applicant_user_id UUID,
    applicant_system_admin_id UUID,
    void_reason VARCHAR(500),
    voided_by_display_name VARCHAR(160),
    voided_by_user_id UUID,
    voided_by_system_admin_id UUID,
    voided_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_procurement_plans_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_procurement_plans_tenant_no UNIQUE (tenant_id, plan_no),
    CONSTRAINT fk_procurement_plans_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_procurement_plans_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_procurement_plans_location
        FOREIGN KEY (tenant_id, warehouse_id, location_id)
        REFERENCES tenant_warehouse_locations (tenant_id, warehouse_id, id),
    CONSTRAINT fk_procurement_plans_applicant_user
        FOREIGN KEY (applicant_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_procurement_plans_applicant_admin
        FOREIGN KEY (applicant_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT fk_procurement_plans_void_user
        FOREIGN KEY (voided_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_procurement_plans_void_admin
        FOREIGN KEY (voided_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_procurement_plans_source CHECK (source = 'MANUAL'),
    CONSTRAINT ck_procurement_plans_status
        CHECK (status IN ('UNPURCHASED', 'VOIDED')),
    CONSTRAINT ck_procurement_plans_quantity
        CHECK (quantity BETWEEN 1 AND 1000000000),
    CONSTRAINT ck_procurement_plans_version CHECK (version >= 0),
    CONSTRAINT ck_procurement_plans_plan_no
        CHECK (plan_no ~ '^PP-[0-9]{8}-[0-9A-F]{28}$'),
    CONSTRAINT ck_procurement_plans_snapshot_text CHECK (
        char_length(btrim(sku_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(sku_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(location_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(location_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(applicant_display_name)) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_procurement_plans_applicant CHECK (
        (applicant_user_id IS NULL) <> (applicant_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_procurement_plans_void_state CHECK (
        (
            status = 'UNPURCHASED'
            AND void_reason IS NULL
            AND voided_by_display_name IS NULL
            AND voided_by_user_id IS NULL
            AND voided_by_system_admin_id IS NULL
            AND voided_at IS NULL
        )
        OR (
            status = 'VOIDED'
            AND void_reason IS NOT NULL
            AND char_length(btrim(void_reason)) BETWEEN 1 AND 500
            AND void_reason !~ '[[:cntrl:]]'
            AND voided_by_display_name IS NOT NULL
            AND char_length(btrim(voided_by_display_name)) BETWEEN 1 AND 160
            AND (voided_by_user_id IS NULL) <> (voided_by_system_admin_id IS NULL)
            AND voided_at IS NOT NULL
            AND version > 0
        )
    )
);

CREATE TABLE procurement_plan_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    plan_id UUID NOT NULL,
    operation VARCHAR(16) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    result_status VARCHAR(24) NOT NULL,
    result_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_procurement_plan_commands_plan
        FOREIGN KEY (tenant_id, plan_id)
        REFERENCES procurement_plans (tenant_id, id),
    CONSTRAINT ck_procurement_plan_commands_operation
        CHECK (operation IN ('CREATE', 'VOID')),
    CONSTRAINT ck_procurement_plan_commands_fingerprint
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_procurement_plan_commands_status
        CHECK (result_status IN ('UNPURCHASED', 'VOIDED')),
    CONSTRAINT ck_procurement_plan_commands_version
        CHECK (result_version >= 0),
    CONSTRAINT ck_procurement_plan_commands_result CHECK (
        (operation = 'CREATE' AND result_status = 'UNPURCHASED' AND result_version = 0)
        OR (operation = 'VOID' AND result_status = 'VOIDED' AND result_version > 0)
    )
);

CREATE INDEX idx_procurement_plans_status_created
    ON procurement_plans (tenant_id, status, created_at DESC, id DESC);
CREATE INDEX idx_procurement_plans_warehouse_created
    ON procurement_plans (tenant_id, warehouse_id, created_at DESC, id DESC);
CREATE INDEX idx_procurement_plans_location_created
    ON procurement_plans (tenant_id, location_id, created_at DESC, id DESC);
CREATE INDEX idx_procurement_plans_sku_created
    ON procurement_plans (tenant_id, sku_id, created_at DESC, id DESC);
CREATE INDEX idx_procurement_plan_commands_plan
    ON procurement_plan_commands (tenant_id, plan_id, created_at DESC);

UPDATE permissions
SET name = 'Read procurement plans',
    description = 'Read tenant-scoped manual procurement plans and active plan references'
WHERE code = 'procurement.read';

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '69000000-0000-0000-0000-000000000001',
    'procurement.write',
    'procurement',
    'Write procurement plans',
    'Create and void tenant-scoped manual procurement plans'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'procurement.write'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;
