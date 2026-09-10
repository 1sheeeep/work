CREATE TABLE IF NOT EXISTS shop_agents (
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (shop_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_shop_agents_user_id ON shop_agents(user_id);
