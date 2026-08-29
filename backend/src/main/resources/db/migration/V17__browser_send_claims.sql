CREATE TABLE browser_send_claims (
    id UUID PRIMARY KEY,
    browser_device_id UUID NOT NULL REFERENCES browser_companion_devices(id),
    binding_id UUID NOT NULL REFERENCES browser_conversation_bindings(id),
    inbound_message_id UUID NOT NULL UNIQUE REFERENCES conversation_messages(id),
    reply_digest VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL,
    lease_until TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    outbound_message_id UUID REFERENCES conversation_messages(id),
    CONSTRAINT ck_browser_send_claim_status CHECK (status IN ('CLAIMED','SENT','UNKNOWN','CANCELLED'))
);

CREATE INDEX idx_browser_send_claim_lease ON browser_send_claims(status, lease_until);
CREATE INDEX idx_browser_send_claim_device ON browser_send_claims(browser_device_id, claimed_at DESC);
