CREATE TABLE tenant_shopify_order_cancellation_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(64) NOT NULL,
    shop_id UUID NOT NULL,
    order_id UUID NOT NULL,
    external_order_ref VARCHAR(160) NOT NULL,
    expected_order_version BIGINT NOT NULL,
    expected_profile_version BIGINT NOT NULL,
    cancellation_reason VARCHAR(24) NOT NULL,
    refund_original_payment_methods BOOLEAN NOT NULL,
    restock BOOLEAN NOT NULL,
    notify_customer BOOLEAN NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(64),
    response_cancelled_at TIMESTAMPTZ,
    response_job_id VARCHAR(200),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_order_cancellation_order
        FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_shopify_order_cancellation_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_shopify_order_cancellation_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$'),
    CONSTRAINT ck_shopify_order_cancellation_order_ref CHECK (
        external_order_ref ~ '^gid://shopify/Order/[0-9]+$'),
    CONSTRAINT ck_shopify_order_cancellation_versions CHECK (
        expected_order_version >= 0 AND expected_profile_version >= 0),
    CONSTRAINT ck_shopify_order_cancellation_reason CHECK (
        cancellation_reason IN (
            'CUSTOMER', 'DECLINED', 'FRAUD', 'INVENTORY', 'STAFF', 'OTHER')),
    CONSTRAINT ck_shopify_order_cancellation_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_shopify_order_cancellation_status CHECK (
        status IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')),
    CONSTRAINT ck_shopify_order_cancellation_attempts CHECK (
        attempt_count > 0),
    CONSTRAINT ck_shopify_order_cancellation_completion CHECK (
        (status = 'PENDING'
            AND locked_until IS NOT NULL
            AND safe_error_code IS NULL
            AND response_cancelled_at IS NULL
            AND response_job_id IS NULL
            AND completed_at IS NULL)
        OR (status = 'UNCERTAIN'
            AND locked_until IS NULL
            AND safe_error_code IS NOT NULL
            AND response_cancelled_at IS NULL
            AND response_job_id IS NULL
            AND completed_at IS NULL)
        OR (status = 'SUCCEEDED'
            AND locked_until IS NULL
            AND safe_error_code IS NULL
            AND response_cancelled_at IS NOT NULL
            AND completed_at IS NOT NULL))
);

CREATE INDEX idx_shopify_order_cancellation_active
    ON tenant_shopify_order_cancellation_commands (tenant_id, order_id, status);

CREATE UNIQUE INDEX uq_shopify_order_cancellation_active_request
    ON tenant_shopify_order_cancellation_commands (
        tenant_id, order_id, request_fingerprint)
    WHERE status IN ('PENDING', 'UNCERTAIN');

CREATE INDEX idx_shopify_order_cancellation_recovery
    ON tenant_shopify_order_cancellation_commands (
        status, locked_until, updated_at)
    WHERE status IN ('PENDING', 'UNCERTAIN');
