-- A restarted deployment may leave tasks in PROCESSING. Return them to the
-- durable queue before creating the one-active-task-per-account invariant.
UPDATE inbound_ai_reply_tasks
SET status = 'QUEUED', started_at = NULL, next_attempt_at = CURRENT_TIMESTAMP,
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'PROCESSING';

ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX uq_inbound_ai_reply_processing_account
    ON inbound_ai_reply_tasks(account_id)
    WHERE status = 'PROCESSING';
