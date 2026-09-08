ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN next_attempt_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN last_error_code VARCHAR(80);

UPDATE inbound_ai_reply_tasks SET next_attempt_at = created_at WHERE status = 'QUEUED';

ALTER TABLE inbound_ai_reply_tasks DROP CONSTRAINT chk_inbound_ai_reply_status;
ALTER TABLE inbound_ai_reply_tasks ADD CONSTRAINT chk_inbound_ai_reply_status
    CHECK (status IN ('QUEUED','RETRY_WAIT','PROCESSING','COMPLETED','FAILED'));

CREATE INDEX idx_inbound_ai_reply_retry
    ON inbound_ai_reply_tasks(status, next_attempt_at);

