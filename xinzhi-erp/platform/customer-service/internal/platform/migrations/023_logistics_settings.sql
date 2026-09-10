CREATE TABLE IF NOT EXISTS logistics_settings (
    id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    base_url TEXT NOT NULL DEFAULT 'https://api.17track.net/track/v2.4',
    encrypted_key TEXT NOT NULL DEFAULT '',
    last_tested_at TIMESTAMPTZ,
    last_test_ok BOOLEAN NOT NULL DEFAULT FALSE,
    last_test_error TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
