CREATE INDEX IF NOT EXISTS idx_email_outbox_active_source_order
  ON email_outbox(source_id, created_at, id)
  WHERE status IN ('pending', 'sending');
