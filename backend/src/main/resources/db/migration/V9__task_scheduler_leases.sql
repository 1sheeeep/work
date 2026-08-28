ALTER TABLE recruitment_tasks
    ADD COLUMN scheduler_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN next_run_at TIMESTAMPTZ,
    ADD COLUMN last_scheduled_at TIMESTAMPTZ,
    ADD COLUMN last_scheduler_owner VARCHAR(120);

UPDATE recruitment_tasks
SET next_run_at = CURRENT_TIMESTAMP
WHERE status = 'RUNNING';

CREATE INDEX idx_recruitment_tasks_scheduler_due
    ON recruitment_tasks(next_run_at, id)
    WHERE scheduler_enabled = TRUE AND status = 'RUNNING';

CREATE TABLE recruitment_task_leases (
    task_id UUID PRIMARY KEY REFERENCES recruitment_tasks(id) ON DELETE CASCADE,
    owner_id VARCHAR(120) NOT NULL,
    fencing_token BIGINT NOT NULL,
    acquired_at TIMESTAMPTZ NOT NULL,
    heartbeat_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_recruitment_task_leases_expiry ON recruitment_task_leases(lease_until);
