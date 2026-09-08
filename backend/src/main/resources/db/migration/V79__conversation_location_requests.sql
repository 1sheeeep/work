CREATE TABLE conversation_location_requests (
    id UUID PRIMARY KEY,
    observation_id UUID NOT NULL REFERENCES local_connector_unread_observations(id),
    device_id UUID NOT NULL REFERENCES local_connector_devices(id),
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    claimed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    result_reason VARCHAR(300)
);
CREATE INDEX idx_conversation_location_claim ON conversation_location_requests(device_id,status,created_at);
