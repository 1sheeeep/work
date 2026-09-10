CREATE INDEX IF NOT EXISTS idx_messages_email_statistics
ON messages(created_at DESC, id DESC, conversation_id)
WHERE direction <> 'agent'
  AND message_type = 'text'
  AND source_message_id NOT LIKE '%:attachment:%';

CREATE INDEX IF NOT EXISTS idx_conversations_email_statistics
ON conversations(kind, source_id, status, id);

CREATE INDEX IF NOT EXISTS idx_shop_sources_email_statistics
ON shop_sources(type, provider, shop_id, id);
