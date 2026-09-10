CREATE INDEX IF NOT EXISTS idx_conversations_workbench
ON conversations(shop_id, status, assigned_agent_id, last_message_at DESC, id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_id
ON messages(conversation_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_direction_created
ON messages(conversation_id, direction, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_knowledge_entries_status_updated
ON knowledge_entries(status, updated_at DESC, id);
