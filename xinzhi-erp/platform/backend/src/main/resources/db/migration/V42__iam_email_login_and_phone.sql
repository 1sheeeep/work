-- Email is the canonical login identifier for all newly created IAM
-- identities. Historical non-email usernames remain readable and login-capable,
-- but cannot be created after this migration.

CREATE OR REPLACE FUNCTION iam_is_business_email(value TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
    SELECT char_length(value) BETWEEN 3 AND 254
       AND value = lower(btrim(value))
       AND char_length(split_part(value, '@', 1)) BETWEEN 1 AND 64
       AND split_part(value, '@', 1) NOT LIKE '.%'
       AND split_part(value, '@', 1) NOT LIKE '%.'
       AND position('..' IN split_part(value, '@', 1)) = 0
       AND value ~ '^[a-z0-9._%+-]+@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
$$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM users
        WHERE iam_is_business_email(lower(btrim(username)))
        GROUP BY tenant_id, lower(btrim(username))
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'duplicate case-insensitive tenant email prevents V42 migration'
            USING ERRCODE = '23505';
    END IF;
END;
$$;

ALTER TABLE users
    ALTER COLUMN username TYPE VARCHAR(254),
    ADD COLUMN email VARCHAR(254),
    ADD COLUMN phone_number VARCHAR(16),
    DROP CONSTRAINT ck_users_username_format;

UPDATE users
SET username = lower(btrim(username)),
    email = lower(btrim(username))
WHERE iam_is_business_email(lower(btrim(username)));

ALTER TABLE users
    ADD CONSTRAINT ck_users_login_identifier
        CHECK (
            (email IS NULL
                AND username ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$')
            OR
            (email IS NOT NULL
                AND username = email
                AND iam_is_business_email(email))
        ),
    ADD CONSTRAINT ck_users_phone_number_e164
        CHECK (
            phone_number IS NULL
            OR phone_number ~ '^\+[1-9][0-9]{7,14}$'
        );

CREATE UNIQUE INDEX uq_users_tenant_email_ci
    ON users (tenant_id, lower(email))
    WHERE email IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM system_admins
        WHERE iam_is_business_email(lower(btrim(username)))
        GROUP BY lower(btrim(username))
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'duplicate case-insensitive system administrator email prevents V42 migration'
            USING ERRCODE = '23505';
    END IF;
END;
$$;

ALTER TABLE system_admins
    ALTER COLUMN username TYPE VARCHAR(254),
    ADD COLUMN email VARCHAR(254),
    DROP CONSTRAINT ck_system_admins_username_format;

UPDATE system_admins
SET username = lower(btrim(username)),
    email = lower(btrim(username))
WHERE iam_is_business_email(lower(btrim(username)));

ALTER TABLE system_admins
    ADD CONSTRAINT ck_system_admins_login_identifier
        CHECK (
            (email IS NULL
                AND username ~ '^[A-Za-z0-9][A-Za-z0-9._@-]{0,119}$')
            OR
            (email IS NOT NULL
                AND username = email
                AND iam_is_business_email(email))
        );

CREATE UNIQUE INDEX uq_system_admins_email_ci
    ON system_admins (lower(email))
    WHERE email IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_iam_email_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.username IS DISTINCT FROM OLD.username
            OR NEW.email IS DISTINCT FROM OLD.email THEN
        RAISE EXCEPTION 'IAM login identities are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_email_identity
BEFORE UPDATE OF username, email ON users
FOR EACH ROW EXECUTE FUNCTION enforce_iam_email_identity();

CREATE TRIGGER trg_system_admins_email_identity
BEFORE UPDATE OF username, email ON system_admins
FOR EACH ROW EXECUTE FUNCTION enforce_iam_email_identity();
