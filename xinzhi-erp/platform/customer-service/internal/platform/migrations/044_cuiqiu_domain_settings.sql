CREATE TABLE IF NOT EXISTS cuiqiu_domain_settings (
  domain TEXT PRIMARY KEY,
  api_base TEXT NOT NULL,
  encrypted_token TEXT NOT NULL,
  domain_id TEXT NOT NULL DEFAULT '',
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  smtp_mode TEXT NOT NULL,
  last_tested_at TIMESTAMPTZ NULL,
  last_test_ok BOOLEAN NOT NULL DEFAULT FALSE,
  last_test_error TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL
);
