-- V58: tenant-safe warehouse transfer workflow and inventory postings.

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
            'WAREHOUSE_TRANSFER_RECEIPT'
        )
    );

ALTER TABLE inventory_balances
    ADD CONSTRAINT uq_inventory_balances_tenant_dimensions
    UNIQUE (tenant_id, id, sku_id, warehouse_id);

CREATE TABLE inventory_warehouse_transfers (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    transfer_no VARCHAR(40) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    transfer_date DATE NOT NULL,
    source_warehouse_id UUID NOT NULL,
    target_warehouse_id UUID NOT NULL,
    transport_mode VARCHAR(16) NOT NULL DEFAULT 'UNSET',
    freight_amount_minor BIGINT,
    currency_code CHAR(3),
    logistics_channel VARCHAR(160),
    tracking_no VARCHAR(160),
    allocation_method VARCHAR(24) NOT NULL DEFAULT 'WEIGHT',
    expected_ship_at TIMESTAMPTZ,
    expected_arrival_at TIMESTAMPTZ,
    note VARCHAR(500),
    operator_display_name VARCHAR(160) NOT NULL,
    approver_display_name VARCHAR(160),
    shipper_display_name VARCHAR(160),
    receiver_display_name VARCHAR(160),
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    approved_by_user_id UUID,
    approved_by_system_admin_id UUID,
    shipped_by_user_id UUID,
    shipped_by_system_admin_id UUID,
    received_by_user_id UUID,
    received_by_system_admin_id UUID,
    submitted_at TIMESTAMPTZ,
    approved_at TIMESTAMPTZ,
    shipped_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    rejected_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_transfers_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_transfers_tenant_no UNIQUE (tenant_id, transfer_no),
    CONSTRAINT fk_inventory_transfers_source_warehouse
        FOREIGN KEY (tenant_id, source_warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_transfers_target_warehouse
        FOREIGN KEY (tenant_id, target_warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_transfers_creator_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_inventory_transfers_approver_user
        FOREIGN KEY (approved_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_inventory_transfers_shipper_user
        FOREIGN KEY (shipped_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_inventory_transfers_receiver_user
        FOREIGN KEY (received_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_inventory_transfers_creator_admin
        FOREIGN KEY (created_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT fk_inventory_transfers_approver_admin
        FOREIGN KEY (approved_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT fk_inventory_transfers_shipper_admin
        FOREIGN KEY (shipped_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT fk_inventory_transfers_receiver_admin
        FOREIGN KEY (received_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_inventory_transfers_status CHECK (
        status IN (
            'DRAFT', 'APPROVAL', 'READY_TO_SHIP', 'IN_TRANSIT',
            'RECEIVED', 'REJECTED', 'CANCELLED'
        )
    ),
    CONSTRAINT ck_inventory_transfers_transport CHECK (
        transport_mode IN ('UNSET', 'LAND', 'AIR', 'SEA')
    ),
    CONSTRAINT ck_inventory_transfers_allocation CHECK (
        allocation_method IN ('WEIGHT', 'VOLUMETRIC_WEIGHT', 'VOLUME')
    ),
    CONSTRAINT ck_inventory_transfers_warehouses CHECK (
        source_warehouse_id <> target_warehouse_id
    ),
    CONSTRAINT ck_inventory_transfers_freight CHECK (
        (freight_amount_minor IS NULL AND currency_code IS NULL)
        OR (
            freight_amount_minor >= 0
            AND currency_code ~ '^[A-Z]{3}$'
        )
    ),
    CONSTRAINT ck_inventory_transfers_dates CHECK (
        expected_ship_at IS NULL OR expected_arrival_at IS NULL
        OR expected_arrival_at >= expected_ship_at
    ),
    CONSTRAINT ck_inventory_transfers_creator CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_inventory_transfers_approver CHECK (
        approved_by_user_id IS NULL OR approved_by_system_admin_id IS NULL
    ),
    CONSTRAINT ck_inventory_transfers_shipper CHECK (
        shipped_by_user_id IS NULL OR shipped_by_system_admin_id IS NULL
    ),
    CONSTRAINT ck_inventory_transfers_receiver CHECK (
        received_by_user_id IS NULL OR received_by_system_admin_id IS NULL
    ),
    CONSTRAINT ck_inventory_transfers_version CHECK (version >= 0)
);

CREATE INDEX idx_inventory_transfers_tenant_status_date
    ON inventory_warehouse_transfers (
        tenant_id, status, transfer_date DESC, created_at DESC, id
    );

CREATE INDEX idx_inventory_transfers_tenant_source_date
    ON inventory_warehouse_transfers (
        tenant_id, source_warehouse_id, transfer_date DESC, id
    );

CREATE INDEX idx_inventory_transfers_tenant_target_date
    ON inventory_warehouse_transfers (
        tenant_id, target_warehouse_id, transfer_date DESC, id
    );

CREATE TABLE inventory_warehouse_transfer_lines (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    transfer_id UUID NOT NULL,
    source_balance_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    source_warehouse_id UUID NOT NULL,
    target_warehouse_id UUID NOT NULL,
    snapshot_balance_version BIGINT NOT NULL,
    snapshot_on_hand BIGINT NOT NULL,
    snapshot_reserved BIGINT NOT NULL,
    quantity BIGINT NOT NULL,
    shipment_event_id UUID,
    receipt_event_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_transfer_lines_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_transfer_lines_sku UNIQUE (
        tenant_id, transfer_id, sku_id
    ),
    CONSTRAINT uq_inventory_transfer_lines_shipment UNIQUE (shipment_event_id),
    CONSTRAINT uq_inventory_transfer_lines_receipt UNIQUE (receipt_event_id),
    CONSTRAINT fk_inventory_transfer_lines_transfer
        FOREIGN KEY (tenant_id, transfer_id)
        REFERENCES inventory_warehouse_transfers (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_inventory_transfer_lines_balance
        FOREIGN KEY (
            tenant_id, source_balance_id, sku_id, source_warehouse_id
        ) REFERENCES inventory_balances (
            tenant_id, id, sku_id, warehouse_id
        ),
    CONSTRAINT fk_inventory_transfer_lines_target
        FOREIGN KEY (tenant_id, target_warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_transfer_lines_shipment_event
        FOREIGN KEY (tenant_id, shipment_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT fk_inventory_transfer_lines_receipt_event
        FOREIGN KEY (tenant_id, receipt_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT ck_inventory_transfer_lines_version CHECK (
        snapshot_balance_version >= 0
    ),
    CONSTRAINT ck_inventory_transfer_lines_quantity CHECK (quantity > 0),
    CONSTRAINT ck_inventory_transfer_lines_warehouses CHECK (
        source_warehouse_id <> target_warehouse_id
    ),
    CONSTRAINT ck_inventory_transfer_lines_events CHECK (
        receipt_event_id IS NULL OR shipment_event_id IS NOT NULL
    )
);

CREATE INDEX idx_inventory_transfer_lines_transfer
    ON inventory_warehouse_transfer_lines (tenant_id, transfer_id, id);

CREATE TABLE inventory_warehouse_transfer_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    transfer_id UUID NOT NULL,
    operation VARCHAR(24) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    result_status VARCHAR(24) NOT NULL,
    result_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_inventory_transfer_commands_transfer
        FOREIGN KEY (tenant_id, transfer_id)
        REFERENCES inventory_warehouse_transfers (tenant_id, id),
    CONSTRAINT ck_inventory_transfer_commands_operation CHECK (
        operation IN (
            'CREATE', 'SUBMIT', 'APPROVE', 'REJECT',
            'SHIP', 'RECEIVE', 'CANCEL'
        )
    ),
    CONSTRAINT ck_inventory_transfer_commands_status CHECK (
        result_status IN (
            'DRAFT', 'APPROVAL', 'READY_TO_SHIP', 'IN_TRANSIT',
            'RECEIVED', 'REJECTED', 'CANCELLED'
        )
    ),
    CONSTRAINT ck_inventory_transfer_commands_version CHECK (
        result_version >= 0
    )
);
