CREATE TABLE tenant_shopify_order_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(100) NOT NULL,
    command_type VARCHAR(64) NOT NULL,
    order_id UUID NOT NULL,
    shop_id UUID NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    response_version BIGINT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_order_commands_order
        FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_shopify_order_commands_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_shopify_order_commands_type CHECK (
        command_type IN ('ORDER_SHIPPING_ADDRESS_UPDATE')
    ),
    CONSTRAINT ck_shopify_order_commands_status CHECK (
        status IN ('PENDING', 'SUCCEEDED', 'FAILED')
    ),
    CONSTRAINT ck_shopify_order_commands_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
    ),
    CONSTRAINT ck_shopify_order_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_shopify_order_commands_attempts CHECK (attempt_count > 0),
    CONSTRAINT ck_shopify_order_commands_completion CHECK (
        (status = 'SUCCEEDED' AND response_version IS NOT NULL
            AND completed_at IS NOT NULL AND safe_error_code IS NULL)
        OR (status <> 'SUCCEEDED' AND response_version IS NULL
            AND completed_at IS NULL)
    )
);

CREATE INDEX idx_shopify_order_commands_order
    ON tenant_shopify_order_commands (tenant_id, order_id, created_at DESC);

CREATE INDEX idx_shopify_order_commands_recovery
    ON tenant_shopify_order_commands (status, locked_until, updated_at)
    WHERE status = 'PENDING';
