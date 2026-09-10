CREATE TABLE tenant_system_general_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    default_currency VARCHAR(3) NOT NULL,
    order_pull_blackout_start TIME,
    order_pull_blackout_end TIME,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_system_general_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_system_general_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_system_general_currency CHECK (default_currency ~ '^[A-Z]{3}$'),
    CONSTRAINT ck_system_general_blackout CHECK (
        (order_pull_blackout_start IS NULL AND order_pull_blackout_end IS NULL)
        OR (order_pull_blackout_start IS NOT NULL
            AND order_pull_blackout_end IS NOT NULL
            AND order_pull_blackout_start <> order_pull_blackout_end)
    ),
    CONSTRAINT ck_system_general_display_name CHECK (
        updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_system_general_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_system_general_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_system_general_version CHECK (version >= 0),
    CONSTRAINT ck_system_general_timestamps CHECK (updated_at >= created_at)
);
