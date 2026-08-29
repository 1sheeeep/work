ALTER TABLE auto_reply_policies
    ADD COLUMN away_mode VARCHAR(24) NOT NULL DEFAULT 'IN_OFFICE',
    ADD COLUMN away_started_at TIMESTAMPTZ,
    ADD COLUMN away_ends_at TIMESTAMPTZ;

UPDATE auto_reply_policies
SET away_mode = CASE WHEN enabled THEN 'TEMPORARY' ELSE 'IN_OFFICE' END,
    away_started_at = CASE WHEN enabled THEN updated_at ELSE NULL END;

ALTER TABLE auto_reply_policies
    ADD CONSTRAINT ck_auto_reply_away_mode
        CHECK (away_mode IN ('IN_OFFICE', 'TEMPORARY', 'AFTER_HOURS')),
    ADD CONSTRAINT ck_auto_reply_away_range
        CHECK (away_ends_at IS NULL OR away_started_at IS NULL OR away_ends_at > away_started_at);

CREATE INDEX idx_auto_reply_away_active
    ON auto_reply_policies(enabled, away_mode, away_ends_at)
    WHERE enabled = TRUE;
