$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

function Assert-True {
    param([bool]$Condition, [string]$Message)
    if (-not $Condition) { throw $Message }
}

$example = Get-Content -LiteralPath (Join-Path $root ".env.example") -Raw -Encoding UTF8
$compose = Get-Content -LiteralPath (Join-Path $root "deploy\docker-compose.yml") -Raw -Encoding UTF8
$bootstrap = Get-Content -LiteralPath (Join-Path $root "deploy\postgres-init\001_customer_service_schema_roles.sql") -Raw -Encoding UTF8
$compatibility = Get-Content -LiteralPath (Join-Path $root "deploy\postgres-init\verify_customer_service_schema_roles.sql") -Raw -Encoding UTF8
$initializer = Get-Content -LiteralPath (Join-Path $root "tools\initialize-local-postgres-schema.ps1") -Raw -Encoding UTF8
$postgres = Get-Content -LiteralPath (Join-Path $root "internal\platform\postgres.go") -Raw -Encoding UTF8
$main = Get-Content -LiteralPath (Join-Path $root "cmd\support-server\main.go") -Raw -Encoding UTF8

Assert-True ($example -match '(?m)^XZDESK_DATABASE_SCHEMA=customer_service\r?$') "The local example must select only customer_service."
Assert-True ($example -match '(?m)^DATABASE_URL=postgres://customer_service_runtime:') "The local runtime DSN must use its bounded role."
Assert-True ($example -match '(?m)^XZDESK_DATABASE_MIGRATION_URL=postgres://customer_service_migrator:') "The local migration DSN must use its owner role."
Assert-True ($compose.Contains('/docker-entrypoint-initdb.d/001_customer_service_schema_roles.sql:ro')) "Fresh local PostgreSQL must mount the reviewed bootstrap."
Assert-True ($bootstrap.Contains("RAISE EXCEPTION 'fresh synthetic bootstrap refused: customer_service schema already exists'")) "Existing customer_service schemas must fail before bootstrap mutations."
Assert-True ($bootstrap.IndexOf('DO $fresh_only$') -lt $bootstrap.IndexOf('DO $roles$')) "The fresh-only guard must run before role creation."
Assert-True ($bootstrap.Contains("rolname IN ('customer_service_migrator', 'customer_service_runtime')")) "Existing service roles must block automatic takeover."
Assert-True ($bootstrap.Contains('database already contains user objects')) "Existing user objects must block fresh bootstrap."
Assert-True ($bootstrap.Contains('CREATE SCHEMA customer_service AUTHORIZATION customer_service_migrator')) "The fresh bootstrap must assign schema ownership to the migrator."
Assert-True (-not $bootstrap.Contains('CREATE SCHEMA IF NOT EXISTS')) "The fresh bootstrap must never accept an existing schema."
Assert-True (-not ($bootstrap -match '(?im)^\s*ALTER\s+SCHEMA\b|^\s*ALTER\s+ROLE\s+\S+\s+WITH\b')) "The fresh bootstrap must not repair or take over existing roles or schemas."
Assert-True ($bootstrap.Contains('GRANT USAGE ON SCHEMA customer_service TO customer_service_runtime')) "The runtime role needs schema usage."
Assert-True ($bootstrap.Contains('REVOKE CREATE ON SCHEMA customer_service FROM customer_service_runtime')) "The runtime role must not create schema objects."
Assert-True ($bootstrap.Contains('REVOKE ALL ON ALL TABLES IN SCHEMA customer_service FROM customer_service_runtime')) "The fresh bootstrap must close table grants before assigning DML."
Assert-True ($bootstrap.Contains('GRANT USAGE ON ALL SEQUENCES IN SCHEMA customer_service')) "The runtime role needs only sequence usage."
Assert-True (-not $bootstrap.Contains('GRANT USAGE, SELECT ON ALL SEQUENCES')) "The bootstrap must not grant extra sequence read/update privileges."
Assert-True ($bootstrap.Contains('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC, customer_service_migrator, customer_service_runtime')) "Fresh bootstrap must close inherited database TEMP."
Assert-True ($bootstrap.Contains('ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator') -and $bootstrap.Contains('REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, customer_service_runtime')) "Future migrator routines must not inherit PUBLIC/runtime EXECUTE."
Assert-True ($bootstrap.Contains('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_service')) "Current routines must close PUBLIC/runtime EXECUTE."
Assert-True (-not ($bootstrap -match '(?im)^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b')) "The role bootstrap must not mutate business data."
Assert-True ($initializer.Contains('missing:legacy-public-data')) "Existing legacy public-schema volumes must be detected."
Assert-True ($initializer.Contains('Automatic migration is not authorized')) "Legacy public-schema detection must fail explicitly."
Assert-True ($initializer.Contains('Bootstrap and automatic takeover are not authorized')) "Every existing customer_service schema must fail closed."
Assert-True ($initializer.Contains('already initialized named volume')) "Missing schemas on named volumes must still refuse bootstrap."
Assert-True (-not $initializer.Contains('001_customer_service_schema_roles.sql')) "The named-volume helper must never load bootstrap SQL."
Assert-True (-not ($initializer -match '(?i)docker\s+exec\s+-i')) "The named-volume helper must never pipe mutation SQL into PostgreSQL."
Assert-True (-not ($initializer -match '(?i)docker\s+compose\s+down|docker\s+volume\s+(rm|prune)')) "The initializer must never delete local volumes."
Assert-True (-not ($compatibility -match '(?im)^\s*(ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|DELETE|UPDATE|INSERT)\b')) "Existing-schema compatibility SQL must remain catalog-read-only."
Assert-True ($compatibility.Contains("'search_path=customer_service, pg_catalog' = ANY(role.rolconfig)")) "Existing roles must retain the fixed default search path without helper repair."
Assert-True ($compatibility.Contains("'TRUNCATE'") -and $compatibility.Contains("'REFERENCES'") -and $compatibility.Contains("'TRIGGER'")) "Compatibility review must close extra table privileges."
Assert-True ($compatibility.Contains("has_sequence_privilege('customer_service_runtime', c.oid, 'UPDATE')")) "Compatibility review must reject sequence UPDATE."
Assert-True ($compatibility.Contains("has_sequence_privilege('customer_service_migrator', c.oid, 'USAGE')")) "Compatibility review must reject migrator external sequence writes."
Assert-True ($compatibility.Contains("has_schema_privilege('customer_service_runtime', n.oid, 'CREATE')")) "Compatibility review must reject runtime CREATE outside customer_service."
Assert-True ($compatibility.Contains("has_database_privilege('customer_service_runtime', current_database(), 'CREATE')")) "Compatibility review must reject creation of new external schemas."
Assert-True ($compatibility.Contains("has_database_privilege('customer_service_runtime', current_database(), 'TEMP')")) "Compatibility review must reject inherited database TEMP."
Assert-True ($compatibility.Contains("has_function_privilege('customer_service_runtime', routine.oid, 'EXECUTE')")) "Compatibility review must reject executable routines outside customer_service."
Assert-True ($compatibility.Contains("has_any_column_privilege('customer_service_runtime', c.oid, 'INSERT,UPDATE,REFERENCES')")) "Compatibility review must reject external column-level writes."
Assert-True ($compatibility.Contains('aclexplode(d.defaclacl)')) "Compatibility review must close migrator default ACL drift."
Assert-True ($compatibility.Contains("defaclobjtype = 'r'") -and $compatibility.Contains("defaclobjtype = 'S'")) "Compatibility review must validate exact table and sequence default privileges."
Assert-True ($compatibility.Contains('pg_auth_members')) "Compatibility review must reject role-membership escalation."
Assert-True ($compatibility.Contains("COUNT(*) FILTER (WHERE NOT acl.is_grantable")) "Compatibility review must reject current ACL grant options."
Assert-True ($compatibility.Contains('routine.prosecdef')) "Compatibility review must reject security-definer or wrongly owned customer-service routines."
Assert-True ($compatibility.Contains("function_defaults.defaclobjtype = 'f'")) "Compatibility review must require closed function default ACLs."
Assert-True ($compatibility.Contains('function_defaults.defaclnamespace = 0')) "Function EXECUTE defaults must be closed at the PostgreSQL role-wide level."
Assert-True ($postgres.Contains('input.Schema != CustomerServiceDatabaseSchema')) "The runtime must reject arbitrary schema identifiers."
Assert-True ($postgres.Contains('customer-service database roles must target the same endpoint')) "Runtime and migration DSNs must identify one endpoint."
Assert-True ($postgres.Contains('pg_control_system()')) "Connected roles must validate the PostgreSQL cluster identifier."
Assert-True ($postgres.Contains('customer_service_schema_migrations')) "The service must keep an independent migration history."
Assert-True ($postgres.Contains('customer-service runtime role exceeds its owned schema boundary')) "The runtime must validate cross-schema privileges."
Assert-True ($postgres.IndexOf('validateMigrationDefaultPrivileges(ctx, migrationDB)') -lt $postgres.IndexOf('migrateCustomerServiceSchema(ctx, migrationDB)')) "Default ACL drift must fail before migrations execute."
Assert-True ($postgres.IndexOf('validateRuntimePreMigrationBoundary(ctx, db)') -lt $postgres.IndexOf('migrateCustomerServiceSchema(ctx, migrationDB)')) "Runtime privilege drift must fail before migrations execute."
Assert-True ($postgres.IndexOf('pg_advisory_xact_lock') -lt $postgres.IndexOf('validateMigrationBoundary(ctx, tx)')) "Migration checks must rerun inside the locked transaction."
Assert-True ($postgres.IndexOf('validateRuntimePreMigrationBoundary(ctx, tx)') -lt $postgres.IndexOf('CREATE TABLE IF NOT EXISTS customer_service.customer_service_schema_migrations')) "Runtime drift must fail inside the transaction before migration objects or history are touched."
Assert-True ($main.Contains('production customer-service storage requires PostgreSQL')) "Production mode must not fall back to local adapters."

Write-Host "customer-service synthetic PostgreSQL schema-role config gate passed"
