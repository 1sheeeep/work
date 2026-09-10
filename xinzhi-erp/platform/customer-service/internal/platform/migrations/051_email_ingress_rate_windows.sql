CREATE TABLE IF NOT EXISTS email_ingress_rate_windows (
  source_id TEXT NOT NULL REFERENCES shop_sources(id) ON DELETE CASCADE,
  dimension_key TEXT NOT NULL,
  dimension_type TEXT NOT NULL,
  window_started_at TIMESTAMPTZ NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (source_id, dimension_key)
);

CREATE INDEX IF NOT EXISTS idx_email_ingress_rate_windows_updated
  ON email_ingress_rate_windows(updated_at);

