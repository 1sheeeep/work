-- V82: tenant-scoped purchase returns backed by the inventory ledger.
-- A return may only use quantity that was previously received and not yet
-- returned. Every accepted return posts a negative inventory event.

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
            'PURCHASE_ORDER_RECEIPT',
            'PURCHASE_ORDER_RETURN'
        )
    );

ALTER TABLE procurement_purchase_orders
    ADD COLUMN returned_quantity BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN last_returned_at TIMESTAMPTZ,
    ADD CONSTRAINT ck_procurement_purchase_orders_return_quantity CHECK (
        returned_quantity BETWEEN 0 AND received_quantity
    ),
    ADD CONSTRAINT ck_procurement_purchase_orders_return_state CHECK (
        (returned_quantity = 0 AND last_returned_at IS NULL)
        OR (returned_quantity > 0 AND last_returned_at IS NOT NULL)
    );

CREATE TABLE procurement_purchase_returns (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    return_no VARCHAR(40) NOT NULL,
    purchase_order_id UUID NOT NULL,
    quantity BIGINT NOT NULL,
    reason VARCHAR(500) NOT NULL,
    inventory_event_id UUID NOT NULL,
    returned_by_display_name VARCHAR(160) NOT NULL,
    returned_by_user_id UUID,
    returned_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    returned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_procurement_purchase_returns_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_procurement_purchase_returns_tenant_no
        UNIQUE (tenant_id, return_no),
    CONSTRAINT uq_procurement_purchase_returns_inventory_event
        UNIQUE (tenant_id, inventory_event_id),
    CONSTRAINT fk_procurement_purchase_returns_order
        FOREIGN KEY (tenant_id, purchase_order_id)
        REFERENCES procurement_purchase_orders (tenant_id, id),
    CONSTRAINT fk_procurement_purchase_returns_inventory_event
        FOREIGN KEY (tenant_id, inventory_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT fk_procurement_purchase_returns_user
        FOREIGN KEY (returned_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_procurement_purchase_returns_admin
        FOREIGN KEY (returned_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_procurement_purchase_returns_no CHECK (
        return_no ~ '^PR-[0-9]{8}-[0-9A-F]{28}$'
    ),
    CONSTRAINT ck_procurement_purchase_returns_quantity CHECK (quantity > 0),
    CONSTRAINT ck_procurement_purchase_returns_reason CHECK (
        char_length(btrim(reason)) BETWEEN 1 AND 500
        AND reason !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_procurement_purchase_returns_actor CHECK (
        (returned_by_user_id IS NULL) <>
        (returned_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_procurement_purchase_returns_display_name CHECK (
        char_length(btrim(returned_by_display_name)) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_procurement_purchase_returns_request_id CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    )
);

CREATE INDEX idx_procurement_purchase_returns_time
    ON procurement_purchase_returns (
        tenant_id, returned_at DESC, id DESC
    );

CREATE INDEX idx_procurement_purchase_returns_order_time
    ON procurement_purchase_returns (
        tenant_id, purchase_order_id, returned_at DESC, id DESC
    );

CREATE TABLE procurement_purchase_return_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    purchase_return_id UUID NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_procurement_purchase_return_commands_return
        FOREIGN KEY (tenant_id, purchase_return_id)
        REFERENCES procurement_purchase_returns (tenant_id, id),
    CONSTRAINT ck_procurement_purchase_return_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    )
);

UPDATE permissions
SET name = 'Read procurement plans, orders, receipts and returns',
    description = 'Read tenant-scoped procurement documents and stock movements'
WHERE code = 'procurement.read';

UPDATE permissions
SET name = 'Write procurement plans, orders, receipts and returns',
    description = 'Create and review purchase orders and post bounded receipts and returns'
WHERE code = 'procurement.write';
