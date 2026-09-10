CREATE TABLE IF NOT EXISTS sla_settings (
    id TEXT PRIMARY KEY,
    first_response_minutes INTEGER NOT NULL DEFAULT 30,
    response_minutes INTEGER NOT NULL DEFAULT 30,
    resolution_minutes INTEGER NOT NULL DEFAULT 1440,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sla_first_response_positive CHECK (first_response_minutes > 0),
    CONSTRAINT sla_response_positive CHECK (response_minutes > 0),
    CONSTRAINT sla_resolution_positive CHECK (resolution_minutes > 0)
);
