UPDATE users
SET data_scopes = jsonb_build_object(
        'knowledge', 'all',
        'monitor', 'all',
        'records', 'all',
        'tickets', 'all',
        'orders', 'all',
        'shops', 'all'
    )
WHERE data_scopes IS DISTINCT FROM jsonb_build_object(
        'knowledge', 'all',
        'monitor', 'all',
        'records', 'all',
        'tickets', 'all',
        'orders', 'all',
        'shops', 'all'
    );
