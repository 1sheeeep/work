ALTER TABLE tenant_order_lines
    ADD COLUMN line_kind VARCHAR(24) NOT NULL DEFAULT 'PRODUCT',
    ADD CONSTRAINT ck_tenant_order_lines_kind CHECK (
        line_kind IN ('PRODUCT', 'CUSTOM_AMOUNT')),
    ADD CONSTRAINT ck_tenant_order_lines_custom_amount CHECK (
        line_kind <> 'CUSTOM_AMOUNT'
        OR (sku_id IS NULL
            AND external_listing_ref IS NULL
            AND external_variant_ref IS NULL
            AND sku_match_source = 'UNMATCHED'));

CREATE TABLE tenant_shopify_order_custom_item_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(100) NOT NULL,
    shop_id UUID NOT NULL,
    order_id UUID NOT NULL,
    external_order_ref VARCHAR(160) NOT NULL,
    item_title VARCHAR(255) NOT NULL,
    unit_price_minor BIGINT NOT NULL,
    currency CHAR(3) NOT NULL,
    requested_quantity INTEGER NOT NULL,
    requires_shipping BOOLEAN NOT NULL,
    taxable BOOLEAN NOT NULL,
    notify_customer BOOLEAN NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    response_order_line_id UUID,
    response_external_line_ref VARCHAR(160),
    response_total_minor BIGINT,
    response_currency CHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_custom_item_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shopify_custom_item_order FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_shopify_custom_item_line FOREIGN KEY (tenant_id, response_order_line_id)
        REFERENCES tenant_order_lines (tenant_id, id),
    CONSTRAINT ck_shopify_custom_item_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_shopify_custom_item_order_ref CHECK (
        external_order_ref ~ '^gid://shopify/Order/[0-9]+$'),
    CONSTRAINT ck_shopify_custom_item_title CHECK (
        char_length(btrim(item_title)) BETWEEN 1 AND 255),
    CONSTRAINT ck_shopify_custom_item_price CHECK (unit_price_minor >= 0),
    CONSTRAINT ck_shopify_custom_item_currency CHECK (
        currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_shopify_custom_item_quantity CHECK (
        requested_quantity BETWEEN 1 AND 100000),
    CONSTRAINT ck_shopify_custom_item_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_shopify_custom_item_status CHECK (
        status IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')),
    CONSTRAINT ck_shopify_custom_item_attempts CHECK (attempt_count > 0),
    CONSTRAINT ck_shopify_custom_item_completion CHECK (
        (status = 'SUCCEEDED'
            AND response_order_line_id IS NOT NULL
            AND response_external_line_ref ~ '^gid://shopify/LineItem/[0-9]+$'
            AND response_total_minor IS NOT NULL
            AND response_total_minor >= 0
            AND response_currency ~ '^[A-Z]{3}$'
            AND completed_at IS NOT NULL
            AND safe_error_code IS NULL)
        OR (status <> 'SUCCEEDED'
            AND response_order_line_id IS NULL
            AND response_external_line_ref IS NULL
            AND response_total_minor IS NULL
            AND response_currency IS NULL
            AND completed_at IS NULL))
);

CREATE UNIQUE INDEX uq_shopify_custom_item_active_request
    ON tenant_shopify_order_custom_item_commands (
        tenant_id, order_id, request_fingerprint)
    WHERE status IN ('PENDING', 'UNCERTAIN');

CREATE INDEX idx_shopify_custom_item_recovery
    ON tenant_shopify_order_custom_item_commands (
        status, locked_until, updated_at)
    WHERE status IN ('PENDING', 'UNCERTAIN');
