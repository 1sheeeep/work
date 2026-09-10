CREATE TABLE tenant_shopify_inventory_publications (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    balance_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    warehouse_id UUID NOT NULL,
    external_inventory_item_ref VARCHAR(160) NOT NULL,
    external_location_ref VARCHAR(160) NOT NULL,
    expected_balance_version BIGINT NOT NULL,
    expected_shopify_available INTEGER NOT NULL,
    target_available INTEGER NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    provider_updated_at TIMESTAMPTZ,
    actor_user_id UUID,
    actor_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100),
    source_ip VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_shopify_inventory_publication_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_shopify_inventory_publication_key
        UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_inventory_publication_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT fk_shopify_inventory_publication_balance
        FOREIGN KEY (tenant_id, balance_id)
        REFERENCES inventory_balances (tenant_id, id),
    CONSTRAINT fk_shopify_inventory_publication_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_shopify_inventory_publication_warehouse
        FOREIGN KEY (tenant_id, warehouse_id)
        REFERENCES tenant_warehouses (tenant_id, id),
    CONSTRAINT fk_shopify_inventory_publication_actor_user
        FOREIGN KEY (actor_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_shopify_inventory_publication_inventory_ref CHECK (
        external_inventory_item_ref ~ '^gid://shopify/InventoryItem/[0-9]+$'),
    CONSTRAINT ck_shopify_inventory_publication_location_ref CHECK (
        external_location_ref ~ '^gid://shopify/Location/[0-9]+$'),
    CONSTRAINT ck_shopify_inventory_publication_quantity CHECK (
        expected_shopify_available BETWEEN -1000000000 AND 1000000000
        AND target_available BETWEEN -1000000000 AND 1000000000),
    CONSTRAINT ck_shopify_inventory_publication_version CHECK (
        expected_balance_version >= 0),
    CONSTRAINT ck_shopify_inventory_publication_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'),
    CONSTRAINT ck_shopify_inventory_publication_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_shopify_inventory_publication_status CHECK (
        status IN ('QUEUED', 'PROCESSING', 'APPLIED', 'STALE',
                   'REJECTED', 'UNCERTAIN')),
    CONSTRAINT ck_shopify_inventory_publication_attempts CHECK (
        attempt_count >= 0),
    CONSTRAINT ck_shopify_inventory_publication_actor CHECK (
        (actor_user_id IS NULL) <> (actor_system_admin_id IS NULL)),
    CONSTRAINT ck_shopify_inventory_publication_completion CHECK (
        (status IN ('APPLIED', 'STALE', 'REJECTED')
            AND completed_at IS NOT NULL AND locked_until IS NULL)
        OR (status NOT IN ('APPLIED', 'STALE', 'REJECTED')
            AND completed_at IS NULL))
);

CREATE UNIQUE INDEX uq_shopify_inventory_publication_active_balance
    ON tenant_shopify_inventory_publications (tenant_id, shop_id, balance_id)
    WHERE status IN ('QUEUED', 'PROCESSING', 'UNCERTAIN');

CREATE INDEX idx_shopify_inventory_publication_claim
    ON tenant_shopify_inventory_publications
        (available_at, created_at, id)
    WHERE status IN ('QUEUED', 'PROCESSING', 'UNCERTAIN');

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    'a3000000-0000-0000-0000-000000000012',
    'inventory.shopify.publish',
    'inventory',
    'Publish Shopify inventory',
    'Queue and inspect compare-and-set Shopify inventory publications')
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;
