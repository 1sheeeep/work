ALTER TABLE tenant_enterprise_branding
    DROP CONSTRAINT IF EXISTS ck_enterprise_branding_logo,
    DROP COLUMN IF EXISTS logo_content,
    DROP COLUMN IF EXISTS logo_media_type;
