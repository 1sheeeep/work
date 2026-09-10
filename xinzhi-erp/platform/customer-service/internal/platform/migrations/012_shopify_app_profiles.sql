CREATE TABLE IF NOT EXISTS shopify_app_profiles (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  shop_domain TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  encrypted_client_secret TEXT NOT NULL,
  encrypted_automation_token TEXT NOT NULL,
  extension_handle TEXT NOT NULL DEFAULT 'xinzhi-chat',
  deploy_status TEXT NOT NULL DEFAULT 'pending',
  deploy_version TEXT NOT NULL DEFAULT '',
  deploy_message TEXT NOT NULL DEFAULT '',
  deployed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_app_profiles_domain ON shopify_app_profiles(shop_domain);
