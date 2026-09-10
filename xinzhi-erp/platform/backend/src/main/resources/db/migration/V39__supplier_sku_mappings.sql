-- Tenant-scoped supplier-to-SKU sourcing relationships.
-- Product, inventory, pricing, and order facts remain owned by their contexts.
CREATE TABLE tenant_supplier_sku_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    supplier_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    supplier_sku_code VARCHAR(120),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    preferred BOOLEAN NOT NULL DEFAULT false,
    lead_time_days INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_supplier_sku_mappings_pair
        UNIQUE (tenant_id, supplier_id, sku_id),
    CONSTRAINT uq_tenant_supplier_sku_mappings_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_supplier_sku_mappings_supplier
        FOREIGN KEY (tenant_id, supplier_id)
        REFERENCES tenant_suppliers (tenant_id, id),
    CONSTRAINT fk_tenant_supplier_sku_mappings_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT ck_tenant_supplier_sku_mappings_code
        CHECK (
            supplier_sku_code IS NULL
            OR (
                supplier_sku_code = btrim(supplier_sku_code)
                AND char_length(supplier_sku_code) BETWEEN 1 AND 120
            )
        ),
    CONSTRAINT ck_tenant_supplier_sku_mappings_status
        CHECK (status IN ('ACTIVE', 'INACTIVE')),
    CONSTRAINT ck_tenant_supplier_sku_mappings_lead_time
        CHECK (lead_time_days IS NULL OR lead_time_days BETWEEN 0 AND 3650),
    CONSTRAINT ck_tenant_supplier_sku_mappings_version
        CHECK (version >= 0),
    CONSTRAINT ck_tenant_supplier_sku_mappings_timestamps
        CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_tenant_supplier_sku_mappings_active_preferred
    ON tenant_supplier_sku_mappings (tenant_id, sku_id)
    WHERE status = 'ACTIVE' AND preferred;

CREATE INDEX idx_tenant_supplier_sku_mappings_list
    ON tenant_supplier_sku_mappings (
        tenant_id,
        supplier_id,
        status,
        preferred DESC,
        created_at,
        id
    );

CREATE OR REPLACE FUNCTION enforce_supplier_sku_mapping_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    supplier_status VARCHAR(24);
    sku_status VARCHAR(24);
BEGIN
    IF TG_OP = 'UPDATE'
       AND (
           NEW.tenant_id <> OLD.tenant_id
           OR NEW.supplier_id <> OLD.supplier_id
           OR NEW.sku_id <> OLD.sku_id
       ) THEN
        RAISE EXCEPTION 'supplier SKU mapping identity cannot be changed'
            USING ERRCODE = '23514';
    END IF;

    SELECT status
      INTO supplier_status
      FROM tenant_suppliers
     WHERE tenant_id = NEW.tenant_id
       AND id = NEW.supplier_id
     FOR UPDATE;

    IF supplier_status IS NULL THEN
        RAISE EXCEPTION 'supplier was not found'
            USING ERRCODE = '23503';
    END IF;
    IF supplier_status = 'ARCHIVED' THEN
        RAISE EXCEPTION 'archived supplier mappings are read-only'
            USING ERRCODE = '23514';
    END IF;

    IF TG_OP = 'INSERT' THEN
        SELECT status
          INTO sku_status
          FROM tenant_product_skus
         WHERE tenant_id = NEW.tenant_id
           AND id = NEW.sku_id
         FOR UPDATE;

        IF sku_status IS NULL THEN
            RAISE EXCEPTION 'SKU was not found'
                USING ERRCODE = '23503';
        END IF;
        IF sku_status = 'ARCHIVED' THEN
            RAISE EXCEPTION 'archived SKUs cannot receive supplier mappings'
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tenant_supplier_sku_mappings_enforce_write
BEFORE INSERT OR UPDATE ON tenant_supplier_sku_mappings
FOR EACH ROW EXECUTE FUNCTION enforce_supplier_sku_mapping_write();

CREATE OR REPLACE FUNCTION prevent_supplier_sku_mapping_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'supplier SKU mappings must be inactivated, not deleted'
        USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER trg_tenant_supplier_sku_mappings_prevent_delete
BEFORE DELETE ON tenant_supplier_sku_mappings
FOR EACH ROW EXECUTE FUNCTION prevent_supplier_sku_mapping_delete();
