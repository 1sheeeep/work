INSERT INTO permissions (id, code, module, name, description)
VALUES
    ('51000000-0000-0000-0000-000000000001', 'orders.dispute.read', 'orders', '查看拒付', '查看租户店铺的 Shopify Payments 拒付与证据状态'),
    ('51000000-0000-0000-0000-000000000002', 'orders.dispute.write', 'orders', '处理拒付', '编辑并提交租户店铺的 Shopify Payments 拒付证据')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN permissions permission ON permission.code IN (
    'orders.dispute.read', 'orders.dispute.write'
)
WHERE role.system_role = true
  AND role.code = 'tenant_admin'
ON CONFLICT DO NOTHING;

CREATE TABLE tenant_shopify_dispute_commands (
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    idempotency_key VARCHAR(100) NOT NULL,
    shop_id UUID NOT NULL,
    external_dispute_ref VARCHAR(160) NOT NULL,
    external_evidence_ref VARCHAR(160) NOT NULL,
    request_fingerprint CHAR(64) NOT NULL,
    submit_evidence BOOLEAN NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    safe_error_code VARCHAR(80),
    response_submitted BOOLEAN,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    PRIMARY KEY (tenant_id, idempotency_key),
    CONSTRAINT fk_shopify_dispute_commands_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_shopify_dispute_commands_key CHECK (
        idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$'
    ),
    CONSTRAINT ck_shopify_dispute_commands_dispute_ref CHECK (
        external_dispute_ref ~ '^gid://shopify/ShopifyPaymentsDispute/[0-9]+$'
    ),
    CONSTRAINT ck_shopify_dispute_commands_evidence_ref CHECK (
        external_evidence_ref ~ '^gid://shopify/ShopifyPaymentsDisputeEvidence/[0-9]+$'
    ),
    CONSTRAINT ck_shopify_dispute_commands_fingerprint CHECK (
        request_fingerprint ~ '^[0-9a-f]{64}$'
    ),
    CONSTRAINT ck_shopify_dispute_commands_status CHECK (
        status IN ('PENDING', 'UNCERTAIN', 'SUCCEEDED')
    ),
    CONSTRAINT ck_shopify_dispute_commands_attempts CHECK (
        attempt_count > 0
    ),
    CONSTRAINT ck_shopify_dispute_commands_completion CHECK (
        (status = 'SUCCEEDED' AND response_submitted IS NOT NULL
            AND completed_at IS NOT NULL AND safe_error_code IS NULL)
        OR (status <> 'SUCCEEDED' AND response_submitted IS NULL
            AND completed_at IS NULL)
    )
);

CREATE INDEX idx_shopify_dispute_commands_evidence
    ON tenant_shopify_dispute_commands (
        tenant_id, shop_id, external_evidence_ref, created_at DESC
    );

CREATE INDEX idx_shopify_dispute_commands_recovery
    ON tenant_shopify_dispute_commands (status, locked_until, updated_at)
    WHERE status IN ('PENDING', 'UNCERTAIN');
