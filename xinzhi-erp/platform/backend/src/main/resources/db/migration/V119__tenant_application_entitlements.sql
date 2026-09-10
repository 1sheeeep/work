CREATE TABLE tenant_entitlement_sets (
    tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by_system_admin_id UUID REFERENCES system_admins(id),
    CONSTRAINT ck_tenant_entitlement_sets_version CHECK (version >= 0)
);

CREATE TABLE tenant_enabled_application_modules (
    tenant_id UUID NOT NULL REFERENCES tenant_entitlement_sets(tenant_id)
        ON DELETE CASCADE,
    application_code VARCHAR(40) NOT NULL,
    module_code VARCHAR(64) NOT NULL,
    enabled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, application_code, module_code),
    CONSTRAINT ck_tenant_application_code CHECK (
        application_code IN ('ERP', 'CHAT', 'ZHAOYAOJING', 'ASSET_REGISTRY')
    ),
    CONSTRAINT ck_tenant_application_module_pair CHECK (
        (application_code = 'ERP' AND module_code IN (
            'CHANNELS', 'PRODUCTS', 'ORDERS', 'PROCUREMENT',
            'WAREHOUSE', 'LOGISTICS', 'ANALYTICS'
        ))
        OR (application_code = 'CHAT' AND module_code IN (
            'WORKSPACE', 'CONVERSATIONS', 'TICKETS'
        ))
        OR (application_code = 'ZHAOYAOJING' AND module_code IN (
            'AD_ACCOUNTS', 'CAMPAIGNS', 'REPORTING'
        ))
        OR (application_code = 'ASSET_REGISTRY' AND module_code IN (
            'ASSETS', 'INVENTORY', 'REPORTING'
        ))
    )
);

CREATE INDEX idx_tenant_enabled_modules_lookup
    ON tenant_enabled_application_modules (
        tenant_id, application_code, module_code
    );

-- Preserve the behavior of existing enterprises. New enterprises start with
-- only the always-available One workspace and core IAM/settings; a platform
-- administrator explicitly opens their business applications.
INSERT INTO tenant_entitlement_sets (tenant_id, version, updated_at)
SELECT tenant.id, 0, now()
FROM tenants tenant
WHERE tenant.deleted_at IS NULL
ON CONFLICT (tenant_id) DO NOTHING;

INSERT INTO tenant_enabled_application_modules (
    tenant_id, application_code, module_code, enabled_at
)
SELECT tenant.id, entitlement.application_code, entitlement.module_code, now()
FROM tenants tenant
CROSS JOIN (VALUES
    ('ERP', 'CHANNELS'),
    ('ERP', 'PRODUCTS'),
    ('ERP', 'ORDERS'),
    ('ERP', 'PROCUREMENT'),
    ('ERP', 'WAREHOUSE'),
    ('ERP', 'LOGISTICS'),
    ('ERP', 'ANALYTICS'),
    ('CHAT', 'WORKSPACE'),
    ('CHAT', 'CONVERSATIONS'),
    ('CHAT', 'TICKETS')
) AS entitlement(application_code, module_code)
WHERE tenant.deleted_at IS NULL
ON CONFLICT (tenant_id, application_code, module_code) DO NOTHING;
