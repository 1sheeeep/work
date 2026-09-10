-- Distinguish plans created from the replenishment recommendation workflow
-- from plans entered manually. The existing purchase-order, review, receipt,
-- inventory and audit contracts remain unchanged.
ALTER TABLE procurement_plans
    DROP CONSTRAINT ck_procurement_plans_source,
    ADD CONSTRAINT ck_procurement_plans_source
        CHECK (source IN ('MANUAL', 'SMART'));
