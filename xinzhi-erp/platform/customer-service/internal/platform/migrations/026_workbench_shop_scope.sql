ALTER TABLE users
    ADD COLUMN IF NOT EXISTS workbench_shop_scope TEXT NOT NULL DEFAULT 'assigned';
