CREATE TABLE IF NOT EXISTS transfer_requests (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  from_agent_id TEXT NOT NULL,
  target_agent_id TEXT NOT NULL DEFAULT '',
  target_skill_group TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_transfer_pending_conversation ON transfer_requests(conversation_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_transfer_target_status ON transfer_requests(target_agent_id,status,created_at DESC);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL DEFAULT '',
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_name TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL DEFAULT '', order_number TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
  assigned_group TEXT NOT NULL DEFAULT '', assigned_agent_id TEXT NOT NULL DEFAULT '', description TEXT NOT NULL,
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb, created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tickets_shop_status ON tickets(shop_id,status,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation ON tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets(assigned_agent_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS ticket_comments (
  id TEXT PRIMARY KEY,
  ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket ON ticket_comments(ticket_id,created_at);
