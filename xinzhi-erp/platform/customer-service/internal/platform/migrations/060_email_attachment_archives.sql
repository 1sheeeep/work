CREATE TABLE IF NOT EXISTS email_attachment_jobs (
  message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES shop_sources(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_message_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'queued',
  available_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_attachment_jobs_status_check CHECK (status IN ('queued', 'running'))
);

CREATE INDEX IF NOT EXISTS idx_email_attachment_jobs_claim
  ON email_attachment_jobs(status, priority DESC, available_at ASC, created_at ASC);

ALTER TABLE email_export_jobs ADD COLUMN IF NOT EXISTS progress_stage TEXT NOT NULL DEFAULT '';
ALTER TABLE email_export_jobs ADD COLUMN IF NOT EXISTS attachment_total INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_export_jobs ADD COLUMN IF NOT EXISTS attachment_processed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_export_jobs ADD COLUMN IF NOT EXISTS attachment_succeeded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_export_jobs ADD COLUMN IF NOT EXISTS attachment_failed INTEGER NOT NULL DEFAULT 0;
