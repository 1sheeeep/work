-- V87: tenant-scoped logistics forecast batches.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '87870000-0000-0000-0000-000000000001',
    'logistics.forecast.write',
    'logistics',
    'Manage logistics forecast batches',
    'Create and update logistics forecast batch results'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.forecast.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_forecast_batches (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    batch_no VARCHAR(48) NOT NULL,
    batch_type VARCHAR(80) NOT NULL,
    forwarder VARCHAR(120) NOT NULL,
    order_references VARCHAR(2000) NOT NULL,
    order_count INTEGER NOT NULL,
    total_weight_kg NUMERIC(12, 3) NOT NULL,
    forecast_status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    printed BOOLEAN NOT NULL DEFAULT false,
    result_message VARCHAR(500),
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_logistics_forecast_batches_tenant_no UNIQUE (tenant_id, batch_no),
    CONSTRAINT uq_logistics_forecast_batches_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_logistics_forecast_batches_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_forecast_batches_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_forecast_batches_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_forecast_batches_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_forecast_batch_text CHECK (
        batch_no ~ '^FB-[0-9]{8}-[0-9]{6}-[A-Z0-9]{6}$'
        AND batch_type = btrim(batch_type)
        AND char_length(batch_type) BETWEEN 1 AND 80
        AND batch_type !~ '[[:cntrl:]]'
        AND forwarder = btrim(forwarder)
        AND char_length(forwarder) BETWEEN 1 AND 120
        AND forwarder !~ '[[:cntrl:]]'
        AND char_length(order_references) BETWEEN 1 AND 2000
        AND order_references ~ '^[A-Za-z0-9._:/-]+(,[A-Za-z0-9._:/-]+)*$'
        AND (result_message IS NULL OR (
            result_message = btrim(result_message)
            AND char_length(result_message) BETWEEN 1 AND 500
            AND result_message !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_logistics_forecast_batch_values CHECK (
        order_count BETWEEN 1 AND 200
        AND total_weight_kg > 0
        AND total_weight_kg <= 999999999.999
        AND forecast_status IN ('PENDING', 'SUCCEEDED', 'FAILED')
        AND (forecast_status <> 'FAILED' OR result_message IS NOT NULL)
        AND (NOT printed OR forecast_status = 'SUCCEEDED')
    ),
    CONSTRAINT ck_logistics_forecast_batch_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_forecast_batch_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_forecast_batch_display_name CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_logistics_forecast_batch_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_forecast_batch_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_forecast_batch_timestamps CHECK (updated_at >= created_at)
);

CREATE INDEX idx_logistics_forecast_batches_list
    ON tenant_logistics_forecast_batches (
        tenant_id, forecast_status, updated_at DESC, id DESC
    );
