CREATE TABLE IF NOT EXISTS ai_settings (
  id TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  base_url TEXT NOT NULL,
  model TEXT NOT NULL,
  encrypted_key TEXT NOT NULL DEFAULT '',
  last_tested_at TIMESTAMPTZ NULL,
  last_test_ok BOOLEAN NOT NULL DEFAULT FALSE,
  last_test_error TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL
);
