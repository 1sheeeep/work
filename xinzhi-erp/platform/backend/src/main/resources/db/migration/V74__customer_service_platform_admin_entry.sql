-- Customer-service entry grants may originate from either a tenant-user
-- session or a system administrator's explicit tenant-entry session.
ALTER TABLE platform_admin_tenant_sessions
    ADD CONSTRAINT uq_platform_admin_tenant_sessions_id_tenant_admin
        UNIQUE (id, tenant_id, system_admin_id);

ALTER TABLE customer_service_entry_grants
    DROP CONSTRAINT fk_customer_service_entry_grants_session,
    ALTER COLUMN auth_session_id DROP NOT NULL,
    ADD COLUMN platform_tenant_session_id UUID,
    ADD CONSTRAINT fk_customer_service_entry_grants_user_session
        FOREIGN KEY (auth_session_id, tenant_id, user_id)
        REFERENCES auth_sessions (id, tenant_id, user_id),
    ADD CONSTRAINT fk_customer_service_entry_grants_platform_session
        FOREIGN KEY (platform_tenant_session_id, tenant_id, user_id)
        REFERENCES platform_admin_tenant_sessions (id, tenant_id, system_admin_id),
    ADD CONSTRAINT ck_customer_service_entry_grants_session_kind
        CHECK (
            (auth_session_id IS NOT NULL)::integer
            + (platform_tenant_session_id IS NOT NULL)::integer = 1
        );

CREATE INDEX idx_customer_service_entry_grants_platform_session
    ON customer_service_entry_grants (
        tenant_id,
        user_id,
        platform_tenant_session_id,
        created_at DESC
    )
    WHERE platform_tenant_session_id IS NOT NULL;
