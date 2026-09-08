ALTER TABLE inbound_ai_reply_tasks
    ADD COLUMN send_status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN send_device_id UUID REFERENCES local_connector_devices(id),
    ADD COLUMN send_lease_token_hash VARCHAR(64),
    ADD COLUMN send_lease_until TIMESTAMP WITH TIME ZONE,
    ADD COLUMN send_claimed_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN send_before_state_digest VARCHAR(64),
    ADD COLUMN send_after_state_digest VARCHAR(64),
    ADD COLUMN send_receipt_digest VARCHAR(64),
    ADD COLUMN send_result_reason VARCHAR(300),
    ADD COLUMN send_completed_at TIMESTAMP WITH TIME ZONE;

UPDATE inbound_ai_reply_tasks
SET send_status = CASE WHEN status = 'COMPLETED' AND reply_allowed THEN 'READY'
                       WHEN status IN ('COMPLETED', 'FAILED') THEN 'SKIPPED'
                       ELSE 'PENDING' END;

ALTER TABLE inbound_ai_reply_tasks ADD CONSTRAINT chk_inbound_ai_reply_send_status
    CHECK (send_status IN ('PENDING','READY','CLAIMED','SUCCEEDED','FAILED','UNKNOWN','SKIPPED'));

CREATE UNIQUE INDEX uq_inbound_ai_reply_send_token
    ON inbound_ai_reply_tasks(send_lease_token_hash)
    WHERE send_lease_token_hash IS NOT NULL;

CREATE INDEX idx_inbound_ai_reply_send_lease_expiry
    ON inbound_ai_reply_tasks(send_status, send_lease_until)
    WHERE send_status = 'CLAIMED';
