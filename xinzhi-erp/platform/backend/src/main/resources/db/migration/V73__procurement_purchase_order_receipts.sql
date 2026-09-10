-- V73: minimal procurement receipt loop. One purchase order contains one SKU,
-- may be received in bounded partial quantities, and posts each receipt to the
-- existing tenant + SKU + warehouse inventory ledger. Approval, QC, costs,
-- payment, returns, lots and supplier settlement remain outside this slice.

ALTER TABLE inventory_ledger_events
    DROP CONSTRAINT ck_inventory_events_type;

ALTER TABLE inventory_ledger_events
    ADD CONSTRAINT ck_inventory_events_type CHECK (
        event_type IN (
            'OPENING_BALANCE',
            'CORRECTION',
            'REVERSAL',
            'FULFILLMENT_SHIPMENT',
            'DOCUMENT_POST',
            'WAREHOUSE_TRANSFER_SHIPMENT',
            'WAREHOUSE_TRANSFER_RECEIPT',
            'PURCHASE_ORDER_RECEIPT'
        )
    );

ALTER TABLE procurement_purchase_orders
    DROP CONSTRAINT ck_procurement_purchase_orders_status,
    DROP CONSTRAINT ck_procurement_purchase_orders_version,
    ADD COLUMN received_quantity BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN last_received_at TIMESTAMPTZ;

ALTER TABLE procurement_purchase_orders
    ADD CONSTRAINT ck_procurement_purchase_orders_status CHECK (
        status IN ('NEW_ORDER', 'PARTIALLY_RECEIVED', 'RECEIVED')
    ),
    ADD CONSTRAINT ck_procurement_purchase_orders_version CHECK (version >= 0),
    ADD CONSTRAINT ck_procurement_purchase_orders_receipt_quantity CHECK (
        received_quantity BETWEEN 0 AND quantity
    ),
    ADD CONSTRAINT ck_procurement_purchase_orders_receipt_state CHECK (
        (
            status = 'NEW_ORDER'
            AND received_quantity = 0
            AND last_received_at IS NULL
        )
        OR (
            status = 'PARTIALLY_RECEIVED'
            AND received_quantity > 0
            AND received_quantity < quantity
            AND last_received_at IS NOT NULL
        )
        OR (
            status = 'RECEIVED'
            AND received_quantity = quantity
            AND last_received_at IS NOT NULL
        )
    );

CREATE TABLE procurement_purchase_order_receipts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    purchase_order_id UUID NOT NULL,
    quantity BIGINT NOT NULL,
    inventory_event_id UUID NOT NULL,
    received_by_display_name VARCHAR(160) NOT NULL,
    received_by_user_id UUID,
    received_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_procurement_receipts_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_procurement_receipts_inventory_event UNIQUE (
        tenant_id, inventory_event_id
    ),
    CONSTRAINT fk_procurement_receipts_order
        FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES procurement_purchase_orders (tenant_id, id),
    CONSTRAINT fk_procurement_receipts_inventory_event
        FOREIGN KEY (tenant_id, inventory_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT fk_procurement_receipts_user
        FOREIGN KEY (received_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_procurement_receipts_admin
        FOREIGN KEY (received_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_procurement_receipts_quantity CHECK (quantity > 0),
    CONSTRAINT ck_procurement_receipts_actor CHECK (
        (received_by_user_id IS NULL) <> (received_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_procurement_receipts_display_name CHECK (
        char_length(btrim(received_by_display_name)) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_procurement_receipts_request_id CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    )
);

CREATE INDEX idx_procurement_receipts_order_time
    ON procurement_purchase_order_receipts (
        tenant_id, purchase_order_id, received_at DESC, id DESC
    );

CREATE TABLE procurement_purchase_order_receipt_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    purchase_order_id UUID NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    result_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_procurement_receipt_commands_order
        FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES procurement_purchase_orders (tenant_id, id),
    CONSTRAINT ck_procurement_receipt_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_procurement_receipt_commands_version CHECK (
        result_version > 0
    )
);

UPDATE permissions
SET name = 'Read procurement plans, purchase orders and receipts',
    description = 'Read tenant-scoped procurement plans, purchase orders and receipt progress'
WHERE code = 'procurement.read';

UPDATE permissions
SET name = 'Write procurement plans, purchase orders and receipts',
    description = 'Create procurement plans and orders, void plans and post bounded purchase receipts'
WHERE code = 'procurement.write';
