\set ON_ERROR_STOP on
\timing on
BEGIN;

INSERT INTO inbound_ai_reply_tasks (
    id, account_id, observation_id, job_position_id, chat_digest,
    message_digest, message_text, status, attempt_count,
    created_at, updated_at, next_attempt_at, version
)
SELECT gen_random_uuid(), account.id, observation.id, job.id,
       md5('load-chat-' || sequence.value::text) || md5('load-chat-' || sequence.value::text),
       md5('load-message-' || sequence.value::text) || md5('load-message-' || sequence.value::text),
       '压力验证消息', 'QUEUED', 0,
       CURRENT_TIMESTAMP + sequence.value * INTERVAL '1 microsecond',
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
FROM generate_series(1, 10000) AS sequence(value)
CROSS JOIN LATERAL (SELECT id FROM boss_accounts LIMIT 1) account
CROSS JOIN LATERAL (SELECT id FROM local_connector_unread_observations LIMIT 1) observation
CROSS JOIN LATERAL (SELECT id FROM job_positions LIMIT 1) job;

EXPLAIN (ANALYZE, BUFFERS)
SELECT id
FROM inbound_ai_reply_tasks
WHERE account_id = (SELECT id FROM boss_accounts LIMIT 1)
  AND status = 'QUEUED'
ORDER BY created_at
LIMIT 1;

DO $$
BEGIN
  INSERT INTO inbound_ai_reply_tasks (
      id, account_id, observation_id, job_position_id, chat_digest,
      message_digest, status, attempt_count, created_at, started_at, updated_at, version
  )
  SELECT gen_random_uuid(), account.id, observation.id, job.id,
         repeat('a', 64), repeat('b', 64), 'PROCESSING', 1,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
  FROM (SELECT id FROM boss_accounts LIMIT 1) account
  CROSS JOIN (SELECT id FROM local_connector_unread_observations LIMIT 1) observation
  CROSS JOIN (SELECT id FROM job_positions LIMIT 1) job;

  BEGIN
    INSERT INTO inbound_ai_reply_tasks (
        id, account_id, observation_id, job_position_id, chat_digest,
        message_digest, status, attempt_count, created_at, started_at, updated_at, version
    )
    SELECT gen_random_uuid(), account.id, observation.id, job.id,
           repeat('c', 64), repeat('d', 64), 'PROCESSING', 1,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 0
    FROM (SELECT id FROM boss_accounts LIMIT 1) account
    CROSS JOIN (SELECT id FROM local_connector_unread_observations LIMIT 1) observation
    CROSS JOIN (SELECT id FROM job_positions LIMIT 1) job;
    RAISE EXCEPTION 'multi-instance account guard did not reject a second PROCESSING task';
  EXCEPTION WHEN unique_violation THEN
    RAISE NOTICE 'multi-instance account guard verified';
  END;
END $$;

ROLLBACK;

SELECT count(*) AS retained_load_rows
FROM inbound_ai_reply_tasks
WHERE message_text = '压力验证消息';
