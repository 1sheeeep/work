ALTER TABLE conversation_messages ADD COLUMN superseded_at TIMESTAMPTZ;

CREATE INDEX idx_conversation_messages_visible_contact_created
    ON conversation_messages(contact_id, created_at, id)
    WHERE superseded_at IS NULL;
