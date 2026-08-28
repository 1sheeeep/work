CREATE TABLE auto_reply_policies (
    id UUID PRIMARY KEY,
    boss_account_id UUID NOT NULL UNIQUE REFERENCES boss_accounts(id),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    response_timeout_minutes INTEGER NOT NULL DEFAULT 120,
    daily_limit INTEGER NOT NULL DEFAULT 20,
    minimum_interval_seconds INTEGER NOT NULL DEFAULT 180,
    sending_window_start TIME NOT NULL DEFAULT '09:00',
    sending_window_end TIME NOT NULL DEFAULT '21:00',
    timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Shanghai',
    max_consecutive_failures INTEGER NOT NULL DEFAULT 3,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    paused_until TIMESTAMPTZ,
    last_sent_at TIMESTAMPTZ,
    sent_today INTEGER NOT NULL DEFAULT 0,
    quota_date DATE,
    reply_template TEXT NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    created_by UUID NOT NULL REFERENCES system_users(id),
    updated_by UUID NOT NULL REFERENCES system_users(id),
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_auto_reply_timeout CHECK (response_timeout_minutes BETWEEN 5 AND 10080),
    CONSTRAINT ck_auto_reply_daily_limit CHECK (daily_limit BETWEEN 1 AND 200),
    CONSTRAINT ck_auto_reply_interval CHECK (minimum_interval_seconds BETWEEN 30 AND 86400),
    CONSTRAINT ck_auto_reply_failures CHECK (max_consecutive_failures BETWEEN 1 AND 20 AND consecutive_failures >= 0),
    CONSTRAINT ck_auto_reply_sent_today CHECK (sent_today >= 0),
    CONSTRAINT ck_auto_reply_template CHECK (char_length(reply_template) BETWEEN 1 AND 1000)
);

CREATE TABLE auto_reply_attempts (
    id UUID PRIMARY KEY,
    policy_id UUID NOT NULL REFERENCES auto_reply_policies(id),
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    contact_id UUID NOT NULL REFERENCES candidate_job_contacts(id),
    inbound_message_id UUID NOT NULL UNIQUE REFERENCES conversation_messages(id),
    outbound_message_id UUID REFERENCES conversation_messages(id),
    status VARCHAR(24) NOT NULL,
    idempotency_key VARCHAR(160) NOT NULL UNIQUE,
    owner_id VARCHAR(120),
    lease_until TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    result_message VARCHAR(500),
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT ck_auto_reply_attempt_status CHECK (status IN ('CLAIMED','PENDING_REVIEW','SENT','FAILED','SKIPPED')),
    CONSTRAINT ck_auto_reply_attempt_count CHECK (attempt_count >= 0)
);

CREATE INDEX idx_auto_reply_attempts_account_created ON auto_reply_attempts(boss_account_id, created_at DESC);
CREATE INDEX idx_auto_reply_attempts_status_lease ON auto_reply_attempts(status, lease_until);
CREATE INDEX idx_conversation_messages_auto_reply_scan ON conversation_messages(contact_id, created_at DESC);
