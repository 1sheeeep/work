CREATE TABLE tenant_shopify_order_variant_add_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(100) NOT NULL,
    shop_id UUID NOT NULL,
    order_id UUID NOT NULL,
    listing_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    external_order_ref VARCHAR(160) NOT NULL,
    external_listing_ref VARCHAR(160) NOT NULL,
    external_variant_ref VARCHAR(160) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    requested_quantity INTEGER NOT NULL,
    notify_customer BOOLEAN NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    response_order_line_id UUID,
    response_external_line_ref VARCHAR(160),
    response_unit_price_minor BIGINT,
    response_total_minor BIGINT,
    response_currency CHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_variant_add_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shopify_variant_add_order FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_shopify_variant_add_listing FOREIGN KEY (tenant_id, listing_id)
        REFERENCES tenant_product_listings (tenant_id, id),
    CONSTRAINT fk_shopify_variant_add_sku FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_shopify_variant_add_line FOREIGN KEY (tenant_id, response_order_line_id)
        REFERENCES tenant_order_lines (tenant_id, id),
    CONSTRAINT ck_shopify_variant_add_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_shopify_variant_add_order_ref CHECK (
        external_order_ref ~ '^gid://shopify/Order/[0-9]+$'),
    CONSTRAINT ck_shopify_variant_add_listing_ref CHECK (
        external_listing_ref ~ '^gid://shopify/Product/[0-9]+$'),
    CONSTRAINT ck_shopify_variant_add_variant_ref CHECK (
        external_variant_ref ~ '^gid://shopify/ProductVariant/[0-9]+$'),
    CONSTRAINT ck_shopify_variant_add_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_shopify_variant_add_quantity CHECK (
        requested_quantity BETWEEN 1 AND 100000),
    CONSTRAINT ck_shopify_variant_add_status CHECK (
        status IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')),
    CONSTRAINT ck_shopify_variant_add_attempts CHECK (attempt_count > 0),
    CONSTRAINT ck_shopify_variant_add_completion CHECK (
        (status = 'SUCCEEDED'
            AND response_order_line_id IS NOT NULL
            AND response_external_line_ref ~ '^gid://shopify/LineItem/[0-9]+$'
            AND response_unit_price_minor IS NOT NULL
            AND response_unit_price_minor >= 0
            AND response_total_minor IS NOT NULL
            AND response_total_minor >= 0
            AND response_currency ~ '^[A-Z]{3}$'
            AND completed_at IS NOT NULL
            AND safe_error_code IS NULL)
        OR (status <> 'SUCCEEDED'
            AND response_order_line_id IS NULL
            AND response_external_line_ref IS NULL
            AND response_unit_price_minor IS NULL
            AND response_total_minor IS NULL
            AND response_currency IS NULL
            AND completed_at IS NULL))
);

CREATE UNIQUE INDEX uq_shopify_variant_add_active_variant
    ON tenant_shopify_order_variant_add_commands (
        tenant_id, order_id, external_variant_ref)
    WHERE status IN ('PENDING', 'UNCERTAIN');

CREATE INDEX idx_shopify_variant_add_recovery
    ON tenant_shopify_order_variant_add_commands (
        status, locked_until, updated_at)
    WHERE status IN ('PENDING', 'UNCERTAIN');
