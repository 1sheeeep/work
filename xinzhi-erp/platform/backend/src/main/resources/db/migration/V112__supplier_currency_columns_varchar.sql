-- Keep the supplier currency columns aligned with the JPA String mapping.
-- V111 used fixed-width CHAR(3), which PostgreSQL reports as bpchar and
-- Hibernate rejects when validating a VARCHAR(3) entity column.

ALTER TABLE tenant_suppliers
    ALTER COLUMN settlement_currency TYPE VARCHAR(3)
    USING btrim(settlement_currency)::VARCHAR(3);

ALTER TABLE tenant_supplier_sku_mappings
    ALTER COLUMN currency_code TYPE VARCHAR(3)
    USING btrim(currency_code)::VARCHAR(3);
