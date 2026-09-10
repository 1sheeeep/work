CREATE TABLE tenant_enterprise_branding (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    logo_media_type VARCHAR(20),
    logo_content BYTEA,
    watermark_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    watermark_user_name BOOLEAN NOT NULL DEFAULT TRUE,
    watermark_company_name BOOLEAN NOT NULL DEFAULT TRUE,
    watermark_time BOOLEAN NOT NULL DEFAULT TRUE,
    watermark_phone_suffix BOOLEAN NOT NULL DEFAULT FALSE,
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
    CONSTRAINT fk_enterprise_branding_created_user
        FOREIGN KEY (created_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_enterprise_branding_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT ck_enterprise_branding_logo CHECK (
        (logo_content IS NULL AND logo_media_type IS NULL)
        OR (
            logo_content IS NOT NULL
            AND logo_media_type IN ('image/png', 'image/jpeg')
            AND octet_length(logo_content) BETWEEN 1 AND 524288
        )
    ),
    CONSTRAINT ck_enterprise_branding_names CHECK (
        created_by_display_name = btrim(created_by_display_name)
        AND updated_by_display_name = btrim(updated_by_display_name)
        AND char_length(created_by_display_name) BETWEEN 1 AND 160
        AND char_length(updated_by_display_name) BETWEEN 1 AND 160
        AND created_by_display_name !~ '[[:cntrl:]]'
        AND updated_by_display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_enterprise_branding_actors CHECK (
        (created_by_user_id IS NULL) <> (created_by_system_admin_id IS NULL)
        AND (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_enterprise_branding_request CHECK (
        request_id ~ '^[A-Za-z0-9._:-]{1,100}$'
    ),
    CONSTRAINT ck_enterprise_branding_version CHECK (version >= 0),
    CONSTRAINT ck_enterprise_branding_timestamps CHECK (updated_at >= created_at)
);
