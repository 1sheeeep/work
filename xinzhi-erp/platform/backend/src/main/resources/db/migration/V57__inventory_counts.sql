-- V57: warehouse inventory count batches on the append-only inventory ledger.
-- Count lines snapshot warehouse-level balances. Locations remain operational
-- references and are deliberately not introduced as a balance dimension.

CREATE TABLE inventory_count_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    count_no VARCHAR(40) NOT NULL,
    warehouse_id UUID NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    count_date DATE NOT NULL,
    note VARCHAR(500),
    version BIGINT NOT NULL DEFAULT 0,
    operator_display_name VARCHAR(160) NOT NULL,
    approver_display_name VARCHAR(160),
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins (id),
    reviewed_by_user_id UUID,
    reviewed_by_system_admin_id UUID REFERENCES system_admins (id),
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_counts_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_counts_no UNIQUE (tenant_id, count_no),
    CONSTRAINT fk_inventory_counts_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_counts_creator
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_inventory_counts_reviewer
        FOREIGN KEY (reviewed_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_inventory_counts_status CHECK (
        status IN ('PENDING', 'APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELLED')
    ),
    CONSTRAINT ck_inventory_counts_version CHECK (version >= 0),
    CONSTRAINT ck_inventory_counts_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_inventory_counts_reviewer CHECK (
        (reviewed_by_user_id IS NULL AND reviewed_by_system_admin_id IS NULL)
        OR ((reviewed_by_user_id IS NULL) <> (reviewed_by_system_admin_id IS NULL))
    ),
    CONSTRAINT ck_inventory_counts_note CHECK (
        note IS NULL OR char_length(note) BETWEEN 1 AND 500
    ),
    CONSTRAINT ck_inventory_counts_operator CHECK (
        char_length(btrim(operator_display_name)) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_inventory_counts_approver CHECK (
        approver_display_name IS NULL
        OR char_length(btrim(approver_display_name)) BETWEEN 1 AND 160
    )
);

CREATE INDEX idx_inventory_counts_list
    ON inventory_count_batches (tenant_id, count_date DESC, created_at DESC, id);
CREATE INDEX idx_inventory_counts_warehouse_status
    ON inventory_count_batches (tenant_id, warehouse_id, status, count_date DESC);

CREATE TABLE inventory_count_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    count_id UUID NOT NULL,
    balance_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    expected_balance_version BIGINT NOT NULL,
    snapshot_on_hand BIGINT NOT NULL,
    snapshot_reserved BIGINT NOT NULL,
    counted_on_hand BIGINT NOT NULL,
    difference BIGINT NOT NULL,
    result_event_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_count_lines_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_count_lines_balance UNIQUE (tenant_id, count_id, balance_id),
    CONSTRAINT fk_inventory_count_lines_batch
        FOREIGN KEY (tenant_id, count_id)
        REFERENCES inventory_count_batches (tenant_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_inventory_count_lines_balance
        FOREIGN KEY (tenant_id, balance_id)
        REFERENCES inventory_balances (tenant_id, id),
    CONSTRAINT fk_inventory_count_lines_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_inventory_count_lines_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_count_lines_result
        FOREIGN KEY (tenant_id, result_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT ck_inventory_count_lines_version CHECK (expected_balance_version >= 0),
    CONSTRAINT ck_inventory_count_lines_difference CHECK (
        difference = counted_on_hand - snapshot_on_hand
    )
);

CREATE INDEX idx_inventory_count_lines_batch
    ON inventory_count_lines (tenant_id, count_id, id);

CREATE TABLE inventory_count_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    count_id UUID NOT NULL,
    operation VARCHAR(16) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    result_status VARCHAR(16) NOT NULL,
    result_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_inventory_count_commands_batch
        FOREIGN KEY (tenant_id, count_id)
        REFERENCES inventory_count_batches (tenant_id, id),
    CONSTRAINT ck_inventory_count_commands_operation CHECK (
        operation IN ('CREATE', 'SUBMIT', 'APPROVE', 'REJECT', 'CANCEL')
    ),
    CONSTRAINT ck_inventory_count_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_inventory_count_commands_status CHECK (
        result_status IN ('PENDING', 'APPROVAL', 'COMPLETED', 'REJECTED', 'CANCELLED')
    ),
    CONSTRAINT ck_inventory_count_commands_version CHECK (result_version >= 0)
);
