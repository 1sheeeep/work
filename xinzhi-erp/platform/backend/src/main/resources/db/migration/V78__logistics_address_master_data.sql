INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '78000000-0000-0000-0000-000000000001',
    'logistics.address.write',
    'logistics',
    '管理物流地址',
    '新增、编辑和停用租户内物流地址主数据'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'logistics.address.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    address_type VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL,
    contact_name VARCHAR(160) NOT NULL,
    contact_email VARCHAR(254),
    country_code VARCHAR(2) NOT NULL,
    province VARCHAR(120),
    city VARCHAR(120),
    district VARCHAR(120),
    address_line1 VARCHAR(300) NOT NULL,
    postal_code VARCHAR(32),
    landline VARCHAR(40),
    mobile VARCHAR(40),
    company_name VARCHAR(200),
    fax VARCHAR(40),
    lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_logistics_addresses_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_logistics_addresses_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_logistics_addresses_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_logistics_addresses_type CHECK (
        address_type IN ('RECEIVING_TRANSIT', 'PLATFORM_SHIPPING', 'SHIPPING')
    ),
    CONSTRAINT ck_tenant_logistics_addresses_name CHECK (
        name = btrim(name) AND char_length(name) BETWEEN 1 AND 160
        AND name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_logistics_addresses_contact_name CHECK (
        contact_name = btrim(contact_name)
        AND char_length(contact_name) BETWEEN 1 AND 160
        AND contact_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_logistics_addresses_email CHECK (
        contact_email IS NULL OR (
            contact_email = lower(btrim(contact_email))
            AND char_length(contact_email) BETWEEN 3 AND 254
            AND contact_email !~ '[[:cntrl:]]'
        )
    ),
    CONSTRAINT ck_tenant_logistics_addresses_country CHECK (
        country_code ~ '^[A-Z]{2}$'
    ),
    CONSTRAINT ck_tenant_logistics_addresses_address CHECK (
        address_line1 = btrim(address_line1)
        AND char_length(address_line1) BETWEEN 1 AND 300
        AND address_line1 !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_logistics_addresses_optional_text CHECK (
        (province IS NULL OR (province = btrim(province) AND char_length(province) BETWEEN 1 AND 120 AND province !~ '[[:cntrl:]]'))
        AND (city IS NULL OR (city = btrim(city) AND char_length(city) BETWEEN 1 AND 120 AND city !~ '[[:cntrl:]]'))
        AND (district IS NULL OR (district = btrim(district) AND char_length(district) BETWEEN 1 AND 120 AND district !~ '[[:cntrl:]]'))
        AND (postal_code IS NULL OR (postal_code = btrim(postal_code) AND char_length(postal_code) BETWEEN 1 AND 32 AND postal_code !~ '[[:cntrl:]]'))
        AND (landline IS NULL OR (landline = btrim(landline) AND char_length(landline) BETWEEN 1 AND 40 AND landline !~ '[[:cntrl:]]'))
        AND (mobile IS NULL OR (mobile = btrim(mobile) AND char_length(mobile) BETWEEN 1 AND 40 AND mobile !~ '[[:cntrl:]]'))
        AND (company_name IS NULL OR (company_name = btrim(company_name) AND char_length(company_name) BETWEEN 1 AND 200 AND company_name !~ '[[:cntrl:]]'))
        AND (fax IS NULL OR (fax = btrim(fax) AND char_length(fax) BETWEEN 1 AND 40 AND fax !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_tenant_logistics_addresses_status CHECK (
        lifecycle_status IN ('ACTIVE', 'ARCHIVED')
    ),
    CONSTRAINT ck_tenant_logistics_addresses_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_tenant_logistics_addresses_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_tenant_logistics_addresses_version CHECK (version >= 0)
);

CREATE UNIQUE INDEX uq_tenant_logistics_addresses_active_name
    ON tenant_logistics_addresses (tenant_id, address_type, lower(name))
    WHERE lifecycle_status = 'ACTIVE';

CREATE INDEX idx_tenant_logistics_addresses_list
    ON tenant_logistics_addresses (
        tenant_id, address_type, lifecycle_status, updated_at DESC, id DESC
    );
