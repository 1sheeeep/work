ALTER TABLE browser_unread_observations
    ADD COLUMN eligibility_status VARCHAR(32) NOT NULL DEFAULT 'OBSERVING',
    ADD COLUMN latest_message_digest VARCHAR(64),
    ADD COLUMN latest_direction VARCHAR(16),
    ADD COLUMN latest_message_at TIMESTAMPTZ,
    ADD COLUMN detail_verified_at TIMESTAMPTZ,
    ADD COLUMN review_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN reviewed_content TEXT,
    ADD COLUMN reviewed_by UUID REFERENCES system_users(id),
    ADD COLUMN reviewed_at TIMESTAMPTZ,
    ADD COLUMN review_note VARCHAR(300);

ALTER TABLE browser_unread_observations
    ADD CONSTRAINT ck_browser_observation_direction CHECK (latest_direction IS NULL OR latest_direction IN ('INBOUND','OUTBOUND')),
    ADD CONSTRAINT ck_browser_observation_review CHECK (review_status IN ('PENDING','APPROVED','REJECTED','HUMAN_TAKEOVER'));

CREATE INDEX idx_browser_observation_eligibility
    ON browser_unread_observations(eligibility_status, first_seen_at);

