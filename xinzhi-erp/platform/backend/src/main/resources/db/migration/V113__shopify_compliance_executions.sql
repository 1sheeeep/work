CREATE TABLE shopify_compliance_executions (
    event_id VARCHAR(260) PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    topic VARCHAR(32) NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    record_count INTEGER,
    export_prepared_at TIMESTAMPTZ,
    data_redacted_at TIMESTAMPTZ,
    delivery_confirmed_at TIMESTAMPTZ,
    completion_outcome VARCHAR(16),
    connector_completed_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    last_error_code VARCHAR(80),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_shopify_compliance_execution_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_shopify_compliance_execution_topic CHECK (
        topic IN ('CUSTOMER_DATA_REQUEST', 'CUSTOMER_REDACT', 'SHOP_REDACT')
    ),
    CONSTRAINT ck_shopify_compliance_execution_dates CHECK (
        due_at = occurred_at + INTERVAL '30 days'
        AND due_at > occurred_at
    ),
    CONSTRAINT ck_shopify_compliance_execution_count CHECK (
        record_count IS NULL OR record_count >= 0
    ),
    CONSTRAINT ck_shopify_compliance_execution_attempts CHECK (
        attempt_count >= 0
    ),
    CONSTRAINT ck_shopify_compliance_execution_outcome CHECK (
        completion_outcome IS NULL
        OR completion_outcome IN ('EXPORTED', 'ANONYMIZED', 'DELETED', 'NOT_FOUND')
    ),
    CONSTRAINT ck_shopify_compliance_execution_export CHECK (
        topic = 'CUSTOMER_DATA_REQUEST'
        OR (export_prepared_at IS NULL AND delivery_confirmed_at IS NULL)
    ),
    CONSTRAINT ck_shopify_compliance_execution_redaction CHECK (
        topic <> 'CUSTOMER_DATA_REQUEST'
        OR data_redacted_at IS NULL
    ),
    CONSTRAINT ck_shopify_compliance_execution_completion CHECK (
        connector_completed_at IS NULL
        OR completion_outcome IS NOT NULL
    ),
    CONSTRAINT ck_shopify_compliance_execution_error CHECK (
        last_error_code IS NULL
        OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,79}$'
    )
);

CREATE INDEX idx_shopify_compliance_executions_due
    ON shopify_compliance_executions (connector_completed_at, due_at, event_id)
    WHERE connector_completed_at IS NULL;

CREATE INDEX idx_shopify_compliance_executions_shop
    ON shopify_compliance_executions (
        tenant_id, shop_id, occurred_at DESC, event_id
    );
