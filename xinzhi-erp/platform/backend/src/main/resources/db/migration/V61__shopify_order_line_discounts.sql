ALTER TABLE tenant_order_lines
    ADD COLUMN discount_total_minor BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN discount_description VARCHAR(255),
    ADD CONSTRAINT ck_tenant_order_lines_discount_total
        CHECK (discount_total_minor >= 0),
    ADD CONSTRAINT ck_tenant_order_lines_discount_description
        CHECK (discount_description IS NULL
            OR char_length(btrim(discount_description)) BETWEEN 1 AND 255),
    ADD CONSTRAINT ck_tenant_order_lines_custom_discount
        CHECK (line_kind <> 'CUSTOM_AMOUNT'
            OR (discount_total_minor = 0 AND discount_description IS NULL));

CREATE TABLE tenant_shopify_order_line_discount_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(100) NOT NULL,
    shop_id UUID NOT NULL,
    order_id UUID NOT NULL,
    order_line_id UUID NOT NULL,
    external_order_ref VARCHAR(160) NOT NULL,
    external_order_line_ref VARCHAR(160) NOT NULL,
    external_variant_ref VARCHAR(160) NOT NULL,
    expected_quantity INTEGER NOT NULL,
    expected_discount_total_minor BIGINT NOT NULL,
    discount_description VARCHAR(255) NOT NULL,
    discount_type VARCHAR(16) NOT NULL,
    fixed_value_minor BIGINT,
    percent_basis_points INTEGER,
    currency CHAR(3) NOT NULL,
    notify_customer BOOLEAN NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    response_discount_total_minor BIGINT,
    response_total_minor BIGINT,
    response_currency CHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_line_discount_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shopify_line_discount_order FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_shopify_line_discount_line FOREIGN KEY (tenant_id, order_line_id)
        REFERENCES tenant_order_lines (tenant_id, id),
    CONSTRAINT ck_shopify_line_discount_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_shopify_line_discount_order_ref CHECK (
        external_order_ref ~ '^gid://shopify/Order/[0-9]+$'),
    CONSTRAINT ck_shopify_line_discount_line_ref CHECK (
        external_order_line_ref ~ '^gid://shopify/LineItem/[0-9]+$'),
    CONSTRAINT ck_shopify_line_discount_variant_ref CHECK (
        external_variant_ref ~ '^gid://shopify/ProductVariant/[0-9]+$'),
    CONSTRAINT ck_shopify_line_discount_quantity CHECK (
        expected_quantity BETWEEN 1 AND 100000),
    CONSTRAINT ck_shopify_line_discount_expected CHECK (
        expected_discount_total_minor >= 0),
    CONSTRAINT ck_shopify_line_discount_description CHECK (
        char_length(btrim(discount_description)) BETWEEN 1 AND 255),
    CONSTRAINT ck_shopify_line_discount_value CHECK (
        (discount_type = 'FIXED'
            AND fixed_value_minor > 0
            AND percent_basis_points IS NULL)
        OR (discount_type = 'PERCENTAGE'
            AND fixed_value_minor IS NULL
            AND percent_basis_points BETWEEN 1 AND 10000)),
    CONSTRAINT ck_shopify_line_discount_currency CHECK (
        currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_shopify_line_discount_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_shopify_line_discount_status CHECK (
        status IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')),
    CONSTRAINT ck_shopify_line_discount_attempts CHECK (attempt_count > 0),
    CONSTRAINT ck_shopify_line_discount_completion CHECK (
        (status = 'SUCCEEDED'
            AND response_discount_total_minor IS NOT NULL
            AND response_discount_total_minor > expected_discount_total_minor
            AND response_total_minor IS NOT NULL
            AND response_total_minor >= 0
            AND response_currency ~ '^[A-Z]{3}$'
            AND completed_at IS NOT NULL
            AND safe_error_code IS NULL)
        OR (status <> 'SUCCEEDED'
            AND response_discount_total_minor IS NULL
            AND response_total_minor IS NULL
            AND response_currency IS NULL
            AND completed_at IS NULL))
);

CREATE UNIQUE INDEX uq_shopify_line_discount_active_request
    ON tenant_shopify_order_line_discount_commands (
        tenant_id, order_line_id, request_fingerprint)
    WHERE status IN ('PENDING', 'UNCERTAIN');

CREATE INDEX idx_shopify_line_discount_recovery
    ON tenant_shopify_order_line_discount_commands (
        status, locked_until, updated_at)
    WHERE status IN ('PENDING', 'UNCERTAIN');
