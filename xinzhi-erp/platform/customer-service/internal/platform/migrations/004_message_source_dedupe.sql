CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_conversation_source_message_id
ON messages(conversation_id, source_message_id)
WHERE source_message_id <> '';
