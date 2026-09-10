ALTER TABLE tenant_logistics_authorization_channels
    ADD CONSTRAINT uq_logistics_authorization_channels_tenant_id
        UNIQUE (tenant_id, id);

ALTER TABLE tenant_fulfillment_packages
    ADD COLUMN logistics_authorization_id UUID,
    ADD COLUMN logistics_channel_id UUID,
    ADD COLUMN logistics_provider_code VARCHAR(40),
    ADD COLUMN logistics_client_reference VARCHAR(160),
    ADD COLUMN logistics_provider_order_reference VARCHAR(160),
    ADD COLUMN logistics_tracking_reference VARCHAR(160),
    ADD COLUMN logistics_label_url VARCHAR(2048),
    ADD COLUMN logistics_booking_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REQUESTED',
    ADD COLUMN logistics_tracking_status VARCHAR(32),
    ADD COLUMN logistics_tracking_summary VARCHAR(500),
    ADD COLUMN logistics_booking_key VARCHAR(100),
    ADD COLUMN logistics_last_synced_at TIMESTAMPTZ,
    ADD COLUMN logistics_next_sync_at TIMESTAMPTZ,
    ADD COLUMN logistics_sync_attempt_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN logistics_safe_error_code VARCHAR(80),
    ADD COLUMN logistics_provider_handover_pending BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT fk_tenant_fulfillment_packages_logistics_authorization
        FOREIGN KEY (tenant_id, logistics_authorization_id)
        REFERENCES tenant_logistics_authorizations (tenant_id, id),
    ADD CONSTRAINT fk_tenant_fulfillment_packages_logistics_channel
        FOREIGN KEY (tenant_id, logistics_channel_id)
        REFERENCES tenant_logistics_authorization_channels (tenant_id, id),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_logistics_booking_status CHECK (
        logistics_booking_status IN (
            'NOT_REQUESTED', 'BOOKING', 'BOOKED', 'FAILED', 'UNCERTAIN'
        )
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_logistics_tracking_status CHECK (
        logistics_tracking_status IS NULL OR logistics_tracking_status IN (
            'CREATED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION', 'UNKNOWN'
        )
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_logistics_attempts CHECK (
        logistics_sync_attempt_count >= 0
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_logistics_url CHECK (
        logistics_label_url IS NULL
        OR logistics_label_url ~ '^https?://[^[:space:]]{1,2039}$'
    ),
    ADD CONSTRAINT ck_tenant_fulfillment_packages_logistics_identity CHECK (
        (logistics_booking_status = 'NOT_REQUESTED'
            AND logistics_authorization_id IS NULL
            AND logistics_channel_id IS NULL
            AND logistics_provider_code IS NULL
            AND logistics_client_reference IS NULL
            AND logistics_booking_key IS NULL)
        OR
        (logistics_booking_status <> 'NOT_REQUESTED'
            AND logistics_authorization_id IS NOT NULL
            AND logistics_channel_id IS NOT NULL
            AND logistics_provider_code IS NOT NULL
            AND logistics_client_reference IS NOT NULL
            AND logistics_booking_key IS NOT NULL)
    );

CREATE UNIQUE INDEX uq_tenant_fulfillment_packages_logistics_booking_key
    ON tenant_fulfillment_packages (tenant_id, logistics_booking_key)
    WHERE logistics_booking_key IS NOT NULL;

CREATE INDEX idx_tenant_fulfillment_packages_logistics_sync
    ON tenant_fulfillment_packages (
        logistics_next_sync_at, tenant_id, id
    )
    WHERE logistics_booking_status IN ('BOOKED', 'UNCERTAIN')
      AND logistics_tracking_status IS DISTINCT FROM 'DELIVERED';

CREATE TABLE tenant_logistics_tracking_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    package_id UUID NOT NULL,
    provider_event_key VARCHAR(200) NOT NULL,
    normalized_status VARCHAR(32) NOT NULL,
    provider_status VARCHAR(120),
    description VARCHAR(500) NOT NULL,
    location VARCHAR(240),
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_tenant_logistics_tracking_events_tenant_id
        UNIQUE (tenant_id, id),
    CONSTRAINT uq_tenant_logistics_tracking_events_provider
        UNIQUE (tenant_id, package_id, provider_event_key),
    CONSTRAINT fk_tenant_logistics_tracking_events_package
        FOREIGN KEY (tenant_id, package_id)
        REFERENCES tenant_fulfillment_packages (tenant_id, id),
    CONSTRAINT ck_tenant_logistics_tracking_events_status CHECK (
        normalized_status IN (
            'CREATED', 'IN_TRANSIT', 'DELIVERED', 'EXCEPTION', 'UNKNOWN'
        )
    )
);

CREATE INDEX idx_tenant_logistics_tracking_events_package
    ON tenant_logistics_tracking_events (
        tenant_id, package_id, occurred_at DESC, id DESC
    );

CREATE TRIGGER trg_tenant_logistics_tracking_events_append_only
BEFORE UPDATE OR DELETE ON tenant_logistics_tracking_events
FOR EACH ROW EXECUTE FUNCTION reject_inventory_ledger_mutation();
