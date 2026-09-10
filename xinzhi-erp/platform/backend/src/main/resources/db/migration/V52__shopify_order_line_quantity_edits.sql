INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '52000000-0000-0000-0000-000000000001',
    'orders.shopify_edit.write',
    'orders',
    '编辑 Shopify 订单商品',
    '修改租户店铺的 Shopify 未履约订单商品数量'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'orders.shopify_edit.write'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_shopify_order_line_edit_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(100) NOT NULL,
    shop_id UUID NOT NULL,
    order_id UUID NOT NULL,
    order_line_id UUID NOT NULL,
    external_order_ref VARCHAR(160) NOT NULL,
    external_line_ref VARCHAR(160) NOT NULL,
    external_variant_ref VARCHAR(160) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    expected_quantity INTEGER NOT NULL,
    requested_quantity INTEGER NOT NULL,
    restock BOOLEAN NOT NULL,
    notify_customer BOOLEAN NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    response_quantity INTEGER,
    response_total_minor BIGINT,
    response_currency CHAR(3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_line_edit_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shopify_line_edit_order FOREIGN KEY (tenant_id, order_id)
        REFERENCES tenant_orders (tenant_id, id),
    CONSTRAINT fk_shopify_line_edit_line FOREIGN KEY (tenant_id, order_line_id)
        REFERENCES tenant_order_lines (tenant_id, id),
    CONSTRAINT ck_shopify_line_edit_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_shopify_line_edit_order_ref CHECK (
        external_order_ref ~ '^gid://shopify/Order/[0-9]+$'),
    CONSTRAINT ck_shopify_line_edit_line_ref CHECK (
        external_line_ref ~ '^gid://shopify/LineItem/[0-9]+$'),
    CONSTRAINT ck_shopify_line_edit_variant_ref CHECK (
        external_variant_ref ~ '^gid://shopify/ProductVariant/[0-9]+$'),
    CONSTRAINT ck_shopify_line_edit_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_shopify_line_edit_quantities CHECK (
        expected_quantity BETWEEN 1 AND 100000
        AND requested_quantity BETWEEN 0 AND 100000
        AND expected_quantity <> requested_quantity
        AND (NOT restock OR requested_quantity < expected_quantity)),
    CONSTRAINT ck_shopify_line_edit_status CHECK (
        status IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')),
    CONSTRAINT ck_shopify_line_edit_attempts CHECK (attempt_count > 0),
    CONSTRAINT ck_shopify_line_edit_completion CHECK (
        (status = 'SUCCEEDED'
            AND response_quantity = requested_quantity
            AND response_total_minor IS NOT NULL
            AND response_total_minor >= 0
            AND response_currency ~ '^[A-Z]{3}$'
            AND completed_at IS NOT NULL
            AND safe_error_code IS NULL)
        OR (status <> 'SUCCEEDED'
            AND response_quantity IS NULL
            AND response_total_minor IS NULL
            AND response_currency IS NULL
            AND completed_at IS NULL))
);

CREATE UNIQUE INDEX uq_shopify_line_edit_active_line
    ON tenant_shopify_order_line_edit_commands (tenant_id, order_line_id)
    WHERE status IN ('PENDING', 'UNCERTAIN');

CREATE INDEX idx_shopify_line_edit_recovery
    ON tenant_shopify_order_line_edit_commands (status, locked_until, updated_at)
    WHERE status IN ('PENDING', 'UNCERTAIN');
