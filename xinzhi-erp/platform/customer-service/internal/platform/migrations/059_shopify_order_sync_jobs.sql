CREATE TABLE IF NOT EXISTS shopify_order_sync_jobs (
  shop_id TEXT PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  target_order_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  rerun_requested BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_requested BOOLEAN NOT NULL DEFAULT FALSE,
  available_at TIMESTAMPTZ NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT shopify_order_sync_jobs_status_check CHECK (status IN ('queued', 'running'))
);

CREATE INDEX IF NOT EXISTS idx_shopify_order_sync_jobs_claim
  ON shopify_order_sync_jobs(status, priority DESC, available_at ASC, created_at ASC);

CREATE TABLE IF NOT EXISTS shopify_webhook_receipts (
  webhook_id TEXT PRIMARY KEY,
  shop_domain TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  received_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shopify_webhook_receipts_received
  ON shopify_webhook_receipts(received_at);
