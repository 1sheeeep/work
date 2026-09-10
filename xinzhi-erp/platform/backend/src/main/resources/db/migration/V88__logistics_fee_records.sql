-- V88: tenant-scoped logistics fee reconciliation records.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '88880000-0000-0000-0000-000000000001',
    'logistics.fee.write',
    'logistics',
    'Manage logistics fee records',
    'Create, update, confirm, and archive logistics fee records'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'logistics.fee.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_fee_records (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    platform_name VARCHAR(100) NOT NULL,
    shop_name VARCHAR(100) NOT NULL,
    channel_name VARCHAR(120) NOT NULL,
    order_reference VARCHAR(120) NOT NULL,
    tracking_reference VARCHAR(120) NOT NULL,
    transaction_reference VARCHAR(120),
    estimated_fee NUMERIC(18, 4),
    actual_fee NUMERIC(18, 4),
    currency CHAR(3) NOT NULL,
    carrier_weight_kg NUMERIC(12, 3),
    warehouse_weight_kg NUMERIC(12, 3),
    shipped_on DATE NOT NULL,
    confirmation_status VARCHAR(16) NOT NULL DEFAULT 'UNCONFIRMED',
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    note VARCHAR(500),
    confirmed_by_display_name VARCHAR(160),
    confirmed_by_user_id UUID,
    confirmed_by_system_admin_id UUID,
    confirmed_at TIMESTAMPTZ,
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_logistics_fee_records_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_logistics_fee_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_fee_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_fee_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_fee_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_fee_confirmed_user
        FOREIGN KEY (confirmed_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_fee_confirmed_admin
        FOREIGN KEY (confirmed_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_fee_required_text CHECK (
        platform_name = btrim(platform_name)
        AND char_length(platform_name) BETWEEN 1 AND 100
        AND platform_name !~ '[[:cntrl:]]'
        AND shop_name = btrim(shop_name)
        AND char_length(shop_name) BETWEEN 1 AND 100
        AND shop_name !~ '[[:cntrl:]]'
        AND channel_name = btrim(channel_name)
        AND char_length(channel_name) BETWEEN 1 AND 120
        AND channel_name !~ '[[:cntrl:]]'
        AND order_reference = btrim(order_reference)
        AND char_length(order_reference) BETWEEN 1 AND 120
        AND order_reference !~ '[[:cntrl:]]'
        AND tracking_reference = btrim(tracking_reference)
        AND char_length(tracking_reference) BETWEEN 1 AND 120
        AND tracking_reference !~ '[[:cntrl:]]'
        AND created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_logistics_fee_optional_text CHECK (
        (transaction_reference IS NULL OR (
            transaction_reference = btrim(transaction_reference)
            AND char_length(transaction_reference) BETWEEN 1 AND 120
            AND transaction_reference !~ '[[:cntrl:]]'))
        AND (note IS NULL OR (
            note = btrim(note)
            AND char_length(note) BETWEEN 1 AND 500
            AND note !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_logistics_fee_amounts CHECK (
        currency ~ '^[A-Z]{3}$'
        AND (estimated_fee IS NOT NULL OR actual_fee IS NOT NULL)
        AND (estimated_fee IS NULL OR estimated_fee BETWEEN 0 AND 99999999999999.9999)
        AND (actual_fee IS NULL OR actual_fee BETWEEN 0 AND 99999999999999.9999)
        AND (carrier_weight_kg IS NULL OR carrier_weight_kg BETWEEN 0.001 AND 999999999.999)
        AND (warehouse_weight_kg IS NULL OR warehouse_weight_kg BETWEEN 0.001 AND 999999999.999)
    ),
    CONSTRAINT ck_logistics_fee_state CHECK (
        confirmation_status IN ('UNCONFIRMED', 'CONFIRMED')
        AND lifecycle_status IN ('ACTIVE', 'ARCHIVED')
        AND (lifecycle_status <> 'ARCHIVED' OR confirmation_status = 'UNCONFIRMED')
        AND (
            (confirmation_status = 'UNCONFIRMED'
             AND confirmed_by_display_name IS NULL
             AND confirmed_by_user_id IS NULL
             AND confirmed_by_system_admin_id IS NULL
             AND confirmed_at IS NULL)
            OR
            (confirmation_status = 'CONFIRMED'
             AND actual_fee IS NOT NULL
             AND confirmed_by_display_name IS NOT NULL
             AND ((confirmed_by_user_id IS NULL) <> (confirmed_by_system_admin_id IS NULL))
             AND confirmed_at IS NOT NULL)
        )
    ),
    CONSTRAINT ck_logistics_fee_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_fee_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_fee_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_fee_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_fee_timestamps CHECK (
        updated_at >= created_at
        AND (confirmed_at IS NULL OR confirmed_at >= created_at)
    )
);

CREATE UNIQUE INDEX uq_logistics_fee_active_tracking
    ON tenant_logistics_fee_records (tenant_id, tracking_reference)
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_logistics_fee_records_list
    ON tenant_logistics_fee_records (
        tenant_id, lifecycle_status, confirmation_status, shipped_on DESC, id DESC
    );
