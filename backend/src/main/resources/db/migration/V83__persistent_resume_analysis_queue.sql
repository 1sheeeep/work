ALTER TABLE resume_intakes
    ADD COLUMN IF NOT EXISTS analysis_queue_status VARCHAR(24) NOT NULL DEFAULT 'NONE',
    ADD COLUMN IF NOT EXISTS analysis_queue_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS analysis_queue_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS analysis_queue_lease_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS analysis_queue_queued_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS analysis_queue_last_error VARCHAR(300);

CREATE INDEX IF NOT EXISTS idx_resume_intakes_analysis_queue
    ON resume_intakes(analysis_queue_status, analysis_queue_next_attempt_at, analysis_queue_queued_at);

COMMENT ON COLUMN resume_intakes.analysis_queue_status IS '简历 AI 后台队列状态；提取完成后入队，分析与会话回复解耦';
