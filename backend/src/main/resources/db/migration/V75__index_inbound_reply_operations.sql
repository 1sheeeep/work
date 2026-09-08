CREATE INDEX idx_inbound_ai_reply_account_sent_at
    ON inbound_ai_reply_tasks (account_id, send_completed_at DESC)
    WHERE send_status = 'SUCCEEDED';

CREATE INDEX idx_inbound_ai_reply_failed_completed_at
    ON inbound_ai_reply_tasks (completed_at DESC)
    WHERE status = 'FAILED';

CREATE INDEX idx_inbound_ai_reply_terminal_cleanup
    ON inbound_ai_reply_tasks (status, completed_at)
    WHERE status IN ('COMPLETED', 'FAILED');

CREATE INDEX idx_inbound_ai_reply_send_status
    ON inbound_ai_reply_tasks (send_status, send_completed_at DESC);
