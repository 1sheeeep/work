-- Tenant-scoped warehouse and location master data.
-- This migration adds catalog permissions only; it creates no role grants.
CREATE TABLE tenant_warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_warehouses_code UNIQUE (tenant_id, business_code),
    CONSTRAINT uq_tenant_warehouses_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_tenant_warehouses_code
        CHECK (business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
    CONSTRAINT ck_tenant_warehouses_name
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_tenant_warehouses_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_tenant_warehouses_version CHECK (version >= 0)
);

CREATE TABLE tenant_warehouse_locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    warehouse_id UUID NOT NULL,
    business_code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_warehouse_locations_code
        UNIQUE (tenant_id, warehouse_id, business_code),
    CONSTRAINT uq_tenant_warehouse_locations_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_warehouse_locations_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT ck_tenant_warehouse_locations_code
        CHECK (business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
    CONSTRAINT ck_tenant_warehouse_locations_name
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_tenant_warehouse_locations_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_tenant_warehouse_locations_version CHECK (version >= 0)
);

CREATE INDEX idx_tenant_warehouses_list
    ON tenant_warehouses (tenant_id, status, business_code, id);
CREATE INDEX idx_tenant_warehouse_locations_list
    ON tenant_warehouse_locations
    (tenant_id, warehouse_id, status, business_code, id);

INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('83000000-0000-0000-0000-000000000001', 'warehouses.read', 'warehouses',
     'Read warehouses', 'Read tenant-scoped warehouse and location master data'),
    ('83000000-0000-0000-0000-000000000002', 'warehouses.write', 'warehouses',
     'Write warehouses', 'Manage tenant-scoped warehouse and location master data')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;
