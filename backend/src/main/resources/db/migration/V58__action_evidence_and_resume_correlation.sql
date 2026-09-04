ALTER TABLE local_connector_action_leases
    ADD COLUMN before_state_digest CHAR(64),
    ADD COLUMN after_state_digest CHAR(64);

ALTER TABLE resume_intakes
    ADD COLUMN source_action_task_id UUID REFERENCES local_connector_action_tasks(id);

CREATE INDEX idx_resume_intakes_source_action_task ON resume_intakes(source_action_task_id)
    WHERE source_action_task_id IS NOT NULL;
