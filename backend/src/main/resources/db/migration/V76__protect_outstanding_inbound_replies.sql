CREATE INDEX idx_inbound_ai_reply_account_outstanding_send
    ON inbound_ai_reply_tasks (account_id, send_status)
    WHERE send_status IN ('READY', 'CLAIMED');

DROP INDEX IF EXISTS idx_inbound_ai_reply_terminal_cleanup;

CREATE INDEX idx_inbound_ai_reply_terminal_cleanup
    ON inbound_ai_reply_tasks ((COALESCE(send_completed_at, completed_at)))
    WHERE status = 'FAILED'
       OR (status = 'COMPLETED' AND send_status IN ('SKIPPED', 'SUCCEEDED', 'FAILED', 'UNKNOWN'));
