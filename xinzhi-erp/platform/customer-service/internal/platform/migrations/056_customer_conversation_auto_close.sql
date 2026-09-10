CREATE INDEX IF NOT EXISTS idx_conversations_customer_auto_close
ON conversations(last_message_at, source_id, id)
WHERE status = 'assigned'
  AND kind = 'customer'
  AND assigned_agent_id <> '';
