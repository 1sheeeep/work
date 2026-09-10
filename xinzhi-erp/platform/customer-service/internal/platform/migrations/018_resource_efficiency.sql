CREATE TABLE IF NOT EXISTS external_cache (
    cache_key TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,
    shop_id TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    fetched_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_external_cache_namespace_shop_expiry
ON external_cache(namespace, shop_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_conversations_monitor_status_updated
ON conversations(status, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_conversations_monitor_agent_status
ON conversations(assigned_agent_id, status, updated_at DESC, id);
