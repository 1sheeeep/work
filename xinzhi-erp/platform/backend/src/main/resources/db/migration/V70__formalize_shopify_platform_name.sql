UPDATE platform_catalog
SET display_name = 'Shopify',
    updated_at = now(),
    version = version + 1
WHERE code = 'SHOPIFY'
  AND display_name <> 'Shopify';
