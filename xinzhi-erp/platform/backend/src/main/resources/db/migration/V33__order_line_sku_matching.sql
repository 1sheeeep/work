ALTER TABLE tenant_order_lines
    ADD COLUMN external_listing_ref VARCHAR(160),
    ADD COLUMN external_variant_ref VARCHAR(160),
    ADD COLUMN sku_match_source VARCHAR(32);

UPDATE tenant_order_lines
SET sku_match_source = CASE
    WHEN sku_id IS NULL THEN 'UNMATCHED'
    ELSE 'PROVIDED'
END;

ALTER TABLE tenant_order_lines
    ALTER COLUMN sku_match_source SET NOT NULL,
    ADD CONSTRAINT ck_tenant_order_lines_listing_ref CHECK (
        external_listing_ref IS NULL OR char_length(btrim(external_listing_ref)) > 0
    ),
    ADD CONSTRAINT ck_tenant_order_lines_variant_ref CHECK (
        external_variant_ref IS NULL
        OR (
            external_listing_ref IS NOT NULL
            AND char_length(btrim(external_variant_ref)) > 0
        )
    ),
    ADD CONSTRAINT ck_tenant_order_lines_match_source CHECK (
        sku_match_source IN ('PROVIDED', 'LISTING_MAPPING', 'MANUAL', 'UNMATCHED')
    ),
    ADD CONSTRAINT ck_tenant_order_lines_match_consistency CHECK (
        (sku_match_source = 'UNMATCHED' AND sku_id IS NULL)
        OR (
            sku_match_source IN ('PROVIDED', 'LISTING_MAPPING', 'MANUAL')
            AND sku_id IS NOT NULL
        )
    );

CREATE INDEX idx_tenant_order_lines_match_source
    ON tenant_order_lines (tenant_id, order_id, sku_match_source, id);
