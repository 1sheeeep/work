ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS parent_ticket_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS handoff_from_agent_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS waiting_reason TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tickets_parent
  ON tickets(parent_ticket_id) WHERE parent_ticket_id <> '';
CREATE INDEX IF NOT EXISTS idx_tickets_active_owner
  ON tickets(assigned_agent_id, updated_at DESC)
  WHERE status NOT IN ('resolved', 'closed', 'cancelled');

UPDATE tickets
SET handoff_from_agent_id = created_by
WHERE ticket_type = 'customer'
  AND conversation_id <> ''
  AND handoff_from_agent_id = '';
