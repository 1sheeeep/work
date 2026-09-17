DROP INDEX IF EXISTS uq_inbound_ai_reply_processing_account;

CREATE INDEX IF NOT EXISTS idx_inbound_ai_reply_account_processing
    ON inbound_ai_reply_tasks(account_id, started_at)
    WHERE status = 'PROCESSING';
