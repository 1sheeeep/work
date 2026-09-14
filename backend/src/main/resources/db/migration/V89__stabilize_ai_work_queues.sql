ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN safe_replay_count INTEGER NOT NULL DEFAULT 0;

-- Existing tasks have already passed through the legacy unbounded replay loop.
-- Quarantine them so the new one-shot replay policy only applies to new tasks.
UPDATE inbound_ai_reply_tasks SET safe_replay_count = 1;

-- Provider credentials are healthy again. Requeue extracted resumes that were
-- exhausted only by the previous starvation/provider failure loop.
UPDATE resume_intakes
SET analysis_queue_status = 'QUEUED',
    analysis_queue_attempts = 0,
    analysis_queue_next_attempt_at = NOW(),
    analysis_queue_lease_until = NULL,
    analysis_queue_last_error = NULL,
    analysis_queue_queued_at = COALESCE(analysis_queue_queued_at, NOW()),
    updated_at = NOW()
WHERE analysis_queue_status = 'FAILED'
  AND processing_status = 'READY_FOR_AI'
  AND extracted_text IS NOT NULL
  AND BTRIM(extracted_text) <> ''
  AND analysis_status <> 'SUCCEEDED';
