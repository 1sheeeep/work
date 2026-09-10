ALTER TABLE users
    ADD COLUMN IF NOT EXISTS data_scopes JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE users
SET data_scopes = CASE
    WHEN system_admin THEN jsonb_build_object(
        'knowledge', 'all',
        'monitor', 'all',
        'records', 'all',
        'tickets', 'all',
        'orders', 'all',
        'shops', 'all'
    )
    ELSE jsonb_build_object(
        'knowledge', 'assigned',
        'monitor', 'assigned',
        'records', 'assigned',
        'tickets', 'assigned',
        'orders', 'assigned',
        'shops', 'assigned'
    )
END
WHERE data_scopes = '{}'::jsonb;
