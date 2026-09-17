ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN IF NOT EXISTS queue_lane VARCHAR(24) NOT NULL DEFAULT 'ANALYSIS';

-- Keep the durable task table as the source of truth while making the
-- pipeline lane explicit: model analysis, page send, revalidation, or final.
UPDATE inbound_ai_reply_tasks
SET queue_lane = CASE
    WHEN status IN ('QUEUED', 'PROCESSING', 'RETRY_WAIT') THEN 'ANALYSIS'
    WHEN send_status IN ('READY', 'CLAIMED') THEN 'SEND'
    WHEN send_status = 'FAILED' THEN 'REVALIDATION'
    ELSE 'TERMINAL'
END
WHERE queue_lane IS NULL OR queue_lane = 'ANALYSIS';

ALTER TABLE inbound_ai_reply_tasks
    DROP CONSTRAINT IF EXISTS chk_inbound_ai_reply_queue_lane;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conname = 'chk_inbound_ai_reply_queue_lane'
    ) THEN
        ALTER TABLE inbound_ai_reply_tasks
            ADD CONSTRAINT chk_inbound_ai_reply_queue_lane
            CHECK (queue_lane IN ('ANALYSIS', 'SEND', 'REVALIDATION', 'TERMINAL'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inbound_ai_reply_queue_lane
    ON inbound_ai_reply_tasks(account_id, queue_lane, updated_at);
