CREATE TABLE IF NOT EXISTS email_runtime_events (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  shop_id TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  entity_id TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT email_runtime_events_severity_check CHECK (severity IN ('info', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_email_runtime_events_created
  ON email_runtime_events(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_runtime_events_source_created
  ON email_runtime_events(source_id, created_at DESC);
