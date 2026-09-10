-- V81: real purchase-order review workflow. New orders remain pending until
-- approved; only approved orders may enter the existing receipt workflow.

ALTER TABLE procurement_purchase_orders
    DROP CONSTRAINT ck_procurement_purchase_orders_status,
    DROP CONSTRAINT ck_procurement_purchase_orders_receipt_state,
    ADD COLUMN review_decision VARCHAR(16),
    ADD COLUMN review_note VARCHAR(500),
    ADD COLUMN reviewed_by_display_name VARCHAR(160),
    ADD COLUMN reviewed_by_user_id UUID,
    ADD COLUMN reviewed_by_system_admin_id UUID,
    ADD COLUMN reviewed_at TIMESTAMPTZ;

-- Orders that already entered receiving were necessarily accepted under the
-- previous workflow. Preserve that fact when introducing explicit review.
UPDATE procurement_purchase_orders
SET review_decision = 'APPROVED',
    reviewed_by_display_name = ordered_by_display_name,
    reviewed_by_user_id = ordered_by_user_id,
    reviewed_by_system_admin_id = ordered_by_system_admin_id,
    reviewed_at = created_at
WHERE status IN ('PARTIALLY_RECEIVED', 'RECEIVED');

ALTER TABLE procurement_purchase_orders
    ADD CONSTRAINT fk_procurement_purchase_orders_review_user
        FOREIGN KEY (reviewed_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    ADD CONSTRAINT fk_procurement_purchase_orders_review_admin
        FOREIGN KEY (reviewed_by_system_admin_id)
        REFERENCES system_admins (id),
    ADD CONSTRAINT ck_procurement_purchase_orders_status CHECK (
        status IN (
            'NEW_ORDER', 'APPROVED', 'REJECTED',
            'PARTIALLY_RECEIVED', 'RECEIVED'
        )
    ),
    ADD CONSTRAINT ck_procurement_purchase_orders_receipt_state CHECK (
        (
            status IN ('NEW_ORDER', 'APPROVED', 'REJECTED')
            AND received_quantity = 0
            AND last_received_at IS NULL
        )
        OR (
            status = 'PARTIALLY_RECEIVED'
            AND received_quantity > 0
            AND received_quantity < quantity
            AND last_received_at IS NOT NULL
        )
        OR (
            status = 'RECEIVED'
            AND received_quantity = quantity
            AND last_received_at IS NOT NULL
        )
    ),
    ADD CONSTRAINT ck_procurement_purchase_orders_review_state CHECK (
        (
            status = 'NEW_ORDER'
            AND review_decision IS NULL
            AND review_note IS NULL
            AND reviewed_by_display_name IS NULL
            AND reviewed_by_user_id IS NULL
            AND reviewed_by_system_admin_id IS NULL
            AND reviewed_at IS NULL
        )
        OR (
            status IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
            AND review_decision = 'APPROVED'
            AND reviewed_by_display_name IS NOT NULL
            AND char_length(btrim(reviewed_by_display_name)) BETWEEN 1 AND 160
            AND (reviewed_by_user_id IS NULL) <>
                (reviewed_by_system_admin_id IS NULL)
            AND reviewed_at IS NOT NULL
            AND (
                review_note IS NULL
                OR (
                    char_length(btrim(review_note)) BETWEEN 1 AND 500
                    AND review_note !~ '[[:cntrl:]]'
                )
            )
        )
        OR (
            status = 'REJECTED'
            AND review_decision = 'REJECTED'
            AND review_note IS NOT NULL
            AND char_length(btrim(review_note)) BETWEEN 1 AND 500
            AND review_note !~ '[[:cntrl:]]'
            AND reviewed_by_display_name IS NOT NULL
            AND char_length(btrim(reviewed_by_display_name)) BETWEEN 1 AND 160
            AND (reviewed_by_user_id IS NULL) <>
                (reviewed_by_system_admin_id IS NULL)
            AND reviewed_at IS NOT NULL
        )
    );

CREATE INDEX idx_procurement_purchase_orders_review_queue
    ON procurement_purchase_orders (tenant_id, status, created_at, id)
    WHERE status = 'NEW_ORDER';

UPDATE permissions
SET name = 'Write and review procurement records',
    description = 'Create and review purchase orders and post approved purchase receipts'
WHERE code = 'procurement.write';
