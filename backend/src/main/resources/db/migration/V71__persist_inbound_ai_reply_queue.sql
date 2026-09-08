CREATE TABLE inbound_ai_reply_tasks (
    id UUID PRIMARY KEY,
    account_id UUID NOT NULL REFERENCES boss_accounts(id),
    observation_id UUID NOT NULL REFERENCES local_connector_unread_observations(id),
    job_position_id UUID NOT NULL REFERENCES job_positions(id),
    chat_digest VARCHAR(64) NOT NULL,
    message_digest VARCHAR(64) NOT NULL,
    message_text TEXT,
    status VARCHAR(24) NOT NULL,
    reply_allowed BOOLEAN,
    category VARCHAR(40),
    confidence DOUBLE PRECISION,
    reply_content VARCHAR(120),
    result_reason VARCHAR(300),
    attempt_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CONSTRAINT uq_inbound_ai_reply_message UNIQUE (account_id, chat_digest, message_digest),
    CONSTRAINT chk_inbound_ai_reply_status CHECK (status IN ('QUEUED','PROCESSING','COMPLETED','FAILED'))
);

CREATE INDEX idx_inbound_ai_reply_account_queue
    ON inbound_ai_reply_tasks(account_id, status, created_at);

