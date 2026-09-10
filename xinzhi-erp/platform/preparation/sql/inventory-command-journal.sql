-- Explicit, isolated rehearsal only. Not Flyway and not application startup.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE SCHEMA IF NOT EXISTS integration_preparation;
CREATE TABLE integration_preparation.inventory_routes (
    tenant_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    provider text NOT NULL CHECK (provider IN ('CS_STORE_APP','ERP_SAAS_APP')),
    version bigint NOT NULL CHECK (version > 0),
    frozen boolean NOT NULL DEFAULT false,
    PRIMARY KEY (tenant_id,shop_id)
);
CREATE TABLE integration_preparation.inventory_commands (
    tenant_id uuid NOT NULL,
    shop_id uuid NOT NULL,
    command_id uuid NOT NULL,
    actor_id uuid,
    origin_business text NOT NULL DEFAULT 'ERP' CHECK(origin_business IN ('ERP','CS')),
    cs_actor_ref text,
    payload_digest char(64) NOT NULL,
    idempotency_key varchar(100) NOT NULL,
    inventory_item text NOT NULL,
    location text NOT NULL,
    expected_available integer NOT NULL CHECK (expected_available BETWEEN -1000000000 AND 1000000000),
    target_available integer NOT NULL CHECK (target_available BETWEEN -1000000000 AND 1000000000),
    provider text NOT NULL CHECK (provider IN ('CS_STORE_APP','ERP_SAAS_APP')),
    route_version bigint NOT NULL CHECK (route_version > 0),
    state text NOT NULL CHECK (state IN ('UNKNOWN','APPLIED','REJECTED')),
    safe_code text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    source_claimed_at timestamptz,
    PRIMARY KEY (tenant_id,shop_id,command_id),
    UNIQUE (tenant_id,shop_id,idempotency_key),
    FOREIGN KEY (tenant_id,shop_id) REFERENCES integration_preparation.inventory_routes(tenant_id,shop_id),
    CHECK ((state='UNKNOWN' AND completed_at IS NULL) OR (state<>'UNKNOWN' AND completed_at IS NOT NULL))
    ,CHECK ((origin_business='ERP' AND actor_id IS NOT NULL AND cs_actor_ref IS NULL)
         OR (origin_business='CS' AND actor_id IS NULL AND cs_actor_ref IS NOT NULL AND cs_actor_ref ~ '^[A-Za-z0-9_-]{1,128}$'))
);
-- A lost reply keeps the resource fenced even after the issuing process exits.
CREATE UNIQUE INDEX inventory_command_unresolved_resource
ON integration_preparation.inventory_commands(tenant_id,shop_id,inventory_item,location)
WHERE state='UNKNOWN';
REVOKE ALL ON integration_preparation.inventory_routes,
    integration_preparation.inventory_commands FROM PUBLIC;
CREATE TABLE integration_preparation.inventory_reconciliation_audit (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id uuid NOT NULL, shop_id uuid NOT NULL, command_id uuid NOT NULL,
    reviewer_id uuid NOT NULL, provider text NOT NULL,
    route_version bigint NOT NULL, state text NOT NULL CHECK(state IN ('APPLIED','REJECTED')),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(tenant_id,shop_id,command_id) REFERENCES integration_preparation.inventory_commands(tenant_id,shop_id,command_id)
);
REVOKE ALL ON integration_preparation.inventory_reconciliation_audit FROM PUBLIC;
COMMIT;
