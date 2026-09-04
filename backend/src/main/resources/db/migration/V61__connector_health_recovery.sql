ALTER TABLE local_connector_devices
    ADD COLUMN last_successful_sync_at TIMESTAMPTZ,
    ADD COLUMN last_successful_sync_type VARCHAR(16),
    ADD COLUMN last_successful_chat_sync_at TIMESTAMPTZ,
    ADD COLUMN last_successful_job_sync_at TIMESTAMPTZ,
    ADD COLUMN last_pause_at TIMESTAMPTZ,
    ADD COLUMN last_pause_reason VARCHAR(300),
    ADD COLUMN recovery_required_since TIMESTAMPTZ,
    ADD COLUMN last_recovered_at TIMESTAMPTZ;

ALTER TABLE local_connector_devices
    ADD CONSTRAINT ck_local_connector_devices_success_type
    CHECK (last_successful_sync_type IS NULL OR last_successful_sync_type IN ('CHAT', 'JOB'));

CREATE INDEX idx_local_connector_device_health
    ON local_connector_devices(status, runtime_state, last_successful_chat_sync_at);
