INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('70000000-0000-0000-0000-000000000001', 'orders.read', 'orders', 'Read orders',
     'Read tenant-scoped offline order master data'),
    ('82000000-0000-0000-0000-000000000002', 'orders.write', 'orders', 'Write orders',
     'Create orders and change tenant-scoped review status')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

CREATE TABLE tenant_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    external_order_ref VARCHAR(160) NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_fingerprint VARCHAR(64) NOT NULL,
    currency VARCHAR(3) NOT NULL,
    buyer_reference VARCHAR(200),
    status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    hold_reason VARCHAR(500),
    line_count INTEGER NOT NULL,
    placed_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_orders_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_orders_tenant_id_currency UNIQUE (tenant_id, id, currency),
    CONSTRAINT uq_tenant_orders_external_ref UNIQUE (tenant_id, shop_id, external_order_ref),
    CONSTRAINT uq_tenant_orders_idempotency UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT fk_tenant_orders_shop FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_tenant_orders_external_ref CHECK (char_length(btrim(external_order_ref)) > 0),
    CONSTRAINT ck_tenant_orders_idempotency_key
        CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_tenant_orders_fingerprint CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_tenant_orders_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_tenant_orders_status CHECK (status IN (
        'RECEIVED', 'REVIEW_PENDING', 'HOLD', 'READY_TO_FULFILL', 'CANCELLED'
    )),
    CONSTRAINT ck_tenant_orders_hold_reason CHECK (
        (status = 'HOLD' AND char_length(btrim(hold_reason)) > 0)
        OR (status <> 'HOLD' AND hold_reason IS NULL)
    ),
    CONSTRAINT ck_tenant_orders_line_count CHECK (line_count BETWEEN 1 AND 200),
    CONSTRAINT ck_tenant_orders_version CHECK (version >= 0)
);

CREATE TABLE tenant_order_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_id UUID NOT NULL,
    sku_id UUID,
    external_line_ref VARCHAR(160) NOT NULL,
    title_snapshot VARCHAR(300) NOT NULL,
    quantity INTEGER NOT NULL,
    unit_price_minor BIGINT NOT NULL,
    currency VARCHAR(3) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_order_lines_external_ref UNIQUE (tenant_id, order_id, external_line_ref),
    CONSTRAINT fk_tenant_order_lines_order FOREIGN KEY (tenant_id, order_id, currency)
        REFERENCES tenant_orders (tenant_id, id, currency),
    CONSTRAINT fk_tenant_order_lines_sku FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT ck_tenant_order_lines_external_ref CHECK (char_length(btrim(external_line_ref)) > 0),
    CONSTRAINT ck_tenant_order_lines_title CHECK (char_length(btrim(title_snapshot)) > 0),
    CONSTRAINT ck_tenant_order_lines_quantity CHECK (quantity > 0),
    CONSTRAINT ck_tenant_order_lines_unit_price CHECK (unit_price_minor >= 0),
    CONSTRAINT ck_tenant_order_lines_currency CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX idx_tenant_orders_list
    ON tenant_orders (tenant_id, placed_at DESC, id DESC);
CREATE INDEX idx_tenant_orders_shop_status
    ON tenant_orders (tenant_id, shop_id, status, placed_at DESC, id DESC);
CREATE INDEX idx_tenant_order_lines_order
    ON tenant_order_lines (tenant_id, order_id, external_line_ref, id);
CREATE INDEX idx_tenant_order_lines_unmatched
    ON tenant_order_lines (tenant_id, order_id)
    WHERE sku_id IS NULL;
