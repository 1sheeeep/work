CREATE TABLE tenant_shopify_location_mappings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    external_location_ref VARCHAR(160) NOT NULL,
    external_name_snapshot VARCHAR(255) NOT NULL,
    external_active BOOLEAN NOT NULL,
    fulfills_online_orders BOOLEAN NOT NULL,
    has_active_inventory BOOLEAN NOT NULL,
    fulfillment_service BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT fk_shopify_location_mapping_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shopify_location_mapping_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT uq_shopify_location_mapping_external
        UNIQUE (tenant_id, shop_id, external_location_ref),
    CONSTRAINT uq_shopify_location_mapping_warehouse
        UNIQUE (tenant_id, shop_id, warehouse_id),
    CONSTRAINT ck_shopify_location_mapping_ref CHECK (
        external_location_ref ~ '^gid://shopify/Location/[0-9]+$'),
    CONSTRAINT ck_shopify_location_mapping_name CHECK (
        char_length(btrim(external_name_snapshot)) BETWEEN 1 AND 255),
    CONSTRAINT ck_shopify_location_mapping_version CHECK (version >= 0)
);

CREATE INDEX idx_shopify_location_mapping_warehouse
    ON tenant_shopify_location_mappings (tenant_id, warehouse_id);
