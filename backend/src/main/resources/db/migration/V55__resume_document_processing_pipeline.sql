ALTER TABLE resume_intakes
    ADD COLUMN processing_status VARCHAR(32) NOT NULL DEFAULT 'RECEIVED',
    ADD COLUMN document_type VARCHAR(24),
    ADD COLUMN malware_scanned BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN extracted_text_digest CHAR(64),
    ADD COLUMN failure_code VARCHAR(80),
    ADD COLUMN failure_reason VARCHAR(300),
    ADD COLUMN processed_at TIMESTAMPTZ;

ALTER TABLE resume_intakes
    ADD CONSTRAINT ck_resume_processing_status CHECK (processing_status IN (
        'RECEIVED', 'PROCESSING', 'READY_FOR_AI', 'FAILED'
    )),
    ADD CONSTRAINT ck_resume_document_type CHECK (
        document_type IS NULL OR document_type IN ('PDF', 'DOCX', 'IMAGE_OCR')
    );

CREATE INDEX idx_resume_intakes_processing_received
    ON resume_intakes(processing_status, received_at DESC);
