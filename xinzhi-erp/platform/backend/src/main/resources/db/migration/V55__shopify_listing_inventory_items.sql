ALTER TABLE tenant_product_listings
    ADD COLUMN external_inventory_item_ref VARCHAR(160);

ALTER TABLE tenant_product_listings
    ADD CONSTRAINT ck_product_listing_inventory_item_ref CHECK (
        external_inventory_item_ref IS NULL
        OR external_inventory_item_ref ~ '^gid://shopify/InventoryItem/[0-9]+$');

CREATE UNIQUE INDEX uq_product_listing_inventory_item_ref
    ON tenant_product_listings (tenant_id, shop_id, external_inventory_item_ref)
    WHERE external_inventory_item_ref IS NOT NULL;
