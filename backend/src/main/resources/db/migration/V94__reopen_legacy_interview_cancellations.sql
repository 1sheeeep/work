-- The application applies the exact cancellation classifier before replaying.
-- Reset the one-shot replay allowance for recent legacy interview coordination
-- records so explicit cancellations can be reconsidered by the current policy.
UPDATE inbound_ai_reply_tasks
   SET safe_replay_count = 0
 WHERE status = 'COMPLETED'
   AND send_status = 'SKIPPED'
   AND category = 'INTERVIEW_COORDINATION'
   AND message_text IS NOT NULL
   AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 days';
