ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN IF NOT EXISTS conversation_context TEXT;

COMMENT ON COLUMN inbound_ai_reply_tasks.conversation_context IS
    'Bounded recent conversation context used transiently for AI understanding; cleared when processing completes.';
