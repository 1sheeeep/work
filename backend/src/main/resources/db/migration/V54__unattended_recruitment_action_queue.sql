ALTER TABLE local_connector_action_tasks
    ALTER COLUMN requested_by DROP NOT NULL,
    ADD COLUMN origin VARCHAR(24) NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN payload TEXT,
    ADD COLUMN cycle_started_at TIMESTAMPTZ;

UPDATE local_connector_action_tasks task
SET cycle_started_at = observation.first_seen_at
FROM local_connector_unread_observations observation
WHERE task.unread_observation_id = observation.id
  AND task.cycle_started_at IS NULL;

UPDATE local_connector_action_tasks task
SET payload = COALESCE(observation.reviewed_content, observation.draft_content)
FROM local_connector_unread_observations observation
WHERE task.unread_observation_id = observation.id
  AND task.action_type = 'SEND_MESSAGE'
  AND task.payload IS NULL;

UPDATE local_connector_action_tasks
SET status = 'CANCELLED',
    payload = '历史发送任务缺少可验证内容，已取消且不会执行',
    reason = '迁移时取消缺少正文的历史发送任务'
WHERE action_type = 'SEND_MESSAGE'
  AND payload IS NULL;

ALTER TABLE local_connector_action_tasks
    ADD CONSTRAINT ck_local_connector_action_origin
        CHECK (origin IN ('MANUAL', 'UNATTENDED')),
    ADD CONSTRAINT ck_local_connector_action_payload
        CHECK (
            (action_type = 'SEND_MESSAGE' AND payload IS NOT NULL AND length(trim(payload)) BETWEEN 1 AND 2000)
            OR (action_type <> 'SEND_MESSAGE' AND payload IS NULL)
        );

CREATE UNIQUE INDEX uq_connector_action_per_unread_cycle
    ON local_connector_action_tasks(unread_observation_id, action_type, cycle_started_at)
    WHERE unread_observation_id IS NOT NULL AND cycle_started_at IS NOT NULL;
