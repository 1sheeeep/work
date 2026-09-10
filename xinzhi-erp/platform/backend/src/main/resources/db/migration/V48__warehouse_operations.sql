-- V48: complete manual inbound/outbound document workflow on the V44 ledger.
-- Inventory remains tenant + SKU + warehouse. Locations are operational
-- references and never become an inventory balance dimension.

ALTER TABLE inventory_ledger_events
    DROP CONSTRAINT ck_inventory_events_type;

ALTER TABLE inventory_ledger_events
    ADD CONSTRAINT ck_inventory_events_type CHECK (
        event_type IN (
            'OPENING_BALANCE',
             'CORRECTION',
             'REVERSAL',
             'FULFILLMENT_SHIPMENT',
             'DOCUMENT_POST'
        )
    ),
    ADD COLUMN source_type VARCHAR(40),
    ADD COLUMN source_id UUID,
    ADD COLUMN source_line_id UUID;

CREATE UNIQUE INDEX uq_inventory_events_source_line
    ON inventory_ledger_events (
        tenant_id,
        source_type,
        source_id,
        source_line_id,
        event_type
    )
    WHERE source_type IS NOT NULL;

ALTER TABLE tenant_warehouse_locations
    ADD CONSTRAINT uq_locations_tenant_warehouse_id
        UNIQUE (tenant_id, warehouse_id, id);

CREATE TABLE inventory_manual_movement_settings (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    direction VARCHAR(16) NOT NULL,
    approval_required BOOLEAN NOT NULL DEFAULT FALSE,
    unit_price_required BOOLEAN NOT NULL DEFAULT FALSE,
    show_cost_price BOOLEAN NOT NULL DEFAULT FALSE,
    cost_update_policy VARCHAR(24) NOT NULL DEFAULT 'NO_UPDATE',
    contact_information_required BOOLEAN NOT NULL DEFAULT FALSE,
    version BIGINT NOT NULL DEFAULT 0,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, direction),
    CONSTRAINT fk_manual_settings_user
        FOREIGN KEY (updated_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_manual_settings_system_admin
        FOREIGN KEY (updated_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_manual_settings_direction
        CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT ck_manual_settings_cost_policy
        CHECK (cost_update_policy IN ('UPDATE_SNAPSHOT', 'NO_UPDATE')),
    CONSTRAINT ck_manual_settings_version CHECK (version >= 0),
    CONSTRAINT ck_manual_settings_actor CHECK (
        (updated_by_user_id IS NULL AND updated_by_system_admin_id IS NULL)
        OR
        ((updated_by_user_id IS NULL)
            <> (updated_by_system_admin_id IS NULL))
    )
);

CREATE TABLE inventory_manual_movement_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    direction VARCHAR(16) NOT NULL,
    code VARCHAR(40) NOT NULL,
    name VARCHAR(80) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    version BIGINT NOT NULL DEFAULT 0,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_types_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_types_code UNIQUE (tenant_id, direction, code),
    CONSTRAINT fk_manual_types_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_manual_types_system_admin
        FOREIGN KEY (created_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_manual_types_direction
        CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT ck_manual_types_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_manual_types_code
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
    CONSTRAINT ck_manual_types_name
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
    CONSTRAINT ck_manual_types_version CHECK (version >= 0),
    CONSTRAINT ck_manual_types_actor CHECK (
        (created_by_user_id IS NULL)
        <> (created_by_system_admin_id IS NULL)
    )
);

CREATE TABLE inventory_manual_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    movement_no VARCHAR(40) NOT NULL,
    direction VARCHAR(16) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    warehouse_id UUID NOT NULL,
    movement_type_id UUID,
    reason_code VARCHAR(64) NOT NULL,
    source_type VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
    wms_status VARCHAR(24) NOT NULL DEFAULT 'NOT_CONFIGURED',
    approval_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REQUIRED',
    entry_mode VARCHAR(16) NOT NULL DEFAULT 'PRODUCT',
    note VARCHAR(500),
    source_reference VARCHAR(100),
    contact_name VARCHAR(80),
    contact_phone VARCHAR(40),
    contact_address VARCHAR(300),
    extension_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    version BIGINT NOT NULL DEFAULT 0,
    submitted_at TIMESTAMPTZ,
    posted_at TIMESTAMPTZ,
    reversed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    reviewed_by_user_id UUID,
    reviewed_by_system_admin_id UUID,
    reviewer_display_name VARCHAR(160),
    review_note VARCHAR(300),
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_movements_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_movements_tenant_warehouse_id
        UNIQUE (tenant_id, id, warehouse_id),
    CONSTRAINT uq_manual_movements_no UNIQUE (tenant_id, movement_no),
    CONSTRAINT fk_manual_movements_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_manual_movements_type
        FOREIGN KEY (tenant_id, movement_type_id)
        REFERENCES inventory_manual_movement_types (tenant_id, id),
    CONSTRAINT fk_manual_movements_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_manual_movements_system_admin
        FOREIGN KEY (created_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT fk_manual_movements_reviewer_user
        FOREIGN KEY (reviewed_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_manual_movements_reviewer_system_admin
        FOREIGN KEY (reviewed_by_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_manual_movements_direction
        CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT ck_manual_movements_status CHECK (
        status IN (
            'DRAFT',
            'SUBMITTED',
            'POSTED',
            'REVERSED',
            'CANCELLED'
        )
    ),
    CONSTRAINT ck_manual_movements_source CHECK (
        source_type IN (
            'MANUAL',
            'TEMPLATE_IMPORT',
            'OPEN_API',
            'TMS',
            'WMS',
            'INVENTORY_SKU'
        )
    ),
    CONSTRAINT ck_manual_movements_wms_status CHECK (
        wms_status IN (
            'NOT_CONFIGURED',
            'NOT_REQUIRED',
            'QUEUED',
            'SENT',
            'CANCELLED',
            'FAILED'
        )
    ),
    CONSTRAINT ck_manual_movements_approval_status CHECK (
        approval_status IN (
            'NOT_REQUIRED',
            'PENDING',
            'APPROVED',
            'REJECTED'
        )
    ),
    CONSTRAINT ck_manual_movements_entry_mode
        CHECK (entry_mode IN ('PRODUCT', 'BOX')),
    CONSTRAINT ck_manual_movements_actor CHECK (
        (created_by_user_id IS NULL)
        <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_manual_movements_version CHECK (version >= 0),
    CONSTRAINT ck_manual_movements_reason CHECK (
        (direction = 'INBOUND' AND reason_code IN (
            'FOUND_STOCK',
            'RECORDING_CORRECTION',
            'OTHER'
        ))
        OR
        (direction = 'OUTBOUND' AND reason_code IN (
            'DAMAGED_STOCK',
            'LOST_STOCK',
            'RECORDING_CORRECTION',
            'OTHER'
        ))
    ),
    CONSTRAINT ck_manual_movements_note CHECK (
        note IS NULL OR char_length(note) BETWEEN 1 AND 500
    ),
    CONSTRAINT ck_manual_movements_source_reference CHECK (
        source_reference IS NULL
        OR char_length(source_reference) BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_manual_movements_contact_name CHECK (
        contact_name IS NULL
        OR char_length(btrim(contact_name)) BETWEEN 1 AND 80
    ),
    CONSTRAINT ck_manual_movements_contact_phone CHECK (
        contact_phone IS NULL
        OR char_length(btrim(contact_phone)) BETWEEN 1 AND 40
    ),
    CONSTRAINT ck_manual_movements_contact_address CHECK (
        contact_address IS NULL
        OR char_length(btrim(contact_address)) BETWEEN 1 AND 300
    ),
    CONSTRAINT ck_manual_movements_extensions CHECK (
        jsonb_typeof(extension_attributes) = 'object'
        AND octet_length(extension_attributes::text) <= 4000
    ),
    CONSTRAINT ck_manual_movements_reviewer CHECK (
        (
            reviewed_by_user_id IS NULL
            AND reviewed_by_system_admin_id IS NULL
            AND reviewer_display_name IS NULL
            AND reviewed_at IS NULL
        )
        OR
        (
            (reviewed_by_user_id IS NULL)
                <> (reviewed_by_system_admin_id IS NULL)
            AND char_length(btrim(reviewer_display_name)) BETWEEN 1 AND 160
            AND reviewed_at IS NOT NULL
        )
    ),
    CONSTRAINT ck_manual_movements_review_note CHECK (
        review_note IS NULL
        OR char_length(btrim(review_note)) BETWEEN 1 AND 300
    ),
    CONSTRAINT ck_manual_movements_approval_consistency CHECK (
        (
            approval_status IN ('NOT_REQUIRED', 'PENDING')
            AND reviewed_at IS NULL
            AND reviewed_by_user_id IS NULL
            AND reviewed_by_system_admin_id IS NULL
            AND reviewer_display_name IS NULL
            AND review_note IS NULL
        )
        OR
        (
            approval_status = 'APPROVED'
            AND reviewed_at IS NOT NULL
            AND reviewer_display_name IS NOT NULL
        )
        OR
        (
            approval_status = 'REJECTED'
            AND reviewed_at IS NOT NULL
            AND reviewer_display_name IS NOT NULL
            AND review_note IS NOT NULL
        )
    ),
    CONSTRAINT ck_manual_movements_times CHECK (
        (status = 'DRAFT'
            AND submitted_at IS NULL
            AND posted_at IS NULL
            AND reversed_at IS NULL
            AND cancelled_at IS NULL)
        OR
        (status = 'SUBMITTED'
            AND submitted_at IS NOT NULL
            AND posted_at IS NULL
            AND reversed_at IS NULL
            AND cancelled_at IS NULL)
        OR
        (status = 'POSTED'
            AND submitted_at IS NOT NULL
            AND posted_at IS NOT NULL
            AND reversed_at IS NULL
            AND cancelled_at IS NULL)
        OR
        (status = 'REVERSED'
            AND submitted_at IS NOT NULL
            AND posted_at IS NOT NULL
            AND reversed_at IS NOT NULL
            AND cancelled_at IS NULL)
        OR
        (status = 'CANCELLED'
            AND posted_at IS NULL
            AND reversed_at IS NULL
            AND cancelled_at IS NOT NULL)
    )
);

CREATE INDEX idx_manual_movements_list
    ON inventory_manual_movements (
        tenant_id,
        warehouse_id,
        direction,
        status,
        created_at DESC,
        id DESC
    );

CREATE TABLE inventory_manual_movement_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    movement_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    line_number INTEGER NOT NULL,
    sku_id UUID NOT NULL,
    location_id UUID NOT NULL,
    quantity BIGINT NOT NULL,
    actual_quantity BIGINT,
    unit_price NUMERIC(19, 4),
    currency CHAR(3),
    extension_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
    note VARCHAR(300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_movement_lines_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_movement_lines_parent_id
        UNIQUE (tenant_id, movement_id, id),
    CONSTRAINT uq_manual_movement_lines_number
        UNIQUE (tenant_id, movement_id, line_number),
    CONSTRAINT uq_manual_movement_lines_sku
        UNIQUE (tenant_id, movement_id, sku_id),
    CONSTRAINT fk_manual_movement_lines_movement
        FOREIGN KEY (tenant_id, movement_id, warehouse_id)
        REFERENCES inventory_manual_movements (
            tenant_id,
            id,
            warehouse_id
        )
        ON DELETE CASCADE,
    CONSTRAINT fk_manual_movement_lines_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_manual_movement_lines_location
        FOREIGN KEY (tenant_id, warehouse_id, location_id)
        REFERENCES tenant_warehouse_locations (
            tenant_id,
            warehouse_id,
            id
        ),
    CONSTRAINT ck_manual_movement_lines_number
        CHECK (line_number BETWEEN 1 AND 500),
    CONSTRAINT ck_manual_movement_lines_quantity
        CHECK (quantity > 0),
    CONSTRAINT ck_manual_movement_lines_actual_quantity
        CHECK (actual_quantity IS NULL OR actual_quantity >= 0),
    CONSTRAINT ck_manual_movement_lines_price CHECK (
        (unit_price IS NULL AND currency IS NULL)
        OR
        (
            unit_price IS NOT NULL
            AND unit_price >= 0
            AND currency ~ '^[A-Z]{3}$'
        )
    ),
    CONSTRAINT ck_manual_movement_lines_extensions CHECK (
        jsonb_typeof(extension_attributes) = 'object'
        AND octet_length(extension_attributes::text) <= 2000
    ),
    CONSTRAINT ck_manual_movement_lines_note CHECK (
        note IS NULL OR char_length(note) BETWEEN 1 AND 300
    )
);

CREATE TABLE inventory_manual_movement_boxes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    movement_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    line_number INTEGER NOT NULL,
    source_box_stock_id UUID,
    custom_box_no VARCHAR(80) NOT NULL,
    box_count BIGINT NOT NULL,
    box_number_rule VARCHAR(24) NOT NULL,
    length_cm NUMERIC(12, 3) NOT NULL,
    width_cm NUMERIC(12, 3) NOT NULL,
    height_cm NUMERIC(12, 3) NOT NULL,
    gross_weight_kg NUMERIC(12, 3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_boxes_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_boxes_number
        UNIQUE (tenant_id, movement_id, line_number),
    CONSTRAINT fk_manual_boxes_movement
        FOREIGN KEY (tenant_id, movement_id, warehouse_id)
        REFERENCES inventory_manual_movements (
            tenant_id,
            id,
            warehouse_id
        )
        ON DELETE CASCADE,
    CONSTRAINT ck_manual_boxes_line_number
        CHECK (line_number BETWEEN 1 AND 200),
    CONSTRAINT ck_manual_boxes_custom_no
        CHECK (char_length(btrim(custom_box_no)) BETWEEN 1 AND 80),
    CONSTRAINT ck_manual_boxes_count CHECK (box_count > 0),
    CONSTRAINT ck_manual_boxes_number_rule
        CHECK (box_number_rule IN ('SHARED_NUMBER', 'UNIQUE_NUMBER')),
    CONSTRAINT ck_manual_boxes_dimensions CHECK (
        length_cm > 0
        AND width_cm > 0
        AND height_cm > 0
        AND gross_weight_kg > 0
    )
);

CREATE TABLE inventory_manual_sku_price_snapshots (
    tenant_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    direction VARCHAR(16) NOT NULL,
    unit_price NUMERIC(19, 4) NOT NULL,
    currency CHAR(3) NOT NULL,
    source_movement_id UUID NOT NULL,
    source_line_id UUID NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sku_id, direction),
    CONSTRAINT fk_manual_price_snapshot_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_manual_price_snapshot_source
        FOREIGN KEY (
            tenant_id,
            source_movement_id,
            source_line_id
        )
        REFERENCES inventory_manual_movement_lines (
            tenant_id,
            movement_id,
            id
        ),
    CONSTRAINT ck_manual_price_snapshot_direction
        CHECK (direction IN ('INBOUND', 'OUTBOUND')),
    CONSTRAINT ck_manual_price_snapshot_price
        CHECK (unit_price >= 0),
    CONSTRAINT ck_manual_price_snapshot_currency
        CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_manual_price_snapshot_version
        CHECK (version >= 0)
);

CREATE TABLE inventory_manual_movement_box_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    movement_box_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    quantity_per_box BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_box_items_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_box_items_sku
        UNIQUE (tenant_id, movement_box_id, sku_id),
    CONSTRAINT fk_manual_box_items_box
        FOREIGN KEY (tenant_id, movement_box_id)
        REFERENCES inventory_manual_movement_boxes (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_manual_box_items_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT ck_manual_box_items_quantity
        CHECK (quantity_per_box > 0)
);

CREATE TABLE inventory_manual_box_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    warehouse_id UUID NOT NULL,
    source_movement_id UUID NOT NULL,
    source_movement_box_id UUID NOT NULL,
    custom_box_no VARCHAR(80) NOT NULL,
    box_number_rule VARCHAR(24) NOT NULL,
    length_cm NUMERIC(12, 3) NOT NULL,
    width_cm NUMERIC(12, 3) NOT NULL,
    height_cm NUMERIC(12, 3) NOT NULL,
    gross_weight_kg NUMERIC(12, 3) NOT NULL,
    original_count BIGINT NOT NULL,
    available_count BIGINT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    reversed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_box_stock_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_box_stock_source
        UNIQUE (tenant_id, source_movement_box_id),
    CONSTRAINT fk_manual_box_stock_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_manual_box_stock_movement
        FOREIGN KEY (tenant_id, source_movement_id)
        REFERENCES inventory_manual_movements (tenant_id, id),
    CONSTRAINT fk_manual_box_stock_box
        FOREIGN KEY (tenant_id, source_movement_box_id)
        REFERENCES inventory_manual_movement_boxes (tenant_id, id),
    CONSTRAINT ck_manual_box_stock_counts CHECK (
        original_count > 0
        AND available_count BETWEEN 0 AND original_count
        AND (reversed_at IS NULL OR available_count = 0)
    ),
    CONSTRAINT ck_manual_box_stock_version CHECK (version >= 0)
);

CREATE TABLE inventory_manual_box_stock_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    box_stock_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    quantity_per_box BIGINT NOT NULL,
    CONSTRAINT uq_manual_box_stock_items_sku
        UNIQUE (tenant_id, box_stock_id, sku_id),
    CONSTRAINT fk_manual_box_stock_items_stock
        FOREIGN KEY (tenant_id, box_stock_id)
        REFERENCES inventory_manual_box_stock (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_manual_box_stock_items_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT ck_manual_box_stock_items_quantity
        CHECK (quantity_per_box > 0)
);

ALTER TABLE inventory_manual_movement_boxes
    ADD CONSTRAINT fk_manual_boxes_source_stock
        FOREIGN KEY (tenant_id, source_box_stock_id)
        REFERENCES inventory_manual_box_stock (tenant_id, id);

CREATE INDEX idx_manual_box_stock_available
    ON inventory_manual_box_stock (
        tenant_id,
        warehouse_id,
        available_count DESC,
        created_at,
        id
    );

ALTER TABLE inventory_ledger_events
    ADD CONSTRAINT ck_inventory_events_source CHECK (
        (
            source_type IS NULL
            AND source_id IS NULL
            AND source_line_id IS NULL
        )
        OR
        (
            source_type = 'MANUAL_MOVEMENT'
            AND source_id IS NOT NULL
            AND source_line_id IS NOT NULL
        )
    ),
    ADD CONSTRAINT fk_inventory_events_manual_source_line
        FOREIGN KEY (tenant_id, source_id, source_line_id)
        REFERENCES inventory_manual_movement_lines (
            tenant_id,
            movement_id,
            id
        );

CREATE TABLE inventory_manual_movement_commands (
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    command_id UUID NOT NULL,
    movement_id UUID NOT NULL,
    operation VARCHAR(24) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    result_status VARCHAR(16) NOT NULL,
    result_version BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_manual_movement_commands_movement
        FOREIGN KEY (tenant_id, movement_id)
        REFERENCES inventory_manual_movements (tenant_id, id),
    CONSTRAINT ck_manual_movement_commands_operation CHECK (
        operation IN (
            'CREATE',
            'UPDATE',
            'SUBMIT',
            'APPROVE',
            'REJECT',
            'POST',
            'CANCEL',
            'REVERSE',
            'BATCH_APPROVE',
            'BATCH_POST',
            'BATCH_CANCEL',
            'CANCEL_WMS'
        )
    ),
    CONSTRAINT ck_manual_movement_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_manual_movement_commands_status CHECK (
        result_status IN (
            'DRAFT',
            'SUBMITTED',
            'POSTED',
            'REVERSED',
            'CANCELLED'
        )
    ),
    CONSTRAINT ck_manual_movement_commands_version
        CHECK (result_version >= 0)
);

CREATE INDEX idx_manual_movement_commands_aggregate
    ON inventory_manual_movement_commands (
        tenant_id,
        movement_id,
        created_at DESC
    );

CREATE TABLE inventory_manual_configuration_commands (
    tenant_id UUID NOT NULL,
    command_id UUID NOT NULL,
    operation VARCHAR(32) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    response_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, command_id),
    CONSTRAINT fk_manual_configuration_commands_tenant
        FOREIGN KEY (tenant_id)
        REFERENCES tenants (id),
    CONSTRAINT ck_manual_configuration_commands_operation CHECK (
        operation IN ('SAVE_SETTINGS', 'CREATE_TYPE', 'UPDATE_TYPE')
    ),
    CONSTRAINT ck_manual_configuration_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_manual_configuration_commands_payload CHECK (
        jsonb_typeof(response_payload) = 'object'
    )
);

CREATE TABLE inventory_manual_movement_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    movement_id UUID NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    from_status VARCHAR(16),
    to_status VARCHAR(16) NOT NULL,
    movement_version BIGINT NOT NULL,
    command_id UUID NOT NULL,
    actor_user_id UUID,
    actor_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_manual_movement_events_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_manual_movement_events_command
        UNIQUE (tenant_id, command_id),
    CONSTRAINT fk_manual_movement_events_movement
        FOREIGN KEY (tenant_id, movement_id)
        REFERENCES inventory_manual_movements (tenant_id, id),
    CONSTRAINT fk_manual_movement_events_user
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_manual_movement_events_system_admin
        FOREIGN KEY (actor_system_admin_id)
        REFERENCES system_admins (id),
    CONSTRAINT ck_manual_movement_events_type CHECK (
        event_type IN (
            'CREATED',
            'UPDATED',
            'SUBMITTED',
            'APPROVED',
            'REJECTED',
            'POSTED',
            'CANCELLED',
            'WMS_CANCELLED',
            'REVERSED'
        )
    ),
    CONSTRAINT ck_manual_movement_events_from_status CHECK (
        from_status IS NULL
        OR from_status IN (
            'DRAFT',
            'SUBMITTED',
            'POSTED',
            'REVERSED',
            'CANCELLED'
        )
    ),
    CONSTRAINT ck_manual_movement_events_to_status CHECK (
        to_status IN (
            'DRAFT',
            'SUBMITTED',
            'POSTED',
            'REVERSED',
            'CANCELLED'
        )
    ),
    CONSTRAINT ck_manual_movement_events_version
        CHECK (movement_version >= 0),
    CONSTRAINT ck_manual_movement_events_actor CHECK (
        (actor_user_id IS NULL)
        <> (actor_system_admin_id IS NULL)
    )
);

CREATE INDEX idx_manual_movement_events_history
    ON inventory_manual_movement_events (
        tenant_id,
        movement_id,
        recorded_at,
        id
    );

CREATE OR REPLACE FUNCTION protect_posted_manual_movement_lines()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status VARCHAR(16);
BEGIN
    SELECT status
    INTO parent_status
    FROM inventory_manual_movements
    WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
      AND id = COALESCE(NEW.movement_id, OLD.movement_id);

    IF parent_status = 'DRAFT' THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_TABLE_NAME = 'inventory_manual_movement_lines'
       AND parent_status = 'SUBMITTED'
       AND TG_OP = 'UPDATE'
       AND OLD.actual_quantity IS NULL
       AND NEW.actual_quantity = NEW.quantity
       AND (to_jsonb(NEW) - 'actual_quantity')
           = (to_jsonb(OLD) - 'actual_quantity') THEN
        RETURN NEW;
    END IF;
    IF parent_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'posted manual movement lines are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_manual_movement_lines_immutable
BEFORE UPDATE OR DELETE ON inventory_manual_movement_lines
FOR EACH ROW EXECUTE FUNCTION protect_posted_manual_movement_lines();

CREATE TRIGGER trg_manual_movement_boxes_immutable
BEFORE UPDATE OR DELETE ON inventory_manual_movement_boxes
FOR EACH ROW EXECUTE FUNCTION protect_posted_manual_movement_lines();

CREATE OR REPLACE FUNCTION protect_posted_manual_movement_box_items()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    parent_status VARCHAR(24);
BEGIN
    SELECT movement.status
    INTO parent_status
    FROM inventory_manual_movement_boxes box
    JOIN inventory_manual_movements movement
      ON movement.tenant_id = box.tenant_id
     AND movement.id = box.movement_id
    WHERE box.tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
      AND box.id = COALESCE(
          NEW.movement_box_id,
          OLD.movement_box_id
      );

    IF parent_status NOT IN ('DRAFT') THEN
        RAISE EXCEPTION 'posted manual movement box items are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_manual_movement_box_items_immutable
BEFORE UPDATE OR DELETE ON inventory_manual_movement_box_items
FOR EACH ROW EXECUTE FUNCTION protect_posted_manual_movement_box_items();

CREATE OR REPLACE FUNCTION reject_manual_movement_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'manual movement events are append-only'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_manual_movement_events_append_only
BEFORE UPDATE OR DELETE ON inventory_manual_movement_events
FOR EACH ROW EXECUTE FUNCTION reject_manual_movement_event_mutation();

INSERT INTO permissions (id, code, module, name, description)
VALUES
    (
        '85000000-0000-0000-0000-000000000001',
        'inventory.manual.write',
        'inventory',
        'Write manual inventory movements',
        'Create and edit draft manual inbound and outbound documents'
    ),
    (
        '85000000-0000-0000-0000-000000000002',
        'inventory.manual.post',
        'inventory',
        'Post manual inventory movements',
        'Post manual inbound and outbound documents to the inventory ledger'
    ),
    (
        '85000000-0000-0000-0000-000000000003',
        'inventory.reverse',
        'inventory',
        'Reverse inventory facts',
        'Append reversal facts for posted inventory documents and adjustments'
    ),
    (
        '85000000-0000-0000-0000-000000000004',
        'inventory.manual.approve',
        'inventory',
        'Approve manual inventory movements',
        'Approve or reject submitted manual inbound and outbound documents'
    ),
    (
        '85000000-0000-0000-0000-000000000005',
        'inventory.manual.configure',
        'inventory',
        'Configure manual inventory movements',
        'Manage movement classifications and local workflow settings'
    )
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;
