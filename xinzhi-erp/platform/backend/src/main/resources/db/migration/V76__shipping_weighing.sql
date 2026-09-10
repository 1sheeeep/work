DELETE FROM role_permissions
WHERE permission_id IN (
    SELECT id FROM permissions
    WHERE code IN ('orders.dispute.read', 'orders.dispute.write')
);
DELETE FROM permissions
WHERE code IN ('orders.dispute.read', 'orders.dispute.write');

INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('76000000-0000-0000-0000-000000000001', 'products.weight.write', 'products', '维护商品重量与包装规则', '维护库存 SKU 标准重量和按数量生效的包装规则'),
    ('76000000-0000-0000-0000-000000000002', 'warehouses.shipping_config.write', 'warehouses', '维护仓库发货称重配置', '维护包装模板在仓库的可用性、电子秤和误差覆盖值'),
    ('76000000-0000-0000-0000-000000000003', 'fulfillments.weigh.override', 'orders', '强制放行称重异常', '在缺少标准重量、设备故障或重量超限时记录原因并强制放行')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code IN (
    'products.weight.write',
    'warehouses.shipping_config.write',
    'fulfillments.weigh.override'
)
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

ALTER TABLE tenant_product_skus
    ADD COLUMN standard_weight_grams BIGINT,
    ADD CONSTRAINT ck_tenant_product_skus_standard_weight
        CHECK (standard_weight_grams IS NULL
            OR standard_weight_grams BETWEEN 1 AND 999999999);

CREATE TABLE tenant_packaging_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_code VARCHAR(64) NOT NULL,
    name VARCHAR(160) NOT NULL,
    packaging_type VARCHAR(24) NOT NULL,
    standard_weight_grams INTEGER NOT NULL,
    length_mm INTEGER,
    width_mm INTEGER,
    height_mm INTEGER,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_packaging_templates_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_packaging_templates_code UNIQUE (tenant_id, business_code),
    CONSTRAINT ck_tenant_packaging_templates_code
        CHECK (business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
    CONSTRAINT ck_tenant_packaging_templates_name
        CHECK (name = btrim(name) AND char_length(name) BETWEEN 1 AND 160),
    CONSTRAINT ck_tenant_packaging_templates_type
        CHECK (packaging_type IN ('BOX', 'MAILER', 'BAG', 'OTHER')),
    CONSTRAINT ck_tenant_packaging_templates_weight
        CHECK (standard_weight_grams BETWEEN 1 AND 999999999),
    CONSTRAINT ck_tenant_packaging_templates_dimensions CHECK (
        (length_mm IS NULL AND width_mm IS NULL AND height_mm IS NULL)
        OR (length_mm BETWEEN 1 AND 999999
            AND width_mm BETWEEN 1 AND 999999
            AND height_mm BETWEEN 1 AND 999999)
    ),
    CONSTRAINT ck_tenant_packaging_templates_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_tenant_packaging_templates_version CHECK (version >= 0)
);
CREATE INDEX idx_tenant_packaging_templates_list
    ON tenant_packaging_templates (tenant_id, status, business_code, id);

CREATE TABLE tenant_sku_packaging_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    sku_id UUID NOT NULL,
    min_quantity INTEGER NOT NULL,
    max_quantity INTEGER NOT NULL,
    packaging_template_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_sku_packaging_rules_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_sku_packaging_rules_range
        UNIQUE (tenant_id, sku_id, min_quantity, max_quantity),
    CONSTRAINT fk_tenant_sku_packaging_rules_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_tenant_sku_packaging_rules_template
        FOREIGN KEY (tenant_id, packaging_template_id)
        REFERENCES tenant_packaging_templates (tenant_id, id),
    CONSTRAINT ck_tenant_sku_packaging_rules_range
        CHECK (min_quantity >= 1 AND max_quantity >= min_quantity),
    CONSTRAINT ck_tenant_sku_packaging_rules_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_tenant_sku_packaging_rules_version CHECK (version >= 0)
);
CREATE INDEX idx_tenant_sku_packaging_rules_lookup
    ON tenant_sku_packaging_rules (
        tenant_id, sku_id, status, min_quantity, max_quantity, id
    );

CREATE TABLE tenant_warehouse_packaging_availability (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    warehouse_id UUID NOT NULL,
    packaging_template_id UUID NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, warehouse_id, packaging_template_id),
    CONSTRAINT fk_tenant_warehouse_packaging_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_tenant_warehouse_packaging_template
        FOREIGN KEY (tenant_id, packaging_template_id)
        REFERENCES tenant_packaging_templates (tenant_id, id)
);

CREATE TABLE tenant_shipping_scales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    warehouse_id UUID NOT NULL,
    device_number VARCHAR(100) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_shipping_scales_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_shipping_scales_device UNIQUE (tenant_id, device_number),
    CONSTRAINT fk_tenant_shipping_scales_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT ck_tenant_shipping_scales_device
        CHECK (device_number ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_tenant_shipping_scales_name
        CHECK (display_name = btrim(display_name)
            AND char_length(display_name) BETWEEN 1 AND 160),
    CONSTRAINT ck_tenant_shipping_scales_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_tenant_shipping_scales_version CHECK (version >= 0)
);
CREATE INDEX idx_tenant_shipping_scales_warehouse
    ON tenant_shipping_scales (tenant_id, warehouse_id, status, display_name, id);

CREATE TABLE tenant_shipping_scale_binding_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    scale_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_shipping_scale_binding_events_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_shipping_scale_binding_events_scale
        FOREIGN KEY (tenant_id, scale_id)
        REFERENCES tenant_shipping_scales (tenant_id, id),
    CONSTRAINT fk_tenant_shipping_scale_binding_events_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_tenant_shipping_scale_binding_events_actor
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_shipping_scale_binding_events_type
        CHECK (event_type IN ('BOUND', 'MOVED', 'DISABLED', 'ENABLED')),
    CONSTRAINT ck_tenant_shipping_scale_binding_events_actor
        CHECK ((actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_tenant_shipping_scale_binding_events_request
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$')
);
CREATE INDEX idx_tenant_shipping_scale_binding_events_scale
    ON tenant_shipping_scale_binding_events (
        tenant_id, scale_id, recorded_at DESC, id DESC
    );
CREATE TRIGGER trg_tenant_shipping_scale_binding_events_append_only
BEFORE UPDATE OR DELETE ON tenant_shipping_scale_binding_events
FOR EACH ROW EXECUTE FUNCTION reject_inventory_ledger_mutation();

CREATE TABLE tenant_shipping_weight_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    tolerance_grams INTEGER NOT NULL DEFAULT 30,
    tolerance_basis_points INTEGER NOT NULL DEFAULT 300,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_tenant_shipping_weight_settings_grams
        CHECK (tolerance_grams BETWEEN 0 AND 999999999),
    CONSTRAINT ck_tenant_shipping_weight_settings_percent
        CHECK (tolerance_basis_points BETWEEN 0 AND 10000)
);

CREATE TABLE tenant_warehouse_weight_settings (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    warehouse_id UUID NOT NULL,
    tolerance_grams INTEGER NOT NULL,
    tolerance_basis_points INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, warehouse_id),
    CONSTRAINT fk_tenant_warehouse_weight_settings_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT ck_tenant_warehouse_weight_settings_grams
        CHECK (tolerance_grams BETWEEN 0 AND 999999999),
    CONSTRAINT ck_tenant_warehouse_weight_settings_percent
        CHECK (tolerance_basis_points BETWEEN 0 AND 10000)
);

ALTER TABLE tenant_fulfillment_packages
    ADD COLUMN packaging_template_id UUID,
    ADD COLUMN packaging_code_snapshot VARCHAR(64),
    ADD COLUMN packaging_name_snapshot VARCHAR(160),
    ADD COLUMN packaging_weight_grams INTEGER,
    ADD COLUMN expected_weight_grams BIGINT,
    ADD COLUMN allowed_tolerance_grams BIGINT,
    ADD COLUMN weight_difference_grams BIGINT,
    ADD COLUMN weighing_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN weighing_source VARCHAR(16),
    ADD COLUMN shipping_scale_id UUID,
    ADD COLUMN weighed_at TIMESTAMPTZ,
    ADD CONSTRAINT fk_tenant_fulfillment_packages_packaging
        FOREIGN KEY (tenant_id, packaging_template_id)
        REFERENCES tenant_packaging_templates (tenant_id, id),
    ADD CONSTRAINT fk_tenant_fulfillment_packages_scale
        FOREIGN KEY (tenant_id, shipping_scale_id)
        REFERENCES tenant_shipping_scales (tenant_id, id),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_packaging_snapshot CHECK (
        (packaging_template_id IS NULL
            AND packaging_code_snapshot IS NULL
            AND packaging_name_snapshot IS NULL
            AND packaging_weight_grams IS NULL)
        OR (packaging_template_id IS NOT NULL
            AND packaging_code_snapshot IS NOT NULL
            AND packaging_name_snapshot IS NOT NULL
            AND packaging_weight_grams BETWEEN 1 AND 999999999)
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_weight_summary CHECK (
        expected_weight_grams IS NULL OR expected_weight_grams BETWEEN 1 AND 999999999
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_tolerance CHECK (
        allowed_tolerance_grams IS NULL
        OR allowed_tolerance_grams BETWEEN 0 AND 999999999
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_difference CHECK (
        weight_difference_grams IS NULL
        OR weight_difference_grams BETWEEN -999999999 AND 999999999
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_weighing_status CHECK (
        weighing_status IN ('PENDING', 'MISSING_WEIGHT', 'PASSED', 'BLOCKED', 'OVERRIDDEN')
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_weighing_source CHECK (
        weighing_source IS NULL OR weighing_source IN ('SCALE', 'MANUAL')
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_weighing_identity CHECK (
        (weighing_status IN ('PENDING', 'MISSING_WEIGHT')
            AND weighing_source IS NULL
            AND shipping_scale_id IS NULL
            AND weighed_at IS NULL)
        OR (weighing_status IN ('PASSED', 'BLOCKED')
            AND weighing_source = 'SCALE'
            AND shipping_scale_id IS NOT NULL
            AND weighed_at IS NOT NULL)
        OR (weighing_status = 'OVERRIDDEN'
            AND weighing_source = 'MANUAL'
            AND shipping_scale_id IS NULL
            AND weighed_at IS NOT NULL)
    );

CREATE TABLE tenant_fulfillment_weighing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    plan_id UUID NOT NULL,
    package_id UUID NOT NULL,
    command_id UUID NOT NULL,
    scale_id UUID,
    source VARCHAR(16) NOT NULL,
    expected_weight_grams BIGINT,
    actual_weight_grams BIGINT NOT NULL,
    allowed_tolerance_grams BIGINT,
    weight_difference_grams BIGINT,
    result VARCHAR(16) NOT NULL,
    override_reason VARCHAR(500),
    occurred_at TIMESTAMPTZ NOT NULL,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_fulfillment_weighing_events_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_fulfillment_weighing_events_command
        UNIQUE (tenant_id, command_id),
    CONSTRAINT fk_tenant_fulfillment_weighing_events_plan
        FOREIGN KEY (tenant_id, plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_weighing_events_package
        FOREIGN KEY (tenant_id, package_id)
        REFERENCES tenant_fulfillment_packages (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_weighing_events_scale
        FOREIGN KEY (tenant_id, scale_id)
        REFERENCES tenant_shipping_scales (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_weighing_events_actor
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_source
        CHECK (source IN ('SCALE', 'MANUAL')),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_actual
        CHECK (actual_weight_grams BETWEEN 1 AND 999999999),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_expected
        CHECK (expected_weight_grams IS NULL
            OR expected_weight_grams BETWEEN 1 AND 999999999),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_tolerance
        CHECK (allowed_tolerance_grams IS NULL
            OR allowed_tolerance_grams BETWEEN 0 AND 999999999),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_difference
        CHECK (weight_difference_grams IS NULL
            OR weight_difference_grams BETWEEN -999999999 AND 999999999),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_result
        CHECK (result IN ('PASSED', 'BLOCKED', 'OVERRIDDEN')),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_identity CHECK (
        (source = 'SCALE' AND scale_id IS NOT NULL
            AND result IN ('PASSED', 'BLOCKED') AND override_reason IS NULL)
        OR (source = 'MANUAL' AND scale_id IS NULL
            AND result = 'OVERRIDDEN'
            AND override_reason = btrim(override_reason)
            AND char_length(override_reason) BETWEEN 1 AND 500)
    ),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_calculation CHECK (
        (expected_weight_grams IS NULL
            AND allowed_tolerance_grams IS NULL
            AND weight_difference_grams IS NULL
            AND result = 'OVERRIDDEN')
        OR (expected_weight_grams IS NOT NULL
            AND allowed_tolerance_grams IS NOT NULL
            AND weight_difference_grams = actual_weight_grams - expected_weight_grams)
    ),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_actor
        CHECK ((actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_tenant_fulfillment_weighing_events_request
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$')
);
CREATE INDEX idx_tenant_fulfillment_weighing_events_package
    ON tenant_fulfillment_weighing_events (
        tenant_id, package_id, recorded_at DESC, id DESC
    );
CREATE TRIGGER trg_tenant_fulfillment_weighing_events_append_only
BEFORE UPDATE OR DELETE ON tenant_fulfillment_weighing_events
FOR EACH ROW EXECUTE FUNCTION reject_inventory_ledger_mutation();
