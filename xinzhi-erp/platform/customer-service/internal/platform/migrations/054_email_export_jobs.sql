CREATE TABLE IF NOT EXISTS email_export_jobs (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filter JSONB NOT NULL,
  status TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  file_path TEXT NOT NULL DEFAULT '',
  row_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ NULL,
  completed_at TIMESTAMPTZ NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_export_jobs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_email_export_jobs_claim
  ON email_export_jobs(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_email_export_jobs_expiry
  ON email_export_jobs(expires_at);
