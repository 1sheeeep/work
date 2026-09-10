ALTER TABLE tenant_shops
    ADD CONSTRAINT uq_tenant_shops_tenant_id_platform_id UNIQUE (tenant_id, id, platform_id);

CREATE TABLE tenant_product_spus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    brand_name VARCHAR(160),
    category_name VARCHAR(160),
    description VARCHAR(2000),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_product_spus_code UNIQUE (tenant_id, business_code),
    CONSTRAINT uq_tenant_product_spus_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT ck_tenant_product_spus_code CHECK (business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
    CONSTRAINT ck_tenant_product_spus_name CHECK (char_length(btrim(name)) > 0),
    CONSTRAINT ck_tenant_product_spus_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE tenant_product_skus (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    spu_id UUID NOT NULL,
    business_code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    variant_summary VARCHAR(1000),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_product_skus_code UNIQUE (tenant_id, business_code),
    CONSTRAINT uq_tenant_product_skus_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_product_skus_spu FOREIGN KEY (tenant_id, spu_id)
        REFERENCES tenant_product_spus (tenant_id, id),
    CONSTRAINT ck_tenant_product_skus_code CHECK (business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'),
    CONSTRAINT ck_tenant_product_skus_name CHECK (char_length(btrim(name)) > 0),
    CONSTRAINT ck_tenant_product_skus_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE tenant_product_listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    platform_id UUID NOT NULL REFERENCES platform_catalog(id),
    sku_id UUID NOT NULL,
    external_listing_ref VARCHAR(160) NOT NULL,
    external_variant_ref VARCHAR(160),
    external_status VARCHAR(80),
    metadata_note VARCHAR(1000),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_product_listings_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_product_listings_shop FOREIGN KEY (tenant_id, shop_id, platform_id)
        REFERENCES tenant_shops (tenant_id, id, platform_id),
    CONSTRAINT fk_tenant_product_listings_sku FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT ck_tenant_product_listings_external_ref CHECK (char_length(btrim(external_listing_ref)) > 0),
    CONSTRAINT ck_tenant_product_listings_status CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE UNIQUE INDEX uq_tenant_product_listings_external_reference
    ON tenant_product_listings (tenant_id, shop_id, external_listing_ref, COALESCE(external_variant_ref, ''));
CREATE INDEX idx_tenant_product_spus_tenant_status_code
    ON tenant_product_spus (tenant_id, status, business_code, id);
CREATE INDEX idx_tenant_product_skus_tenant_spu_status_code
    ON tenant_product_skus (tenant_id, spu_id, status, business_code, id);
CREATE INDEX idx_tenant_product_listings_tenant_shop_status_ref
    ON tenant_product_listings (tenant_id, shop_id, status, external_listing_ref, id);
CREATE INDEX idx_tenant_product_listings_tenant_sku_status
    ON tenant_product_listings (tenant_id, sku_id, status);
