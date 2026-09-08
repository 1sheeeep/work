ALTER TABLE local_connector_unread_observations
    ADD COLUMN conversation_stage VARCHAR(40) NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN can_request_resume BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN resume_received BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN can_exchange_wechat BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN can_exchange_phone BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN wechat_exchanged BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN phone_exchanged BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN can_schedule_interview BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN interview_scheduled BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX idx_connector_observation_stage
    ON local_connector_unread_observations (boss_account_id, conversation_stage, last_seen_at DESC);
