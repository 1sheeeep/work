CREATE TABLE IF NOT EXISTS email_installations (
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  mailbox TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'outlook',
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL,
  installed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (shop_id, mailbox)
);

CREATE INDEX IF NOT EXISTS idx_email_installations_shop_id ON email_installations(shop_id);
