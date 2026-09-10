INSERT INTO platform_catalog (code, display_name, status)
SELECT 'SHOPIFY', 'Shopify', 'ACTIVE'
WHERE NOT EXISTS (
    SELECT 1
    FROM platform_catalog
    WHERE code = 'SHOPIFY'
);

UPDATE platform_catalog
SET display_name = 'Shopify',
    status = 'ACTIVE',
    updated_at = now(),
    version = version + 1
WHERE code = 'SHOPIFY'
  AND (display_name <> 'Shopify' OR status <> 'ACTIVE');
