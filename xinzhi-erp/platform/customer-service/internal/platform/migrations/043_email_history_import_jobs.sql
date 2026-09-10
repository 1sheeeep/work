CREATE TABLE IF NOT EXISTS email_history_import_jobs (
  source_id TEXT PRIMARY KEY REFERENCES shop_sources(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  status TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  pages_processed INTEGER NOT NULL DEFAULT 0,
  messages_scanned INTEGER NOT NULL DEFAULT 0,
  messages_imported INTEGER NOT NULL DEFAULT 0,
  messages_skipped INTEGER NOT NULL DEFAULT 0,
  filtered_messages INTEGER NOT NULL DEFAULT 0,
  conversations_created INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_history_import_jobs_status_check
    CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_email_history_import_jobs_shop_id
  ON email_history_import_jobs(shop_id);

CREATE INDEX IF NOT EXISTS idx_email_history_import_jobs_status
  ON email_history_import_jobs(status, updated_at);
