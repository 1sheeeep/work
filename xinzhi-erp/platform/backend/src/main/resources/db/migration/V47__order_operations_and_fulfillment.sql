INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('46000000-0000-0000-0000-000000000001', 'fulfillments.read', 'orders', '查看订单履约', '查看租户内订单履约、包裹与发货事实'),
    ('46000000-0000-0000-0000-000000000002', 'fulfillments.allocate.write', 'orders', '分配订单履约', '为租户内履约行分配仓库并形成库存记账引用'),
    ('46000000-0000-0000-0000-000000000003', 'fulfillments.pick.write', 'orders', '执行拣货', '记录租户内订单拣货事实'),
    ('46000000-0000-0000-0000-000000000004', 'fulfillments.pack.write', 'orders', '执行包装验货', '记录包装验货与包裹编排事实'),
    ('46000000-0000-0000-0000-000000000005', 'fulfillments.ship.write', 'orders', '执行称重出库', '记录称重与不可变发货交接事实'),
    ('46000000-0000-0000-0000-000000000008', 'fulfillments.ship.correct.write', 'orders', '冲销发货交接', '追加受保护的发货交接冲销事实，不修改原发货事实'),
    ('46000000-0000-0000-0000-000000000006', 'fulfillments.cancel.write', 'orders', '取消订单履约', '取消未发货履约数量'),
    ('46000000-0000-0000-0000-000000000007', 'fulfillments.exception.write', 'orders', '处理履约异常', '暂停、恢复与处理租户内履约异常'),
    ('46000000-0000-0000-0000-000000000010', 'orders.transfer.read', 'orders', '查看订单导入导出', '查看租户内订单导入、导出和批处理任务'),
    ('46000000-0000-0000-0000-000000000011', 'orders.transfer.write', 'orders', '执行订单导入导出', '创建租户内订单导入、导出和批处理任务')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code IN (
    'fulfillments.read', 'fulfillments.allocate.write', 'fulfillments.pick.write',
    'fulfillments.pack.write', 'fulfillments.ship.write', 'fulfillments.ship.correct.write',
    'fulfillments.cancel.write',
    'fulfillments.exception.write', 'orders.transfer.read', 'orders.transfer.write'
)
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

ALTER TABLE tenant_order_lines
    ADD CONSTRAINT uq_tenant_order_lines_tenant_id UNIQUE (tenant_id, id);

ALTER TABLE tenant_orders
    DROP CONSTRAINT ck_tenant_orders_status,
    ADD CONSTRAINT ck_tenant_orders_status CHECK (status IN (
        'UNPAID', 'RECEIVED', 'REVIEW_PENDING', 'MERGE_PENDING',
        'HOLD', 'READY_TO_FULFILL', 'FULFILLING',
        'SHIPPED', 'DELIVERED', 'CANCELLED'
    )),
    ADD COLUMN platform_status VARCHAR(64),
    ADD COLUMN payment_status VARCHAR(24),
    ADD COLUMN logistics_channel VARCHAR(80),
    ADD COLUMN country_code VARCHAR(2),
    ADD COLUMN province VARCHAR(120),
    ADD COLUMN postal_code VARCHAR(32),
    ADD COLUMN buyer_selected_logistics VARCHAR(120),
    ADD COLUMN total_amount_minor BIGINT,
    ADD COLUMN shipping_amount_minor BIGINT,
    ADD COLUMN weight_grams NUMERIC(12,3),
    ADD COLUMN paid_at TIMESTAMPTZ,
    ADD COLUMN ship_by_at TIMESTAMPTZ,
    ADD COLUMN shipped_at TIMESTAMPTZ,
    ADD COLUMN tracking_status VARCHAR(32),
    ADD COLUMN fixed_category VARCHAR(80),
    ADD COLUMN custom_category VARCHAR(80),
    ADD COLUMN warehouse_id UUID,
    ADD COLUMN is_reshipment BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN reshipment_reason VARCHAR(160),
    ADD COLUMN platform_handover_required BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN printed BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT fk_tenant_orders_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    ADD CONSTRAINT ck_tenant_orders_country_code CHECK (
        country_code IS NULL OR country_code ~ '^[A-Z]{2}$'
    ),
    ADD CONSTRAINT ck_tenant_orders_payment_status CHECK (
        payment_status IS NULL OR payment_status IN ('UNPAID', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED')
    ),
    ADD CONSTRAINT ck_tenant_orders_amounts CHECK (
        (total_amount_minor IS NULL OR total_amount_minor >= 0)
        AND (shipping_amount_minor IS NULL OR shipping_amount_minor >= 0)
    ),
    ADD CONSTRAINT ck_tenant_orders_weight CHECK (
        weight_grams IS NULL OR (weight_grams > 0 AND weight_grams <= 999999999.999)
    ),
    ADD CONSTRAINT ck_tenant_orders_reshipment CHECK (
        (is_reshipment AND reshipment_reason IS NOT NULL)
        OR (NOT is_reshipment AND reshipment_reason IS NULL)
    );

CREATE TABLE tenant_order_profiles (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL,
    sales_record_number VARCHAR(160),
    shopping_cart_reference VARCHAR(160),
    custom_order_reference VARCHAR(160),
    customer_id VARCHAR(160),
    customer_code VARCHAR(160),
    recipient_name VARCHAR(200),
    recipient_phone VARCHAR(40),
    recipient_email VARCHAR(254),
    recipient_company VARCHAR(200),
    address_line1 VARCHAR(300),
    address_line2 VARCHAR(300),
    city VARCHAR(120),
    district VARCHAR(120),
    town VARCHAR(120),
    door_code VARCHAR(80),
    shipping_service VARCHAR(120),
    tracking_reference VARCHAR(160),
    secondary_tracking_reference VARCHAR(160),
    item_amount_minor BIGINT,
    platform_fee_minor BIGINT,
    insurance_fee_minor BIGINT,
    payment_fee_minor BIGINT,
    other_income_minor BIGINT,
    other_expense_minor BIGINT,
    actual_paid_minor BIGINT,
    profit_minor BIGINT,
    tax_minor BIGINT,
    estimated_shipping_minor BIGINT,
    actual_shipping_minor BIGINT,
    platform_message VARCHAR(1000),
    platform_remark VARCHAR(1000),
    order_remark VARCHAR(1000),
    declaration_plan VARCHAR(1000),
    declaration_actual VARCHAR(1000),
    customer_category VARCHAR(80),
    product_kind_count INTEGER,
    location_id UUID,
    picker_user_id UUID,
    shipper_user_id UUID,
    salesperson_user_id UUID,
    purchaser_user_id UUID,
    developer_user_id UUID,
    manager_user_id UUID,
    supplier_reference VARCHAR(160),
    parent_product_category VARCHAR(120),
    child_product_category VARCHAR(120),
    product_status VARCHAR(40),
    extended_attribute VARCHAR(160),
    printed_at TIMESTAMPTZ,
    platform_returned_at TIMESTAMPTZ,
    exception_reviewed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    handed_over_at TIMESTAMPTZ,
    platform_specified_handover_at TIMESTAMPTZ,
    platform_label_requested_at TIMESTAMPTZ,
    delivery_deadline_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, order_id),
    CONSTRAINT fk_tenant_order_profiles_order
        FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_tenant_order_profiles_location
        FOREIGN KEY (tenant_id, location_id)
        REFERENCES tenant_warehouse_locations (tenant_id, id),
    CONSTRAINT fk_tenant_order_profiles_picker
        FOREIGN KEY (picker_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_order_profiles_shipper
        FOREIGN KEY (shipper_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_order_profiles_salesperson
        FOREIGN KEY (salesperson_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_order_profiles_purchaser
        FOREIGN KEY (purchaser_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_order_profiles_developer
        FOREIGN KEY (developer_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_order_profiles_manager
        FOREIGN KEY (manager_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_order_profiles_amounts CHECK (
        (item_amount_minor IS NULL OR item_amount_minor >= 0)
        AND (platform_fee_minor IS NULL OR platform_fee_minor >= 0)
        AND (insurance_fee_minor IS NULL OR insurance_fee_minor >= 0)
        AND (payment_fee_minor IS NULL OR payment_fee_minor >= 0)
        AND (other_income_minor IS NULL OR other_income_minor >= 0)
        AND (other_expense_minor IS NULL OR other_expense_minor >= 0)
        AND (actual_paid_minor IS NULL OR actual_paid_minor >= 0)
        AND (estimated_shipping_minor IS NULL OR estimated_shipping_minor >= 0)
        AND (actual_shipping_minor IS NULL OR actual_shipping_minor >= 0)
    ),
    CONSTRAINT ck_tenant_order_profiles_product_kind_count CHECK (
        product_kind_count IS NULL OR product_kind_count > 0
    ),
    CONSTRAINT ck_tenant_order_profiles_version CHECK (version >= 0),
    CONSTRAINT ck_tenant_order_profiles_recipient_email CHECK (
        recipient_email IS NULL OR recipient_email = lower(recipient_email)
    )
);
CREATE INDEX idx_tenant_order_profiles_filters
    ON tenant_order_profiles (
        tenant_id, customer_category, supplier_reference,
        product_status, delivered_at, order_id
    );

CREATE TABLE tenant_order_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL,
    activity_type VARCHAR(64) NOT NULL,
    safe_summary VARCHAR(500) NOT NULL,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_order_activity_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_order_activity_order
        FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_tenant_order_activity_user
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_order_activity_actor
        CHECK ((actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_tenant_order_activity_type
        CHECK (activity_type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT ck_tenant_order_activity_request_id
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$')
);
CREATE INDEX idx_tenant_order_activity_order
    ON tenant_order_activity (tenant_id, order_id, created_at DESC, id DESC);
CREATE TRIGGER trg_tenant_order_activity_append_only
BEFORE UPDATE OR DELETE ON tenant_order_activity
FOR EACH ROW EXECUTE FUNCTION reject_inventory_ledger_mutation();

ALTER TABLE tenant_order_lines
    ADD COLUMN platform_sku VARCHAR(160),
    ADD COLUMN warehouse_id UUID,
    ADD COLUMN location_id UUID,
    ADD COLUMN purchase_reference VARCHAR(160),
    ADD CONSTRAINT fk_tenant_order_lines_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    ADD CONSTRAINT fk_tenant_order_lines_location FOREIGN KEY (tenant_id, location_id)
        REFERENCES tenant_warehouse_locations (tenant_id, id),
    ADD CONSTRAINT ck_tenant_order_lines_location_parent CHECK (
        location_id IS NULL OR warehouse_id IS NOT NULL
    );

CREATE INDEX idx_tenant_orders_operational_filters
    ON tenant_orders (tenant_id, status, payment_status, warehouse_id, placed_at DESC, id DESC);
CREATE INDEX idx_tenant_orders_country_tracking
    ON tenant_orders (tenant_id, country_code, tracking_status, placed_at DESC, id DESC);
CREATE INDEX idx_tenant_order_lines_operational_filters
    ON tenant_order_lines (tenant_id, warehouse_id, sku_id, order_id);

CREATE TABLE tenant_fulfillment_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL,
    shop_id UUID NOT NULL,
    source_order_version BIGINT NOT NULL,
    external_order_ref_snapshot VARCHAR(160) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_ALLOCATION',
    pause_state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    pause_reason_code VARCHAR(64),
    shortage_state VARCHAR(16) NOT NULL DEFAULT 'NONE',
    resume_status VARCHAR(32),
    planned_quantity INTEGER NOT NULL,
    picked_quantity INTEGER NOT NULL DEFAULT 0,
    packed_quantity INTEGER NOT NULL DEFAULT 0,
    shipped_quantity INTEGER NOT NULL DEFAULT 0,
    cancelled_quantity INTEGER NOT NULL DEFAULT 0,
    creation_idempotency_key VARCHAR(100) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_tenant_fulfillment_plans_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_fulfillment_plans_creation UNIQUE (tenant_id, creation_idempotency_key),
    CONSTRAINT fk_tenant_fulfillment_plans_order FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_plans_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_tenant_fulfillment_plans_status CHECK (status IN (
        'PENDING_ALLOCATION', 'ALLOCATED', 'PICKING', 'PACKING', 'READY_TO_SHIP',
        'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_FULFILLED', 'CANCELLED', 'EXCEPTION'
    )),
    CONSTRAINT ck_tenant_fulfillment_plans_pause CHECK (
        pause_state IN ('ACTIVE', 'PAUSED')
        AND ((pause_state = 'ACTIVE' AND pause_reason_code IS NULL)
            OR (pause_state = 'PAUSED' AND pause_reason_code IS NOT NULL))
    ),
    CONSTRAINT ck_tenant_fulfillment_plans_shortage CHECK (
        shortage_state IN ('NONE', 'PARTIAL', 'FULL', 'UNKNOWN')
    ),
    CONSTRAINT ck_tenant_fulfillment_plans_resume CHECK (
        (status = 'EXCEPTION' AND resume_status IS NOT NULL)
        OR (status <> 'EXCEPTION' AND resume_status IS NULL)
    ),
    CONSTRAINT ck_tenant_fulfillment_plans_quantities CHECK (
        planned_quantity > 0
        AND picked_quantity BETWEEN 0 AND planned_quantity
        AND packed_quantity BETWEEN 0 AND planned_quantity
        AND shipped_quantity BETWEEN 0 AND planned_quantity
        AND cancelled_quantity BETWEEN 0 AND planned_quantity
        AND shipped_quantity + cancelled_quantity <= planned_quantity
    ),
    CONSTRAINT ck_tenant_fulfillment_plans_version CHECK (version >= 0),
    CONSTRAINT ck_tenant_fulfillment_plans_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX uq_tenant_fulfillment_plans_open_order
    ON tenant_fulfillment_plans (tenant_id, order_id)
    WHERE status NOT IN ('SHIPPED', 'PARTIALLY_FULFILLED', 'CANCELLED');
CREATE INDEX idx_tenant_fulfillment_plans_list
    ON tenant_fulfillment_plans (tenant_id, updated_at DESC, id DESC);
CREATE INDEX idx_tenant_fulfillment_plans_status
    ON tenant_fulfillment_plans (tenant_id, status, updated_at DESC, id DESC);

CREATE TABLE tenant_fulfillment_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    plan_id UUID NOT NULL,
    order_line_id UUID NOT NULL,
    split_sequence SMALLINT NOT NULL,
    sku_id UUID NOT NULL,
    warehouse_id UUID,
    location_id UUID,
    planned_quantity INTEGER NOT NULL,
    picked_quantity INTEGER NOT NULL DEFAULT 0,
    packed_quantity INTEGER NOT NULL DEFAULT 0,
    shipped_quantity INTEGER NOT NULL DEFAULT 0,
    cancelled_quantity INTEGER NOT NULL DEFAULT 0,
    external_line_ref_snapshot VARCHAR(160) NOT NULL,
    sku_business_code_snapshot VARCHAR(120) NOT NULL,
    sku_name_snapshot VARCHAR(200) NOT NULL,
    inventory_operation_ref VARCHAR(160),
    exception_code VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_fulfillment_lines_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_fulfillment_lines_split
        UNIQUE (tenant_id, plan_id, order_line_id, split_sequence),
    CONSTRAINT fk_tenant_fulfillment_lines_plan FOREIGN KEY (tenant_id, plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_lines_order_line FOREIGN KEY (tenant_id, order_line_id)
        REFERENCES tenant_order_lines (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_lines_sku FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_lines_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_lines_location FOREIGN KEY (tenant_id, location_id)
        REFERENCES tenant_warehouse_locations (tenant_id, id),
    CONSTRAINT ck_tenant_fulfillment_lines_location CHECK (
        location_id IS NULL OR warehouse_id IS NOT NULL
    ),
    CONSTRAINT ck_tenant_fulfillment_lines_quantities CHECK (
        planned_quantity > 0
        AND picked_quantity BETWEEN 0 AND planned_quantity
        AND packed_quantity BETWEEN 0 AND planned_quantity
        AND shipped_quantity BETWEEN 0 AND planned_quantity
        AND cancelled_quantity BETWEEN 0 AND planned_quantity
        AND shipped_quantity + cancelled_quantity <= planned_quantity
    ),
    CONSTRAINT ck_tenant_fulfillment_lines_split_sequence CHECK (split_sequence >= 0),
    CONSTRAINT ck_tenant_fulfillment_lines_inventory_ref CHECK (
        inventory_operation_ref IS NULL OR inventory_operation_ref = btrim(inventory_operation_ref)
    )
);
CREATE INDEX idx_tenant_fulfillment_lines_plan
    ON tenant_fulfillment_lines (tenant_id, plan_id, order_line_id, split_sequence);
CREATE INDEX idx_tenant_fulfillment_lines_warehouse
    ON tenant_fulfillment_lines (tenant_id, warehouse_id, plan_id);

CREATE TABLE tenant_inventory_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    fulfillment_plan_id UUID NOT NULL,
    fulfillment_line_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    location_id UUID,
    quantity INTEGER NOT NULL,
    consumed_quantity INTEGER NOT NULL DEFAULT 0,
    released_quantity INTEGER NOT NULL DEFAULT 0,
    command_id UUID NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    operation_reference VARCHAR(160) NOT NULL,
    available_after BIGINT NOT NULL,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_inventory_reservations_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_inventory_reservations_line
        UNIQUE (tenant_id, fulfillment_line_id),
    CONSTRAINT uq_tenant_inventory_reservations_reference
        UNIQUE (tenant_id, operation_reference),
    CONSTRAINT fk_tenant_inventory_reservations_plan
        FOREIGN KEY (tenant_id, fulfillment_plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_tenant_inventory_reservations_line
        FOREIGN KEY (tenant_id, fulfillment_line_id)
        REFERENCES tenant_fulfillment_lines (tenant_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_tenant_inventory_reservations_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_tenant_inventory_reservations_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_tenant_inventory_reservations_location
        FOREIGN KEY (tenant_id, location_id)
        REFERENCES tenant_warehouse_locations (tenant_id, id),
    CONSTRAINT fk_tenant_inventory_reservations_actor_user
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_inventory_reservations_quantity CHECK (quantity > 0),
    CONSTRAINT ck_tenant_inventory_reservations_lifecycle CHECK (
        consumed_quantity >= 0
        AND released_quantity >= 0
        AND consumed_quantity + released_quantity <= quantity
    ),
    CONSTRAINT ck_tenant_inventory_reservations_version CHECK (version >= 0),
    CONSTRAINT ck_tenant_inventory_reservations_fingerprint
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_tenant_inventory_reservations_actor
        CHECK ((actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_tenant_inventory_reservations_request_id
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$')
);
CREATE INDEX idx_tenant_inventory_reservations_balance
    ON tenant_inventory_reservations (tenant_id, warehouse_id, sku_id);

CREATE TABLE tenant_inventory_reservation_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    reservation_id UUID NOT NULL,
    fulfillment_plan_id UUID NOT NULL,
    fulfillment_line_id UUID NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    quantity INTEGER NOT NULL,
    command_id UUID NOT NULL,
    shipment_event_id UUID,
    inventory_event_id UUID,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_reservation_events_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_reservation_events_command
        UNIQUE (tenant_id, command_id, reservation_id, event_type),
    CONSTRAINT fk_inventory_reservation_events_reservation
        FOREIGN KEY (tenant_id, reservation_id)
        REFERENCES tenant_inventory_reservations (tenant_id, id),
    CONSTRAINT fk_inventory_reservation_events_plan
        FOREIGN KEY (tenant_id, fulfillment_plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_inventory_reservation_events_line
        FOREIGN KEY (tenant_id, fulfillment_line_id)
        REFERENCES tenant_fulfillment_lines (tenant_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT fk_inventory_reservation_events_inventory
        FOREIGN KEY (tenant_id, inventory_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT ck_inventory_reservation_events_type CHECK (
        event_type IN ('RESERVED', 'CONSUMED', 'RELEASED', 'CONSUMPTION_REVERSED')
    ),
    CONSTRAINT ck_inventory_reservation_events_quantity CHECK (quantity > 0),
    CONSTRAINT ck_inventory_reservation_events_actor
        CHECK ((actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_inventory_reservation_events_request_id
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$')
);
CREATE INDEX idx_inventory_reservation_events_reservation
    ON tenant_inventory_reservation_events (tenant_id, reservation_id, recorded_at, id);
CREATE TRIGGER trg_inventory_reservation_events_append_only
BEFORE UPDATE OR DELETE ON tenant_inventory_reservation_events
FOR EACH ROW EXECUTE FUNCTION reject_inventory_ledger_mutation();

ALTER TABLE inventory_ledger_events
    DROP CONSTRAINT ck_inventory_events_type,
    ADD CONSTRAINT ck_inventory_events_type CHECK (
        event_type IN (
            'OPENING_BALANCE', 'CORRECTION', 'REVERSAL',
            'FULFILLMENT_SHIPMENT'
        )
    );

CREATE TABLE tenant_fulfillment_packages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    plan_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    package_number VARCHAR(80) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    weight_grams NUMERIC(12,3),
    version BIGINT NOT NULL DEFAULT 0,
    sealed_at TIMESTAMPTZ,
    handed_over_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_fulfillment_packages_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_fulfillment_packages_number UNIQUE (tenant_id, plan_id, package_number),
    CONSTRAINT fk_tenant_fulfillment_packages_plan FOREIGN KEY (tenant_id, plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_packages_warehouse FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT ck_tenant_fulfillment_packages_status CHECK (
        status IN ('DRAFT', 'SEALED', 'HANDED_OVER', 'HANDOVER_CORRECTED', 'VOIDED')
    ),
    CONSTRAINT ck_tenant_fulfillment_packages_weight CHECK (
        weight_grams IS NULL OR (weight_grams > 0 AND weight_grams <= 999999999.999)
    ),
    CONSTRAINT ck_tenant_fulfillment_packages_version CHECK (version >= 0)
);
CREATE INDEX idx_tenant_fulfillment_packages_plan
    ON tenant_fulfillment_packages (tenant_id, plan_id, created_at, id);

CREATE TABLE tenant_fulfillment_package_items (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    package_id UUID NOT NULL,
    fulfillment_line_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, package_id, fulfillment_line_id),
    CONSTRAINT fk_tenant_fulfillment_package_items_package FOREIGN KEY (tenant_id, package_id)
        REFERENCES tenant_fulfillment_packages (tenant_id, id),
    CONSTRAINT fk_tenant_fulfillment_package_items_line FOREIGN KEY (tenant_id, fulfillment_line_id)
        REFERENCES tenant_fulfillment_lines (tenant_id, id),
    CONSTRAINT ck_tenant_fulfillment_package_items_quantity CHECK (quantity > 0)
);

CREATE TABLE tenant_shipment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    plan_id UUID NOT NULL,
    package_id UUID NOT NULL,
    event_type VARCHAR(48) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    source_system VARCHAR(40) NOT NULL,
    external_event_ref VARCHAR(160) NOT NULL,
    actor_user_id UUID,
    request_id VARCHAR(100),
    reverses_event_id UUID,
    carrier_code VARCHAR(40),
    service_code VARCHAR(60),
    tracking_reference VARCHAR(160),
    correction_reason_code VARCHAR(64),
    CONSTRAINT uq_tenant_shipment_events_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_shipment_events_external UNIQUE (tenant_id, source_system, external_event_ref),
    CONSTRAINT fk_tenant_shipment_events_plan FOREIGN KEY (tenant_id, plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_tenant_shipment_events_package FOREIGN KEY (tenant_id, package_id)
        REFERENCES tenant_fulfillment_packages (tenant_id, id),
    CONSTRAINT fk_tenant_shipment_events_reversal FOREIGN KEY (tenant_id, reverses_event_id)
        REFERENCES tenant_shipment_events (tenant_id, id),
    CONSTRAINT ck_tenant_shipment_events_type CHECK (
        event_type IN ('HANDOVER_CONFIRMED', 'HANDOVER_CORRECTION_RECORDED')
    ),
    CONSTRAINT ck_tenant_shipment_events_correction_reason CHECK (
        (event_type = 'HANDOVER_CONFIRMED' AND correction_reason_code IS NULL)
        OR (
            event_type = 'HANDOVER_CORRECTION_RECORDED'
            AND correction_reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
        )
    )
);
CREATE UNIQUE INDEX uq_tenant_shipment_events_handover
    ON tenant_shipment_events (tenant_id, package_id)
    WHERE event_type = 'HANDOVER_CONFIRMED';
CREATE UNIQUE INDEX uq_tenant_shipment_events_correction
    ON tenant_shipment_events (tenant_id, reverses_event_id)
    WHERE event_type = 'HANDOVER_CORRECTION_RECORDED';

ALTER TABLE tenant_inventory_reservation_events
    ADD CONSTRAINT fk_inventory_reservation_events_shipment
    FOREIGN KEY (tenant_id, shipment_event_id)
    REFERENCES tenant_shipment_events (tenant_id, id);

CREATE TABLE tenant_shipment_inventory_events (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shipment_event_id UUID NOT NULL,
    fulfillment_line_id UUID NOT NULL,
    inventory_event_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (tenant_id, shipment_event_id, fulfillment_line_id),
    CONSTRAINT fk_shipment_inventory_events_shipment
        FOREIGN KEY (tenant_id, shipment_event_id)
        REFERENCES tenant_shipment_events (tenant_id, id),
    CONSTRAINT fk_shipment_inventory_events_line
        FOREIGN KEY (tenant_id, fulfillment_line_id)
        REFERENCES tenant_fulfillment_lines (tenant_id, id),
    CONSTRAINT fk_shipment_inventory_events_inventory
        FOREIGN KEY (tenant_id, inventory_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT ck_shipment_inventory_events_quantity CHECK (quantity <> 0)
);

CREATE VIEW tenant_order_warehouse_facts AS
SELECT o.tenant_id, o.id AS order_id, o.warehouse_id
FROM tenant_orders o
WHERE o.warehouse_id IS NOT NULL
UNION
SELECT l.tenant_id, l.order_id, l.warehouse_id
FROM tenant_order_lines l
WHERE l.warehouse_id IS NOT NULL
UNION
SELECT p.tenant_id, p.order_id, l.warehouse_id
FROM tenant_fulfillment_plans p
JOIN tenant_fulfillment_lines l
  ON l.tenant_id = p.tenant_id AND l.plan_id = p.id
WHERE l.warehouse_id IS NOT NULL
UNION
SELECT p.tenant_id, p.order_id, pkg.warehouse_id
FROM tenant_fulfillment_plans p
JOIN tenant_fulfillment_packages pkg
  ON pkg.tenant_id = p.tenant_id AND pkg.plan_id = p.id;

CREATE VIEW tenant_fulfillment_warehouse_facts AS
SELECT p.tenant_id, p.id AS plan_id, f.warehouse_id
FROM tenant_fulfillment_plans p
JOIN tenant_order_warehouse_facts f
  ON f.tenant_id = p.tenant_id AND f.order_id = p.order_id
UNION
SELECT l.tenant_id, l.plan_id, l.warehouse_id
FROM tenant_fulfillment_lines l
WHERE l.warehouse_id IS NOT NULL
UNION
SELECT p.tenant_id, p.plan_id, p.warehouse_id
FROM tenant_fulfillment_packages p;

CREATE TABLE tenant_fulfillment_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    command_id UUID NOT NULL,
    resource_type VARCHAR(40) NOT NULL,
    resource_id UUID NOT NULL,
    command_type VARCHAR(64) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    response_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT ck_tenant_fulfillment_commands_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE TABLE tenant_order_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    event_type VARCHAR(80) NOT NULL,
    aggregate_type VARCHAR(40) NOT NULL,
    aggregate_id UUID NOT NULL,
    shop_id UUID NOT NULL,
    order_id UUID NOT NULL,
    package_id UUID,
    payload JSONB NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ,
    CONSTRAINT fk_tenant_order_outbox_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_tenant_order_outbox_order FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT ck_tenant_order_outbox_status CHECK (status IN ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED')),
    CONSTRAINT ck_tenant_order_outbox_attempts CHECK (attempt_count >= 0),
    CONSTRAINT ck_tenant_order_outbox_payload CHECK (jsonb_typeof(payload) = 'object')
);
CREATE INDEX idx_tenant_order_outbox_pending
    ON tenant_order_outbox (status, available_at, id)
    WHERE status IN ('PENDING', 'FAILED');

CREATE TABLE tenant_order_transfer_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    job_type VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    filter_spec JSONB NOT NULL DEFAULT '{}'::jsonb,
    requested_count INTEGER NOT NULL DEFAULT 0,
    succeeded_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    safe_error_summary VARCHAR(500),
    object_reference VARCHAR(200),
    command_id UUID,
    request_fingerprint CHAR(64),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_tenant_order_transfer_jobs_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_tenant_order_transfer_jobs_type CHECK (
        job_type IN ('IMPORT', 'EXPORT', 'BULK_STATUS', 'BULK_EXCEPTION_RETRY')
    ),
    CONSTRAINT ck_tenant_order_transfer_jobs_status CHECK (
        status IN ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED')
    ),
    CONSTRAINT ck_tenant_order_transfer_jobs_counts CHECK (
        requested_count >= 0 AND succeeded_count >= 0 AND failed_count >= 0
        AND succeeded_count + failed_count <= requested_count
    ),
    CONSTRAINT ck_tenant_order_transfer_jobs_command CHECK (
        (command_id IS NULL AND request_fingerprint IS NULL)
        OR (command_id IS NOT NULL
            AND request_fingerprint ~ '^[0-9a-f]{64}$')
    ),
    CONSTRAINT ck_tenant_order_transfer_jobs_filter CHECK (jsonb_typeof(filter_spec) = 'object'),
    CONSTRAINT ck_tenant_order_transfer_jobs_version CHECK (version >= 0)
);
CREATE INDEX idx_tenant_order_transfer_jobs_list
    ON tenant_order_transfer_jobs (tenant_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX uq_tenant_order_transfer_jobs_command
    ON tenant_order_transfer_jobs (tenant_id, command_id)
    WHERE command_id IS NOT NULL;
