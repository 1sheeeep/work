-- Purchase orders can now be created directly. Existing procurement plans remain
-- available as optional historical sources and are never rewritten or deleted.

ALTER TABLE procurement_purchase_orders
    ALTER COLUMN plan_id DROP NOT NULL,
    ALTER COLUMN plan_no_snapshot DROP NOT NULL;

ALTER TABLE procurement_purchase_orders
    DROP CONSTRAINT ck_procurement_purchase_orders_snapshots;

ALTER TABLE procurement_purchase_orders
    ADD CONSTRAINT ck_procurement_purchase_orders_legacy_plan CHECK (
        (plan_id IS NULL AND plan_no_snapshot IS NULL)
        OR (
            plan_id IS NOT NULL
            AND plan_no_snapshot IS NOT NULL
            AND char_length(btrim(plan_no_snapshot)) BETWEEN 1 AND 40
        )
    ),
    ADD CONSTRAINT ck_procurement_purchase_orders_snapshots CHECK (
        char_length(btrim(supplier_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(supplier_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(sku_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(sku_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(warehouse_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(warehouse_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(location_code_snapshot)) BETWEEN 1 AND 64
        AND char_length(btrim(location_name_snapshot)) BETWEEN 1 AND 200
        AND char_length(btrim(ordered_by_display_name)) BETWEEN 1 AND 160
    );

UPDATE permissions
SET name = 'Read purchase orders, receipts and returns',
    description = 'Read tenant-scoped purchase orders and related stock movements'
WHERE code = 'procurement.read';

UPDATE permissions
SET name = 'Write purchase orders, receipts and returns',
    description = 'Create and review purchase orders and post bounded receipts and returns'
WHERE code = 'procurement.write';
