ALTER TABLE local_connector_unread_observations
    ADD COLUMN draft_fill_status VARCHAR(16) NOT NULL DEFAULT 'NONE',
    ADD COLUMN draft_fill_token_hash VARCHAR(64),
    ADD COLUMN draft_fill_expires_at TIMESTAMPTZ,
    ADD COLUMN draft_fill_digest VARCHAR(64),
    ADD COLUMN draft_filled_at TIMESTAMPTZ,
    ADD COLUMN draft_fill_device_id UUID REFERENCES local_connector_devices(id);

UPDATE local_connector_unread_observations
SET draft_fill_status = 'READY'
WHERE review_status = 'APPROVED'
  AND draft_qualification = 'KNOWLEDGE_READY'
  AND reviewed_content IS NOT NULL;

ALTER TABLE local_connector_unread_observations
    ADD CONSTRAINT ck_local_connector_draft_fill_status
        CHECK (draft_fill_status IN ('NONE', 'READY', 'CLAIMED', 'FILLED', 'UNKNOWN')),
    ADD CONSTRAINT ck_local_connector_draft_fill_digest
        CHECK (draft_fill_digest IS NULL OR draft_fill_digest ~ '^[a-f0-9]{64}$'),
    ADD CONSTRAINT ck_local_connector_draft_fill_token
        CHECK (draft_fill_token_hash IS NULL OR draft_fill_token_hash ~ '^[a-f0-9]{64}$');

CREATE INDEX idx_local_connector_draft_fill
    ON local_connector_unread_observations(draft_fill_status, draft_fill_expires_at);
