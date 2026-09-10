-- Minimal purchase-order slice: convert one unpurchased plan into one new order
-- using an existing active supplier-to-SKU relationship. No payment, receiving,
-- finance, approval, recommendation, or third-party authorization is added.

ALTER TABLE procurement_plans
    DROP CONSTRAINT ck_procurement_plans_status,
    DROP CONSTRAINT ck_procurement_plans_void_state;

ALTER TABLE procurement_plans
    ADD CONSTRAINT ck_procurement_plans_status
        CHECK (status IN ('UNPURCHASED', 'ORDERED', 'VOIDED')),
    ADD CONSTRAINT ck_procurement_plans_void_state CHECK (
        (
            status IN ('UNPURCHASED', 'ORDERED')
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
    );

CREATE TABLE procurement_purchase_orders (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    purchase_no VARCHAR(40) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'NEW_ORDER',
    plan_id UUID NOT NULL,
    plan_no_snapshot VARCHAR(40) NOT NULL,
    supplier_id UUID NOT NULL,
    supplier_code_snapshot VARCHAR(64) NOT NULL,
    supplier_name_snapshot VARCHAR(200) NOT NULL,
    supplier_sku_code_snapshot VARCHAR(120),
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
    order_note VARCHAR(500),
    ordered_by_display_name VARCHAR(160) NOT NULL,
    ordered_by_user_id UUID,
    ordered_by_system_admin_id UUID,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_procurement_purchase_orders_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_procurement_purchase_orders_tenant_no UNIQUE (tenant_id, purchase_no),
    CONSTRAINT uq_procurement_purchase_orders_plan UNIQUE (tenant_id, plan_id),
    CONSTRAINT fk_procurement_purchase_orders_plan
        FOREIGN KEY (tenant_id, plan_id)
        REFERENCES procurement_plans (tenant_id, id),
    CONSTRAINT fk_procurement_purchase_orders_supplier
        FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES tenant_suppliers (tenant_id, id),
    CONSTRAINT fk_procurement_purchase_orders_supplier_sku
        FOREIGN KEY (tenant_id, supplier_id, sku_id)
        REFERENCES tenant_supplier_sku_mappings (tenant_id, supplier_id, sku_id),
    CONSTRAINT fk_procurement_purchase_orders_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_procurement_purchase_orders_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_procurement_purchase_orders_location
        FOREIGN KEY (tenant_id, warehouse_id, location_id)
        REFERENCES tenant_warehouse_locations (tenant_id, warehouse_id, id),
    CONSTRAINT fk_procurement_purchase_orders_user
        FOREIGN KEY (ordered_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_procurement_purchase_orders_admin
        FOREIGN KEY (ordered_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_procurement_purchase_orders_status CHECK (status = 'NEW_ORDER'),
    CONSTRAINT ck_procurement_purchase_orders_quantity
        CHECK (quantity BETWEEN 1 AND 1000000000),
    CONSTRAINT ck_procurement_purchase_orders_version CHECK (version = 0),
    CONSTRAINT ck_procurement_purchase_orders_no
        CHECK (purchase_no ~ '^PO-[0-9]{8}-[0-9A-F]{28}$'),
    CONSTRAINT ck_procurement_purchase_orders_snapshots CHECK (
        char_length(btrim(plan_no_snapshot)) BETWEEN 1 AND 40
        AND char_length(btrim(supplier_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(supplier_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(sku_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(sku_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(location_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(location_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(ordered_by_display_name)) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_procurement_purchase_orders_actor CHECK (
        (ordered_by_user_id IS NULL) <> (ordered_by_system_admin_id IS NULL)
    )
);

CREATE TABLE procurement_purchase_order_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    purchase_order_id UUID NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_procurement_purchase_order_commands_order
        FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES procurement_purchase_orders (tenant_id, id),
    CONSTRAINT ck_procurement_purchase_order_commands_fingerprint
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE INDEX idx_procurement_purchase_orders_created
    ON procurement_purchase_orders (tenant_id, created_at DESC, id DESC);
CREATE INDEX idx_procurement_purchase_orders_warehouse_created
    ON procurement_purchase_orders (tenant_id, warehouse_id, created_at DESC, id DESC);
CREATE INDEX idx_procurement_purchase_orders_supplier_created
    ON procurement_purchase_orders (tenant_id, supplier_id, created_at DESC, id DESC);

UPDATE permissions
SET name = 'Read procurement plans and purchase orders',
    description = 'Read tenant-scoped procurement plans and minimal purchase orders'
WHERE code = 'procurement.read';

UPDATE permissions
SET name = 'Write procurement plans and purchase orders',
    description = 'Create and void procurement plans and create minimal purchase orders'
WHERE code = 'procurement.write';
