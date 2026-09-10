ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS supersedes_id TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'knowledge_entries_supersedes_fk'
  ) THEN
    ALTER TABLE knowledge_entries
      ADD CONSTRAINT knowledge_entries_supersedes_fk
      FOREIGN KEY (supersedes_id)
      REFERENCES knowledge_entries(id)
      ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_entries_pending_revision
  ON knowledge_entries(supersedes_id)
  WHERE supersedes_id IS NOT NULL AND status = 'pending';

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_submitted_status
  ON knowledge_entries(submitted_by, status, updated_at DESC);
