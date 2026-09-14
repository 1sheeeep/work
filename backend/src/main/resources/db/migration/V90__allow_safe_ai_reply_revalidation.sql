-- Re-open exactly one safe replay for recent AI/model-quality failures.
-- The connector still must prove that the conversation, latest message,
-- direction and job binding are unchanged before the task can be requeued.
UPDATE inbound_ai_reply_tasks
SET safe_replay_count = 0
WHERE updated_at >= CURRENT_TIMESTAMP - INTERVAL '2 days'
  AND send_status = 'SKIPPED'
  AND (
    (status = 'FAILED' AND last_error_code IN (
      'AI_OUTPUT_INVALID', 'INBOUND_REPLY_AI_REQUEST_FAILED', 'INBOUND_REPLY_AI_TIMEOUT',
      'INBOUND_REPLY_AI_INVALID', 'INBOUND_REPLY_AI_INVALID_RESULT', 'INBOUND_REPLY_AI_OUTPUT_MISSING',
      'INBOUND_REPLY_AI_RATE_LIMITED', 'INBOUND_REPLY_AI_UPSTREAM_5XX'
    ))
    OR
    (status = 'COMPLETED' AND (
      result_reason LIKE 'AI 回复未通过%'
      OR result_reason LIKE 'AI 社交回复未通过%'
      OR result_reason LIKE 'AI 澄清问题未通过%'
      OR result_reason LIKE '无法可靠判断消息意图%'
      OR result_reason LIKE 'AI 判断该消息需要人工复核%'
    ))
  );
