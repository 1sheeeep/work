CREATE TABLE IF NOT EXISTS erp_tenant_stores (
    tenant_id TEXT PRIMARY KEY CHECK (BTRIM(tenant_id) <> ''),
    snapshot BYTEA NOT NULL DEFAULT ''::BYTEA,
    revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
