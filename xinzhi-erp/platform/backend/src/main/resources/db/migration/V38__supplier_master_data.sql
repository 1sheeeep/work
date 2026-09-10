-- Tenant-scoped supplier master data.
-- This migration adds catalog permissions only; it creates no role grants.
CREATE TABLE tenant_suppliers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    contact_name VARCHAR(120),
    contact_phone VARCHAR(40),
    contact_email VARCHAR(254),
    address VARCHAR(500),
    notes VARCHAR(2000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_suppliers_code
        UNIQUE (tenant_id, business_code),
    CONSTRAINT uq_tenant_suppliers_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT ck_tenant_suppliers_code
        CHECK (business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
    CONSTRAINT ck_tenant_suppliers_name
        CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    CONSTRAINT ck_tenant_suppliers_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),
    CONSTRAINT ck_tenant_suppliers_contact_name
        CHECK (
            contact_name IS NULL
            OR char_length(btrim(contact_name)) BETWEEN 1 AND 120
        ),
    CONSTRAINT ck_tenant_suppliers_contact_phone
        CHECK (
            contact_phone IS NULL
            OR char_length(btrim(contact_phone)) BETWEEN 1 AND 40
        ),
    CONSTRAINT ck_tenant_suppliers_contact_email
        CHECK (
            contact_email IS NULL
            OR char_length(btrim(contact_email)) BETWEEN 1 AND 254
        ),
    CONSTRAINT ck_tenant_suppliers_address
        CHECK (
            address IS NULL
            OR char_length(btrim(address)) BETWEEN 1 AND 500
        ),
    CONSTRAINT ck_tenant_suppliers_notes
        CHECK (
            notes IS NULL
            OR char_length(btrim(notes)) BETWEEN 1 AND 2000
        ),
    CONSTRAINT ck_tenant_suppliers_version
        CHECK (version >= 0),
    CONSTRAINT ck_tenant_suppliers_timestamps
        CHECK (updated_at >= created_at)
);

CREATE INDEX idx_tenant_suppliers_list
    ON tenant_suppliers (tenant_id, status, business_code, id);

CREATE OR REPLACE FUNCTION prevent_tenant_supplier_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'tenant suppliers must be archived, not deleted'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_tenant_suppliers_prevent_delete
BEFORE DELETE ON tenant_suppliers
FOR EACH ROW EXECUTE FUNCTION prevent_tenant_supplier_delete();

INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('84000000-0000-0000-0000-000000000001', 'suppliers.read', 'suppliers',
     'Read suppliers', 'Read tenant-scoped supplier master data'),
    ('84000000-0000-0000-0000-000000000002', 'suppliers.write', 'suppliers',
     'Write suppliers', 'Manage tenant-scoped supplier master data')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;
