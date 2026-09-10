ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

UPDATE conversations
SET closed_at = updated_at
WHERE status = 'closed' AND closed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_closed_at
ON conversations(closed_at DESC)
WHERE status = 'closed';
