-- Explicit owned rehearsal only. Never discovered by Flyway/application boot.
BEGIN;
CREATE SCHEMA IF NOT EXISTS integration_preparation;
CREATE TABLE integration_preparation.shopify_budget (
    tenant_id uuid NOT NULL, shop_id uuid NOT NULL, app_ref text NOT NULL,
    capacity numeric NOT NULL CHECK(capacity>0 AND capacity<=100000),
    available numeric NOT NULL CHECK(available>=0 AND available<=capacity), restore_rate numeric NOT NULL CHECK(restore_rate>0 AND restore_rate<=10000),
    foreground_reserve numeric NOT NULL CHECK(foreground_reserve>=0 AND foreground_reserve<capacity),
    observed_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
    PRIMARY KEY(tenant_id,shop_id,app_ref)
);
CREATE TABLE integration_preparation.shopify_deliveries (
    tenant_id uuid NOT NULL, shop_id uuid NOT NULL, app_ref text NOT NULL,
    delivery_id text NOT NULL, topic text NOT NULL, resource_ref text NOT NULL,
    resource_version timestamptz NOT NULL, payload_digest char(64) NOT NULL,
    outcome text NOT NULL CHECK(outcome IN ('APPLIED','DUPLICATE','STALE','CONFLICT')),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(tenant_id,shop_id,app_ref,delivery_id)
);
CREATE TABLE integration_preparation.shopify_resource_versions (
    tenant_id uuid NOT NULL, shop_id uuid NOT NULL, topic text NOT NULL,
    resource_ref text NOT NULL, resource_version timestamptz NOT NULL,
    payload_digest char(64) NOT NULL,
    PRIMARY KEY(tenant_id,shop_id,topic,resource_ref)
);
CREATE TABLE integration_preparation.shopify_reconciliation_checkpoints (
    tenant_id uuid NOT NULL, shop_id uuid NOT NULL, app_ref text NOT NULL,
    topic text NOT NULL, synchronized_through timestamptz NOT NULL,
    PRIMARY KEY(tenant_id,shop_id,app_ref,topic)
);
REVOKE ALL ON ALL TABLES IN SCHEMA integration_preparation FROM PUBLIC;
COMMIT;
