CREATE TABLE IF NOT EXISTS email_outbox (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES shop_sources(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  client_request_id TEXT NOT NULL,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  body TEXT NOT NULL,
  request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  provider_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT NOT NULL DEFAULT '',
  message_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ NULL,
  CONSTRAINT email_outbox_status_check CHECK (status IN ('pending', 'sending', 'sent', 'completed', 'failed', 'ambiguous')),
  UNIQUE (conversation_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_email_outbox_status_updated
  ON email_outbox(status, updated_at);

