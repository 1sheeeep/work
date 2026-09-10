CREATE TABLE tenant_product_bundles (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    business_code VARCHAR(64) NOT NULL,
    business_code_key VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
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
    CONSTRAINT uq_product_bundle_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_product_bundle_business_code
        UNIQUE (tenant_id, business_code_key),
    CONSTRAINT fk_product_bundle_created_user
        FOREIGN KEY (created_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT fk_product_bundle_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id)
        REFERENCES users (id, tenant_id),
    CONSTRAINT ck_product_bundle_business_code CHECK (
        business_code ~ '^[A-Z][A-Z0-9_-]{1,63}$'
        AND business_code_key = lower(business_code)
    ),
    CONSTRAINT ck_product_bundle_name CHECK (
        name = btrim(name)
        AND char_length(name) BETWEEN 1 AND 200
        AND name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_product_bundle_description CHECK (
        description IS NULL OR (
            description = btrim(description)
            AND char_length(description) BETWEEN 1 AND 1000
            AND description !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT ck_product_bundle_status CHECK (
        status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_product_bundle_display_names CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND created_by_display_name !~ '[[:cntrl:]]'
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_product_bundle_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_product_bundle_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_product_bundle_version CHECK (version >= 0),
    CONSTRAINT ck_product_bundle_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE tenant_product_bundle_components (
    bundle_id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    sku_id UUID NOT NULL,
    quantity INTEGER NOT NULL,
    PRIMARY KEY (bundle_id, sku_id),
    CONSTRAINT fk_product_bundle_component_bundle
        FOREIGN KEY (tenant_id, bundle_id)
        REFERENCES tenant_product_bundles (tenant_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_product_bundle_component_sku
        FOREIGN KEY (tenant_id, sku_id)
        REFERENCES tenant_product_skus (tenant_id, id),
    CONSTRAINT ck_product_bundle_component_quantity CHECK (
        quantity BETWEEN 1 AND 1000000
    )
);

CREATE INDEX ix_product_bundles_tenant_list
    ON tenant_product_bundles (
        tenant_id, status, created_at DESC, business_code, id
    );

CREATE INDEX ix_product_bundle_components_sku
    ON tenant_product_bundle_components (tenant_id, sku_id, bundle_id);
