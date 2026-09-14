-- The reply policy now has deterministic fallbacks for recurrent cases such as
-- work-time questions, no-experience applications and interview cancellations.
-- A prior bounded replay may have been consumed before those rules existed.
-- Re-open one fresh, connector-verified replay for recent unsent records only.
-- The browser still must prove the latest chat/message digest, inbound direction,
-- current job binding and fresh detail snapshot before it can requeue anything.
UPDATE inbound_ai_reply_tasks
   SET safe_replay_count = 0
 WHERE safe_replay_count >= 1
   AND updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 days'
   AND (
       (send_status = 'FAILED' AND status = 'COMPLETED' AND reply_allowed = TRUE)
       OR
       (send_status = 'SKIPPED' AND status = 'FAILED' AND last_error_code IN (
           'AI_OUTPUT_INVALID', 'INBOUND_REPLY_AI_REQUEST_FAILED', 'INBOUND_REPLY_AI_TIMEOUT',
           'INBOUND_REPLY_AI_INVALID', 'INBOUND_REPLY_AI_INVALID_RESULT',
           'INBOUND_REPLY_AI_OUTPUT_MISSING', 'INBOUND_REPLY_AI_RATE_LIMITED',
           'INBOUND_REPLY_AI_UPSTREAM_5XX'
       ))
       OR
       (send_status = 'SKIPPED' AND status = 'COMPLETED' AND (
           result_reason LIKE 'AI 回复未通过%'
           OR result_reason LIKE 'AI 社交回复未通过%'
           OR result_reason LIKE 'AI 澄清问题未通过%'
           OR result_reason LIKE '无法可靠判断消息意图%'
           OR result_reason LIKE 'AI 判断该消息需要人工复核%'
           OR result_reason LIKE '正常静默：%'
       ))
   );
