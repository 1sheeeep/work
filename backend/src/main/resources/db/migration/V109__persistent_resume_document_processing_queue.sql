ALTER TABLE resume_intakes
    ADD COLUMN IF NOT EXISTS processing_attempts INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS processing_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_lease_until TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_queued_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS processing_last_error VARCHAR(300);

ALTER TABLE resume_intakes
    DROP CONSTRAINT IF EXISTS ck_resume_processing_status;

ALTER TABLE resume_intakes
    ADD CONSTRAINT ck_resume_processing_status CHECK (processing_status IN (
        'RECEIVED', 'QUEUED', 'RETRY_WAIT', 'PROCESSING', 'READY_FOR_AI', 'FAILED'
    ));

CREATE INDEX IF NOT EXISTS idx_resume_intakes_document_processing_queue
    ON resume_intakes(processing_status, processing_next_attempt_at, processing_queued_at);

COMMENT ON COLUMN resume_intakes.processing_status IS '简历文件后台处理状态；队列只负责病毒扫描、OCR/文本提取，完成后再进入 AI 队列';
COMMENT ON COLUMN resume_intakes.processing_attempts IS '简历文件后台处理尝试次数，用于有界重试和服务重启恢复';
