ALTER TABLE browser_unread_observations
    ADD COLUMN fill_status VARCHAR(24) NOT NULL DEFAULT 'NONE',
    ADD COLUMN fill_claim_id UUID,
    ADD COLUMN fill_device_id UUID REFERENCES browser_companion_devices(id),
    ADD COLUMN fill_lease_until TIMESTAMPTZ,
    ADD COLUMN filled_at TIMESTAMPTZ;

ALTER TABLE browser_unread_observations
    ADD CONSTRAINT ck_browser_observation_fill_status CHECK (fill_status IN ('NONE','READY','CLAIMED','FILLED','UNKNOWN'));

CREATE UNIQUE INDEX uk_browser_observation_fill_claim
    ON browser_unread_observations(fill_claim_id) WHERE fill_claim_id IS NOT NULL;

