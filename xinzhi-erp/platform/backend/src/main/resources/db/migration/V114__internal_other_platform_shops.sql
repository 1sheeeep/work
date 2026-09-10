INSERT INTO platform_catalog (code, display_name, description, status)
SELECT 'OTHER', '其他平台', 'ERP 内部店铺，无需绑定外部平台', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1
    FROM platform_catalog
    WHERE code = 'OTHER'
);

UPDATE platform_catalog
SET display_name = '其他平台',
    description = 'ERP 内部店铺，无需绑定外部平台',
    status = 'ACTIVE',
    updated_at = now(),
    version = version + 1
WHERE code = 'OTHER'
  AND (
      display_name <> '其他平台'
      OR description IS DISTINCT FROM 'ERP 内部店铺，无需绑定外部平台'
      OR status <> 'ACTIVE'
  );

ALTER TABLE shop_authorizations
    DROP CONSTRAINT ck_shop_authorizations_status;

ALTER TABLE shop_authorizations
    ADD CONSTRAINT ck_shop_authorizations_status
        CHECK (status IN (
            'NOT_REQUIRED', 'NOT_AUTHORIZED', 'PENDING', 'AUTHORIZED',
            'EXPIRED', 'REVOKED', 'ERROR'
        ));

UPDATE shop_authorizations AS target_authorization
SET status = 'NOT_REQUIRED',
    updated_at = now(),
    version = target_authorization.version + 1
FROM tenant_shops shop
JOIN platform_catalog platform ON platform.id = shop.platform_id
WHERE target_authorization.tenant_id = shop.tenant_id
  AND target_authorization.shop_id = shop.id
  AND platform.code = 'OTHER'
  AND target_authorization.status = 'NOT_AUTHORIZED'
  AND target_authorization.credential_reference IS NULL;
