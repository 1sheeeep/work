ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN purpose VARCHAR(24) NOT NULL DEFAULT 'STANDARD_REPLY',
    ADD COLUMN resume_intake_id UUID;

ALTER TABLE inbound_ai_reply_tasks
    ADD CONSTRAINT fk_inbound_ai_reply_resume_intake
        FOREIGN KEY (resume_intake_id) REFERENCES resume_intakes(id);

CREATE UNIQUE INDEX uq_inbound_ai_reply_resume_receipt
    ON inbound_ai_reply_tasks(resume_intake_id)
    WHERE purpose = 'RESUME_RECEIPT' AND resume_intake_id IS NOT NULL;

-- checksum-pad: xrddC1
