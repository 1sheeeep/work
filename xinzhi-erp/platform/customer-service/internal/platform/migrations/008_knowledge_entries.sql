CREATE TABLE IF NOT EXISTS knowledge_entries (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  shop_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  answer TEXT NOT NULL,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  conversation_id TEXT NOT NULL DEFAULT '',
  submitted_by TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  review_note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  reviewed_at TIMESTAMPTZ NULL,
  CONSTRAINT knowledge_entries_scope_check CHECK (scope IN ('global', 'shop')),
  CONSTRAINT knowledge_entries_status_check CHECK (status IN ('pending', 'published', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_scope_status ON knowledge_entries(scope, status);
CREATE INDEX IF NOT EXISTS idx_knowledge_entries_shop_status ON knowledge_entries(shop_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entries_conversation_id
ON knowledge_entries(conversation_id)
WHERE conversation_id <> '';
