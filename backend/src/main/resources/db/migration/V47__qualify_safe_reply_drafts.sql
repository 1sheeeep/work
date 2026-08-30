ALTER TABLE local_connector_unread_observations
    ADD COLUMN draft_qualification VARCHAR(32),
    ADD COLUMN matched_job_position_id UUID,
    ADD COLUMN draft_blocker_codes VARCHAR(500),
    ADD COLUMN draft_company_knowledge_version INTEGER,
    ADD COLUMN draft_job_knowledge_version INTEGER;

UPDATE local_connector_unread_observations
SET draft_qualification = CASE
    WHEN draft_mode = 'KNOWLEDGE' THEN 'KNOWLEDGE_READY'
    ELSE 'KNOWLEDGE_BLOCKED'
END
WHERE draft_mode IS NOT NULL;

CREATE INDEX idx_local_connector_draft_qualification
    ON local_connector_unread_observations (draft_qualification, unread)
    WHERE unread = TRUE;
