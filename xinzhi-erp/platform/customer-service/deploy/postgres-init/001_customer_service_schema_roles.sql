-- Synthetic local/test bootstrap only. Business migrations remain embedded in
-- the customer-service Go service and use customer_service_migrator.
DO $fresh_only$
BEGIN
    IF to_regnamespace('customer_service') IS NOT NULL THEN
        RAISE EXCEPTION 'fresh synthetic bootstrap refused: customer_service schema already exists';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_roles
        WHERE rolname IN ('customer_service_migrator', 'customer_service_runtime')
    ) THEN
        RAISE EXCEPTION 'fresh synthetic bootstrap refused: customer-service roles already exist';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM pg_class object
        JOIN pg_namespace schema ON schema.oid = object.relnamespace
        WHERE schema.nspname NOT IN ('pg_catalog', 'information_schema')
          AND schema.nspname NOT LIKE 'pg\_%' ESCAPE '\'
    ) THEN
        RAISE EXCEPTION 'fresh synthetic bootstrap refused: database already contains user objects';
    END IF;
END
$fresh_only$;

DO $roles$
BEGIN
    CREATE ROLE customer_service_migrator LOGIN
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        PASSWORD 'not-a-real-secret-customer-service-migrator';
    CREATE ROLE customer_service_runtime LOGIN
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
        PASSWORD 'not-a-real-secret-customer-service-runtime';
END
$roles$;

DO $database_grants$
BEGIN
    EXECUTE format(
        'REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC, customer_service_migrator, customer_service_runtime',
        current_database()
    );
    EXECUTE format(
        'GRANT CONNECT ON DATABASE %I TO customer_service_migrator, customer_service_runtime',
        current_database()
    );
END
$database_grants$;

CREATE SCHEMA customer_service AUTHORIZATION customer_service_migrator;
REVOKE ALL ON SCHEMA customer_service FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA customer_service TO customer_service_migrator;
GRANT USAGE ON SCHEMA customer_service TO customer_service_runtime;
REVOKE CREATE ON SCHEMA customer_service FROM customer_service_runtime;

ALTER ROLE customer_service_migrator SET search_path = customer_service, pg_catalog;
ALTER ROLE customer_service_runtime SET search_path = customer_service, pg_catalog;

ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
    REVOKE ALL ON TABLES FROM customer_service_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO customer_service_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
    REVOKE ALL ON SEQUENCES FROM customer_service_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
    GRANT USAGE ON SEQUENCES TO customer_service_runtime;
-- PostgreSQL's PUBLIC EXECUTE default is global. A per-schema REVOKE cannot
-- subtract it, so close it at the role-wide default before any routines exist.
ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator
    REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, customer_service_runtime;

REVOKE ALL ON ALL TABLES IN SCHEMA customer_service FROM customer_service_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA customer_service
    TO customer_service_runtime;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA customer_service FROM customer_service_runtime;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA customer_service
    TO customer_service_runtime;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_service
    FROM PUBLIC, customer_service_runtime;
