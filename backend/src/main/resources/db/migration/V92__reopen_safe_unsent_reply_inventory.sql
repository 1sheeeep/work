-- V89 quarantined every pre-existing task. Re-open one safe validation only
-- for retained tasks that were already terminal before V90 introduced the
-- bounded replay flow. Anything replayed after V90 keeps safe_replay_count=1.
UPDATE inbound_ai_reply_tasks
   SET safe_replay_count = 0
 WHERE safe_replay_count = 1
   AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
   AND updated_at < COALESCE(
       (SELECT installed_on FROM flyway_schema_history WHERE version = '90' AND success = TRUE ORDER BY installed_rank DESC LIMIT 1),
       CURRENT_TIMESTAMP
   )
   AND (
       (send_status = 'FAILED' AND status = 'COMPLETED' AND reply_allowed = TRUE)
       OR
       (send_status = 'SKIPPED' AND status = 'FAILED' AND last_error_code IN (
           'AI_OUTPUT_INVALID', 'INBOUND_REPLY_AI_REQUEST_FAILED', 'INBOUND_REPLY_AI_TIMEOUT',
           'INBOUND_REPLY_AI_INVALID', 'INBOUND_REPLY_AI_INVALID_RESULT',
           'INBOUND_REPLY_AI_OUTPUT_MISSING', 'INBOUND_REPLY_AI_RATE_LIMITED',
           'INBOUND_REPLY_AI_UPSTREAM_5XX'
       ))
   );
