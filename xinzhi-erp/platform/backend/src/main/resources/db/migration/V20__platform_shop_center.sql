CREATE TABLE platform_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(32) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    description VARCHAR(500),
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_platform_catalog_code UNIQUE (code),
    CONSTRAINT ck_platform_catalog_code
        CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'),
    CONSTRAINT ck_platform_catalog_display_name
        CHECK (char_length(btrim(display_name)) > 0),
    CONSTRAINT ck_platform_catalog_status
        CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

CREATE TABLE tenant_shops (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    platform_id UUID NOT NULL,
    external_shop_ref VARCHAR(160) NOT NULL,
    display_name VARCHAR(160) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_tenant_shops_tenant_external UNIQUE (tenant_id, platform_id, external_shop_ref),
    CONSTRAINT uq_tenant_shops_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_tenant_shops_platform
        FOREIGN KEY (platform_id)
        REFERENCES platform_catalog (id),
    CONSTRAINT ck_tenant_shops_external_ref
        CHECK (char_length(btrim(external_shop_ref)) > 0),
    CONSTRAINT ck_tenant_shops_display_name
        CHECK (char_length(btrim(display_name)) > 0),
    CONSTRAINT ck_tenant_shops_status
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED'))
);

CREATE TABLE shop_authorizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'NOT_AUTHORIZED',
    credential_reference VARCHAR(512),
    provider_account_ref VARCHAR(160),
    scope_summary VARCHAR(1000),
    authorized_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    last_verified_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    error_summary VARCHAR(1000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_shop_authorizations_tenant_shop UNIQUE (tenant_id, shop_id),
    CONSTRAINT fk_shop_authorizations_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_shop_authorizations_status
        CHECK (status IN (
            'NOT_AUTHORIZED', 'PENDING', 'AUTHORIZED',
            'EXPIRED', 'REVOKED', 'ERROR'
        )),
    CONSTRAINT ck_shop_authorizations_credential_reference
        CHECK (
            credential_reference IS NULL
            OR credential_reference ~ '^(vault|credential)://[A-Za-z0-9][A-Za-z0-9._/-]*(#[A-Za-z0-9._-]+)?$'
        ),
    CONSTRAINT ck_shop_authorizations_authorized_reference
        CHECK (status <> 'AUTHORIZED' OR credential_reference IS NOT NULL),
    CONSTRAINT ck_shop_authorizations_error_summary
        CHECK (status <> 'ERROR' OR char_length(btrim(error_summary)) > 0)
);

CREATE TABLE shop_sync_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    shop_id UUID NOT NULL,
    job_type VARCHAR(32) NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'QUEUED',
    progress_processed INTEGER NOT NULL DEFAULT 0,
    progress_total INTEGER,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    error_code VARCHAR(80),
    error_summary VARCHAR(1000),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_shop_sync_jobs_tenant_id UNIQUE (tenant_id, id),
    CONSTRAINT fk_shop_sync_jobs_shop
        FOREIGN KEY (tenant_id, shop_id)
        REFERENCES tenant_shops (tenant_id, id),
    CONSTRAINT ck_shop_sync_jobs_type
        CHECK (job_type IN ('FULL', 'ORDERS', 'PRODUCTS', 'INVENTORY')),
    CONSTRAINT ck_shop_sync_jobs_status
        CHECK (status IN ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
    CONSTRAINT ck_shop_sync_jobs_progress
        CHECK (
            progress_processed >= 0
            AND (progress_total IS NULL OR progress_total >= 0)
            AND (progress_total IS NULL OR progress_processed <= progress_total)
        ),
    CONSTRAINT ck_shop_sync_jobs_attempt_count CHECK (attempt_count >= 0),
    CONSTRAINT ck_shop_sync_jobs_failed_summary
        CHECK (status <> 'FAILED' OR char_length(btrim(error_summary)) > 0)
);

CREATE INDEX idx_platform_catalog_status
    ON platform_catalog (status, code);
CREATE INDEX idx_tenant_shops_tenant_status
    ON tenant_shops (tenant_id, status, display_name);
CREATE INDEX idx_tenant_shops_tenant_platform
    ON tenant_shops (tenant_id, platform_id);
CREATE INDEX idx_shop_authorizations_tenant_status
    ON shop_authorizations (tenant_id, status);
CREATE INDEX idx_shop_sync_jobs_tenant_shop_requested
    ON shop_sync_jobs (tenant_id, shop_id, requested_at DESC);
CREATE INDEX idx_shop_sync_jobs_tenant_status
    ON shop_sync_jobs (tenant_id, status, requested_at);
CREATE UNIQUE INDEX uq_shop_sync_jobs_open_type
    ON shop_sync_jobs (tenant_id, shop_id, job_type)
    WHERE status IN ('QUEUED', 'RUNNING');
