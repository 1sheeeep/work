CREATE TABLE browser_unread_observations (
    id UUID PRIMARY KEY,
    browser_device_id UUID NOT NULL REFERENCES browser_companion_devices(id),
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    chat_digest VARCHAR(64) NOT NULL,
    preview_digest VARCHAR(64),
    job_digest VARCHAR(64),
    time_digest VARCHAR(64),
    unread_count INTEGER NOT NULL,
    unread BOOLEAN NOT NULL,
    first_seen_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT uk_browser_unread_account_chat UNIQUE (boss_account_id, chat_digest),
    CONSTRAINT ck_browser_unread_count CHECK (unread_count BETWEEN 0 AND 999)
);

CREATE INDEX idx_browser_unread_queue ON browser_unread_observations(unread, first_seen_at);
CREATE INDEX idx_browser_unread_account ON browser_unread_observations(boss_account_id, unread, first_seen_at);
