CREATE TABLE tenant_address_mapping_settings (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_address_mapping_setting_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_address_mapping_setting_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_address_mapping_setting_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_address_mapping_setting_display_name CHECK (
        updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_address_mapping_setting_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_address_mapping_setting_version CHECK (version >= 0),
    CONSTRAINT ck_address_mapping_setting_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE tenant_address_mappings (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    platform VARCHAR(32) NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    address_type VARCHAR(32) NOT NULL,
    source_value VARCHAR(120) NOT NULL,
    source_key VARCHAR(120) NOT NULL,
    mapped_value VARCHAR(120) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_address_mapping_id_tenant UNIQUE (id, tenant_id),
    CONSTRAINT fk_address_mapping_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_address_mapping_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_address_mapping_platform CHECK (platform = 'SHOPIFY'),
    CONSTRAINT ck_address_mapping_country CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT ck_address_mapping_type CHECK (address_type IN ('PROVINCE', 'CITY')),
    CONSTRAINT ck_address_mapping_values CHECK (
        source_value = btrim(source_value)
        AND source_key = btrim(source_key)
        AND mapped_value = btrim(mapped_value)
        AND char_length(source_value) BETWEEN 1 AND 120
        AND char_length(source_key) BETWEEN 1 AND 120
        AND char_length(mapped_value) BETWEEN 1 AND 120
        AND source_value !~ '[[:cntrl:]]'
        AND source_key !~ '[[:cntrl:]]'
        AND mapped_value !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_address_mapping_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_address_mapping_display_name CHECK (
        updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_address_mapping_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_address_mapping_version CHECK (version >= 0),
    CONSTRAINT ck_address_mapping_timestamps CHECK (
        updated_at >= created_at
        AND (deleted_at IS NULL OR deleted_at >= created_at)
    )
);

CREATE UNIQUE INDEX uq_address_mapping_active_source
    ON tenant_address_mappings (
        tenant_id, platform, country_code, address_type, source_key
    ) WHERE deleted_at IS NULL;

CREATE INDEX ix_address_mapping_tenant_filter
    ON tenant_address_mappings (
        tenant_id, platform, country_code, address_type, updated_at DESC, id
    ) WHERE deleted_at IS NULL;
