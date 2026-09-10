CREATE TABLE tenant_product_supply_prices (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    sku_type VARCHAR(24) NOT NULL,
    sku_id UUID,
    bundle_id UUID,
    sales_country CHAR(2) NOT NULL,
    currency CHAR(3) NOT NULL,
    unit_price NUMERIC(19, 4) NOT NULL,
    minimum_quantity INTEGER NOT NULL DEFAULT 1,
    valid_from DATE NOT NULL,
    valid_to DATE,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    note VARCHAR(500),
    created_by_display_name VARCHAR(160) NOT NULL,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_product_supply_price_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_product_supply_price_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT fk_product_supply_price_bundle
        FOREIGN KEY (tenant_id, bundle_id)
        REFERENCES tenant_product_bundles (tenant_id, id),
    CONSTRAINT fk_product_supply_price_created_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_product_supply_price_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_product_supply_price_reference CHECK (
        (sku_type = 'INVENTORY' AND sku_id IS NOT NULL AND bundle_id IS NULL)
        OR (sku_type = 'BUNDLE' AND sku_id IS NULL AND bundle_id IS NOT NULL)
    ),
    CONSTRAINT ck_product_supply_price_country CHECK (
        sales_country ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT ck_product_supply_price_currency CHECK (
        currency ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_product_supply_price_amount CHECK (
        unit_price > 0 AND unit_price <= 999999999999999.9999
    ),
    CONSTRAINT ck_product_supply_price_minimum CHECK (
        minimum_quantity BETWEEN 1 AND 1000000
    ),
    CONSTRAINT ck_product_supply_price_dates CHECK (
        valid_to IS NULL OR valid_to >= valid_from
    ),
    CONSTRAINT ck_product_supply_price_status CHECK (
        status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_product_supply_price_note CHECK (
        note IS NULL OR (
            note = btrim(note)
            AND char_length(note) BETWEEN 1 AND 500
            AND note !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT ck_product_supply_price_display_names CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND created_by_display_name !~ '[[:cntrl:]]'
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_product_supply_price_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_product_supply_price_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_product_supply_price_version CHECK (version >= 0),
    CONSTRAINT ck_product_supply_price_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_product_supply_price_inventory_period
    ON tenant_product_supply_prices (
        tenant_id, sku_id, sales_country, valid_from
    ) WHERE sku_type = 'INVENTORY' AND status <> 'ARCHIVED';

CREATE UNIQUE INDEX uq_product_supply_price_bundle_period
    ON tenant_product_supply_prices (
        tenant_id, bundle_id, sales_country, valid_from
    ) WHERE sku_type = 'BUNDLE' AND status <> 'ARCHIVED';

CREATE INDEX ix_product_supply_prices_tenant_list
    ON tenant_product_supply_prices (
        tenant_id, status, sales_country, valid_from DESC, id
    );

CREATE INDEX ix_product_supply_prices_inventory
    ON tenant_product_supply_prices (tenant_id, sku_id, status)
    WHERE sku_type = 'INVENTORY';

CREATE INDEX ix_product_supply_prices_bundle
    ON tenant_product_supply_prices (tenant_id, bundle_id, status)
    WHERE sku_type = 'BUNDLE';
