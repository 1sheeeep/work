ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'customer',
  ADD COLUMN IF NOT EXISTS reply_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS classification_reason TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_conversations_kind ON conversations(kind);

DROP INDEX IF EXISTS idx_email_installations_provider_mailbox;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM email_installations
    GROUP BY lower(mailbox)
    HAVING count(DISTINCT shop_id) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate email mailbox bindings must be resolved before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_installations_unique_mailbox
  ON email_installations(lower(mailbox));

CREATE TABLE IF NOT EXISTS filtered_emails (
  id TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL REFERENCES shop_sources(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  external_conversation_id TEXT NOT NULL DEFAULT '',
  source_message_id TEXT NOT NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  body_preview TEXT NOT NULL DEFAULT '',
  attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  recovered_at TIMESTAMPTZ,
  recovered_conversation_id TEXT NOT NULL DEFAULT '',
  UNIQUE(source_id, source_message_id)
);

ALTER TABLE filtered_emails
  ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recovered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovered_conversation_id TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_filtered_emails_shop_received
  ON filtered_emails(shop_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_filtered_emails_expires
  ON filtered_emails(expires_at);
