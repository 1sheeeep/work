-- V44: first real inventory quantity loop.
-- The balance grain is tenant + SKU + warehouse. Locations, reservations,
-- dispositions, lots, serial numbers, UOM conversion and costs are excluded.

CREATE SEQUENCE inventory_ledger_sequence;

CREATE TABLE inventory_ledger_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    ledger_sequence BIGINT NOT NULL DEFAULT nextval('inventory_ledger_sequence'),
    event_type VARCHAR(24) NOT NULL,
    sku_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    signed_delta BIGINT NOT NULL,
    balance_after BIGINT NOT NULL,
    balance_version_after BIGINT NOT NULL,
    reason VARCHAR(64) NOT NULL,
    note VARCHAR(500),
    reversal_of_event_id UUID,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins (id),
    request_id VARCHAR(100) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_events_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_events_tenant_dimensions
        UNIQUE (tenant_id, id, sku_id, warehouse_id),
    CONSTRAINT uq_inventory_events_tenant_sequence
        UNIQUE (tenant_id, ledger_sequence),
    CONSTRAINT fk_inventory_events_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_inventory_events_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_events_actor_user
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_inventory_events_type
        CHECK (event_type IN ('OPENING_BALANCE', 'CORRECTION', 'REVERSAL')),
    CONSTRAINT ck_inventory_events_nonzero_delta
        CHECK (
            signed_delta <> 0
            AND signed_delta <> '-9223372036854775808'::BIGINT
        ),
    CONSTRAINT ck_inventory_events_version CHECK (balance_version_after > 0),
    CONSTRAINT ck_inventory_events_reason
        CHECK (reason ~ '^[A-Z][A-Z0-9_]{1,63}$'),
    CONSTRAINT ck_inventory_events_note
        CHECK (note IS NULL OR char_length(note) BETWEEN 1 AND 500),
    CONSTRAINT ck_inventory_events_actor
        CHECK ((actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_inventory_events_reversal_shape
        CHECK (
            (event_type = 'REVERSAL' AND reversal_of_event_id IS NOT NULL)
            OR (event_type <> 'REVERSAL' AND reversal_of_event_id IS NULL)
        ),
    CONSTRAINT ck_inventory_events_request_id
        CHECK (request_id ~ '^[A-Za-z0-9._:-]{1,100}$')
);

ALTER TABLE inventory_ledger_events
    ADD CONSTRAINT fk_inventory_events_reversal
    FOREIGN KEY (tenant_id, reversal_of_event_id, sku_id, warehouse_id)
    REFERENCES inventory_ledger_events (tenant_id, id, sku_id, warehouse_id);

CREATE UNIQUE INDEX uq_inventory_events_reversal_once
    ON inventory_ledger_events (tenant_id, reversal_of_event_id)
    WHERE reversal_of_event_id IS NOT NULL;

CREATE INDEX idx_inventory_events_balance_history
    ON inventory_ledger_events (
        tenant_id,
        warehouse_id,
        sku_id,
        ledger_sequence DESC
    );

CREATE INDEX idx_inventory_events_reason_time
    ON inventory_ledger_events (
        tenant_id,
        reason,
        recorded_at DESC,
        ledger_sequence DESC
    );

CREATE TABLE inventory_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    sku_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    on_hand BIGINT NOT NULL DEFAULT 0,
    version BIGINT NOT NULL DEFAULT 0,
    last_event_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_inventory_balances_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_inventory_balances_dimensions
        UNIQUE (tenant_id, sku_id, warehouse_id),
    CONSTRAINT fk_inventory_balances_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_inventory_balances_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_inventory_balances_last_event
        FOREIGN KEY (
            tenant_id,
            last_event_id,
            sku_id,
            warehouse_id
        )
        REFERENCES inventory_ledger_events (
            tenant_id,
            id,
            sku_id,
            warehouse_id
        ),
    CONSTRAINT ck_inventory_balances_version CHECK (version >= 0),
    CONSTRAINT ck_inventory_balances_event_shape
        CHECK (
            (version = 0 AND last_event_id IS NULL)
            OR (version > 0 AND last_event_id IS NOT NULL)
        )
);

CREATE INDEX idx_inventory_balances_tenant_updated
    ON inventory_balances (tenant_id, updated_at DESC, id);

CREATE TABLE inventory_command_idempotency (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    operation VARCHAR(24) NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    result_event_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, operation, idempotency_key),
    CONSTRAINT fk_inventory_idempotency_result
        FOREIGN KEY (tenant_id, result_event_id)
        REFERENCES inventory_ledger_events (tenant_id, id),
    CONSTRAINT ck_inventory_idempotency_operation
        CHECK (operation IN ('ADJUSTMENT', 'REVERSAL')),
    CONSTRAINT ck_inventory_idempotency_key
        CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_inventory_idempotency_fingerprint
        CHECK (request_fingerprint ~ '^[0-9a-f]{64}$')
);

CREATE FUNCTION reject_inventory_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'inventory ledger events are append-only'
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER trg_inventory_ledger_append_only
BEFORE UPDATE OR DELETE ON inventory_ledger_events
FOR EACH ROW EXECUTE FUNCTION reject_inventory_ledger_mutation();

INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('a3000000-0000-0000-0000-000000000010',
     'inventory.read', 'inventory',
     'Read inventory',
     'Read warehouse-level inventory balances and ledger events'),
    ('a3000000-0000-0000-0000-000000000011',
     'inventory.adjust', 'inventory',
     'Adjust inventory',
     'Create and reverse single warehouse-level inventory adjustments')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

-- Deliberately no role_permissions insert: inventory access must be explicitly
-- granted after V44 and remains independent from warehouses.* permissions.
