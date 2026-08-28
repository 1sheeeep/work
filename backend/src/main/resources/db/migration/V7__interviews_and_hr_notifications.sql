CREATE TABLE interview_schedules (
    id UUID PRIMARY KEY,
    contact_id UUID NOT NULL REFERENCES candidate_job_contacts(id),
    owner_hr_id UUID NOT NULL REFERENCES system_users(id),
    timezone VARCHAR(64) NOT NULL,
    status VARCHAR(28) NOT NULL DEFAULT 'PROPOSING',
    current_round INTEGER NOT NULL DEFAULT 1,
    mock_notification_outcome VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    confirmation_key VARCHAR(100),
    last_confirmation_result VARCHAR(16),
    confirmed_slot_id UUID,
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_interview_confirmation_key UNIQUE (id, confirmation_key),
    CONSTRAINT ck_interview_status CHECK (status IN ('PROPOSING', 'CONFIRMED', 'RESCHEDULE_REQUIRED', 'CANCELLED')),
    CONSTRAINT ck_interview_round CHECK (current_round > 0),
    CONSTRAINT ck_interview_mock_notification CHECK (mock_notification_outcome IN ('SUCCESS', 'FAILURE')),
    CONSTRAINT ck_interview_confirmation_result CHECK (last_confirmation_result IS NULL OR last_confirmation_result IN ('CONFIRMED', 'CONFLICT', 'EXPIRED'))
);

CREATE INDEX idx_interview_schedules_contact ON interview_schedules(contact_id, created_at DESC);
CREATE INDEX idx_interview_schedules_owner_status ON interview_schedules(owner_hr_id, status);

CREATE TABLE interview_slots (
    id UUID PRIMARY KEY,
    schedule_id UUID NOT NULL REFERENCES interview_schedules(id),
    round_number INTEGER NOT NULL,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'AVAILABLE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_interview_slot_round CHECK (round_number > 0),
    CONSTRAINT ck_interview_slot_range CHECK (ends_at > starts_at),
    CONSTRAINT ck_interview_slot_status CHECK (status IN ('AVAILABLE', 'CONFIRMED', 'DECLINED', 'EXPIRED'))
);

ALTER TABLE interview_schedules ADD CONSTRAINT fk_interview_confirmed_slot
    FOREIGN KEY (confirmed_slot_id) REFERENCES interview_slots(id);
CREATE INDEX idx_interview_slots_schedule_round ON interview_slots(schedule_id, round_number, starts_at);

CREATE TABLE hr_notifications (
    id UUID PRIMARY KEY,
    schedule_id UUID NOT NULL REFERENCES interview_schedules(id),
    confirmation_round INTEGER NOT NULL,
    recipient_id UUID NOT NULL REFERENCES system_users(id),
    channel VARCHAR(20) NOT NULL DEFAULT 'IN_APP_MOCK',
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_error VARCHAR(1000),
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_hr_notification_schedule_round UNIQUE (schedule_id, confirmation_round),
    CONSTRAINT ck_hr_notification_round CHECK (confirmation_round > 0),
    CONSTRAINT ck_hr_notification_channel CHECK (channel IN ('IN_APP_MOCK')),
    CONSTRAINT ck_hr_notification_status CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
    CONSTRAINT ck_hr_notification_attempts CHECK (attempt_count >= 0)
);

CREATE TABLE notification_attempts (
    id UUID PRIMARY KEY,
    notification_id UUID NOT NULL REFERENCES hr_notifications(id),
    idempotency_key VARCHAR(100) NOT NULL,
    status VARCHAR(16) NOT NULL,
    message VARCHAR(1000),
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_notification_attempt_idempotency UNIQUE (notification_id, idempotency_key),
    CONSTRAINT ck_notification_attempt_status CHECK (status IN ('SENT', 'FAILED'))
);

CREATE INDEX idx_notification_attempts_notification ON notification_attempts(notification_id, attempted_at DESC);
