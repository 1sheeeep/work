ALTER TABLE users
    ADD COLUMN IF NOT EXISTS shop_scope_configured BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET shop_scope = 'assigned',
    shop_scope_ids = '[]'::jsonb
WHERE role = 'agent'
  AND shop_scope_configured = FALSE;

UPDATE users
SET shop_scope = 'all',
    shop_scope_ids = '[]'::jsonb
WHERE role = 'admin'
  AND shop_scope_configured = FALSE;
