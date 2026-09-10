-- Restore the core supplier-management write model required by procurement.
-- Advanced supplier contracts, finance, qualification and portal features remain out of scope.

ALTER TABLE tenant_suppliers
    ADD COLUMN tax_registration_number VARCHAR(120),
    ADD COLUMN settlement_currency CHAR(3),
    ADD COLUMN payment_terms_days INTEGER;

ALTER TABLE tenant_suppliers
    ADD CONSTRAINT ck_tenant_suppliers_tax_registration_number CHECK (
        tax_registration_number IS NULL
        OR (
            tax_registration_number = btrim(tax_registration_number)
            AND char_length(tax_registration_number) BETWEEN 1 AND 120
            AND tax_registration_number !~ '[[:cntrl:]]'
        )
    ),
    ADD CONSTRAINT ck_tenant_suppliers_settlement_currency CHECK (
        settlement_currency IS NULL
        OR settlement_currency ~ '^[A-Z]{3}$'
    ),
    ADD CONSTRAINT ck_tenant_suppliers_payment_terms_days CHECK (
        payment_terms_days IS NULL
        OR payment_terms_days BETWEEN 0 AND 3650
    );

ALTER TABLE tenant_supplier_sku_mappings
    ADD COLUMN unit_price NUMERIC(19, 4),
    ADD COLUMN currency_code CHAR(3),
    ADD COLUMN minimum_order_quantity BIGINT;

ALTER TABLE tenant_supplier_sku_mappings
    ADD CONSTRAINT ck_supplier_sku_mapping_price_pair CHECK (
        (unit_price IS NULL AND currency_code IS NULL)
        OR (
            unit_price IS NOT NULL
            AND currency_code IS NOT NULL
            AND unit_price > 0
            AND unit_price <= 999999999999999.9999
            AND currency_code ~ '^[A-Z]{3}$'
        )
    ),
    ADD CONSTRAINT ck_supplier_sku_mapping_minimum_order CHECK (
        minimum_order_quantity IS NULL
        OR minimum_order_quantity BETWEEN 1 AND 1000000000
    );

UPDATE permissions
SET name = 'Read suppliers and sourcing relationships',
    description = 'Read tenant-scoped supplier profiles and SKU sourcing relationships'
WHERE code = 'suppliers.read';

UPDATE permissions
SET name = 'Manage suppliers and sourcing relationships',
    description = 'Create, update and archive supplier profiles and SKU sourcing relationships'
WHERE code = 'suppliers.write';
