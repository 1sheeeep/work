CREATE TABLE tenant_order_exception_category_sets (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    revision BIGINT NOT NULL DEFAULT 0,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_order_exception_set_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_order_exception_set_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_order_exception_set_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_order_exception_set_display_name CHECK (
        updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_order_exception_set_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_order_exception_set_revision CHECK (revision >= 0),
    CONSTRAINT ck_order_exception_set_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE tenant_order_exception_categories (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenant_order_exception_category_sets(tenant_id)
        ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    name_key VARCHAR(80) NOT NULL,
    handling_guidance VARCHAR(240),
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order INTEGER NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_order_exception_category_name UNIQUE (tenant_id, name_key),
    CONSTRAINT uq_order_exception_category_order UNIQUE (tenant_id, sort_order),
    CONSTRAINT fk_order_exception_category_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_order_exception_category_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_order_exception_category_name CHECK (
        name = btrim(name)
        AND name_key = lower(name_key)
        AND char_length(name) BETWEEN 1 AND 80
        AND char_length(name_key) BETWEEN 1 AND 80
        AND name !~ '[[:cntrl:]]'
        AND name_key !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_order_exception_category_guidance CHECK (
        handling_guidance IS NULL OR (
            handling_guidance = btrim(handling_guidance)
            AND char_length(handling_guidance) BETWEEN 1 AND 240
            AND handling_guidance !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT ck_order_exception_category_order CHECK (sort_order BETWEEN 0 AND 49),
    CONSTRAINT ck_order_exception_category_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_order_exception_category_timestamps CHECK (updated_at >= created_at)
);

CREATE INDEX ix_order_exception_categories_tenant_enabled
    ON tenant_order_exception_categories (tenant_id, enabled, sort_order);
