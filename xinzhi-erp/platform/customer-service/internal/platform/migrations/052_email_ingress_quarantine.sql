CREATE TABLE IF NOT EXISTS email_ingress_quarantine (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES shop_sources(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  error_message TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'quarantined',
  attempts INTEGER NOT NULL DEFAULT 1,
  first_failed_at TIMESTAMPTZ NOT NULL,
  last_failed_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_ingress_quarantine_status_check CHECK (status IN ('quarantined', 'resolved')),
  UNIQUE (source_id, source_message_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_email_ingress_quarantine_source_status
  ON email_ingress_quarantine(source_id, status, last_failed_at DESC);

