INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '80000000-0000-0000-0000-000000000001',
    'settings.enterprise.write',
    'settings',
    '管理企业基础资料',
    '维护租户内公司名称、地区、地址和联系人资料'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission
  ON permission.code = 'settings.enterprise.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_enterprise_profiles (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    company_name VARCHAR(160) NOT NULL,
    province VARCHAR(100),
    city VARCHAR(100),
    district VARCHAR(100),
    detailed_address VARCHAR(500),
    contact_name VARCHAR(160) NOT NULL,
    contact_email VARCHAR(254) NOT NULL,
    contact_qq VARCHAR(20),
    contact_mobile VARCHAR(32) NOT NULL,
    contact_telephone VARCHAR(32),
    created_by_user_id UUID,
    created_by_system_admin_id UUID REFERENCES system_admins(id),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_tenant_enterprise_profiles_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_tenant_enterprise_profiles_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_tenant_enterprise_profiles_company_name CHECK (
        company_name = btrim(company_name)
        AND char_length(company_name) BETWEEN 1 AND 160
        AND company_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_contact_name CHECK (
        contact_name = btrim(contact_name)
        AND char_length(contact_name) BETWEEN 1 AND 160
        AND contact_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_contact_email CHECK (
        contact_email = lower(btrim(contact_email))
        AND char_length(contact_email) BETWEEN 3 AND 254
        AND contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_contact_qq CHECK (
        contact_qq IS NULL OR contact_qq ~ '^[0-9]{5,20}$'
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_contact_mobile CHECK (
        contact_mobile = btrim(contact_mobile)
        AND char_length(contact_mobile) BETWEEN 6 AND 32
        AND contact_mobile ~ '^[+()0-9 .-]+$'
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_contact_telephone CHECK (
        contact_telephone IS NULL OR (
            contact_telephone = btrim(contact_telephone)
            AND char_length(contact_telephone) BETWEEN 6 AND 32
            AND contact_telephone ~ '^[+()0-9 .-]+$'
        )
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_optional_text CHECK (
        (province IS NULL OR (province = btrim(province) AND char_length(province) BETWEEN 1 AND 100 AND province !~ '[[:cntrl:]]'))
        AND (city IS NULL OR (city = btrim(city) AND char_length(city) BETWEEN 1 AND 100 AND city !~ '[[:cntrl:]]'))
        AND (district IS NULL OR (district = btrim(district) AND char_length(district) BETWEEN 1 AND 100 AND district !~ '[[:cntrl:]]'))
        AND (detailed_address IS NULL OR (detailed_address = btrim(detailed_address) AND char_length(detailed_address) BETWEEN 1 AND 500 AND detailed_address !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_tenant_enterprise_profiles_version CHECK (version >= 0),
    CONSTRAINT ck_tenant_enterprise_profiles_timestamps CHECK (updated_at >= created_at)
);
