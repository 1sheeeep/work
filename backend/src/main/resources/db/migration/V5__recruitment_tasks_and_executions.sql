CREATE TABLE recruitment_tasks (
    id UUID PRIMARY KEY,
    job_position_id UUID NOT NULL REFERENCES job_positions(id),
    boss_account_id UUID NOT NULL REFERENCES boss_accounts(id),
    name VARCHAR(120) NOT NULL,
    execution_strategy VARCHAR(24) NOT NULL,
    daily_quota INTEGER NOT NULL,
    window_start TIME NOT NULL,
    window_end TIME NOT NULL,
    timezone VARCHAR(64) NOT NULL,
    require_manual_review BOOLEAN NOT NULL DEFAULT TRUE,
    mock_outcome VARCHAR(24) NOT NULL DEFAULT 'SUCCESS',
    status VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
    processed_today INTEGER NOT NULL DEFAULT 0,
    quota_date DATE,
    last_run_at TIMESTAMPTZ,
    last_error VARCHAR(1000),
    version BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_recruitment_task_strategy CHECK (execution_strategy IN ('BALANCED', 'QUALITY_FIRST', 'FAST')),
    CONSTRAINT ck_recruitment_task_quota CHECK (daily_quota BETWEEN 1 AND 500),
    CONSTRAINT ck_recruitment_task_mock_outcome CHECK (mock_outcome IN ('SUCCESS', 'FAILURE', 'NEEDS_ATTENTION')),
    CONSTRAINT ck_recruitment_task_status CHECK (status IN ('DRAFT', 'READY', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'NEEDS_ATTENTION')),
    CONSTRAINT ck_recruitment_task_processed CHECK (processed_today >= 0)
);

CREATE INDEX idx_recruitment_tasks_job ON recruitment_tasks(job_position_id);
CREATE INDEX idx_recruitment_tasks_company_status ON recruitment_tasks(status, created_at DESC);

CREATE TABLE recruitment_task_executions (
    id UUID PRIMARY KEY,
    task_id UUID NOT NULL REFERENCES recruitment_tasks(id),
    idempotency_key VARCHAR(100) NOT NULL,
    attempt_number INTEGER NOT NULL,
    requested_count INTEGER NOT NULL,
    processed_count INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL,
    message VARCHAR(1000),
    started_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    CONSTRAINT uq_recruitment_execution_idempotency UNIQUE (task_id, idempotency_key),
    CONSTRAINT ck_recruitment_execution_attempt CHECK (attempt_number > 0),
    CONSTRAINT ck_recruitment_execution_counts CHECK (requested_count > 0 AND processed_count >= 0),
    CONSTRAINT ck_recruitment_execution_status CHECK (status IN ('SUCCEEDED', 'FAILED', 'NEEDS_ATTENTION'))
);

CREATE INDEX idx_recruitment_executions_task_started ON recruitment_task_executions(task_id, started_at DESC);
