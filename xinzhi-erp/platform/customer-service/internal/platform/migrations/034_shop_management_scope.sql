DO $migration$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'users'
          AND column_name = 'shop_scope_ids'
    ) THEN
        ALTER TABLE users
            ADD COLUMN shop_scope_ids JSONB NOT NULL DEFAULT '[]'::jsonb;

        UPDATE users
        SET shop_scope = CASE
            WHEN role = 'admin' THEN 'all'
            ELSE 'assigned'
        END,
        shop_scope_ids = '[]'::jsonb;

        UPDATE users
        SET permissions = permissions
            || CASE WHEN permissions ? 'shops.view' THEN '[]'::jsonb ELSE '["shops.view"]'::jsonb END
            || CASE WHEN permissions ? 'shops.channels.manage' THEN '[]'::jsonb ELSE '["shops.channels.manage"]'::jsonb END
        WHERE role = 'agent'
          AND permissions_customized = TRUE;
    END IF;
END
$migration$;
