ALTER TABLE users
    ADD COLUMN IF NOT EXISTS permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS permissions_customized BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS shop_scope TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS conversation_scope TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS system_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET system_admin = TRUE
WHERE id = (
    SELECT id
    FROM users
    WHERE role = 'admin'
    ORDER BY created_at ASC, id ASC
    LIMIT 1
)
AND NOT EXISTS (SELECT 1 FROM users WHERE system_admin = TRUE);

CREATE TABLE IF NOT EXISTS account_audit_logs (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    changes JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_audit_logs_target_created
    ON account_audit_logs (target_user_id, created_at DESC);
