CREATE TABLE tenant_shopify_fulfillment_publications (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    plan_id UUID NOT NULL,
    package_id UUID NOT NULL,
    idempotency_key VARCHAR(100) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    notify_customer BOOLEAN NOT NULL,
    tracking_url VARCHAR(2048),
    status VARCHAR(16) NOT NULL DEFAULT 'PUBLISHING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    external_fulfillment_ref VARCHAR(160),
    recovered_from_shopify BOOLEAN,
    safe_error_code VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    CONSTRAINT uq_shopify_fulfillment_publication_package
        UNIQUE (tenant_id, package_id),
    CONSTRAINT uq_shopify_fulfillment_publication_key
        UNIQUE (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_fulfillment_publication_plan
        FOREIGN KEY (tenant_id, plan_id)
        REFERENCES tenant_fulfillment_plans (tenant_id, id),
    CONSTRAINT fk_shopify_fulfillment_publication_package
        FOREIGN KEY (tenant_id, package_id)
        REFERENCES tenant_fulfillment_packages (tenant_id, id),
    CONSTRAINT ck_shopify_fulfillment_publication_status CHECK (
        status IN ('PUBLISHING', 'PUBLISHED', 'UNCERTAIN')
    ),
    CONSTRAINT ck_shopify_fulfillment_publication_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
    ),
    CONSTRAINT ck_shopify_fulfillment_publication_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_shopify_fulfillment_publication_attempts CHECK (
        attempt_count > 0
    ),
    CONSTRAINT ck_shopify_fulfillment_publication_completion CHECK (
        (status = 'PUBLISHED'
            AND external_fulfillment_ref IS NOT NULL
            AND recovered_from_shopify IS NOT NULL
            AND published_at IS NOT NULL
            AND locked_until IS NULL
            AND safe_error_code IS NULL)
        OR (status <> 'PUBLISHED'
            AND external_fulfillment_ref IS NULL
            AND recovered_from_shopify IS NULL
            AND published_at IS NULL)
    )
);

CREATE INDEX idx_shopify_fulfillment_publication_recovery
    ON tenant_shopify_fulfillment_publications
        (status, locked_until, updated_at)
    WHERE status IN ('PUBLISHING', 'UNCERTAIN');
