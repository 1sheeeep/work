CREATE TABLE IF NOT EXISTS email_sync_jobs (
  source_id TEXT PRIMARY KEY REFERENCES shop_sources(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  rerun_requested BOOLEAN NOT NULL DEFAULT FALSE,
  available_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_sync_jobs_status_check CHECK (status IN ('queued', 'running'))
);

CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_claim
  ON email_sync_jobs(provider, status, available_at, priority DESC, created_at ASC);

