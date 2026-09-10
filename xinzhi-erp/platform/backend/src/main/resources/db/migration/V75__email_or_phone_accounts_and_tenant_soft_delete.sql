-- Every ERP identity can use an email address or phone number for login.
-- Tenant deletion remains recoverable: rows and business data are retained.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        WHERE phone_number IS NOT NULL
        GROUP BY tenant_id, phone_number
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'duplicate tenant phone number prevents V75 migration'
            USING ERRCODE = '23505';
    END IF;
END;
$$;

ALTER TABLE users
    DROP CONSTRAINT ck_users_login_identifier;

ALTER TABLE users
    ADD CONSTRAINT ck_users_login_identifier
        CHECK (
            (email IS NULL AND phone_number IS NULL
                AND username ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$')
            OR
            (email IS NOT NULL
                AND username = email
                AND iam_is_business_email(email))
            OR
            (phone_number IS NOT NULL
                AND username = phone_number
                AND phone_number ~ '^\+[1-9][0-9]{7,14}$')
        );

CREATE UNIQUE INDEX uq_users_tenant_phone
    ON users (tenant_id, phone_number)
    WHERE phone_number IS NOT NULL;

ALTER TABLE system_admins
    ADD COLUMN phone_number VARCHAR(16),
    DROP CONSTRAINT ck_system_admins_login_identifier;

ALTER TABLE system_admins
    ADD CONSTRAINT ck_system_admins_phone_number_e164
        CHECK (
            phone_number IS NULL
            OR phone_number ~ '^\+[1-9][0-9]{7,14}$'
        ),
    ADD CONSTRAINT ck_system_admins_login_identifier
        CHECK (
            (email IS NULL AND phone_number IS NULL
                AND username ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$')
            OR
            (email IS NOT NULL
                AND username = email
                AND iam_is_business_email(email))
            OR
            (phone_number IS NOT NULL
                AND username = phone_number
                AND phone_number ~ '^\+[1-9][0-9]{7,14}$')
        );

CREATE UNIQUE INDEX uq_system_admins_phone
    ON system_admins (phone_number)
    WHERE phone_number IS NOT NULL;

DROP TRIGGER trg_system_admins_email_identity ON system_admins;

ALTER TABLE tenants
    ADD COLUMN deleted_at TIMESTAMPTZ,
    ADD CONSTRAINT ck_tenants_deletion_timestamp
        CHECK (deleted_at IS NULL OR deleted_at >= created_at);

CREATE INDEX idx_tenants_active_list
    ON tenants (code, id)
    WHERE deleted_at IS NULL;
