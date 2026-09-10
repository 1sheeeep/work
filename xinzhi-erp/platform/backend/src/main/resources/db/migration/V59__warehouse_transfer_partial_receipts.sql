-- V59: partial warehouse-transfer receipt progress and immutable receipt rows.

ALTER TABLE inventory_warehouse_transfers
    DROP CONSTRAINT ck_inventory_transfers_status;

ALTER TABLE inventory_warehouse_transfers
    ADD CONSTRAINT ck_inventory_transfers_status CHECK (
        status IN (
            'DRAFT', 'APPROVAL', 'READY_TO_SHIP', 'IN_TRANSIT',
            'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED'
        )
    );

ALTER TABLE inventory_warehouse_transfer_lines
    ADD COLUMN received_quantity BIGINT NOT NULL DEFAULT 0;

UPDATE inventory_warehouse_transfer_lines
SET received_quantity = quantity
WHERE receipt_event_id IS NOT NULL;

ALTER TABLE inventory_warehouse_transfer_lines
    ADD CONSTRAINT ck_inventory_transfer_lines_received_quantity CHECK (
        received_quantity >= 0 AND received_quantity <= quantity
    );

ALTER TABLE inventory_warehouse_transfer_lines
    ADD CONSTRAINT uq_inventory_transfer_lines_transfer_id
        UNIQUE (tenant_id, transfer_id, id);

CREATE TABLE inventory_warehouse_transfer_receipts (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    transfer_id UUID NOT NULL,
    line_id UUID NOT NULL,
    quantity BIGINT NOT NULL,
    inventory_event_id UUID NOT NULL,
    command_id UUID,
    received_by_user_id UUID,
    received_by_system_admin_id UUID,
    receiver_display_name VARCHAR(160) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_transfer_receipts_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_transfer_receipts_event
        UNIQUE (tenant_id, inventory_event_id),
    CONSTRAINT uq_inventory_transfer_receipts_command_line
        UNIQUE (tenant_id, command_id, line_id),
    CONSTRAINT fk_inventory_transfer_receipts_transfer
        FOREIGN KEY (tenant_id, transfer_id)
        REFERENCES inventory_warehouse_transfers (tenant_id, id),
    CONSTRAINT fk_inventory_transfer_receipts_line
        FOREIGN KEY (tenant_id, transfer_id, line_id)
        REFERENCES inventory_warehouse_transfer_lines (
            tenant_id, transfer_id, id
        ),
    CONSTRAINT fk_inventory_transfer_receipts_event
        FOREIGN KEY (tenant_id, inventory_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT fk_inventory_transfer_receipts_user
        FOREIGN KEY (received_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_inventory_transfer_receipts_admin
        FOREIGN KEY (received_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_inventory_transfer_receipts_quantity CHECK (quantity > 0),
    CONSTRAINT ck_inventory_transfer_receipts_actor CHECK (
        (received_by_user_id IS NULL) <>
        (received_by_system_admin_id IS NULL)
    )
);

INSERT INTO inventory_warehouse_transfer_receipts (
    id, tenant_id, transfer_id, line_id, quantity,
    inventory_event_id, command_id,
    received_by_user_id, received_by_system_admin_id,
    receiver_display_name, created_at
)
SELECT
    gen_random_uuid(), line.tenant_id, line.transfer_id, line.id,
    line.quantity, line.receipt_event_id, NULL,
    transfer.received_by_user_id,
    transfer.received_by_system_admin_id,
    coalesce(transfer.receiver_display_name, 'Historical receiver'),
    coalesce(transfer.received_at, transfer.updated_at)
FROM inventory_warehouse_transfer_lines line
JOIN inventory_warehouse_transfers transfer
  ON transfer.tenant_id = line.tenant_id
 AND transfer.id = line.transfer_id
WHERE line.receipt_event_id IS NOT NULL;

CREATE INDEX idx_inventory_transfer_receipts_transfer_line
    ON inventory_warehouse_transfer_receipts (
        tenant_id, transfer_id, line_id, created_at, id
    );

ALTER TABLE inventory_warehouse_transfer_commands
    DROP CONSTRAINT ck_inventory_transfer_commands_operation;

ALTER TABLE inventory_warehouse_transfer_commands
    ADD CONSTRAINT ck_inventory_transfer_commands_operation CHECK (
        operation IN (
            'CREATE', 'SUBMIT', 'APPROVE', 'REJECT',
            'SHIP', 'RECEIVE', 'RECEIVE_PARTIAL', 'CANCEL'
        )
    );

ALTER TABLE inventory_warehouse_transfer_commands
    DROP CONSTRAINT ck_inventory_transfer_commands_status;

ALTER TABLE inventory_warehouse_transfer_commands
    ADD CONSTRAINT ck_inventory_transfer_commands_status CHECK (
        result_status IN (
            'DRAFT', 'APPROVAL', 'READY_TO_SHIP', 'IN_TRANSIT',
            'PARTIALLY_RECEIVED', 'RECEIVED', 'REJECTED', 'CANCELLED'
        )
    );
