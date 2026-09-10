ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS ticket_type TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS collaborator_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS requires_acceptance BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS completed_by TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE tickets ALTER COLUMN shop_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_type_status
  ON tickets(ticket_type,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_due_at
  ON tickets(due_at) WHERE due_at IS NOT NULL AND status NOT IN ('resolved','closed','cancelled');

ALTER TABLE ticket_comments
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'comment';
