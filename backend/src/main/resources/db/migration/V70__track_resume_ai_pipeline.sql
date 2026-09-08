ALTER TABLE local_connector_unread_observations
    ADD COLUMN resume_pipeline_status VARCHAR(24) NOT NULL DEFAULT 'NOT_DETECTED',
    ADD COLUMN resume_pipeline_reason VARCHAR(300),
    ADD COLUMN resume_intake_id UUID,
    ADD COLUMN resume_pipeline_updated_at TIMESTAMP WITH TIME ZONE;

UPDATE local_connector_unread_observations
SET resume_pipeline_status = 'DETECTED',
    resume_pipeline_reason = '已识别到 BOSS 在线简历，等待安全导入',
    resume_pipeline_updated_at = COALESCE(cycle_test_updated_at, updated_at)
WHERE resume_received = TRUE;

ALTER TABLE local_connector_unread_observations
    ADD CONSTRAINT chk_observation_resume_pipeline_status
        CHECK (resume_pipeline_status IN ('NOT_DETECTED','DETECTED','IMPORTING','ANALYZING','SUCCEEDED','FAILED')),
    ADD CONSTRAINT fk_observation_resume_intake
        FOREIGN KEY (resume_intake_id) REFERENCES resume_intakes(id);
