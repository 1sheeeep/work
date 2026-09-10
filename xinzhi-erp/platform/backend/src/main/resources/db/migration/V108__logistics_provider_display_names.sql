-- V108: platform-managed display names for the built-in logistics provider catalog.

CREATE TABLE system_logistics_provider_display_names (
    provider_code VARCHAR(64) PRIMARY KEY,
    display_name VARCHAR(120) NOT NULL,
    version BIGINT NOT NULL DEFAULT 1,
    updated_by_system_admin_id UUID NOT NULL REFERENCES system_admins (id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_system_logistics_provider_display_code CHECK (
        provider_code ~ '^[A-Z][A-Z0-9_]{1,63}$'
    ),
    CONSTRAINT ck_system_logistics_provider_display_name CHECK (
        display_name = btrim(display_name)
        AND char_length(display_name) BETWEEN 1 AND 120
        AND display_name !~ '[[:cntrl:]]'
    ),
    CONSTRAINT ck_system_logistics_provider_display_version CHECK (version > 0)
);

CREATE INDEX idx_system_logistics_provider_display_updated
    ON system_logistics_provider_display_names (updated_at DESC, provider_code);
