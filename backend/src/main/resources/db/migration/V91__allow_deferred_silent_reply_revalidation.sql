-- Normal silence was historically quarantined by V89. Allow one bounded
-- revalidation for recent records; the connector still has to prove that the
-- account, conversation, latest inbound message and job binding are unchanged.
UPDATE inbound_ai_reply_tasks
   SET safe_replay_count = 0
 WHERE status = 'COMPLETED'
   AND send_status = 'SKIPPED'
   AND result_reason LIKE '正常静默：%'
   AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 days';
