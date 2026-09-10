CREATE TABLE IF NOT EXISTS shopify_installations (
  shop_domain TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  installed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_installations_shop_id ON shopify_installations(shop_id);
