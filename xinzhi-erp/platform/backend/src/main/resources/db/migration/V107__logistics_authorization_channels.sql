-- V107: tenant-scoped logistics channels discovered from authorized provider accounts.

CREATE TABLE tenant_logistics_authorization_channels (
    id UUID PRIMARY KEY,
    authorization_id UUID NOT NULL,
    tenant_id UUID NOT NULL REFERENCES tenants (id),
    channel_code VARCHAR(160) NOT NULL,
    channel_name VARCHAR(160) NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT false,
    provider_available BOOLEAN NOT NULL DEFAULT true,
    version BIGINT NOT NULL DEFAULT 0,
    last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_user_id UUID,
    updated_by_system_admin_id UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_logistics_authorization_channels_authorization
        FOREIGN KEY (authorization_id, tenant_id)
        REFERENCES tenant_logistics_authorizations (id, tenant_id)
        ON DELETE CASCADE,
    CONSTRAINT fk_logistics_authorization_channels_updated_user
        FOREIGN KEY (updated_by_user_id, tenant_id) REFERENCES users (id, tenant_id),
    CONSTRAINT fk_logistics_authorization_channels_updated_admin
        FOREIGN KEY (updated_by_system_admin_id) REFERENCES system_admins (id),
    CONSTRAINT uq_logistics_authorization_channels_code
        UNIQUE (authorization_id, channel_code),
    CONSTRAINT ck_logistics_authorization_channels_code CHECK (
        channel_code = btrim(channel_code)
        AND char_length(channel_code) BETWEEN 1 AND 160
        AND channel_code !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_logistics_authorization_channels_name CHECK (
        channel_name = btrim(channel_name)
        AND char_length(channel_name) BETWEEN 1 AND 160
        AND channel_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_logistics_authorization_channels_actor CHECK (
        (updated_by_user_id IS NULL) <> (updated_by_system_admin_id IS NULL)
    ),
    CONSTRAINT ck_logistics_authorization_channels_version CHECK (version >= 0),
    CONSTRAINT ck_logistics_authorization_channels_timestamps CHECK (
        updated_at >= last_synced_at
    )
);

CREATE INDEX idx_logistics_authorization_channels_account
    ON tenant_logistics_authorization_channels (
        tenant_id, authorization_id, enabled DESC, channel_name, id
    );

CREATE INDEX idx_logistics_authorization_channels_enabled
    ON tenant_logistics_authorization_channels (
        tenant_id, channel_name, authorization_id
    )
    WHERE enabled = true AND provider_available = true;
