-- V89: tenant-scoped logistics inquiry, contact, and quote workflow.

INSERT INTO permissions (id, code, module, name, description)
VALUES (
    '89890000-0000-0000-0000-000000000001',
    'logistics.inquiry.write',
    'logistics',
    'Manage logistics inquiries',
    'Maintain logistics inquiry contacts, demands, quotes, and lifecycle'
)
ON CONFLICT (code) DO UPDATE SET
    module = EXCLUDED.module,
    name = EXCLUDED.name,
    description = EXCLUDED.description;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code = 'logistics.inquiry.write'
WHERE role.system_role = true AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_logistics_inquiry_contacts (
    tenant_id UUID PRIMARY KEY REFERENCES tenants (id),
    contact_name VARCHAR(100) NOT NULL,
    contact_phone VARCHAR(40) NOT NULL,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_logistics_inquiry_contact_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_inquiry_contact_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_inquiry_contact_text CHECK (
        contact_name = btrim(contact_name)
        AND char_length(contact_name) BETWEEN 1 AND 100
        AND contact_name !~ '[[:cntrl:]]'
        AND contact_phone = btrim(contact_phone)
        AND char_length(contact_phone) BETWEEN 5 AND 40
        AND contact_phone ~ '^[0-9+() -]+$'
    ),
    CONSTRAINT ck_logistics_inquiry_contact_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_inquiry_contact_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_inquiry_contact_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_inquiry_contact_timestamps CHECK (updated_at >= created_at)
);

CREATE TABLE tenant_logistics_inquiries (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    inquiry_no VARCHAR(40) NOT NULL,
    origin VARCHAR(160) NOT NULL,
    destination VARCHAR(240) NOT NULL,
    weekly_order_count INTEGER NOT NULL,
    weekly_weight_kg NUMERIC(12, 3) NOT NULL,
    category VARCHAR(120) NOT NULL,
    contact_name VARCHAR(100) NOT NULL,
    contact_phone VARCHAR(40) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'BIDDING',
    note VARCHAR(500),
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_logistics_inquiries_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT uq_logistics_inquiries_no UNIQUE (tenant_id, inquiry_no),
    CONSTRAINT fk_logistics_inquiry_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_inquiry_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_inquiry_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_inquiry_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_inquiry_text CHECK (
        inquiry_no = btrim(inquiry_no)
        AND inquiry_no ~ '^LI-[0-9]{8}-[A-Z0-9]{6}$'
        AND origin = btrim(origin)
        AND char_length(origin) BETWEEN 1 AND 160
        AND origin !~ '[[:cntrl:]]'
        AND destination = btrim(destination)
        AND char_length(destination) BETWEEN 1 AND 240
        AND destination !~ '[[:cntrl:]]'
        AND category = btrim(category)
        AND char_length(category) BETWEEN 1 AND 120
        AND category !~ '[[:cntrl:]]'
        AND contact_name = btrim(contact_name)
        AND char_length(contact_name) BETWEEN 1 AND 100
        AND contact_name !~ '[[:cntrl:]]'
        AND contact_phone = btrim(contact_phone)
        AND char_length(contact_phone) BETWEEN 5 AND 40
        AND contact_phone ~ '^[0-9+() -]+$'
        AND created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND (note IS NULL OR (
            note = btrim(note)
            AND char_length(note) BETWEEN 1 AND 500
            AND note !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_logistics_inquiry_quantity CHECK (
        weekly_order_count BETWEEN 1 AND 1000000
        AND weekly_weight_kg BETWEEN 0.001 AND 999999999.999
    ),
    CONSTRAINT ck_logistics_inquiry_status CHECK (
        status IN ('BIDDING', 'PAUSED', 'COMPLETED', 'CANCELLED')
    ),
    CONSTRAINT ck_logistics_inquiry_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_inquiry_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_inquiry_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_inquiry_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_inquiry_timestamps CHECK (
        updated_at >= created_at AND published_at >= created_at
    )
);

CREATE INDEX idx_logistics_inquiries_list
    ON tenant_logistics_inquiries (tenant_id, status, published_at DESC, id DESC);

CREATE TABLE tenant_logistics_inquiry_quotes (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    inquiry_id UUID NOT NULL,
    provider_name VARCHAR(120) NOT NULL,
    service_name VARCHAR(120) NOT NULL,
    price_per_kg NUMERIC(18, 4) NOT NULL,
    currency CHAR(3) NOT NULL,
    transit_days INTEGER NOT NULL,
    note VARCHAR(500),
    status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    created_by_display_name VARCHAR(160) NOT NULL,
    created_by_user_id UUID,
    created_by_system_admin_id UUID,
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    request_id VARCHAR(100) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_logistics_inquiry_quotes_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_logistics_inquiry_quote_inquiry
        FOREIGN KEY (tenant_id, inquiry_id)
        REFERENCES tenant_logistics_inquiries (tenant_id, id),
    CONSTRAINT fk_logistics_inquiry_quote_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_inquiry_quote_created_admin
        FOREIGN KEY (created_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT fk_logistics_inquiry_quote_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_inquiry_quote_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT ck_logistics_inquiry_quote_text CHECK (
        provider_name = btrim(provider_name)
        AND char_length(provider_name) BETWEEN 1 AND 120
        AND provider_name !~ '[[:cntrl:]]'
        AND service_name = btrim(service_name)
        AND char_length(service_name) BETWEEN 1 AND 120
        AND service_name !~ '[[:cntrl:]]'
        AND currency ~ '^[A-Z]{3}$'
        AND created_by_display_name = btrim(created_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND (note IS NULL OR (
            note = btrim(note)
            AND char_length(note) BETWEEN 1 AND 500
            AND note !~ '[[:cntrl:]]'))
    ),
    CONSTRAINT ck_logistics_inquiry_quote_values CHECK (
        price_per_kg BETWEEN 0 AND 99999999999999.9999
        AND transit_days BETWEEN 1 AND 365
    ),
    CONSTRAINT ck_logistics_inquiry_quote_status CHECK (
        status IN ('ACTIVE', 'WITHDRAWN')
    ),
    CONSTRAINT ck_logistics_inquiry_quote_created_actor CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_inquiry_quote_updated_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_inquiry_quote_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_logistics_inquiry_quote_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_inquiry_quote_timestamps CHECK (updated_at >= created_at)
);

CREATE INDEX idx_logistics_inquiry_quotes_list
    ON tenant_logistics_inquiry_quotes (
        tenant_id, inquiry_id, status, price_per_kg, created_at, id
    );
