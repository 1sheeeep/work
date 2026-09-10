-- Short-lived, one-time handoff between the Xinzhi One portal and first-party
-- business applications. Provider access tokens are never stored here.
CREATE TABLE first_party_application_entry_grants (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    subject_id UUID NOT NULL,
    auth_session_id UUID,
    platform_tenant_session_id UUID,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    target_application VARCHAR(32) NOT NULL,
    target_origin VARCHAR(512) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT fk_first_party_entry_user_session
        FOREIGN KEY (auth_session_id, tenant_id, subject_id)
        REFERENCES auth_sessions (id, tenant_id, user_id),
    CONSTRAINT fk_first_party_entry_platform_session
        FOREIGN KEY (platform_tenant_session_id, tenant_id, subject_id)
        REFERENCES platform_admin_tenant_sessions (id, tenant_id, system_admin_id),
    CONSTRAINT ck_first_party_entry_session_kind
        CHECK (
            (auth_session_id IS NOT NULL)::integer
            + (platform_tenant_session_id IS NOT NULL)::integer = 1
        ),
    CONSTRAINT ck_first_party_entry_token_hash
        CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ck_first_party_entry_target_application
        CHECK (target_application IN ('ONE', 'ERP')),
    CONSTRAINT ck_first_party_entry_target_origin
        CHECK (target_origin ~ '^https?://[^/?#]+$'),
    CONSTRAINT ck_first_party_entry_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_first_party_entry_consumption
        CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX idx_first_party_entry_grants_active
    ON first_party_application_entry_grants (expires_at)
    WHERE consumed_at IS NULL;

CREATE INDEX idx_first_party_entry_grants_user_session
    ON first_party_application_entry_grants (
        tenant_id,
        subject_id,
        auth_session_id,
        created_at DESC
    )
    WHERE auth_session_id IS NOT NULL;

CREATE INDEX idx_first_party_entry_grants_platform_session
    ON first_party_application_entry_grants (
        tenant_id,
        subject_id,
        platform_tenant_session_id,
        created_at DESC
    )
    WHERE platform_tenant_session_id IS NOT NULL;
