-- V83: tenant-scoped custom shipping regions and fee rules.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '83830000-0000-0000-0000-000000000001',
    'logistics.shipping_fee.write',
    'logistics',
    'Manage custom shipping fees',
    'Create and archive tenant shipping regions and fee rules'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'logistics.shipping_fee.write'
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_shipping_fee_regions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    name VARCHAR(100) NOT NULL,
    country_code CHAR(2) NOT NULL,
    city VARCHAR(100),
    postal_code_prefix VARCHAR(32),
    note VARCHAR(500),
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_shipping_fee_regions_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_shipping_fee_regions_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_shipping_fee_regions_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_shipping_fee_regions_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_shipping_fee_regions_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_shipping_fee_regions_name CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_shipping_fee_regions_country CHECK (
        country_code ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT ck_shipping_fee_regions_optional CHECK (
        (city IS NULL OR (city = btrim(city) AND char_length(city) BETWEEN 1 AND 100))
        AND (postal_code_prefix IS NULL OR (
            postal_code_prefix = btrim(postal_code_prefix)
            AND char_length(postal_code_prefix) BETWEEN 1 AND 32
        ))
        AND (note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 500))
    ),
    CONSTRAINT ck_shipping_fee_regions_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_shipping_fee_regions_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_shipping_fee_regions_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_shipping_fee_regions_display_name CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_shipping_fee_regions_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_shipping_fee_regions_version CHECK (version >= 0),
    CONSTRAINT ck_shipping_fee_regions_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_shipping_fee_regions_active_name
    ON tenant_shipping_fee_regions (tenant_id, lower(name))
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_shipping_fee_regions_list
    ON tenant_shipping_fee_regions (
        tenant_id, lifecycle_status, updated_at DESC, id DESC
    );

CREATE TABLE tenant_shipping_fee_rules (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    region_id UUID NOT NULL,
    name VARCHAR(100) NOT NULL,
    minimum_weight_grams BIGINT NOT NULL,
    maximum_weight_grams BIGINT,
    base_fee_minor BIGINT NOT NULL,
    per_kilogram_fee_minor BIGINT NOT NULL,
    other_fee_minor BIGINT NOT NULL DEFAULT 0,
    currency_code CHAR(3) NOT NULL,
    note VARCHAR(500),
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_shipping_fee_rules_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_shipping_fee_rules_region
        FOREIGN KEY (tenant_id, region_id)
        REFERENCES tenant_shipping_fee_regions (tenant_id, id),
    CONSTRAINT fk_shipping_fee_rules_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_shipping_fee_rules_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_shipping_fee_rules_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_shipping_fee_rules_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_shipping_fee_rules_name CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 100
    ),
    CONSTRAINT ck_shipping_fee_rules_weight CHECK (
        minimum_weight_grams >= 0
        AND (maximum_weight_grams IS NULL
             OR maximum_weight_grams >= minimum_weight_grams)
    ),
    CONSTRAINT ck_shipping_fee_rules_amounts CHECK (
        base_fee_minor >= 0 AND per_kilogram_fee_minor >= 0
        AND other_fee_minor >= 0
    ),
    CONSTRAINT ck_shipping_fee_rules_currency CHECK (
        currency_code ~ '^[A-Z]{3}$'
    ),
    CONSTRAINT ck_shipping_fee_rules_optional CHECK (
        note IS NULL OR (note = btrim(note) AND char_length(note) BETWEEN 1 AND 500)
    ),
    CONSTRAINT ck_shipping_fee_rules_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_shipping_fee_rules_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_shipping_fee_rules_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_shipping_fee_rules_display_name CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
    ),
    CONSTRAINT ck_shipping_fee_rules_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_shipping_fee_rules_version CHECK (version >= 0),
    CONSTRAINT ck_shipping_fee_rules_timestamps CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX uq_shipping_fee_rules_active_name
    ON tenant_shipping_fee_rules (tenant_id, region_id, lower(name))
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_shipping_fee_rules_list
    ON tenant_shipping_fee_rules (
        tenant_id, lifecycle_status, updated_at DESC, id DESC
    );
