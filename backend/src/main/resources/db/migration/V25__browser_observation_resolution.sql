ALTER TABLE browser_unread_observations
    ADD COLUMN resolution_status VARCHAR(32) NOT NULL DEFAULT 'UNRESOLVED',
    ADD COLUMN resolved_at TIMESTAMPTZ;

ALTER TABLE browser_unread_observations
    ADD CONSTRAINT ck_browser_observation_resolution_status
        CHECK (resolution_status IN ('UNRESOLVED', 'HR_REPLIED', 'HR_SENT_AFTER_DRAFT'));

CREATE INDEX ix_browser_observation_resolution
    ON browser_unread_observations(resolution_status, resolved_at DESC);
