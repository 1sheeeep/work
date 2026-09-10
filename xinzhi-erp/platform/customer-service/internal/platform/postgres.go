package platform

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"shopify-support-platform/internal/records"
)

//go:embed migrations/*.sql
var migrationFiles embed.FS

const (
	CustomerServiceDatabaseSchema = "customer_service"
	customerServiceRuntimeRole    = "customer_service_runtime"
	customerServiceMigrationRole  = "customer_service_migrator"
)

type PostgresStoreConfig struct {
	DatabaseURL          string
	MigrationDatabaseURL string
	Schema               string
}

type PostgresStore struct {
	db *sql.DB
}

type postgresQueryer interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func OpenPostgresStore(ctx context.Context, input PostgresStoreConfig) (*PostgresStore, error) {
	config, err := normalizePostgresStoreConfig(input)
	if err != nil {
		return nil, err
	}
	migrationDB, err := openCustomerServiceDatabase(config.MigrationDatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("customer-service migration database configuration is invalid")
	}
	migrationDB.SetMaxOpenConns(1)
	migrationDB.SetMaxIdleConns(1)
	migrationIdentity, err := validateDatabaseIdentity(ctx, migrationDB, customerServiceMigrationRole)
	if err != nil {
		_ = migrationDB.Close()
		return nil, err
	}
	if err := validateMigrationBoundary(ctx, migrationDB); err != nil {
		_ = migrationDB.Close()
		return nil, err
	}
	if err := validateMigrationDefaultPrivileges(ctx, migrationDB); err != nil {
		_ = migrationDB.Close()
		return nil, err
	}

	db, err := openCustomerServiceDatabase(config.DatabaseURL)
	if err != nil {
		_ = migrationDB.Close()
		return nil, fmt.Errorf("customer-service runtime database configuration is invalid")
	}
	db.SetMaxOpenConns(envPositiveInt("DB_MAX_OPEN_CONNS", 30))
	db.SetMaxIdleConns(envPositiveInt("DB_MAX_IDLE_CONNS", 10))
	db.SetConnMaxLifetime(envPositiveDuration("DB_CONN_MAX_LIFETIME", 30*time.Minute))
	runtimeIdentity, err := validateDatabaseIdentity(ctx, db, customerServiceRuntimeRole)
	if err != nil {
		_ = migrationDB.Close()
		_ = db.Close()
		return nil, err
	}
	if !sameDatabaseIdentity(runtimeIdentity, migrationIdentity) {
		_ = migrationDB.Close()
		_ = db.Close()
		return nil, fmt.Errorf("customer-service database roles reached different server endpoints")
	}
	if err := validateRuntimePreMigrationBoundary(ctx, db); err != nil {
		_ = migrationDB.Close()
		_ = db.Close()
		return nil, err
	}
	if err := migrateCustomerServiceSchema(ctx, migrationDB); err != nil {
		_ = migrationDB.Close()
		_ = db.Close()
		return nil, err
	}
	if err := validateMigrationBoundary(ctx, migrationDB); err != nil {
		_ = migrationDB.Close()
		_ = db.Close()
		return nil, err
	}
	if err := validateMigrationDefaultPrivileges(ctx, migrationDB); err != nil {
		_ = migrationDB.Close()
		_ = db.Close()
		return nil, err
	}
	if err := migrationDB.Close(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("close customer-service migration database failed")
	}
	if err := validateRuntimeBoundary(ctx, db); err != nil {
		_ = db.Close()
		return nil, err
	}
	return &PostgresStore{db: db}, nil
}

func normalizePostgresStoreConfig(input PostgresStoreConfig) (PostgresStoreConfig, error) {
	input.DatabaseURL = strings.TrimSpace(input.DatabaseURL)
	input.MigrationDatabaseURL = strings.TrimSpace(input.MigrationDatabaseURL)
	input.Schema = strings.TrimSpace(input.Schema)
	if input.DatabaseURL == "" {
		return PostgresStoreConfig{}, fmt.Errorf("%w: DATABASE_URL is required", ErrInvalid)
	}
	if input.MigrationDatabaseURL == "" {
		return PostgresStoreConfig{}, fmt.Errorf("%w: XZDESK_DATABASE_MIGRATION_URL is required", ErrInvalid)
	}
	if input.Schema != CustomerServiceDatabaseSchema {
		return PostgresStoreConfig{}, fmt.Errorf("%w: XZDESK_DATABASE_SCHEMA must be customer_service", ErrInvalid)
	}
	runtimeEndpoint, err := postgresEndpointIdentity(input.DatabaseURL)
	if err != nil {
		return PostgresStoreConfig{}, fmt.Errorf("%w: DATABASE_URL is invalid", ErrInvalid)
	}
	migrationEndpoint, err := postgresEndpointIdentity(input.MigrationDatabaseURL)
	if err != nil {
		return PostgresStoreConfig{}, fmt.Errorf("%w: XZDESK_DATABASE_MIGRATION_URL is invalid", ErrInvalid)
	}
	if runtimeEndpoint != migrationEndpoint {
		return PostgresStoreConfig{}, fmt.Errorf("%w: customer-service database roles must target the same endpoint", ErrInvalid)
	}
	return input, nil
}

func postgresEndpointIdentity(databaseURL string) (string, error) {
	config, err := pgx.ParseConfig(strings.TrimSpace(databaseURL))
	if err != nil || strings.TrimSpace(config.Host) == "" || strings.TrimSpace(config.Database) == "" {
		return "", fmt.Errorf("invalid PostgreSQL endpoint")
	}
	hosts := []string{normalizedPostgresHostPort(config.Host, config.Port)}
	for _, fallback := range config.Fallbacks {
		hosts = append(hosts, normalizedPostgresHostPort(fallback.Host, fallback.Port))
	}
	return strings.TrimSpace(config.Database) + "@" + strings.Join(hosts, ","), nil
}

func normalizedPostgresHostPort(host string, port uint16) string {
	return strings.ToLower(strings.TrimSpace(host)) + ":" + strconv.Itoa(int(port))
}

func openCustomerServiceDatabase(databaseURL string) (*sql.DB, error) {
	config, err := pgx.ParseConfig(strings.TrimSpace(databaseURL))
	if err != nil {
		return nil, err
	}
	if config.RuntimeParams == nil {
		config.RuntimeParams = map[string]string{}
	}
	config.RuntimeParams["search_path"] = CustomerServiceDatabaseSchema + ",pg_catalog"
	config.RuntimeParams["application_name"] = "xzdesk_customer_service"
	return sql.OpenDB(stdlib.GetConnector(*config)), nil
}

func envPositiveInt(name string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func envPositiveDuration(name string, fallback time.Duration) time.Duration {
	value, err := time.ParseDuration(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}

func (s *PostgresStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *PostgresStore) Health(ctx context.Context) HealthStatus {
	if s == nil || s.db == nil {
		return HealthStatus{Name: "postgres", OK: false, Error: "database is not initialized"}
	}
	if err := s.db.PingContext(ctx); err != nil {
		return HealthStatus{Name: "postgres", OK: false, Error: "database is unavailable"}
	}
	return HealthStatus{Name: "postgres", OK: true}
}

type databaseIdentity struct {
	database         string
	databaseOID      uint32
	systemIdentifier string
	serverAddress    string
	serverPort       int
}

func validateDatabaseIdentity(ctx context.Context, db *sql.DB, expectedRole string) (databaseIdentity, error) {
	var database, user, schema, searchPath, systemIdentifier, serverAddress string
	var databaseOID uint32
	var serverPort int
	var superuser, createRole, createDB, replication, bypassRLS, defaultSearchPath, hasMembership, databaseTemp bool
	err := db.QueryRowContext(ctx, `
		SELECT current_database(), d.oid, current_user, current_schema(), current_setting('search_path'),
		       control.system_identifier::text,
		       COALESCE(inet_server_addr()::text, ''), COALESCE(inet_server_port(), 0),
		       r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolreplication, r.rolbypassrls,
		       'search_path=customer_service, pg_catalog' = ANY(COALESCE(r.rolconfig, ARRAY[]::text[])),
		       EXISTS (SELECT 1 FROM pg_auth_members memberships
		         WHERE memberships.member = r.oid OR memberships.roleid = r.oid),
		       has_database_privilege(current_user, current_database(), 'TEMP')
		FROM pg_roles r
		JOIN pg_database d ON d.datname = current_database()
		CROSS JOIN pg_control_system() control
		WHERE r.rolname = current_user
	`).Scan(&database, &databaseOID, &user, &schema, &searchPath, &systemIdentifier,
		&serverAddress, &serverPort, &superuser, &createRole, &createDB, &replication,
		&bypassRLS, &defaultSearchPath, &hasMembership, &databaseTemp)
	if err != nil {
		return databaseIdentity{}, fmt.Errorf("customer-service database identity validation failed")
	}
	if database == "" || user != expectedRole || schema != CustomerServiceDatabaseSchema ||
		normalizeSearchPath(searchPath) != CustomerServiceDatabaseSchema+",pg_catalog" ||
		systemIdentifier == "" || !defaultSearchPath || hasMembership || databaseTemp ||
		superuser || createRole || createDB || replication || bypassRLS {
		return databaseIdentity{}, fmt.Errorf("customer-service database identity does not match the schema-role contract")
	}
	return databaseIdentity{
		database: database, databaseOID: databaseOID, systemIdentifier: systemIdentifier,
		serverAddress: serverAddress, serverPort: serverPort,
	}, nil
}

func sameDatabaseIdentity(left, right databaseIdentity) bool {
	return left.database == right.database &&
		left.databaseOID == right.databaseOID &&
		left.systemIdentifier == right.systemIdentifier &&
		left.serverAddress == right.serverAddress &&
		left.serverPort == right.serverPort
}

func normalizeSearchPath(value string) string {
	parts := strings.Split(value, ",")
	for index := range parts {
		parts[index] = strings.Trim(strings.TrimSpace(parts[index]), `"`)
	}
	return strings.Join(parts, ",")
}

func migrateCustomerServiceSchema(ctx context.Context, db *sql.DB) error {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("start customer-service migrations failed")
	}
	defer func() {
		_ = tx.Rollback()
	}()
	const migrationLockID int64 = 6363137172437496147
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, migrationLockID); err != nil {
		return fmt.Errorf("acquire customer-service migration lock failed")
	}
	if err := validateMigrationBoundary(ctx, tx); err != nil {
		return err
	}
	if err := validateMigrationDefaultPrivileges(ctx, tx); err != nil {
		return err
	}
	if err := validateRuntimePreMigrationBoundary(ctx, tx); err != nil {
		return err
	}
	var historyExists bool
	if err := tx.QueryRowContext(ctx, `
		SELECT to_regclass('customer_service.customer_service_schema_migrations') IS NOT NULL
	`).Scan(&historyExists); err != nil {
		return fmt.Errorf("inspect customer-service migration history failed")
	}
	if !historyExists {
		var existingRelations int
		if err := tx.QueryRowContext(ctx, `
			SELECT COUNT(*) FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p','S','v','m','f')
		`).Scan(&existingRelations); err != nil {
			return fmt.Errorf("inspect customer-service schema failed")
		}
		if existingRelations != 0 {
			return fmt.Errorf("customer-service schema is nonempty but has no migration history")
		}
	}
	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS customer_service.customer_service_schema_migrations (
			filename TEXT PRIMARY KEY,
			sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
			applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)
	`); err != nil {
		return fmt.Errorf("create customer-service migration history failed")
	}
	entries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("read customer-service migrations failed")
	}
	sort.Slice(entries, func(left, right int) bool { return entries[left].Name() < entries[right].Name() })
	applied, err := readAppliedCustomerServiceMigrations(ctx, tx)
	if err != nil {
		return err
	}
	expected := make(map[string]string)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		raw, err := migrationFiles.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("read customer-service migration %s failed", entry.Name())
		}
		digest := sha256.Sum256(raw)
		checksum := hex.EncodeToString(digest[:])
		expected[entry.Name()] = checksum
		if recorded, ok := applied[entry.Name()]; ok {
			if recorded != checksum {
				return fmt.Errorf("customer-service migration %s checksum does not match history", entry.Name())
			}
			continue
		}
		if _, err := tx.ExecContext(ctx, string(raw)); err != nil {
			return fmt.Errorf("apply customer-service migration %s failed", entry.Name())
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO customer_service.customer_service_schema_migrations(filename, sha256)
			VALUES ($1, $2)
		`, entry.Name(), checksum); err != nil {
			return fmt.Errorf("record customer-service migration %s failed", entry.Name())
		}
	}
	for filename := range applied {
		if _, ok := expected[filename]; !ok {
			return fmt.Errorf("customer-service migration history contains an unknown migration")
		}
	}
	if !historyExists {
		if _, err := tx.ExecContext(ctx, `
			REVOKE ALL ON customer_service.customer_service_schema_migrations
			FROM customer_service_runtime;
			GRANT SELECT ON customer_service.customer_service_schema_migrations
			TO customer_service_runtime
		`); err != nil {
			return fmt.Errorf("protect customer-service migration history failed")
		}
	}
	if err := validateMigrationBoundary(ctx, tx); err != nil {
		return err
	}
	if err := validateMigrationDefaultPrivileges(ctx, tx); err != nil {
		return err
	}
	if err := validateRuntimeBoundary(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit customer-service migrations failed")
	}
	return nil
}

func readAppliedCustomerServiceMigrations(ctx context.Context, tx *sql.Tx) (map[string]string, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT filename, sha256
		FROM customer_service.customer_service_schema_migrations
		ORDER BY filename
	`)
	if err != nil {
		return nil, fmt.Errorf("read customer-service migration history failed")
	}
	defer rows.Close()
	applied := map[string]string{}
	for rows.Next() {
		var filename, checksum string
		if err := rows.Scan(&filename, &checksum); err != nil {
			return nil, fmt.Errorf("read customer-service migration history failed")
		}
		applied[filename] = checksum
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("read customer-service migration history failed")
	}
	return applied, nil
}

func validateMigrationBoundary(ctx context.Context, db postgresQueryer) error {
	var schemaOwner string
	var wronglyOwned, wronglyOwnedRoutines, unexpectedColumnACLs, foreignOwned, otherSchemaCreate int
	var databaseCreate, databaseTemp bool
	err := db.QueryRowContext(ctx, `
		SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'customer_service'
	`).Scan(&schemaOwner)
	if err != nil || schemaOwner != customerServiceMigrationRole {
		return fmt.Errorf("customer-service schema ownership does not match the migration role")
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p','S','v','m','f')
		  AND pg_get_userbyid(c.relowner) <> 'customer_service_migrator'
	`).Scan(&wronglyOwned); err != nil || wronglyOwned != 0 {
		return fmt.Errorf("customer-service relation ownership is invalid")
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
		WHERE n.nspname = 'customer_service'
		  AND (
		    pg_get_userbyid(routine.proowner) <> 'customer_service_migrator'
		    OR routine.prosecdef
		    OR EXISTS (
		      SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
		      WHERE acl.grantee <> routine.proowner
		    )
		  )
	`).Scan(&wronglyOwnedRoutines); err != nil || wronglyOwnedRoutines != 0 {
		return fmt.Errorf("customer-service routine ownership, security mode or ACL is invalid")
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pg_attribute column_acl
		JOIN pg_class relation ON relation.oid = column_acl.attrelid
		JOIN pg_namespace n ON n.oid = relation.relnamespace
		WHERE n.nspname = 'customer_service'
		  AND relation.relkind IN ('r','p','v','m','f')
		  AND column_acl.attnum > 0 AND NOT column_acl.attisdropped
		  AND column_acl.attacl IS NOT NULL
	`).Scan(&unexpectedColumnACLs); err != nil || unexpectedColumnACLs != 0 {
		return fmt.Errorf("customer-service column ACLs do not match the schema-role contract")
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		  AND pg_get_userbyid(c.relowner) IN ('customer_service_migrator','customer_service_runtime')
	`).Scan(&foreignOwned); err != nil || foreignOwned != 0 {
		return fmt.Errorf("customer-service roles own relations outside their schema")
	}
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pg_namespace n
		WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		  AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		  AND has_schema_privilege('customer_service_migrator', n.oid, 'CREATE')
	`).Scan(&otherSchemaCreate); err != nil || otherSchemaCreate != 0 {
		return fmt.Errorf("customer-service migration role can create outside its schema")
	}
	if err := db.QueryRowContext(ctx, `
		SELECT has_database_privilege(current_user, current_database(), 'CREATE'),
		       has_database_privilege(current_user, current_database(), 'TEMP')
	`).Scan(&databaseCreate, &databaseTemp); err != nil || databaseCreate || databaseTemp {
		return fmt.Errorf("customer-service migration role exceeds its database boundary")
	}
	var foreignTableWrite, foreignSequenceWrite, foreignRoutineExecute bool
	if err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
		  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND c.relkind IN ('r','p','v','m','f')
		    AND (has_table_privilege(current_user, c.oid, 'INSERT')
		      OR has_table_privilege(current_user, c.oid, 'UPDATE')
		      OR has_table_privilege(current_user, c.oid, 'DELETE')
		      OR has_table_privilege(current_user, c.oid, 'TRUNCATE')
		      OR has_table_privilege(current_user, c.oid, 'REFERENCES')
		      OR has_table_privilege(current_user, c.oid, 'TRIGGER')
		      OR has_any_column_privilege(current_user, c.oid, 'INSERT,UPDATE,REFERENCES'))
		), EXISTS (
		  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND c.relkind = 'S'
		    AND (has_sequence_privilege(current_user, c.oid, 'USAGE')
		      OR has_sequence_privilege(current_user, c.oid, 'SELECT')
		      OR has_sequence_privilege(current_user, c.oid, 'UPDATE'))
		), EXISTS (
		  SELECT 1 FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND has_function_privilege(current_user, routine.oid, 'EXECUTE')
		)
	`).Scan(&foreignTableWrite, &foreignSequenceWrite, &foreignRoutineExecute); err != nil {
		return fmt.Errorf("customer-service migration privilege validation failed")
	}
	if foreignTableWrite || foreignSequenceWrite || foreignRoutineExecute {
		return fmt.Errorf("customer-service migration role can write outside its schema")
	}
	return nil
}

func validateMigrationDefaultPrivileges(ctx context.Context, db postgresQueryer) error {
	var expectedGrants, unexpectedGrants int
	var functionDefaultsClosed bool
	if err := db.QueryRowContext(ctx, `
		WITH role_ids AS (
		  SELECT
		    (SELECT oid FROM pg_roles WHERE rolname = 'customer_service_migrator') AS migrator_oid,
		    (SELECT oid FROM pg_roles WHERE rolname = 'customer_service_runtime') AS runtime_oid
		), non_owner_default_grants AS (
		  SELECT COALESCE(n.nspname, '') AS nspname, d.defaclobjtype, grants.grantee,
		         grants.privilege_type, grants.is_grantable,
		         roles.runtime_oid
		  FROM pg_default_acl d
		  LEFT JOIN pg_namespace n ON n.oid = d.defaclnamespace
		  CROSS JOIN LATERAL aclexplode(d.defaclacl) AS grants
		  CROSS JOIN role_ids roles
		  WHERE d.defaclrole = roles.migrator_oid
		    AND grants.grantee <> roles.migrator_oid
		)
		SELECT
		  COUNT(*) FILTER (WHERE
		    nspname = 'customer_service'
		    AND grantee = runtime_oid
		    AND NOT is_grantable
		    AND ((defaclobjtype = 'r' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
		      OR (defaclobjtype = 'S' AND privilege_type = 'USAGE'))
		  ),
		  COUNT(*) FILTER (WHERE NOT (
		    nspname = 'customer_service'
		    AND grantee = runtime_oid
		    AND NOT is_grantable
		    AND ((defaclobjtype = 'r' AND privilege_type IN ('SELECT','INSERT','UPDATE','DELETE'))
		      OR (defaclobjtype = 'S' AND privilege_type = 'USAGE'))
		  )),
		  EXISTS (
		    SELECT 1 FROM pg_default_acl function_defaults
		    CROSS JOIN role_ids function_roles
		    WHERE function_defaults.defaclrole = function_roles.migrator_oid
		      AND function_defaults.defaclnamespace = 0
		      AND function_defaults.defaclobjtype = 'f'
		      AND NOT EXISTS (
		        SELECT 1 FROM aclexplode(function_defaults.defaclacl) function_grant
		        WHERE function_grant.grantee <> function_roles.migrator_oid
		      )
		  )
		FROM non_owner_default_grants
	`).Scan(&expectedGrants, &unexpectedGrants, &functionDefaultsClosed); err != nil {
		return fmt.Errorf("customer-service default privilege validation failed")
	}
	if expectedGrants != 5 || unexpectedGrants != 0 || !functionDefaultsClosed {
		return fmt.Errorf("customer-service migration default privileges do not match the schema-role contract")
	}
	return nil
}

func validateRuntimePreMigrationBoundary(ctx context.Context, db postgresQueryer) error {
	var historyExists bool
	if err := db.QueryRowContext(ctx, `
		SELECT to_regclass('customer_service.customer_service_schema_migrations') IS NOT NULL
	`).Scan(&historyExists); err != nil {
		return fmt.Errorf("inspect customer-service runtime migration history failed")
	}
	if historyExists {
		return validateRuntimeBoundary(ctx, db)
	}

	var existingRelations int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p','S','v','m','f')
	`).Scan(&existingRelations); err != nil {
		return fmt.Errorf("inspect customer-service schema before migration failed")
	}
	if existingRelations != 0 {
		return fmt.Errorf("customer-service schema is nonempty but has no migration history")
	}

	var schemaUsage, schemaCreate bool
	if err := db.QueryRowContext(ctx, `
		SELECT has_schema_privilege($1, 'customer_service', 'USAGE'),
		       has_schema_privilege($1, 'customer_service', 'CREATE')
	`, customerServiceRuntimeRole).Scan(&schemaUsage, &schemaCreate); err != nil {
		return fmt.Errorf("customer-service runtime privilege validation failed")
	}
	if !schemaUsage || schemaCreate {
		return fmt.Errorf("customer-service runtime privileges do not match the schema-role contract")
	}
	return validateRuntimeExternalBoundary(ctx, db)
}

func validateRuntimeBoundary(ctx context.Context, db postgresQueryer) error {
	var schemaUsage, schemaCreate, tablesReady, sequencesReady, supportedRelations, columnACLsClosed, routinesClosed, historyProtected bool
	if err := db.QueryRowContext(ctx, `
		SELECT has_schema_privilege($1, 'customer_service', 'USAGE'),
		       has_schema_privilege($1, 'customer_service', 'CREATE'),
		       NOT EXISTS (
		         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		         WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p')
		           AND c.relname <> 'customer_service_schema_migrations'
		           AND NOT (has_table_privilege($1, c.oid, 'SELECT')
		             AND has_table_privilege($1, c.oid, 'INSERT')
		             AND has_table_privilege($1, c.oid, 'UPDATE')
		             AND has_table_privilege($1, c.oid, 'DELETE')
		             AND NOT has_table_privilege($1, c.oid, 'TRUNCATE')
		             AND NOT has_table_privilege($1, c.oid, 'REFERENCES')
		             AND NOT has_table_privilege($1, c.oid, 'TRIGGER'))
		       ),
		       NOT EXISTS (
		         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		         WHERE n.nspname = 'customer_service' AND c.relkind = 'S'
		           AND NOT (has_sequence_privilege($1, c.oid, 'USAGE')
		             AND NOT has_sequence_privilege($1, c.oid, 'SELECT')
		             AND NOT has_sequence_privilege($1, c.oid, 'UPDATE'))
		       ),
		       NOT EXISTS (
		         SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		         WHERE n.nspname = 'customer_service' AND c.relkind IN ('v','m','f')
		       ),
		       NOT EXISTS (
		         SELECT 1 FROM pg_attribute column_acl
		         JOIN pg_class relation ON relation.oid = column_acl.attrelid
		         JOIN pg_namespace n ON n.oid = relation.relnamespace
		         WHERE n.nspname = 'customer_service'
		           AND relation.relkind IN ('r','p','v','m','f')
		           AND column_acl.attnum > 0 AND NOT column_acl.attisdropped
		           AND column_acl.attacl IS NOT NULL
		       ),
		       NOT EXISTS (
		         SELECT 1 FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
		         WHERE n.nspname = 'customer_service'
		           AND (has_function_privilege($1, routine.oid, 'EXECUTE')
		             OR EXISTS (
		               SELECT 1 FROM aclexplode(COALESCE(routine.proacl, acldefault('f', routine.proowner))) acl
		               WHERE acl.grantee <> routine.proowner
		             ))
		       ),
		       has_table_privilege($1,
		         'customer_service.customer_service_schema_migrations', 'SELECT')
		         AND NOT has_table_privilege($1,
		           'customer_service.customer_service_schema_migrations', 'INSERT')
		         AND NOT has_table_privilege($1,
		           'customer_service.customer_service_schema_migrations', 'UPDATE')
		         AND NOT has_table_privilege($1,
		           'customer_service.customer_service_schema_migrations', 'DELETE')
		         AND NOT has_table_privilege($1,
		           'customer_service.customer_service_schema_migrations', 'TRUNCATE')
		         AND NOT has_table_privilege($1,
		           'customer_service.customer_service_schema_migrations', 'REFERENCES')
		         AND NOT has_table_privilege($1,
		           'customer_service.customer_service_schema_migrations', 'TRIGGER')
	`, customerServiceRuntimeRole).Scan(&schemaUsage, &schemaCreate, &tablesReady, &sequencesReady, &supportedRelations, &columnACLsClosed, &routinesClosed, &historyProtected); err != nil {
		return fmt.Errorf("customer-service runtime privilege validation failed")
	}
	if !schemaUsage || schemaCreate || !tablesReady || !sequencesReady || !supportedRelations || !columnACLsClosed || !routinesClosed || !historyProtected {
		return fmt.Errorf("customer-service runtime privileges do not match the schema-role contract")
	}
	var schemaACLExact, tableACLsExact, sequenceACLsExact, historyACLExact bool
	if err := db.QueryRowContext(ctx, `
		WITH runtime_role AS (
		  SELECT oid FROM pg_roles WHERE rolname = $1
		)
		SELECT
		  (
		    SELECT COUNT(*) FILTER (WHERE acl.grantee <> n.nspowner) = 1
		      AND COUNT(*) FILTER (WHERE acl.grantee = runtime.oid
		        AND NOT acl.is_grantable AND acl.privilege_type = 'USAGE') = 1
		    FROM pg_namespace n
		    CROSS JOIN runtime_role runtime
		    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) acl
		    WHERE n.nspname = 'customer_service'
		  ),
		  NOT EXISTS (
		    SELECT 1 FROM pg_class c
		    JOIN pg_namespace n ON n.oid = c.relnamespace
		    CROSS JOIN runtime_role runtime
		    WHERE n.nspname = 'customer_service' AND c.relkind IN ('r','p')
		      AND c.relname <> 'customer_service_schema_migrations'
		      AND NOT (
		        SELECT COUNT(*) FILTER (WHERE acl.grantee <> c.relowner) = 4
		          AND COUNT(*) FILTER (WHERE NOT acl.is_grantable
		            AND acl.grantee = runtime.oid
		            AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE')) = 4
		        FROM aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
		      )
		  ),
		  NOT EXISTS (
		    SELECT 1 FROM pg_class c
		    JOIN pg_namespace n ON n.oid = c.relnamespace
		    CROSS JOIN runtime_role runtime
		    WHERE n.nspname = 'customer_service' AND c.relkind = 'S'
		      AND NOT (
		        SELECT COUNT(*) FILTER (WHERE acl.grantee <> c.relowner) = 1
		          AND COUNT(*) FILTER (WHERE NOT acl.is_grantable
		            AND acl.grantee = runtime.oid AND acl.privilege_type = 'USAGE') = 1
		        FROM aclexplode(COALESCE(c.relacl, acldefault('S', c.relowner))) acl
		      )
		  ),
		  (
		    SELECT COUNT(*) FILTER (WHERE acl.grantee <> c.relowner) = 1
		      AND COUNT(*) FILTER (WHERE NOT acl.is_grantable
		        AND acl.grantee = runtime.oid AND acl.privilege_type = 'SELECT') = 1
		    FROM pg_class c
		    JOIN pg_namespace n ON n.oid = c.relnamespace
		    CROSS JOIN runtime_role runtime
		    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
		    WHERE n.nspname = 'customer_service'
		      AND c.relname = 'customer_service_schema_migrations'
		  )
	`, customerServiceRuntimeRole).Scan(&schemaACLExact, &tableACLsExact, &sequenceACLsExact, &historyACLExact); err != nil {
		return fmt.Errorf("customer-service runtime ACL validation failed")
	}
	if !schemaACLExact || !tableACLsExact || !sequenceACLsExact || !historyACLExact {
		return fmt.Errorf("customer-service runtime ACLs do not match the schema-role contract")
	}
	return validateRuntimeExternalBoundary(ctx, db)
}

func validateRuntimeExternalBoundary(ctx context.Context, db postgresQueryer) error {
	var databaseCreate, databaseTemp, foreignSchemaCreate, foreignWrite, foreignSequenceWrite, foreignRoutineExecute, ownedRelation bool
	if err := db.QueryRowContext(ctx, `
		SELECT has_database_privilege($1, current_database(), 'CREATE'),
		       has_database_privilege($1, current_database(), 'TEMP'), EXISTS (
		  SELECT 1 FROM pg_namespace n
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND has_schema_privilege($1, n.oid, 'CREATE')
		), EXISTS (
		  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND c.relkind IN ('r','p','v','m','f')
		    AND (has_table_privilege($1, c.oid, 'INSERT')
		      OR has_table_privilege($1, c.oid, 'UPDATE')
		      OR has_table_privilege($1, c.oid, 'DELETE')
		      OR has_table_privilege($1, c.oid, 'TRUNCATE')
		      OR has_table_privilege($1, c.oid, 'REFERENCES')
		      OR has_table_privilege($1, c.oid, 'TRIGGER')
		      OR has_any_column_privilege($1, c.oid, 'INSERT,UPDATE,REFERENCES'))
		), EXISTS (
		  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND c.relkind = 'S'
		    AND (has_sequence_privilege($1, c.oid, 'USAGE')
		      OR has_sequence_privilege($1, c.oid, 'SELECT')
		      OR has_sequence_privilege($1, c.oid, 'UPDATE'))
		), EXISTS (
		  SELECT 1 FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
		  WHERE n.nspname NOT IN ('customer_service','pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND has_function_privilege($1, routine.oid, 'EXECUTE')
		), EXISTS (
		  SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname NOT IN ('pg_catalog','information_schema')
		    AND n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
		    AND pg_get_userbyid(c.relowner) = $1
		)
	`, customerServiceRuntimeRole).Scan(&databaseCreate, &databaseTemp, &foreignSchemaCreate, &foreignWrite, &foreignSequenceWrite, &foreignRoutineExecute, &ownedRelation); err != nil {
		return fmt.Errorf("customer-service cross-schema privilege validation failed")
	}
	if databaseCreate || databaseTemp || foreignSchemaCreate || foreignWrite || foreignSequenceWrite || foreignRoutineExecute || ownedRelation {
		return fmt.Errorf("customer-service runtime role exceeds its owned schema boundary")
	}
	return nil
}

func (s *PostgresStore) CreateUser(ctx context.Context, input User) (User, error) {
	email := normalizeEmail(input.Email)
	if email == "" {
		return User{}, fmt.Errorf("%w: email is required", ErrInvalid)
	}
	if strings.TrimSpace(input.PasswordHash) == "" {
		return User{}, fmt.Errorf("%w: passwordHash is required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("user")
	}
	input.Email = email
	input.DisplayName = defaultString(input.DisplayName, email)
	input.Role = defaultString(input.Role, UserRoleAgent)
	input.Status = defaultString(input.Status, UserStatusActive)
	department, err := normalizeUserDepartment(input.Role, input.Department)
	if err != nil {
		return User{}, err
	}
	input.Department = department
	skillGroup, err := normalizeUserSkillGroupForDepartment(input.Role, input.Department, input.SkillGroup)
	if err != nil {
		return User{}, err
	}
	input.SkillGroup = skillGroup
	input.ReceptionLimit = normalizeReceptionLimit(input.ReceptionLimit)
	input.ReceptionOnline = true
	input.Permissions = normalizePermissions(input.Permissions)
	if err := validateDataScopes(input.DataScopes); err != nil {
		return User{}, err
	}
	input.DataScopes = normalizeDataScopes(input.DataScopes, input.SystemAdmin)
	input.ShopScope = effectiveShopScope(input.ShopScope, input.Role)
	input.ShopScopeIDs = normalizeShopScopeIDs(input.ShopScopeIDs)
	if input.ShopScope != AccessScopeSelected {
		input.ShopScopeIDs = []string{}
	}
	input.WorkbenchShopScope = effectiveWorkbenchShopScope(input.WorkbenchShopScope)
	if err := validateShopScope(input.ShopScope, input.ShopScopeIDs); err != nil {
		return User{}, err
	}
	if err := validateAccessScope(input.WorkbenchShopScope); err != nil {
		return User{}, err
	}
	if err := validateAccessScope(input.ConversationScope); err != nil {
		return User{}, err
	}
	permissions, err := json.Marshal(input.Permissions)
	if err != nil {
		return User{}, err
	}
	dataScopes, err := json.Marshal(input.DataScopes)
	if err != nil {
		return User{}, err
	}
	shopScopeIDs, err := json.Marshal(input.ShopScopeIDs)
	if err != nil {
		return User{}, err
	}
	input.CreatedAt = now
	input.UpdatedAt = now
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO users (id, email, display_name, role, status, department, skill_group, reception_limit, permissions, permissions_customized, data_scopes, shop_scope, shop_scope_ids, shop_scope_configured, workbench_shop_scope, conversation_scope, system_admin, password_hash, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
	`, input.ID, input.Email, input.DisplayName, input.Role, input.Status, input.Department, input.SkillGroup, input.ReceptionLimit, permissions, input.PermissionsCustomized, dataScopes, input.ShopScope, shopScopeIDs, input.SetShopScope, input.WorkbenchShopScope, input.ConversationScope, input.SystemAdmin, input.PasswordHash, input.CreatedAt, input.UpdatedAt)
	if err != nil {
		if strings.Contains(err.Error(), "SQLSTATE 23505") {
			return User{}, fmt.Errorf("%w: email already exists", ErrInvalid)
		}
		return User{}, err
	}
	return input, nil
}

func (s *PostgresStore) ListUsers(ctx context.Context) ([]User, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, email, display_name, role, status, department, skill_group, reception_limit, reception_online, permissions, permissions_customized, data_scopes, shop_scope, shop_scope_ids, workbench_shop_scope, conversation_scope, system_admin, password_hash, created_at, updated_at
		FROM users
		ORDER BY created_at ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetUser(ctx context.Context, id string) (User, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, email, display_name, role, status, department, skill_group, reception_limit, reception_online, permissions, permissions_customized, data_scopes, shop_scope, shop_scope_ids, workbench_shop_scope, conversation_scope, system_admin, password_hash, created_at, updated_at
		FROM users
		WHERE id = $1
	`, id)
	user, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (s *PostgresStore) FindUserByEmail(ctx context.Context, email string) (User, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, email, display_name, role, status, department, skill_group, reception_limit, reception_online, permissions, permissions_customized, data_scopes, shop_scope, shop_scope_ids, workbench_shop_scope, conversation_scope, system_admin, password_hash, created_at, updated_at
		FROM users
		WHERE email = $1
	`, normalizeEmail(email))
	user, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (s *PostgresStore) UpdateUser(ctx context.Context, id string, input User) (User, error) {
	current, err := s.GetUser(ctx, strings.TrimSpace(id))
	if err != nil {
		return User{}, err
	}
	if strings.TrimSpace(input.DisplayName) != "" {
		current.DisplayName = strings.TrimSpace(input.DisplayName)
	}
	if strings.TrimSpace(input.Email) != "" {
		current.Email = normalizeEmail(input.Email)
	}
	if strings.TrimSpace(input.PasswordHash) != "" {
		current.PasswordHash = input.PasswordHash
	}
	if strings.TrimSpace(input.Role) != "" {
		role := strings.TrimSpace(input.Role)
		if role != UserRoleAdmin && role != UserRoleAgent {
			return User{}, fmt.Errorf("%w: unsupported role", ErrInvalid)
		}
		current.Role = role
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err := normalizeUserStatus(input.Status)
		if err != nil {
			return User{}, err
		}
		current.Status = status
	}
	if input.SetDepartment {
		department, err := normalizeUserDepartment(current.Role, input.Department)
		if err != nil {
			return User{}, err
		}
		current.Department = department
	}
	if input.SetSkillGroup {
		skillGroup, err := normalizeUserSkillGroupForDepartment(current.Role, current.Department, input.SkillGroup)
		if err != nil {
			return User{}, err
		}
		current.SkillGroup = skillGroup
	}
	if input.ReceptionLimit != 0 {
		if err := validateReceptionLimit(input.ReceptionLimit); err != nil {
			return User{}, err
		}
		current.ReceptionLimit = input.ReceptionLimit
	}
	if input.SetAccessControl {
		if err := validatePermissions(input.Permissions); err != nil {
			return User{}, err
		}
		if err := validateDataScopes(input.DataScopes); err != nil {
			return User{}, err
		}
		if err := validateShopScope(input.ShopScope, input.ShopScopeIDs); err != nil {
			return User{}, err
		}
		if err := validateAccessScope(input.WorkbenchShopScope); err != nil {
			return User{}, err
		}
		if err := validateAccessScope(input.ConversationScope); err != nil {
			return User{}, err
		}
		current.Permissions = normalizePermissions(input.Permissions)
		current.PermissionsCustomized = input.PermissionsCustomized
		current.DataScopes = normalizeDataScopes(input.DataScopes, current.SystemAdmin)
		current.ShopScope = effectiveShopScope(input.ShopScope, current.Role)
		current.ShopScopeIDs = normalizeShopScopeIDs(input.ShopScopeIDs)
		if current.ShopScope != AccessScopeSelected {
			current.ShopScopeIDs = []string{}
		}
		current.WorkbenchShopScope = strings.TrimSpace(input.WorkbenchShopScope)
		current.ConversationScope = strings.TrimSpace(input.ConversationScope)
	}
	current.ReceptionLimit = normalizeReceptionLimit(current.ReceptionLimit)
	current.Department, _ = normalizeUserDepartment(current.Role, current.Department)
	current.SkillGroup, _ = normalizeUserSkillGroupForDepartment(current.Role, current.Department, current.SkillGroup)
	current.UpdatedAt = time.Now().UTC()
	permissions, err := json.Marshal(current.Permissions)
	if err != nil {
		return User{}, err
	}
	dataScopes, err := json.Marshal(current.DataScopes)
	if err != nil {
		return User{}, err
	}
	shopScopeIDs, err := json.Marshal(current.ShopScopeIDs)
	if err != nil {
		return User{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE users
		SET email = $2, display_name = $3, role = $4, status = $5, department = $6, skill_group = $7, reception_limit = $8,
			permissions = $9, permissions_customized = $10, data_scopes = $11, shop_scope = $12, shop_scope_ids = $13,
			shop_scope_configured = CASE WHEN $14 THEN TRUE ELSE shop_scope_configured END,
			workbench_shop_scope = $15, conversation_scope = $16,
			password_hash = $17, updated_at = $18
		WHERE id = $1
		RETURNING id, email, display_name, role, status, department, skill_group, reception_limit, reception_online, permissions, permissions_customized, data_scopes, shop_scope, shop_scope_ids, workbench_shop_scope, conversation_scope, system_admin, password_hash, created_at, updated_at
	`, current.ID, current.Email, current.DisplayName, current.Role, current.Status, current.Department, current.SkillGroup, current.ReceptionLimit, permissions, current.PermissionsCustomized, dataScopes, current.ShopScope, shopScopeIDs, input.SetShopScope, current.WorkbenchShopScope, current.ConversationScope, current.PasswordHash, current.UpdatedAt)
	user, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (s *PostgresStore) SetUserReceptionOnline(ctx context.Context, id string, online bool) (User, error) {
	row := s.db.QueryRowContext(ctx, `
		UPDATE users
		SET reception_online = $2, updated_at = $3
		WHERE id = $1
		RETURNING id, email, display_name, role, status, department, skill_group, reception_limit, reception_online, permissions, permissions_customized, data_scopes, shop_scope, shop_scope_ids, workbench_shop_scope, conversation_scope, system_admin, password_hash, created_at, updated_at
	`, strings.TrimSpace(id), online, time.Now().UTC())
	user, err := scanUser(row)
	if errors.Is(err, sql.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return user, err
}

func (s *PostgresStore) DeleteUser(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.ExecContext(ctx, `
		UPDATE conversations
		SET assigned_agent_id = '', status = CASE WHEN status = $2 THEN $3 ELSE status END, updated_at = $4
		WHERE assigned_agent_id = $1
	`, id, ConversationStatusAssigned, ConversationStatusOpen, time.Now().UTC())
	if err != nil {
		return err
	}
	_ = result
	result, err = tx.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return tx.Commit()
}

func (s *PostgresStore) CreateAccountAuditLog(ctx context.Context, input AccountAuditLog) (AccountAuditLog, error) {
	if input.ID == "" {
		input.ID = prefixedID("audit")
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	}
	changes, err := json.Marshal(input.Changes)
	if err != nil {
		return AccountAuditLog{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO account_audit_logs (id, actor_user_id, target_user_id, action, changes, created_at)
		VALUES ($1, $2, $3, $4, $5, $6)
	`, input.ID, input.ActorUserID, input.TargetUserID, input.Action, changes, input.CreatedAt)
	return input, err
}

func (s *PostgresStore) ListAccountAuditLogs(ctx context.Context, targetUserID string, limit int) ([]AccountAuditLog, error) {
	targetUserID = strings.TrimSpace(targetUserID)
	if targetUserID == "" {
		return nil, fmt.Errorf("%w: target user is required", ErrInvalid)
	}
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, actor_user_id, target_user_id, action, changes, created_at
		FROM account_audit_logs
		WHERE target_user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT $2
	`, targetUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AccountAuditLog, 0, limit)
	for rows.Next() {
		var item AccountAuditLog
		var changes []byte
		if err := rows.Scan(&item.ID, &item.ActorUserID, &item.TargetUserID, &item.Action, &changes, &item.CreatedAt); err != nil {
			return nil, err
		}
		if len(changes) > 0 {
			if err := json.Unmarshal(changes, &item.Changes); err != nil {
				return nil, err
			}
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CountUsers(ctx context.Context) (int, error) {
	var count int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *PostgresStore) CreateSession(ctx context.Context, input Session) (Session, error) {
	if strings.TrimSpace(input.UserID) == "" || strings.TrimSpace(input.TokenHash) == "" {
		return Session{}, fmt.Errorf("%w: userId and tokenHash are required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("sess")
	}
	if input.ExpiresAt.IsZero() {
		input.ExpiresAt = now.Add(sessionDuration)
	}
	input.CreatedAt = now
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at)
		VALUES ($1, $2, $3, $4, $5)
	`, input.ID, input.UserID, input.TokenHash, input.ExpiresAt, input.CreatedAt)
	if err != nil {
		if isForeignKeyError(err) {
			return Session{}, ErrNotFound
		}
		return Session{}, err
	}
	return input, nil
}

func (s *PostgresStore) GetSessionByTokenHash(ctx context.Context, tokenHash string) (Session, User, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT
			s.id, s.user_id, s.token_hash, s.expires_at, s.created_at,
			u.id, u.email, u.display_name, u.role, u.status, u.department, u.skill_group, u.reception_limit, u.reception_online, u.permissions, u.permissions_customized, u.data_scopes, u.shop_scope, u.shop_scope_ids, u.workbench_shop_scope, u.conversation_scope, u.system_admin, u.password_hash, u.created_at, u.updated_at
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		WHERE s.token_hash = $1 AND s.expires_at > NOW()
	`, strings.TrimSpace(tokenHash))
	var session Session
	var user User
	var permissions []byte
	var dataScopes []byte
	var shopScopeIDs []byte
	err := row.Scan(
		&session.ID,
		&session.UserID,
		&session.TokenHash,
		&session.ExpiresAt,
		&session.CreatedAt,
		&user.ID,
		&user.Email,
		&user.DisplayName,
		&user.Role,
		&user.Status,
		&user.Department,
		&user.SkillGroup,
		&user.ReceptionLimit,
		&user.ReceptionOnline,
		&permissions,
		&user.PermissionsCustomized,
		&dataScopes,
		&user.ShopScope,
		&shopScopeIDs,
		&user.WorkbenchShopScope,
		&user.ConversationScope,
		&user.SystemAdmin,
		&user.PasswordHash,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err == nil && len(permissions) > 0 {
		err = json.Unmarshal(permissions, &user.Permissions)
	}
	if err == nil && len(dataScopes) > 0 {
		err = json.Unmarshal(dataScopes, &user.DataScopes)
	}
	if err == nil && len(shopScopeIDs) > 0 {
		err = json.Unmarshal(shopScopeIDs, &user.ShopScopeIDs)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return Session{}, User{}, ErrNotFound
	}
	return session, user, err
}

func (s *PostgresStore) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM sessions WHERE token_hash = $1`, strings.TrimSpace(tokenHash))
	return err
}

func (s *PostgresStore) AssignUserToShop(ctx context.Context, shopID string, userID string) (ShopAgent, error) {
	shopID = strings.TrimSpace(shopID)
	userID = strings.TrimSpace(userID)
	if shopID == "" || userID == "" {
		return ShopAgent{}, fmt.Errorf("%w: shopId and userId are required", ErrInvalid)
	}
	assignment := ShopAgent{ShopID: shopID, UserID: userID, CreatedAt: time.Now().UTC()}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO shop_agents (shop_id, user_id, created_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (shop_id, user_id) DO NOTHING
	`, assignment.ShopID, assignment.UserID, assignment.CreatedAt)
	if err != nil {
		if isForeignKeyError(err) {
			return ShopAgent{}, ErrNotFound
		}
		return ShopAgent{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		SELECT shop_id, user_id, created_at
		FROM shop_agents
		WHERE shop_id = $1 AND user_id = $2
	`, assignment.ShopID, assignment.UserID)
	if err := row.Scan(&assignment.ShopID, &assignment.UserID, &assignment.CreatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ShopAgent{}, ErrNotFound
		}
		return ShopAgent{}, err
	}
	return assignment, nil
}

func (s *PostgresStore) UnassignUserFromShop(ctx context.Context, shopID string, userID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM shop_agents WHERE shop_id = $1 AND user_id = $2`, strings.TrimSpace(shopID), strings.TrimSpace(userID))
	return err
}

func (s *PostgresStore) ListShopUsers(ctx context.Context, shopID string) ([]User, error) {
	shopID = strings.TrimSpace(shopID)
	if _, err := s.GetShop(ctx, shopID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT u.id, u.email, u.display_name, u.role, u.status, u.department, u.skill_group, u.reception_limit, u.reception_online, u.permissions, u.permissions_customized, u.data_scopes, u.shop_scope, u.shop_scope_ids, u.workbench_shop_scope, u.conversation_scope, u.system_admin, u.password_hash, u.created_at, u.updated_at
		FROM shop_agents sa
		JOIN users u ON u.id = sa.user_id
		WHERE sa.shop_id = $1
		ORDER BY u.created_at ASC, u.id ASC
	`, shopID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []User
	for rows.Next() {
		user, err := scanUser(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListUserShopIDs(ctx context.Context, userID string) ([]string, error) {
	userID = strings.TrimSpace(userID)
	if _, err := s.GetUser(ctx, userID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT shop_id
		FROM shop_agents
		WHERE user_id = $1
		ORDER BY created_at ASC, shop_id ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var shopID string
		if err := rows.Scan(&shopID); err != nil {
			return nil, err
		}
		out = append(out, shopID)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListShopAssignments(ctx context.Context) ([]ShopAgent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT shop_id, user_id, created_at
		FROM shop_agents
		ORDER BY created_at ASC, shop_id ASC, user_id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ShopAgent{}
	for rows.Next() {
		var assignment ShopAgent
		if err := rows.Scan(&assignment.ShopID, &assignment.UserID, &assignment.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, assignment)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CreateShop(ctx context.Context, input Shop) (Shop, error) {
	name := strings.TrimSpace(input.DisplayName)
	if name == "" {
		return Shop{}, fmt.Errorf("%w: displayName is required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("shop")
	}
	input.DisplayName = name
	input.Platform = defaultString(input.Platform, "shopify")
	input.ExternalID = strings.TrimSpace(input.ExternalID)
	status, err := normalizeShopStatus(input.Status)
	if err != nil {
		return Shop{}, err
	}
	input.Status = status
	input.CreatedAt = now
	input.UpdatedAt = now
	metadata, err := marshalMetadata(input.Metadata)
	if err != nil {
		return Shop{}, err
	}
	var existingName string
	err = s.db.QueryRowContext(ctx, `
		SELECT display_name
		FROM shops
		WHERE lower(btrim(display_name)) = lower(btrim($1))
		LIMIT 1
	`, name).Scan(&existingName)
	if err == nil {
		return Shop{}, fmt.Errorf("%w: 店铺名称“%s”已存在，请直接使用原店铺", ErrConflict, existingName)
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Shop{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO shops (id, display_name, platform, external_id, status, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`, input.ID, input.DisplayName, input.Platform, input.ExternalID, input.Status, metadata, input.CreatedAt, input.UpdatedAt)
	if err != nil {
		return Shop{}, err
	}
	return input, nil
}

func (s *PostgresStore) ListShops(ctx context.Context) ([]Shop, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, display_name, platform, external_id, status, metadata, created_at, updated_at
		FROM shops
		ORDER BY created_at ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Shop
	for rows.Next() {
		shop, err := scanShop(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, shop)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListAuthorizedShopifyShops(ctx context.Context) ([]Shop, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT shop.id, shop.display_name, shop.platform, shop.external_id, shop.status, shop.metadata, shop.created_at, shop.updated_at
		FROM shops AS shop
		WHERE shop.status = $1
		  AND EXISTS (
			SELECT 1
			FROM shopify_installations AS installation
			WHERE installation.shop_id = shop.id
			  AND BTRIM(installation.access_token) <> ''
		  )
		ORDER BY shop.created_at ASC, shop.id ASC
	`, ShopStatusActive)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Shop, 0)
	for rows.Next() {
		shop, scanErr := scanShop(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, shop)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetShop(ctx context.Context, id string) (Shop, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, display_name, platform, external_id, status, metadata, created_at, updated_at
		FROM shops
		WHERE id = $1
	`, id)
	shop, err := scanShop(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Shop{}, ErrNotFound
	}
	return shop, err
}

func (s *PostgresStore) UpdateShop(ctx context.Context, id string, input Shop) (Shop, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return Shop{}, ErrNotFound
	}
	current, err := s.GetShop(ctx, id)
	if err != nil {
		return Shop{}, err
	}
	if name := strings.TrimSpace(input.DisplayName); name != "" {
		current.DisplayName = name
	}
	if platform := strings.TrimSpace(input.Platform); platform != "" {
		current.Platform = platform
	}
	if externalID := strings.TrimSpace(input.ExternalID); externalID != "" {
		current.ExternalID = externalID
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err := normalizeShopStatus(input.Status)
		if err != nil {
			return Shop{}, err
		}
		current.Status = status
	}
	if input.Metadata != nil {
		current.Metadata = input.Metadata
	}
	current.UpdatedAt = time.Now().UTC()
	metadata, err := marshalMetadata(current.Metadata)
	if err != nil {
		return Shop{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE shops
		SET display_name = $2, platform = $3, external_id = $4, status = $5, metadata = $6, updated_at = $7
		WHERE id = $1
		RETURNING id, display_name, platform, external_id, status, metadata, created_at, updated_at
	`, current.ID, current.DisplayName, current.Platform, current.ExternalID, current.Status, metadata, current.UpdatedAt)
	updated, err := scanShop(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Shop{}, ErrNotFound
	}
	return updated, err
}

func (s *PostgresStore) DeleteShop(ctx context.Context, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return ErrNotFound
	}
	result, err := s.db.ExecContext(ctx, `DELETE FROM shops WHERE id = $1`, id)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) CreateShopSource(ctx context.Context, input ShopSource) (ShopSource, error) {
	if strings.TrimSpace(input.ShopID) == "" {
		return ShopSource{}, ErrShopNeeded
	}
	if strings.TrimSpace(input.Type) == "" {
		return ShopSource{}, fmt.Errorf("%w: type is required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("src")
	}
	input.Type = strings.TrimSpace(input.Type)
	input = withShopifyChatDefaults(input)
	input.Provider = defaultString(input.Provider, input.Type)
	input.Address = strings.TrimSpace(input.Address)
	status, err := normalizeSourceStatus(defaultSourceStatus(input))
	if err != nil {
		return ShopSource{}, err
	}
	input.Status = status
	input.CreatedAt = now
	input.UpdatedAt = now
	metadata, err := marshalMetadata(input.Metadata)
	if err != nil {
		return ShopSource{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO shop_sources (id, shop_id, type, provider, address, status, metadata, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, input.ID, input.ShopID, input.Type, input.Provider, input.Address, input.Status, metadata, input.CreatedAt, input.UpdatedAt)
	if err != nil {
		if isForeignKeyError(err) {
			return ShopSource{}, ErrNotFound
		}
		return ShopSource{}, err
	}
	if input.Type == SourceTypeShopifyChat {
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO visitor_scheme_assignments (shop_id, scheme_id, applied_at)
			VALUES ($1, $2, $3)
			ON CONFLICT (shop_id) DO NOTHING
		`, input.ShopID, defaultVisitorSchemeID, now); err != nil {
			return ShopSource{}, err
		}
	}
	return input, nil
}

func (s *PostgresStore) ListShopSources(ctx context.Context, shopID string) ([]ShopSource, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, shop_id, type, provider, address, status, metadata, created_at, updated_at
		FROM shop_sources
		WHERE $1 = '' OR shop_id = $1
		ORDER BY created_at ASC, id ASC
	`, strings.TrimSpace(shopID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ShopSource
	for rows.Next() {
		source, err := scanShopSource(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, source)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetShopSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, shop_id, type, provider, address, status, metadata, created_at, updated_at
		FROM shop_sources
		WHERE shop_id = $1 AND id = $2
	`, strings.TrimSpace(shopID), strings.TrimSpace(sourceID))
	source, err := scanShopSource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopSource{}, ErrNotFound
	}
	return source, err
}

func (s *PostgresStore) SetShopSourceStatus(ctx context.Context, shopID string, sourceID string, status string) (ShopSource, error) {
	return s.UpdateShopSource(ctx, shopID, sourceID, ShopSource{Status: status})
}

func (s *PostgresStore) UpdateShopSource(ctx context.Context, shopID string, sourceID string, input ShopSource) (ShopSource, error) {
	source, err := s.GetShopSource(ctx, shopID, sourceID)
	if err != nil {
		return ShopSource{}, err
	}
	if strings.TrimSpace(input.Provider) != "" {
		source.Provider = strings.TrimSpace(input.Provider)
	}
	if strings.TrimSpace(input.Address) != "" {
		source.Address = strings.TrimSpace(input.Address)
	}
	if strings.TrimSpace(input.Status) != "" {
		status, err := normalizeSourceStatus(input.Status)
		if err != nil {
			return ShopSource{}, err
		}
		source.Status = status
	}
	if input.Metadata != nil {
		source.Metadata = input.Metadata
	}
	metadata, err := marshalMetadata(source.Metadata)
	if err != nil {
		return ShopSource{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE shop_sources
		SET provider = $3, address = $4, status = $5, metadata = $6, updated_at = $7
		WHERE shop_id = $1 AND id = $2
		RETURNING id, shop_id, type, provider, address, status, metadata, created_at, updated_at
	`, strings.TrimSpace(shopID), strings.TrimSpace(sourceID), source.Provider, source.Address, source.Status, metadata, time.Now().UTC())
	updated, err := scanShopSource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopSource{}, ErrNotFound
	}
	return updated, err
}

func (s *PostgresStore) MutateShopSourceMetadata(ctx context.Context, shopID string, sourceID string, mutate func(map[string]string) map[string]string) (ShopSource, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ShopSource{}, err
	}
	defer tx.Rollback()
	row := tx.QueryRowContext(ctx, `
		SELECT id, shop_id, type, provider, address, status, metadata, created_at, updated_at
		FROM shop_sources
		WHERE shop_id = $1 AND id = $2
		FOR UPDATE
	`, strings.TrimSpace(shopID), strings.TrimSpace(sourceID))
	source, err := scanShopSource(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopSource{}, ErrNotFound
	}
	if err != nil {
		return ShopSource{}, err
	}
	currentMetadata := cloneStringMap(source.Metadata)
	if currentMetadata == nil {
		currentMetadata = map[string]string{}
	}
	metadata, err := marshalMetadata(mutate(currentMetadata))
	if err != nil {
		return ShopSource{}, err
	}
	updated, err := scanShopSource(tx.QueryRowContext(ctx, `
		UPDATE shop_sources
		SET metadata = $3, updated_at = $4
		WHERE shop_id = $1 AND id = $2
		RETURNING id, shop_id, type, provider, address, status, metadata, created_at, updated_at
	`, strings.TrimSpace(shopID), strings.TrimSpace(sourceID), metadata, time.Now().UTC()))
	if err != nil {
		return ShopSource{}, err
	}
	if err := tx.Commit(); err != nil {
		return ShopSource{}, err
	}
	return updated, nil
}

func (s *PostgresStore) SaveShopifyInstallation(ctx context.Context, input ShopifyInstallation) (ShopifyInstallation, error) {
	input.ShopDomain = normalizeShopifyDomain(input.ShopDomain)
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.AccessToken = strings.TrimSpace(input.AccessToken)
	input.Scope = strings.TrimSpace(input.Scope)
	if input.ShopDomain == "" || input.ShopID == "" || input.AccessToken == "" {
		return ShopifyInstallation{}, fmt.Errorf("%w: shopDomain, shopId, and accessToken are required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.InstalledAt.IsZero() {
		input.InstalledAt = now
	}
	input.UpdatedAt = now
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO shopify_installations (shop_domain, shop_id, access_token, scope, installed_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (shop_domain) DO UPDATE SET
			shop_id = EXCLUDED.shop_id,
			access_token = EXCLUDED.access_token,
			scope = EXCLUDED.scope,
			updated_at = EXCLUDED.updated_at
		RETURNING shop_domain, shop_id, access_token, scope, installed_at, updated_at
	`, input.ShopDomain, input.ShopID, input.AccessToken, input.Scope, input.InstalledAt, input.UpdatedAt)
	installation, err := scanShopifyInstallation(row)
	if err != nil && isForeignKeyError(err) {
		return ShopifyInstallation{}, ErrNotFound
	}
	return installation, err
}

func (s *PostgresStore) GetShopifyInstallationByDomain(ctx context.Context, shopDomain string) (ShopifyInstallation, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT shop_domain, shop_id, access_token, scope, installed_at, updated_at
		FROM shopify_installations
		WHERE shop_domain = $1
	`, normalizeShopifyDomain(shopDomain))
	installation, err := scanShopifyInstallation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopifyInstallation{}, ErrNotFound
	}
	return installation, err
}

func (s *PostgresStore) DeleteShopifyInstallationByDomain(ctx context.Context, shopDomain string) error {
	shopDomain = normalizeShopifyDomain(shopDomain)
	if shopDomain == "" {
		return fmt.Errorf("%w: shopDomain is required", ErrInvalid)
	}
	_, err := s.db.ExecContext(ctx, `
		DELETE FROM shopify_installations
		WHERE shop_domain = $1
	`, shopDomain)
	return err
}

func (s *PostgresStore) SaveShopifyAppProfile(ctx context.Context, input ShopifyAppProfile) (ShopifyAppProfile, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.ShopDomain = normalizeShopifyDomain(input.ShopDomain)
	input.ClientID = strings.TrimSpace(input.ClientID)
	input.ExtensionHandle = defaultString(strings.TrimSpace(input.ExtensionHandle), "xinzhi-chat")
	input.DeployStatus = defaultString(strings.TrimSpace(input.DeployStatus), ShopifyAppDeployPending)
	if input.ShopID == "" || input.ShopDomain == "" || input.ClientID == "" || input.EncryptedClientSecret == "" || input.EncryptedAutomationToken == "" {
		return ShopifyAppProfile{}, fmt.Errorf("%w: shopId, shopDomain, clientId, clientSecret, and automationToken are required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.CreatedAt.IsZero() {
		input.CreatedAt = now
	}
	input.UpdatedAt = now
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO shopify_app_profiles (
		  shop_id, shop_domain, client_id, encrypted_client_secret, encrypted_automation_token,
		  extension_handle, deploy_status, deploy_version, deploy_message, deployed_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULLIF($10, '')::timestamptz,$11,$12)
		ON CONFLICT (shop_id) DO UPDATE SET
		  shop_domain = EXCLUDED.shop_domain,
		  client_id = EXCLUDED.client_id,
		  encrypted_client_secret = EXCLUDED.encrypted_client_secret,
		  encrypted_automation_token = EXCLUDED.encrypted_automation_token,
		  extension_handle = EXCLUDED.extension_handle,
		  deploy_status = EXCLUDED.deploy_status,
		  deploy_version = EXCLUDED.deploy_version,
		  deploy_message = EXCLUDED.deploy_message,
		  deployed_at = EXCLUDED.deployed_at,
		  updated_at = EXCLUDED.updated_at
		RETURNING shop_id, shop_domain, client_id, encrypted_client_secret, encrypted_automation_token,
		  extension_handle, deploy_status, deploy_version, deploy_message, deployed_at, created_at, updated_at
	`, input.ShopID, input.ShopDomain, input.ClientID, input.EncryptedClientSecret, input.EncryptedAutomationToken,
		input.ExtensionHandle, input.DeployStatus, input.DeployVersion, input.DeployMessage, nullableTimeText(input.DeployedAt), input.CreatedAt, input.UpdatedAt)
	return scanShopifyAppProfile(row)
}

func (s *PostgresStore) GetShopifyAppProfile(ctx context.Context, shopID string) (ShopifyAppProfile, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT shop_id, shop_domain, client_id, encrypted_client_secret, encrypted_automation_token,
		  extension_handle, deploy_status, deploy_version, deploy_message, deployed_at, created_at, updated_at
		FROM shopify_app_profiles WHERE shop_id = $1
	`, strings.TrimSpace(shopID))
	profile, err := scanShopifyAppProfile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopifyAppProfile{}, ErrNotFound
	}
	return profile, err
}

func (s *PostgresStore) GetShopifyAppProfileByDomain(ctx context.Context, shopDomain string) (ShopifyAppProfile, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT shop_id, shop_domain, client_id, encrypted_client_secret, encrypted_automation_token,
		  extension_handle, deploy_status, deploy_version, deploy_message, deployed_at, created_at, updated_at
		FROM shopify_app_profiles WHERE shop_domain = $1
	`, normalizeShopifyDomain(shopDomain))
	profile, err := scanShopifyAppProfile(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopifyAppProfile{}, ErrNotFound
	}
	return profile, err
}

func (s *PostgresStore) DeleteShopifyAppProfile(ctx context.Context, shopID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM shopify_app_profiles WHERE shop_id = $1`, strings.TrimSpace(shopID))
	return err
}

func (s *PostgresStore) SaveEmailInstallation(ctx context.Context, input EmailInstallation) (EmailInstallation, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.Mailbox = normalizeEmail(input.Mailbox)
	input.Provider = strings.ToLower(defaultString(strings.TrimSpace(input.Provider), "outlook"))
	input.AccessToken = strings.TrimSpace(input.AccessToken)
	input.RefreshToken = strings.TrimSpace(input.RefreshToken)
	input.Scope = strings.TrimSpace(input.Scope)
	if input.ShopID == "" || input.Mailbox == "" || input.AccessToken == "" {
		return EmailInstallation{}, fmt.Errorf("%w: shopId, mailbox, and accessToken are required", ErrInvalid)
	}
	var conflictingShopID string
	err := s.db.QueryRowContext(ctx, `
		SELECT shop_id FROM email_installations
		WHERE lower(mailbox) = lower($1) AND shop_id <> $2
		LIMIT 1
	`, input.Mailbox, input.ShopID).Scan(&conflictingShopID)
	if err == nil {
		return EmailInstallation{}, fmt.Errorf("%w: 邮箱 %s 已绑定到其他店铺", ErrConflict, input.Mailbox)
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return EmailInstallation{}, err
	}
	now := time.Now().UTC()
	if input.InstalledAt.IsZero() {
		input.InstalledAt = now
	}
	if input.ExpiresAt.IsZero() {
		input.ExpiresAt = now
	}
	input.UpdatedAt = now
	encryptedAccessToken, err := encryptEmailCredential(input.AccessToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	encryptedRefreshToken, err := encryptEmailCredential(input.RefreshToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_installations (shop_id, mailbox, provider, access_token, refresh_token, scope, expires_at, installed_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (shop_id, mailbox) DO UPDATE SET
			provider = EXCLUDED.provider,
			access_token = EXCLUDED.access_token,
			refresh_token = CASE WHEN EXCLUDED.refresh_token = '' THEN email_installations.refresh_token ELSE EXCLUDED.refresh_token END,
			scope = EXCLUDED.scope,
			expires_at = EXCLUDED.expires_at,
			updated_at = EXCLUDED.updated_at
		RETURNING shop_id, mailbox, provider, access_token, refresh_token, scope, expires_at, installed_at, updated_at
	`, input.ShopID, input.Mailbox, input.Provider, encryptedAccessToken, encryptedRefreshToken, input.Scope, input.ExpiresAt, input.InstalledAt, input.UpdatedAt)
	installation, err := scanEmailInstallation(row)
	if err != nil && isForeignKeyError(err) {
		return EmailInstallation{}, ErrNotFound
	}
	if isUniqueConstraintError(err) {
		return EmailInstallation{}, fmt.Errorf("%w: 邮箱 %s 已绑定到其他店铺", ErrConflict, input.Mailbox)
	}
	return installation, err
}

func (s *PostgresStore) GetEmailInstallation(ctx context.Context, shopID string, mailbox string) (EmailInstallation, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT shop_id, mailbox, provider, access_token, refresh_token, scope, expires_at, installed_at, updated_at
		FROM email_installations
		WHERE shop_id = $1 AND mailbox = $2
	`, strings.TrimSpace(shopID), normalizeEmail(mailbox))
	installation, err := scanEmailInstallation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailInstallation{}, ErrNotFound
	}
	return installation, err
}

// MigrateEmailInstallationCredentials upgrades legacy plaintext credentials only
// after this deployment color becomes active. The previous blue-green release
// already understands this envelope, so rollback remains compatible.
func (s *PostgresStore) MigrateEmailInstallationCredentials(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := tx.QueryContext(ctx, `
		SELECT shop_id, mailbox, access_token, refresh_token
		FROM email_installations
		ORDER BY shop_id, mailbox
		FOR UPDATE
	`)
	if err != nil {
		return err
	}
	type legacyCredential struct {
		shopID, mailbox, accessToken, refreshToken string
	}
	credentials := make([]legacyCredential, 0)
	for rows.Next() {
		var item legacyCredential
		if err := rows.Scan(&item.shopID, &item.mailbox, &item.accessToken, &item.refreshToken); err != nil {
			_ = rows.Close()
			return err
		}
		credentials = append(credentials, item)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, item := range credentials {
		if isEncryptedEmailCredential(item.accessToken) && (item.refreshToken == "" || isEncryptedEmailCredential(item.refreshToken)) {
			continue
		}
		encryptedAccessToken, err := encryptEmailCredential(item.accessToken)
		if err != nil {
			return err
		}
		encryptedRefreshToken, err := encryptEmailCredential(item.refreshToken)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
			UPDATE email_installations
			SET access_token = $3, refresh_token = $4
			WHERE shop_id = $1 AND mailbox = $2
		`, item.shopID, item.mailbox, encryptedAccessToken, encryptedRefreshToken); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *PostgresStore) SaveEmailHistoryImportJob(ctx context.Context, input EmailHistoryImportJob) (EmailHistoryImportJob, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Mailbox = normalizeEmail(input.Mailbox)
	input.Status = strings.ToLower(strings.TrimSpace(input.Status))
	if input.ShopID == "" || input.SourceID == "" || input.Provider == "" || input.Mailbox == "" || input.Status == "" {
		return EmailHistoryImportJob{}, fmt.Errorf("%w: email history import identity and status are required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("email_history")
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = now
	}
	input.UpdatedAt = now
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_history_import_jobs (
		  source_id, id, shop_id, provider, mailbox, status, cursor,
		  pages_processed, messages_scanned, messages_imported, messages_skipped,
		  filtered_messages, conversations_created, last_error,
		  started_at, completed_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
		ON CONFLICT (source_id) DO UPDATE SET
		  id = EXCLUDED.id, shop_id = EXCLUDED.shop_id, provider = EXCLUDED.provider,
		  mailbox = EXCLUDED.mailbox, status = EXCLUDED.status, cursor = EXCLUDED.cursor,
		  pages_processed = EXCLUDED.pages_processed, messages_scanned = EXCLUDED.messages_scanned,
		  messages_imported = EXCLUDED.messages_imported, messages_skipped = EXCLUDED.messages_skipped,
		  filtered_messages = EXCLUDED.filtered_messages, conversations_created = EXCLUDED.conversations_created,
		  last_error = EXCLUDED.last_error, started_at = EXCLUDED.started_at,
		  completed_at = EXCLUDED.completed_at, created_at = EXCLUDED.created_at,
		  updated_at = EXCLUDED.updated_at
		RETURNING source_id, id, shop_id, provider, mailbox, status, cursor,
		  pages_processed, messages_scanned, messages_imported, messages_skipped,
		  filtered_messages, conversations_created, last_error,
		  started_at, completed_at, created_at, updated_at
	`, input.SourceID, input.ID, input.ShopID, input.Provider, input.Mailbox, input.Status, input.Cursor,
		input.PagesProcessed, input.MessagesScanned, input.MessagesImported, input.MessagesSkipped,
		input.FilteredMessages, input.ConversationsCreated, input.LastError,
		nullableTimeValue(input.StartedAt), nullableTimeValue(input.CompletedAt), input.CreatedAt, input.UpdatedAt)
	job, err := scanEmailHistoryImportJob(row)
	if isForeignKeyError(err) {
		return EmailHistoryImportJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) GetEmailHistoryImportJob(ctx context.Context, shopID string, sourceID string) (EmailHistoryImportJob, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT source_id, id, shop_id, provider, mailbox, status, cursor,
		  pages_processed, messages_scanned, messages_imported, messages_skipped,
		  filtered_messages, conversations_created, last_error,
		  started_at, completed_at, created_at, updated_at
		FROM email_history_import_jobs
		WHERE source_id = $1 AND ($2 = '' OR shop_id = $2)
	`, strings.TrimSpace(sourceID), strings.TrimSpace(shopID))
	job, err := scanEmailHistoryImportJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailHistoryImportJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) ListEmailHistoryImportJobs(ctx context.Context, shopID string) ([]EmailHistoryImportJob, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT source_id, id, shop_id, provider, mailbox, status, cursor,
		  pages_processed, messages_scanned, messages_imported, messages_skipped,
		  filtered_messages, conversations_created, last_error,
		  started_at, completed_at, created_at, updated_at
		FROM email_history_import_jobs
		WHERE $1 = '' OR shop_id = $1
		ORDER BY updated_at DESC, id ASC
	`, strings.TrimSpace(shopID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmailHistoryImportJob{}
	for rows.Next() {
		job, scanErr := scanEmailHistoryImportJob(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, job)
	}
	return out, rows.Err()
}

type emailHistoryImportScanner interface{ Scan(...any) error }

func scanEmailHistoryImportJob(row emailHistoryImportScanner) (EmailHistoryImportJob, error) {
	var job EmailHistoryImportJob
	var startedAt sql.NullTime
	var completedAt sql.NullTime
	err := row.Scan(&job.SourceID, &job.ID, &job.ShopID, &job.Provider, &job.Mailbox, &job.Status, &job.Cursor,
		&job.PagesProcessed, &job.MessagesScanned, &job.MessagesImported, &job.MessagesSkipped,
		&job.FilteredMessages, &job.ConversationsCreated, &job.LastError,
		&startedAt, &completedAt, &job.CreatedAt, &job.UpdatedAt)
	if startedAt.Valid {
		job.StartedAt = startedAt.Time
	}
	if completedAt.Valid {
		job.CompletedAt = completedAt.Time
	}
	return job, err
}

func (s *PostgresStore) DisconnectEmailSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error) {
	shopID = strings.TrimSpace(shopID)
	sourceID = strings.TrimSpace(sourceID)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ShopSource{}, err
	}
	defer tx.Rollback()
	source, err := scanShopSource(tx.QueryRowContext(ctx, `
		SELECT id, shop_id, type, provider, address, status, metadata, created_at, updated_at
		FROM shop_sources
		WHERE shop_id = $1 AND id = $2
		FOR UPDATE
	`, shopID, sourceID))
	if errors.Is(err, sql.ErrNoRows) {
		return ShopSource{}, ErrNotFound
	}
	if err != nil {
		return ShopSource{}, err
	}
	if source.Type != SourceTypeEmail {
		return ShopSource{}, fmt.Errorf("%w: source is not an email channel", ErrInvalid)
	}
	if _, err := tx.ExecContext(ctx, `
		DELETE FROM email_installations
		WHERE shop_id = $1 AND lower(mailbox) = lower($2)
	`, shopID, sourceEmailAddress(source)); err != nil {
		return ShopSource{}, err
	}
	metadata, err := marshalMetadata(disconnectedEmailSourceMetadata(source, time.Now().UTC()))
	if err != nil {
		return ShopSource{}, err
	}
	updated, err := scanShopSource(tx.QueryRowContext(ctx, `
		UPDATE shop_sources
		SET status = $3, metadata = $4, updated_at = $5
		WHERE shop_id = $1 AND id = $2
		RETURNING id, shop_id, type, provider, address, status, metadata, created_at, updated_at
	`, shopID, sourceID, SourceStatusDisabled, metadata, time.Now().UTC()))
	if err != nil {
		return ShopSource{}, err
	}
	if err := tx.Commit(); err != nil {
		return ShopSource{}, err
	}
	return updated, nil
}

func (s *PostgresStore) CreateConversation(ctx context.Context, input Conversation) (Conversation, error) {
	if strings.TrimSpace(input.ShopID) == "" {
		return Conversation{}, ErrShopNeeded
	}
	if strings.TrimSpace(input.SourceID) == "" {
		return Conversation{}, fmt.Errorf("%w: sourceId is required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("conv")
	}
	input.CustomerName = strings.TrimSpace(input.CustomerName)
	input.CustomerEmail = strings.TrimSpace(input.CustomerEmail)
	input.Subject = strings.TrimSpace(input.Subject)
	input.Status = defaultString(input.Status, ConversationStatusOpen)
	input.Kind = normalizeConversationKind(input.Kind)
	if input.Kind == ConversationKindCustomer && !input.ReplyAllowed {
		input.ReplyAllowed = true
	}
	input.AssignedAgentID = strings.TrimSpace(input.AssignedAgentID)
	if input.LastMessageAt.IsZero() {
		input.LastMessageAt = now
	}
	input.CreatedAt = now
	input.UpdatedAt = now
	if input.Status == ConversationStatusClosed && input.ClosedAt.IsZero() {
		input.ClosedAt = now
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO conversations (id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, NULLIF($21, '')::timestamptz, $22, $23, $24)
	`, input.ID, input.ShopID, input.SourceID, input.CustomerName, input.CustomerEmail, input.Subject, input.Status, input.AssignedAgentID, input.LastMessageAt, input.CreatedAt, input.UpdatedAt, input.Kind, input.ReplyAllowed, input.Classification, input.RecordPrimary, input.RecordSecondary, input.RecordTertiary, input.RecordRemark, input.RecordClassified, input.RecordAutoFilled, nullableTimeText(input.RecordUpdatedAt), input.RecordUpdatedBy, input.RecordOrderNumber, nullableTimeValue(input.ClosedAt))
	if err != nil {
		if isForeignKeyError(err) {
			return Conversation{}, ErrNotFound
		}
		return Conversation{}, err
	}
	return input, nil
}

func (s *PostgresStore) ListConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error) {
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 0 {
		pageSize = 0
	}
	offset := 0
	if pageSize > 0 {
		offset = (page - 1) * pageSize
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.shop_id, c.source_id, c.customer_name, c.customer_email, c.subject, c.status, c.assigned_agent_id, c.last_message_at, c.created_at, c.updated_at, c.kind, c.reply_allowed, c.classification_reason, c.record_primary, c.record_secondary, c.record_tertiary, c.record_remark, c.record_classified, c.record_auto_filled, c.record_updated_at, c.record_updated_by, c.record_order_number, c.closed_at,
			COALESCE((
				SELECT MAX(m.created_at)
				FROM messages m
				WHERE m.conversation_id = c.id AND LOWER(m.direction) = $10
			), c.last_message_at) AS customer_last_message_at,
			COALESCE((
				SELECT LOWER(latest_message.direction)
				FROM messages latest_message
				WHERE latest_message.conversation_id = c.id
				  AND LOWER(latest_message.direction) IN ($10, $12)
				ORDER BY latest_message.created_at DESC, latest_message.id DESC
				LIMIT 1
			), '') AS last_message_direction,
			CASE WHEN $7 = '' THEN FALSE ELSE EXISTS (
				SELECT 1
				FROM messages unread_message
				LEFT JOIN conversation_reads read_state
				  ON read_state.conversation_id = c.id AND read_state.user_id = $7
				WHERE unread_message.conversation_id = c.id
				  AND (
					LOWER(unread_message.direction) = $10
					OR (c.kind = $14 AND LOWER(unread_message.direction) = $11)
				  )
				  AND (read_state.last_read_at IS NULL OR unread_message.created_at > read_state.last_read_at)
			) END AS unread
		FROM conversations c
		WHERE ($1 = '' OR c.shop_id = $1)
		  AND ($2 = '' OR c.source_id = $2)
		  AND ($3 = '' OR c.status = $3)
		  AND (NOT $19 OR (c.status <> $20 AND LOWER(TRIM(c.classification_reason)) NOT LIKE (LOWER($21) || '%')))
		  AND ($4 = '' OR c.kind = $4)
		  AND ($5 = '' OR c.assigned_agent_id = $5)
		  AND ($15 = '' OR LOWER(c.customer_name || ' ' || c.customer_email || ' ' || c.subject) LIKE '%' || LOWER($15) || '%')
		  AND (NOT $16 OR c.classification_reason = $18 OR c.customer_name = '' OR LOWER(c.customer_email) !~ '^store\+[0-9]+@([a-z0-9-]+\.)*shopifyemail\.com$')
		  AND (NOT $22 OR EXISTS (
			SELECT 1 FROM shops active_shop
			WHERE active_shop.id = c.shop_id AND active_shop.status = 'active'
		  ))
		  AND (NOT $23 OR EXISTS (
			SELECT 1 FROM shop_sources active_source
			WHERE active_source.id = c.source_id AND active_source.shop_id = c.shop_id AND active_source.status = 'active'
		  ))
		  AND ($17 = '' OR EXISTS (
			SELECT 1 FROM shop_agents scope_sa
			JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
			WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $17
		  ))
		  AND ($6 = '' OR (
			EXISTS (
				SELECT 1 FROM shop_agents sa
				JOIN shops assigned_shop ON assigned_shop.id = sa.shop_id AND assigned_shop.status = 'active'
				WHERE sa.shop_id = c.shop_id AND sa.user_id = $6
			)
			AND (
				c.assigned_agent_id = $6
				OR (c.status = 'open' AND c.assigned_agent_id = '')
				OR EXISTS (
					SELECT 1 FROM transfer_requests tr
					WHERE tr.conversation_id = c.id AND tr.status = 'pending'
					  AND (tr.target_agent_id = $6 OR ($13 <> '' AND tr.target_skill_group = $13))
				)
			)
		  ))
		ORDER BY customer_last_message_at DESC, c.created_at DESC, c.id ASC
		LIMIT NULLIF($8, 0) OFFSET $9
	`, strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.TrimSpace(filter.Status), strings.TrimSpace(filter.Kind), strings.TrimSpace(filter.AssignedAgentID), strings.TrimSpace(filter.WorkbenchUserID), strings.TrimSpace(filter.UnreadUserID), pageSize, offset, MessageDirectionCustomer, MessageDirectionSystem, MessageDirectionAgent, strings.TrimSpace(filter.WorkbenchSkillGroup), ConversationKindSystem, strings.TrimSpace(filter.Search), filter.ServiceLineOnly, strings.TrimSpace(filter.WorkbenchShopUserID), relayedCustomerInquiryClassification, filter.ActiveOnly, ConversationStatusClosed, historicalEmailClassification, filter.ActiveShopsOnly, filter.ActiveSourcesOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Conversation
	for rows.Next() {
		conversation, err := scanConversationWithCustomerLastMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, conversation)
	}
	return out, rows.Err()
}

// ListOperationalCustomerConversations is the lean read path used by
// monitoring and statistics. Those views do not need unread state or message
// direction, so avoid three per-conversation message lookups and filter out
// history-import/system traffic in PostgreSQL instead of in Go.
func (s *PostgresStore) ListOperationalCustomerConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.id, c.shop_id, c.source_id, c.customer_name, c.customer_email, c.subject, c.status, c.assigned_agent_id, c.last_message_at, c.created_at, c.updated_at, c.kind, c.reply_allowed, c.classification_reason, c.record_primary, c.record_secondary, c.record_tertiary, c.record_remark, c.record_classified, c.record_auto_filled, c.record_updated_at, c.record_updated_by, c.record_order_number, c.closed_at
		FROM conversations c
		WHERE c.kind = $1
		  AND LOWER(TRIM(c.classification_reason)) NOT LIKE (LOWER($2) || '%')
		  AND (c.classification_reason = $3 OR c.customer_name = '' OR LOWER(c.customer_email) !~ '^store\+[0-9]+@([a-z0-9-]+\.)*shopifyemail\.com$')
		  AND ($4 = '' OR c.shop_id = $4)
		  AND ($5 = '' OR c.source_id = $5)
		  AND ($6 = '' OR c.status = $6)
		  AND ($7 = '' OR c.assigned_agent_id = $7)
		  AND ($8 = '' OR LOWER(c.customer_name || ' ' || c.customer_email || ' ' || c.subject) LIKE '%' || LOWER($8) || '%')
		ORDER BY c.last_message_at DESC, c.created_at DESC, c.id ASC
	`, ConversationKindCustomer, historicalEmailClassification, relayedCustomerInquiryClassification,
		strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.TrimSpace(filter.Status),
		strings.TrimSpace(filter.AssignedAgentID), strings.TrimSpace(filter.Search))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Conversation{}
	for rows.Next() {
		conversation, scanErr := scanConversation(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		conversation.CustomerLastMessageAt = conversation.LastMessageAt
		out = append(out, conversation)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CountConversations(ctx context.Context, filter ConversationFilter) (int, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM conversations c
		WHERE ($1 = '' OR c.shop_id = $1)
		  AND ($2 = '' OR c.source_id = $2)
		  AND ($3 = '' OR c.status = $3)
		  AND (NOT $12 OR (c.status <> $13 AND LOWER(TRIM(c.classification_reason)) NOT LIKE (LOWER($14) || '%')))
		  AND ($4 = '' OR c.kind = $4)
		  AND ($5 = '' OR c.assigned_agent_id = $5)
		  AND ($6 = '' OR LOWER(c.customer_name || ' ' || c.customer_email || ' ' || c.subject) LIKE '%' || LOWER($6) || '%')
		  AND (NOT $7 OR c.classification_reason = $9 OR c.customer_name = '' OR LOWER(c.customer_email) !~ '^store\+[0-9]+@([a-z0-9-]+\.)*shopifyemail\.com$')
		  AND (NOT $15 OR EXISTS (
			SELECT 1 FROM shops active_shop
			WHERE active_shop.id = c.shop_id AND active_shop.status = 'active'
		  ))
		  AND (NOT $16 OR EXISTS (
			SELECT 1 FROM shop_sources active_source
			WHERE active_source.id = c.source_id AND active_source.shop_id = c.shop_id AND active_source.status = 'active'
		  ))
		  AND ($8 = '' OR EXISTS (
			SELECT 1 FROM shop_agents scope_sa
			JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
			WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $8
		  ))
		  AND ($10 = '' OR (
			EXISTS (
				SELECT 1 FROM shop_agents sa
				JOIN shops assigned_shop ON assigned_shop.id = sa.shop_id AND assigned_shop.status = 'active'
				WHERE sa.shop_id = c.shop_id AND sa.user_id = $10
			)
			AND (
				c.assigned_agent_id = $10
				OR (c.status = 'open' AND c.assigned_agent_id = '')
				OR EXISTS (
					SELECT 1 FROM transfer_requests tr
					WHERE tr.conversation_id = c.id AND tr.status = 'pending'
					  AND (tr.target_agent_id = $10 OR ($11 <> '' AND tr.target_skill_group = $11))
				)
			)
		  ))
	`, strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.TrimSpace(filter.Status), strings.TrimSpace(filter.Kind), strings.TrimSpace(filter.AssignedAgentID), strings.TrimSpace(filter.Search), filter.ServiceLineOnly, strings.TrimSpace(filter.WorkbenchShopUserID), relayedCustomerInquiryClassification, strings.TrimSpace(filter.WorkbenchUserID), strings.TrimSpace(filter.WorkbenchSkillGroup), filter.ActiveOnly, ConversationStatusClosed, historicalEmailClassification, filter.ActiveShopsOnly, filter.ActiveSourcesOnly)
	var total int
	if err := row.Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (s *PostgresStore) CustomerConversationLoads(ctx context.Context) (map[string]int, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT c.assigned_agent_id, COUNT(*)
		FROM conversations c
		WHERE c.status = $1
		  AND c.assigned_agent_id <> ''
		  AND c.kind = $2
		  AND LOWER(TRIM(c.classification_reason)) NOT LIKE (LOWER($3) || '%')
		  AND (c.classification_reason = $4 OR c.customer_name = '' OR LOWER(c.customer_email) !~ '^store\+[0-9]+@([a-z0-9-]+\.)*shopifyemail\.com$')
		  AND EXISTS (
			SELECT 1
			FROM shop_agents sa
			JOIN shops active_shop ON active_shop.id = sa.shop_id AND active_shop.status = 'active'
			WHERE sa.shop_id = c.shop_id AND sa.user_id = c.assigned_agent_id
		  )
		GROUP BY c.assigned_agent_id
	`, ConversationStatusAssigned, ConversationKindCustomer, historicalEmailClassification, relayedCustomerInquiryClassification)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	loads := map[string]int{}
	for rows.Next() {
		var userID string
		var count int
		if err := rows.Scan(&userID, &count); err != nil {
			return nil, err
		}
		loads[userID] = count
	}
	return loads, rows.Err()
}

func (s *PostgresStore) UpdateConversation(ctx context.Context, id string, input ConversationUpdate) (Conversation, error) {
	id = strings.TrimSpace(id)
	if input.SetRecord && input.Status == "" && !input.SetAssignedAgentID && !input.SetCustomerIdentity && !input.SetEmailDisposition {
		now := time.Now().UTC()
		row := s.db.QueryRowContext(ctx, `
			UPDATE conversations
			SET updated_at = $2,
			    record_primary = $3, record_secondary = $4, record_tertiary = $5,
			    record_remark = $6, record_order_number = $7,
			    record_classified = $8, record_auto_filled = $9,
			    record_updated_at = $2, record_updated_by = $10
			WHERE id = $1
			  AND (NOT $11 OR record_classified = FALSE)
			  AND (NOT $12 OR record_auto_filled = TRUE)
			RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
		`, id, now, strings.TrimSpace(input.RecordPrimary), strings.TrimSpace(input.RecordSecondary), strings.TrimSpace(input.RecordTertiary), strings.TrimSpace(input.RecordRemark), strings.TrimSpace(input.RecordOrderNumber), input.RecordClassified, input.RecordAutoFilled, strings.TrimSpace(input.RecordUpdatedBy), input.OnlyIfRecordUnclassified, input.OnlyIfRecordAutoFilled)
		updated, err := scanConversation(row)
		if errors.Is(err, sql.ErrNoRows) {
			if input.OnlyIfRecordUnclassified || input.OnlyIfRecordAutoFilled {
				return s.GetConversation(ctx, id)
			}
			return Conversation{}, ErrNotFound
		}
		return updated, err
	}
	if input.Status == "" && !input.SetAssignedAgentID && !input.SetRecord && (input.SetCustomerIdentity || input.SetEmailDisposition) {
		now := time.Now().UTC()
		customerName := strings.TrimSpace(input.CustomerName)
		customerEmail := strings.TrimSpace(input.CustomerEmail)
		kind := ""
		classification := ""
		if input.SetEmailDisposition {
			kind = normalizeConversationKind(input.Kind)
			classification = strings.TrimSpace(input.Classification)
		}
		row := s.db.QueryRowContext(ctx, `
			UPDATE conversations
			SET updated_at = $2,
			    customer_name = CASE WHEN $3 AND $4 <> '' THEN $4 ELSE customer_name END,
			    customer_email = CASE WHEN $3 AND $5 <> '' THEN $5 ELSE customer_email END,
			    kind = CASE WHEN $6 THEN $7 ELSE kind END,
			    reply_allowed = CASE WHEN $6 THEN $8 ELSE reply_allowed END,
			    classification_reason = CASE WHEN $6 THEN $9 ELSE classification_reason END
			WHERE id = $1
			RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
		`, id, now, input.SetCustomerIdentity, customerName, customerEmail, input.SetEmailDisposition, kind, input.ReplyAllowed, classification)
		updated, err := scanConversation(row)
		if errors.Is(err, sql.ErrNoRows) {
			return Conversation{}, ErrNotFound
		}
		return updated, err
	}
	conversation, err := s.GetConversation(ctx, id)
	if err != nil {
		return Conversation{}, err
	}
	if input.Status != "" {
		status, err := normalizeConversationStatus(input.Status)
		if err != nil {
			return Conversation{}, err
		}
		if status == ConversationStatusClosed && conversation.Status != ConversationStatusClosed {
			conversation.ClosedAt = time.Now().UTC()
		} else if status != ConversationStatusClosed {
			conversation.ClosedAt = time.Time{}
		}
		conversation.Status = status
	}
	if input.SetAssignedAgentID {
		conversation.AssignedAgentID = strings.TrimSpace(input.AssignedAgentID)
	}
	if input.SetCustomerIdentity {
		if value := strings.TrimSpace(input.CustomerName); value != "" {
			conversation.CustomerName = value
		}
		if value := strings.TrimSpace(input.CustomerEmail); value != "" {
			conversation.CustomerEmail = value
		}
	}
	if input.SetEmailDisposition {
		conversation.Kind = normalizeConversationKind(input.Kind)
		conversation.ReplyAllowed = input.ReplyAllowed
		conversation.Classification = strings.TrimSpace(input.Classification)
	}
	if input.SetRecord {
		conversation.RecordPrimary = strings.TrimSpace(input.RecordPrimary)
		conversation.RecordSecondary = strings.TrimSpace(input.RecordSecondary)
		conversation.RecordTertiary = strings.TrimSpace(input.RecordTertiary)
		conversation.RecordRemark = strings.TrimSpace(input.RecordRemark)
		conversation.RecordOrderNumber = strings.TrimSpace(input.RecordOrderNumber)
		conversation.RecordClassified = input.RecordClassified
		conversation.RecordAutoFilled = input.RecordAutoFilled
		conversation.RecordUpdatedAt = time.Now().UTC()
		conversation.RecordUpdatedBy = strings.TrimSpace(input.RecordUpdatedBy)
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE conversations
		SET status = $2, assigned_agent_id = $3, updated_at = $4,
		    record_primary = $5, record_secondary = $6, record_tertiary = $7,
		    record_remark = $8, record_order_number = $9,
		    record_classified = $10, record_auto_filled = $11,
		    record_updated_at = NULLIF($12, '')::timestamptz, record_updated_by = $13,
		    kind = $14, reply_allowed = $15, classification_reason = $16,
		    customer_name = $17, customer_email = $18, closed_at = $19
		WHERE id = $1
		RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
	`, id, conversation.Status, conversation.AssignedAgentID, time.Now().UTC(), conversation.RecordPrimary, conversation.RecordSecondary, conversation.RecordTertiary, conversation.RecordRemark, conversation.RecordOrderNumber, conversation.RecordClassified, conversation.RecordAutoFilled, nullableTimeText(conversation.RecordUpdatedAt), conversation.RecordUpdatedBy, conversation.Kind, conversation.ReplyAllowed, conversation.Classification, conversation.CustomerName, conversation.CustomerEmail, nullableTimeValue(conversation.ClosedAt))
	updated, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, ErrNotFound
	}
	return updated, err
}

func (s *PostgresStore) PromoteSystemConversation(ctx context.Context, id string, replyAllowed bool, classification string) (Conversation, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Conversation{}, err
	}
	defer func() { _ = tx.Rollback() }()
	id = strings.TrimSpace(id)
	var currentKind string
	if err := tx.QueryRowContext(ctx, `SELECT kind FROM conversations WHERE id=$1 FOR UPDATE`, id).Scan(&currentKind); errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, ErrNotFound
	} else if err != nil {
		return Conversation{}, err
	}
	if normalizeConversationKind(currentKind) != ConversationKindSystem {
		return Conversation{}, fmt.Errorf("%w: 该邮件已进入客户会话", ErrConflict)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE messages SET direction=$2 WHERE conversation_id=$1 AND LOWER(direction)=$3`, id, MessageDirectionCustomer, MessageDirectionSystem); err != nil {
		return Conversation{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM conversation_reads WHERE conversation_id=$1`, id); err != nil {
		return Conversation{}, err
	}
	row := tx.QueryRowContext(ctx, `
		UPDATE conversations
		SET kind=$2, reply_allowed=$3, classification_reason=$4, status=$5,
		    assigned_agent_id='', closed_at=NULL, updated_at=$6
		WHERE id=$1
		RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
	`, id, ConversationKindCustomer, replyAllowed, strings.TrimSpace(classification), ConversationStatusOpen, time.Now().UTC())
	conversation, err := scanConversation(row)
	if err != nil {
		return Conversation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Conversation{}, err
	}
	return conversation, nil
}

func (s *PostgresStore) BackfillConversationRecordLifecycle(ctx context.Context, id string, primary string, orderNumber string) error {
	id = strings.TrimSpace(id)
	primary = strings.TrimSpace(primary)
	orderNumber = strings.TrimSpace(orderNumber)
	if id == "" || primary == "" {
		return ErrInvalid
	}
	result, err := s.db.ExecContext(ctx, `
		UPDATE conversations
		SET record_primary = $2,
		    record_order_number = CASE WHEN record_order_number = '' AND $3 <> '' THEN $3 ELSE record_order_number END
		WHERE id = $1 AND record_auto_filled = TRUE
	`, id, primary, orderNumber)
	if err != nil {
		return err
	}
	if affected, affectedErr := result.RowsAffected(); affectedErr == nil && affected == 0 {
		if _, getErr := s.GetConversation(ctx, id); getErr != nil {
			return getErr
		}
	}
	return nil
}

func (s *PostgresStore) ClaimConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	id = strings.TrimSpace(id)
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return Conversation{}, fmt.Errorf("%w: userId is required", ErrInvalid)
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE conversations
		SET status = $3, assigned_agent_id = $2, updated_at = $4, closed_at = NULL
		WHERE id = $1 AND status = $5 AND assigned_agent_id = ''
		RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
	`, id, userID, ConversationStatusAssigned, time.Now().UTC(), ConversationStatusOpen)
	updated, err := scanConversation(row)
	if err == nil {
		return updated, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, err
	}
	existing, getErr := s.GetConversation(ctx, id)
	if getErr != nil {
		return Conversation{}, getErr
	}
	if existing.Status == ConversationStatusAssigned && existing.AssignedAgentID == userID {
		return existing, nil
	}
	return Conversation{}, fmt.Errorf("%w: conversation is no longer available", ErrConflict)
}

func (s *PostgresStore) CloseConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	id = strings.TrimSpace(id)
	userID = strings.TrimSpace(userID)
	row := s.db.QueryRowContext(ctx, `
		UPDATE conversations
		SET status = $3, updated_at = $4, closed_at = $4
		WHERE id = $1 AND status = $5 AND assigned_agent_id = $2
		RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
	`, id, userID, ConversationStatusClosed, time.Now().UTC(), ConversationStatusAssigned)
	updated, err := scanConversation(row)
	if err == nil {
		return updated, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, err
	}
	existing, getErr := s.GetConversation(ctx, id)
	if getErr != nil {
		return Conversation{}, getErr
	}
	if existing.Status == ConversationStatusClosed && existing.AssignedAgentID == userID {
		return existing, nil
	}
	return Conversation{}, fmt.Errorf("%w: only the assigned agent can close the conversation", ErrConflict)
}

func (s *PostgresStore) CloseInactiveCustomerConversations(ctx context.Context, before time.Time) ([]Conversation, error) {
	rows, err := s.db.QueryContext(ctx, `
		UPDATE conversations AS c
		SET status = $1, updated_at = $2, closed_at = $2
		FROM shop_sources AS source
		WHERE c.source_id = source.id
		  AND source.type IN ($3, $9)
		  AND c.status = $4
		  AND c.kind = $5
		  AND c.assigned_agent_id <> ''
		  AND NOT EXISTS (
			SELECT 1 FROM messages pending_send
			WHERE pending_send.conversation_id = c.id
			  AND COALESCE(pending_send.metadata->>'email_send_status', '') IN ('queued', 'sending', 'reconciling', 'failed')
		  )
		  AND COALESCE((
			SELECT m.direction = $7 AND m.created_at <= $6
			FROM messages m
			WHERE m.conversation_id = c.id
			  AND m.direction IN ($7, $8)
			ORDER BY m.created_at DESC, m.id DESC
			LIMIT 1
		  ), FALSE)
		RETURNING c.id, c.shop_id, c.source_id, c.customer_name, c.customer_email, c.subject, c.status, c.assigned_agent_id, c.last_message_at, c.created_at, c.updated_at, c.kind, c.reply_allowed, c.classification_reason, c.record_primary, c.record_secondary, c.record_tertiary, c.record_remark, c.record_classified, c.record_auto_filled, c.record_updated_at, c.record_updated_by, c.record_order_number, c.closed_at
	`, ConversationStatusClosed, time.Now().UTC(), SourceTypeShopifyChat, ConversationStatusAssigned, ConversationKindCustomer, before.UTC(), MessageDirectionAgent, MessageDirectionCustomer, SourceTypeEmail)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	closed := make([]Conversation, 0)
	for rows.Next() {
		conversation, scanErr := scanConversation(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		closed = append(closed, conversation)
	}
	return closed, rows.Err()
}

func (s *PostgresStore) ReopenConversation(ctx context.Context, id string, userID string) (Conversation, error) {
	id = strings.TrimSpace(id)
	userID = strings.TrimSpace(userID)
	row := s.db.QueryRowContext(ctx, `
		UPDATE conversations
		SET status = $3, assigned_agent_id = $2, updated_at = $4, closed_at = NULL
		WHERE id = $1 AND status = $5 AND (assigned_agent_id = '' OR assigned_agent_id = $2)
		RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
	`, id, userID, ConversationStatusAssigned, time.Now().UTC(), ConversationStatusClosed)
	updated, err := scanConversation(row)
	if err == nil {
		return updated, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, err
	}
	existing, getErr := s.GetConversation(ctx, id)
	if getErr != nil {
		return Conversation{}, getErr
	}
	if existing.Status == ConversationStatusAssigned && existing.AssignedAgentID == userID {
		return existing, nil
	}
	return Conversation{}, fmt.Errorf("%w: conversation cannot be reopened by this agent", ErrConflict)
}

func (s *PostgresStore) AddMessage(ctx context.Context, input Message) (Message, Conversation, error) {
	return s.addMessage(ctx, input, "")
}

func (s *PostgresStore) AddAgentMessage(ctx context.Context, input Message, userID string) (Message, Conversation, error) {
	return s.addMessage(ctx, input, strings.TrimSpace(userID))
}

func (s *PostgresStore) addMessage(ctx context.Context, input Message, agentID string) (Message, Conversation, error) {
	if strings.TrimSpace(input.ConversationID) == "" {
		return Message{}, Conversation{}, fmt.Errorf("%w: conversationId is required", ErrInvalid)
	}
	if strings.TrimSpace(input.Body) == "" {
		return Message{}, Conversation{}, fmt.Errorf("%w: body is required", ErrInvalid)
	}
	now := time.Now().UTC()
	autoCreatedAt := input.CreatedAt.IsZero()
	createdAt := input.CreatedAt
	if autoCreatedAt {
		createdAt = now
	}
	if input.ID == "" {
		input.ID = prefixedID("msg")
	}
	input.Direction = defaultString(input.Direction, MessageDirectionCustomer)
	input, err := normalizeMessageContent(input)
	if err != nil {
		return Message{}, Conversation{}, err
	}
	input.Body = strings.TrimSpace(input.Body)
	if agentID != "" {
		input.Metadata = mergeStringMaps(input.Metadata, map[string]string{messageAgentIDMetadataKey: agentID})
	}
	metadata, err := marshalMetadata(input.Metadata)
	if err != nil {
		return Message{}, Conversation{}, err
	}
	input.SenderName = strings.TrimSpace(input.SenderName)
	input.SenderEmail = strings.TrimSpace(input.SenderEmail)
	input.SourceMessageID = strings.TrimSpace(input.SourceMessageID)
	input.CreatedAt = createdAt

	if input.SourceMessageID != "" {
		existing, err := s.messageBySourceMessageID(ctx, input.ConversationID, input.SourceMessageID)
		if err == nil {
			conversation, convErr := s.GetConversation(ctx, input.ConversationID)
			return existing, conversation, convErr
		}
		if !errors.Is(err, ErrNotFound) {
			return Message{}, Conversation{}, err
		}
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Message{}, Conversation{}, err
	}
	defer tx.Rollback()
	var status string
	var assignedAgentID string
	var replyAllowed bool
	var conversationKind string
	var conversationLastMessageAt time.Time
	err = tx.QueryRowContext(ctx, `
			SELECT status, assigned_agent_id, reply_allowed, kind, last_message_at
			FROM conversations
			WHERE id = $1
			FOR UPDATE
		`, input.ConversationID).Scan(&status, &assignedAgentID, &replyAllowed, &conversationKind, &conversationLastMessageAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, Conversation{}, ErrNotFound
	}
	if err != nil {
		return Message{}, Conversation{}, err
	}
	if agentID != "" {
		if !replyAllowed {
			return Message{}, Conversation{}, fmt.Errorf("%w: this conversation is read-only", ErrForbidden)
		}
		if status != ConversationStatusAssigned {
			return Message{}, Conversation{}, fmt.Errorf("%w: conversation must be claimed before replying", ErrConflict)
		}
		if assignedAgentID != agentID {
			return Message{}, Conversation{}, fmt.Errorf("%w: conversation is assigned to another agent", ErrForbidden)
		}
		input.Direction = MessageDirectionAgent
	}
	if autoCreatedAt && !createdAt.After(conversationLastMessageAt) {
		createdAt = conversationLastMessageAt.Add(time.Nanosecond)
		input.CreatedAt = createdAt
	}
	reopenStatus := ConversationStatusOpen
	reopenAgentID := ""

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO messages (id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`, input.ID, input.ConversationID, input.Direction, input.Type, input.Body, metadata, input.SenderName, input.SenderEmail, input.SourceMessageID, input.CreatedAt); err != nil {
		if isForeignKeyError(err) {
			return Message{}, Conversation{}, ErrNotFound
		}
		if input.SourceMessageID != "" && isUniqueConstraintError(err) {
			existing, existingErr := s.messageBySourceMessageID(ctx, input.ConversationID, input.SourceMessageID)
			if existingErr != nil {
				return Message{}, Conversation{}, existingErr
			}
			conversation, convErr := s.GetConversation(ctx, input.ConversationID)
			return existing, conversation, convErr
		}
		return Message{}, Conversation{}, err
	}
	if !isHistoricalEmailMessage(input) && isUnreadConversationMessage(conversationKind, input.Direction) {
		if _, err := tx.ExecContext(ctx, `DELETE FROM conversation_reads WHERE conversation_id = $1`, input.ConversationID); err != nil {
			return Message{}, Conversation{}, err
		}
	}

	reopensConversation := !isHistoricalEmailMessage(input) && messageReopensConversation(conversationKind, input.Direction)
	row := tx.QueryRowContext(ctx, `
		UPDATE conversations
		SET last_message_at = GREATEST(last_message_at, $2),
			updated_at = $3,
			status = CASE WHEN $4 AND status = $5 THEN $6 ELSE status END,
			assigned_agent_id = CASE WHEN $4 AND status = $5 THEN $7 ELSE assigned_agent_id END,
			closed_at = CASE WHEN $4 AND status = $5 THEN NULL ELSE closed_at END
		WHERE id = $1
		RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
	`, input.ConversationID, createdAt, now, reopensConversation, ConversationStatusClosed, reopenStatus, reopenAgentID)
	conversation, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, Conversation{}, ErrNotFound
	}
	if err != nil {
		return Message{}, Conversation{}, err
	}
	if err := tx.QueryRowContext(ctx, `
		SELECT
			COALESCE((
				SELECT MAX(customer_message.created_at)
				FROM messages customer_message
				WHERE customer_message.conversation_id = $1 AND LOWER(customer_message.direction) = $3
			), $2),
			COALESCE((
				SELECT LOWER(latest_message.direction)
				FROM messages latest_message
				WHERE latest_message.conversation_id = $1
				  AND LOWER(latest_message.direction) IN ($3, $4)
				ORDER BY latest_message.created_at DESC, latest_message.id DESC
				LIMIT 1
			), '')
	`, input.ConversationID, conversation.LastMessageAt, MessageDirectionCustomer, MessageDirectionAgent).Scan(
		&conversation.CustomerLastMessageAt,
		&conversation.LastMessageDirection,
	); err != nil {
		return Message{}, Conversation{}, err
	}
	if err := tx.Commit(); err != nil {
		return Message{}, Conversation{}, err
	}
	return input, conversation, nil
}

func (s *PostgresStore) ListMessages(ctx context.Context, conversationID string) ([]Message, error) {
	if strings.TrimSpace(conversationID) == "" {
		return nil, fmt.Errorf("%w: conversationId is required", ErrInvalid)
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at
		FROM messages
		WHERE conversation_id = $1
		ORDER BY created_at ASC, id ASC
	`, conversationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if out == nil {
		if _, err := s.GetConversation(ctx, conversationID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *PostgresStore) GetMessage(ctx context.Context, conversationID string, messageID string) (Message, error) {
	message, err := scanMessage(s.db.QueryRowContext(ctx, `
		SELECT id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at
		FROM messages WHERE conversation_id = $1 AND id = $2
	`, strings.TrimSpace(conversationID), strings.TrimSpace(messageID)))
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return message, err
}

func (s *PostgresStore) ListMessagePage(ctx context.Context, conversationID string, beforeMessageID string, limit int) ([]Message, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, fmt.Errorf("%w: conversationId is required", ErrInvalid)
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at
		FROM messages m
		WHERE m.conversation_id = $1
		  AND ($2 = '' OR (m.created_at, m.id) < (
			SELECT cursor.created_at, cursor.id FROM messages cursor WHERE cursor.conversation_id = $1 AND cursor.id = $2
		  ))
		ORDER BY m.created_at DESC, m.id DESC
		LIMIT $3
	`, conversationID, strings.TrimSpace(beforeMessageID), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		message, scanErr := scanMessage(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, message)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	if len(out) == 0 {
		if _, err := s.GetConversation(ctx, conversationID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *PostgresStore) ListMessageRange(ctx context.Context, conversationID string, afterMessageID string, throughMessageID string) ([]Message, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at
		FROM messages m
		WHERE m.conversation_id = $1
		  AND ($2 = '' OR (m.created_at, m.id) > (
			SELECT boundary.created_at, boundary.id FROM messages boundary WHERE boundary.conversation_id = $1 AND boundary.id = $2
		  ))
		  AND ($3 = '' OR (m.created_at, m.id) <= (
			SELECT boundary.created_at, boundary.id FROM messages boundary WHERE boundary.conversation_id = $1 AND boundary.id = $3
		  ))
		ORDER BY m.created_at ASC, m.id ASC
	`, strings.TrimSpace(conversationID), strings.TrimSpace(afterMessageID), strings.TrimSpace(throughMessageID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Message{}
	for rows.Next() {
		message, scanErr := scanMessage(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, message)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ListResponseSamples(ctx context.Context) ([]ResponseSample, error) {
	rows, err := s.db.QueryContext(ctx, `
		WITH response_pairs AS (
			SELECT COALESCE(NULLIF(agent.metadata->>'agentId', ''), NULLIF(c.assigned_agent_id, '')) AS response_agent_id,
			       c.id AS conversation_id,
			       EXTRACT(EPOCH FROM (agent.created_at - customer.created_at)) AS seconds,
			       customer.created_at AS started_at,
			       agent.created_at AS response_at
			FROM conversations c
			JOIN messages agent ON agent.conversation_id = c.id AND agent.direction = 'agent'
			JOIN LATERAL (
				SELECT customer_message.created_at
				FROM messages customer_message
				WHERE customer_message.conversation_id = c.id
				  AND customer_message.direction = 'customer'
				  AND COALESCE(customer_message.metadata->>'email_historical_import', '') <> 'true'
				  AND customer_message.created_at < agent.created_at
				ORDER BY customer_message.created_at DESC, customer_message.id DESC
				LIMIT 1
			) customer ON TRUE
			WHERE COALESCE(NULLIF(agent.metadata->>'agentId', ''), NULLIF(c.assigned_agent_id, '')) IS NOT NULL
			  AND COALESCE(agent.metadata->>'email_historical_import', '') <> 'true'
			  AND NOT EXISTS (
				SELECT 1 FROM messages earlier_agent
				WHERE earlier_agent.conversation_id = c.id
				  AND earlier_agent.direction = 'agent'
				  AND earlier_agent.created_at > customer.created_at
				  AND earlier_agent.created_at < agent.created_at
			  )
		), ranked AS (
			SELECT *, ROW_NUMBER() OVER (PARTITION BY conversation_id ORDER BY response_at ASC) = 1 AS first
			FROM response_pairs
		)
		SELECT response_agent_id, conversation_id, seconds, first, started_at, response_at
		FROM ranked
		WHERE seconds >= 0
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ResponseSample{}
	for rows.Next() {
		var sample ResponseSample
		if err := rows.Scan(&sample.AgentID, &sample.ConversationID, &sample.Seconds, &sample.First, &sample.StartedAt, &sample.EndedAt); err != nil {
			return nil, err
		}
		out = append(out, sample)
	}
	return out, rows.Err()
}

func (s *PostgresStore) UpdateMessageMetadata(ctx context.Context, conversationID string, messageID string, patch map[string]string) (Message, error) {
	metadata, err := marshalMetadata(patch)
	if err != nil {
		return Message{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE messages
		SET metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
		WHERE conversation_id = $1 AND id = $2
		RETURNING id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at
	`, strings.TrimSpace(conversationID), strings.TrimSpace(messageID), metadata)
	message, err := scanMessage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return message, err
}

func (s *PostgresStore) ListUnreadConversationIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT m.conversation_id
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		LEFT JOIN conversation_reads r
		  ON r.conversation_id = m.conversation_id AND r.user_id = $1
		WHERE (LOWER(m.direction) = $2 OR (c.kind = $4 AND LOWER(m.direction) = $3))
		  AND COALESCE(m.metadata->>'email_historical_import', '') <> 'true'
		  AND (r.last_read_at IS NULL OR m.created_at > r.last_read_at)
	`, strings.TrimSpace(userID), MessageDirectionCustomer, MessageDirectionSystem, ConversationKindSystem)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var conversationID string
		if err := rows.Scan(&conversationID); err != nil {
			return nil, err
		}
		out = append(out, conversationID)
	}
	return out, rows.Err()
}

func (s *PostgresStore) MarkConversationRead(ctx context.Context, userID string, conversationID string, readAt time.Time) error {
	if readAt.IsZero() {
		readAt = time.Now().UTC()
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO conversation_reads (user_id, conversation_id, last_read_at)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, conversation_id)
		DO UPDATE SET last_read_at = GREATEST(conversation_reads.last_read_at, EXCLUDED.last_read_at)
	`, strings.TrimSpace(userID), strings.TrimSpace(conversationID), readAt.UTC())
	if isForeignKeyError(err) {
		return ErrNotFound
	}
	return err
}

func (s *PostgresStore) messageBySourceMessageID(ctx context.Context, conversationID string, sourceMessageID string) (Message, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, conversation_id, direction, message_type, body, metadata, sender_name, sender_email, source_message_id, created_at
		FROM messages
		WHERE conversation_id = $1 AND source_message_id = $2
		LIMIT 1
	`, strings.TrimSpace(conversationID), strings.TrimSpace(sourceMessageID))
	message, err := scanMessage(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Message{}, ErrNotFound
	}
	return message, err
}

func (s *PostgresStore) GetConversation(ctx context.Context, id string) (Conversation, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at
		FROM conversations
		WHERE id = $1
	`, id)
	conversation, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, ErrNotFound
	}
	return conversation, err
}

func (s *PostgresStore) ListConversationEmailTags(ctx context.Context) (map[string][]EmailProcessingTag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT conversation_id, tags
		FROM conversation_email_tags
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]EmailProcessingTag{}
	for rows.Next() {
		var conversationID string
		var raw []byte
		if err := rows.Scan(&conversationID, &raw); err != nil {
			return nil, err
		}
		var tags []EmailProcessingTag
		if err := json.Unmarshal(raw, &tags); err != nil {
			return nil, err
		}
		out[conversationID] = append([]EmailProcessingTag(nil), tags...)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ReplaceConversationEmailTags(ctx context.Context, conversationID string, tags []EmailProcessingTag, updatedBy string) ([]EmailProcessingTag, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, fmt.Errorf("%w: conversation is required", ErrInvalid)
	}
	if _, err := s.GetConversation(ctx, conversationID); err != nil {
		return nil, err
	}
	if len(tags) == 0 {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM conversation_email_tags WHERE conversation_id = $1`, conversationID); err != nil {
			return nil, err
		}
		return []EmailProcessingTag{}, nil
	}
	cloned := append([]EmailProcessingTag(nil), tags...)
	raw, err := json.Marshal(cloned)
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO conversation_email_tags (conversation_id, tags, updated_by, updated_at)
		VALUES ($1, $2, $3, NOW())
		ON CONFLICT (conversation_id) DO UPDATE
		SET tags = EXCLUDED.tags, updated_by = EXCLUDED.updated_by, updated_at = NOW()
	`, conversationID, raw, strings.TrimSpace(updatedBy))
	if err != nil {
		return nil, err
	}
	return cloned, nil
}

func (s *PostgresStore) CreateKnowledge(ctx context.Context, input KnowledgeEntry) (KnowledgeEntry, error) {
	var err error
	input, err = normalizeKnowledgeEntry(input, true)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	if input.ShopID != "" {
		if _, err := s.GetShop(ctx, input.ShopID); err != nil {
			return KnowledgeEntry{}, err
		}
	}
	if input.ConversationID != "" {
		if _, err := s.GetConversation(ctx, input.ConversationID); err != nil {
			return KnowledgeEntry{}, err
		}
	}
	if input.SupersedesID != "" {
		base, err := s.GetKnowledge(ctx, input.SupersedesID)
		if err != nil || base.Status != KnowledgeStatusPublished {
			return KnowledgeEntry{}, fmt.Errorf("%w: published knowledge to revise was not found", ErrInvalid)
		}
	}
	if input.ID == "" {
		input.ID = prefixedID("knowledge")
	}
	now := time.Now().UTC()
	input.CreatedAt = now
	input.UpdatedAt = now
	if input.Status == KnowledgeStatusPublished || input.Status == KnowledgeStatusRejected {
		input.ReviewedAt = now
	}
	tags, err := json.Marshal(input.Tags)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO knowledge_entries (id, supersedes_id, scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at)
		VALUES ($1, NULLIF($2, ''), $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
	`, input.ID, input.SupersedesID, input.Scope, input.ShopID, input.Title, input.Answer, tags, input.Status, input.ConversationID, input.SubmittedBy, input.ReviewedBy, input.ReviewNote, input.CreatedAt, input.UpdatedAt, nullableTimeValue(input.ReviewedAt))
	if isUniqueConstraintError(err) && input.ConversationID != "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: conversation has already been submitted", ErrConflict)
	}
	if isUniqueConstraintError(err) && input.SupersedesID != "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: knowledge already has a pending revision", ErrConflict)
	}
	return input, err
}

func (s *PostgresStore) ListKnowledge(ctx context.Context, filter KnowledgeFilter) ([]KnowledgeEntry, error) {
	pageSize := filter.PageSize
	offset := 0
	if pageSize > 0 {
		offset = (max(filter.Page, 1) - 1) * pageSize
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, COALESCE(supersedes_id, ''), scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at
		FROM knowledge_entries
		WHERE ($1 = '' OR shop_id = $1)
		  AND ($2 = '' OR status = $2)
		  AND ($3 = '' OR scope = $3)
		  AND ($4 = '' OR submitted_by = $4)
		ORDER BY updated_at DESC, id ASC
		LIMIT NULLIF($5, 0) OFFSET $6
	`, strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.Status), strings.TrimSpace(filter.Scope), strings.TrimSpace(filter.SubmittedBy), pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []KnowledgeEntry{}
	for rows.Next() {
		entry, err := scanKnowledge(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (s *PostgresStore) CountKnowledge(ctx context.Context, filter KnowledgeFilter) (int, error) {
	var total int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*)
		FROM knowledge_entries
		WHERE ($1 = '' OR shop_id = $1)
		  AND ($2 = '' OR status = $2)
		  AND ($3 = '' OR scope = $3)
		  AND ($4 = '' OR submitted_by = $4)
	`, strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.Status), strings.TrimSpace(filter.Scope), strings.TrimSpace(filter.SubmittedBy)).Scan(&total)
	return total, err
}

func (s *PostgresStore) GetKnowledge(ctx context.Context, id string) (KnowledgeEntry, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT id, COALESCE(supersedes_id, ''), scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at
		FROM knowledge_entries WHERE id = $1
	`, strings.TrimSpace(id))
	entry, err := scanKnowledge(row)
	if errors.Is(err, sql.ErrNoRows) {
		return KnowledgeEntry{}, ErrNotFound
	}
	return entry, err
}

func (s *PostgresStore) UpdateKnowledge(ctx context.Context, id string, input KnowledgeUpdate) (KnowledgeEntry, error) {
	entry, err := s.GetKnowledge(ctx, id)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	if strings.TrimSpace(input.Scope) != "" {
		entry.Scope = input.Scope
	}
	if input.ShopID != "" || entry.Scope == KnowledgeScopeGlobal {
		entry.ShopID = strings.TrimSpace(input.ShopID)
	}
	if strings.TrimSpace(input.Title) != "" {
		entry.Title = input.Title
	}
	if strings.TrimSpace(input.Answer) != "" {
		entry.Answer = input.Answer
	}
	if input.Tags != nil {
		entry.Tags = input.Tags
	}
	if strings.TrimSpace(input.Status) != "" {
		entry.Status = input.Status
	}
	if input.ReviewNote != "" {
		entry.ReviewNote = input.ReviewNote
	}
	if input.ReviewedBy != "" {
		entry.ReviewedBy = strings.TrimSpace(input.ReviewedBy)
	}
	entry, err = normalizeKnowledgeEntry(entry, false)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	if entry.ShopID != "" {
		if _, err := s.GetShop(ctx, entry.ShopID); err != nil {
			return KnowledgeEntry{}, err
		}
	}
	entry.UpdatedAt = time.Now().UTC()
	if input.Status == KnowledgeStatusPending {
		entry.ReviewedBy = ""
		entry.ReviewNote = ""
		entry.ReviewedAt = time.Time{}
	} else if input.Status == KnowledgeStatusPublished || input.Status == KnowledgeStatusRejected {
		entry.ReviewNote = strings.TrimSpace(input.ReviewNote)
		entry.ReviewedAt = entry.UpdatedAt
	}
	tags, err := json.Marshal(entry.Tags)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE knowledge_entries
		SET scope = $2, shop_id = $3, title = $4, answer = $5, tags = $6, status = $7, reviewed_by = $8, review_note = $9, updated_at = $10, reviewed_at = $11
		WHERE id = $1
		RETURNING id, COALESCE(supersedes_id, ''), scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at
	`, entry.ID, entry.Scope, entry.ShopID, entry.Title, entry.Answer, tags, entry.Status, entry.ReviewedBy, entry.ReviewNote, entry.UpdatedAt, nullableTimeValue(entry.ReviewedAt))
	updated, err := scanKnowledge(row)
	if errors.Is(err, sql.ErrNoRows) {
		return KnowledgeEntry{}, ErrNotFound
	}
	if isUniqueConstraintError(err) && entry.SupersedesID != "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: knowledge already has a pending revision", ErrConflict)
	}
	return updated, err
}

func (s *PostgresStore) ApplyKnowledgeRevision(ctx context.Context, revisionID string, reviewedBy string, reviewNote string) (KnowledgeEntry, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	defer tx.Rollback()

	revision, err := scanKnowledge(tx.QueryRowContext(ctx, `
		SELECT id, COALESCE(supersedes_id, ''), scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at
		FROM knowledge_entries
		WHERE id = $1
		FOR UPDATE
	`, strings.TrimSpace(revisionID)))
	if errors.Is(err, sql.ErrNoRows) {
		return KnowledgeEntry{}, ErrNotFound
	}
	if err != nil {
		return KnowledgeEntry{}, err
	}
	if revision.Status != KnowledgeStatusPending || revision.SupersedesID == "" {
		return KnowledgeEntry{}, fmt.Errorf("%w: knowledge is not a pending revision", ErrInvalid)
	}

	base, err := scanKnowledge(tx.QueryRowContext(ctx, `
		SELECT id, COALESCE(supersedes_id, ''), scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at
		FROM knowledge_entries
		WHERE id = $1
		FOR UPDATE
	`, revision.SupersedesID))
	if errors.Is(err, sql.ErrNoRows) || (err == nil && base.Status != KnowledgeStatusPublished) {
		return KnowledgeEntry{}, fmt.Errorf("%w: published knowledge to revise was not found", ErrConflict)
	}
	if err != nil {
		return KnowledgeEntry{}, err
	}

	tags, err := json.Marshal(revision.Tags)
	if err != nil {
		return KnowledgeEntry{}, err
	}
	now := time.Now().UTC()
	updated, err := scanKnowledge(tx.QueryRowContext(ctx, `
		UPDATE knowledge_entries
		SET scope = $2, shop_id = $3, title = $4, answer = $5, tags = $6,
		    submitted_by = $7, reviewed_by = $8, review_note = $9,
		    updated_at = $10, reviewed_at = $10
		WHERE id = $1
		RETURNING id, COALESCE(supersedes_id, ''), scope, shop_id, title, answer, tags, status, conversation_id, submitted_by, reviewed_by, review_note, created_at, updated_at, reviewed_at
	`, base.ID, revision.Scope, revision.ShopID, revision.Title, revision.Answer, tags,
		revision.SubmittedBy, strings.TrimSpace(reviewedBy), strings.TrimSpace(reviewNote), now))
	if err != nil {
		return KnowledgeEntry{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM knowledge_entries WHERE id = $1`, revision.ID); err != nil {
		return KnowledgeEntry{}, err
	}
	if err := tx.Commit(); err != nil {
		return KnowledgeEntry{}, err
	}
	return updated, nil
}

func (s *PostgresStore) DeleteKnowledge(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM knowledge_entries
		WHERE id = $1
	`, strings.TrimSpace(id))
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) GetAISettings(ctx context.Context) (AISettings, error) {
	var settings AISettings
	var lastTestedAt sql.NullTime
	var models []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT enabled, base_url, model, models, thinking, encrypted_key, last_tested_at, last_test_ok, last_test_error, updated_at
		FROM ai_settings WHERE id = 'global'
	`).Scan(&settings.Enabled, &settings.BaseURL, &settings.Model, &models, &settings.Thinking, &settings.EncryptedKey, &lastTestedAt, &settings.LastTestOK, &settings.LastTestError, &settings.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return AISettings{}, ErrNotFound
	}
	if lastTestedAt.Valid {
		settings.LastTestedAt = lastTestedAt.Time
	}
	if len(models) > 0 {
		if err := json.Unmarshal(models, &settings.Models); err != nil {
			return AISettings{}, err
		}
	}
	return settings, err
}

func (s *PostgresStore) SaveAISettings(ctx context.Context, input AISettings) (AISettings, error) {
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	input.Model = strings.TrimSpace(input.Model)
	input.Models = normalizeAIModels(input.Models, input.Model)
	if input.BaseURL == "" || input.Model == "" {
		return AISettings{}, fmt.Errorf("%w: AI baseUrl and model are required", ErrInvalid)
	}
	input.UpdatedAt = time.Now().UTC()
	models, err := json.Marshal(input.Models)
	if err != nil {
		return AISettings{}, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO ai_settings (id, enabled, base_url, model, models, thinking, encrypted_key, last_tested_at, last_test_ok, last_test_error, updated_at)
		VALUES ('global', $1, $2, $3, $4, $5, $6, NULLIF($7, '')::timestamptz, $8, $9, $10)
		ON CONFLICT (id) DO UPDATE SET
		  enabled = EXCLUDED.enabled,
		  base_url = EXCLUDED.base_url,
		  model = EXCLUDED.model,
		  models = EXCLUDED.models,
		  thinking = EXCLUDED.thinking,
		  encrypted_key = EXCLUDED.encrypted_key,
		  last_tested_at = EXCLUDED.last_tested_at,
		  last_test_ok = EXCLUDED.last_test_ok,
		  last_test_error = EXCLUDED.last_test_error,
		  updated_at = EXCLUDED.updated_at
	`, input.Enabled, input.BaseURL, input.Model, models, input.Thinking, input.EncryptedKey, nullableTimeText(input.LastTestedAt), input.LastTestOK, input.LastTestError, input.UpdatedAt)
	return input, err
}

func (s *PostgresStore) GetLogisticsSettings(ctx context.Context) (LogisticsSettings, error) {
	var settings LogisticsSettings
	var lastTestedAt sql.NullTime
	err := s.db.QueryRowContext(ctx, `
		SELECT enabled, base_url, encrypted_key,
		       auto_draft_enabled, auto_send_enabled, chat_enabled, gmail_enabled, outlook_enabled, reply_cooldown_hours,
		       last_tested_at, last_test_ok, last_test_error, updated_at
		FROM logistics_settings WHERE id = 'global'
	`).Scan(
		&settings.Enabled, &settings.BaseURL, &settings.EncryptedKey,
		&settings.AutoDraftEnabled, &settings.AutoSendEnabled, &settings.ChatEnabled, &settings.GmailEnabled, &settings.OutlookEnabled, &settings.ReplyCooldownHours,
		&lastTestedAt, &settings.LastTestOK, &settings.LastTestError, &settings.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return LogisticsSettings{}, ErrNotFound
	}
	if lastTestedAt.Valid {
		settings.LastTestedAt = lastTestedAt.Time
	}
	return settings, err
}

func (s *PostgresStore) SaveLogisticsSettings(ctx context.Context, input LogisticsSettings) (LogisticsSettings, error) {
	input.BaseURL = strings.TrimSpace(input.BaseURL)
	if input.BaseURL == "" {
		return LogisticsSettings{}, fmt.Errorf("%w: logistics base URL is required", ErrInvalid)
	}
	input.ReplyCooldownHours = normalizeLogisticsReplyCooldown(input.ReplyCooldownHours)
	input.UpdatedAt = time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO logistics_settings (
		  id, enabled, base_url, encrypted_key,
		  auto_draft_enabled, auto_send_enabled, chat_enabled, gmail_enabled, outlook_enabled, reply_cooldown_hours,
		  last_tested_at, last_test_ok, last_test_error, updated_at
		)
		VALUES ('global', $1, $2, $3, $4, $5, $6, $7, $8, $9, NULLIF($10, '')::timestamptz, $11, $12, $13)
		ON CONFLICT (id) DO UPDATE SET
		  enabled = EXCLUDED.enabled,
		  base_url = EXCLUDED.base_url,
		  encrypted_key = EXCLUDED.encrypted_key,
		  auto_draft_enabled = EXCLUDED.auto_draft_enabled,
		  auto_send_enabled = EXCLUDED.auto_send_enabled,
		  chat_enabled = EXCLUDED.chat_enabled,
		  gmail_enabled = EXCLUDED.gmail_enabled,
		  outlook_enabled = EXCLUDED.outlook_enabled,
		  reply_cooldown_hours = EXCLUDED.reply_cooldown_hours,
		  last_tested_at = EXCLUDED.last_tested_at,
		  last_test_ok = EXCLUDED.last_test_ok,
		  last_test_error = EXCLUDED.last_test_error,
		  updated_at = EXCLUDED.updated_at
	`,
		input.Enabled, input.BaseURL, input.EncryptedKey,
		input.AutoDraftEnabled, input.AutoSendEnabled, input.ChatEnabled, input.GmailEnabled, input.OutlookEnabled, input.ReplyCooldownHours,
		nullableTimeText(input.LastTestedAt), input.LastTestOK, input.LastTestError, input.UpdatedAt,
	)
	return input, err
}

func (s *PostgresStore) ListCuiqiuDomainSettings(ctx context.Context) ([]CuiqiuDomainSettings, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT domain, api_base, encrypted_token, domain_id, smtp_host, smtp_port, smtp_mode,
		       webhook_verified_at, last_tested_at, last_test_ok, last_test_error, updated_at
		FROM cuiqiu_domain_settings
		ORDER BY domain
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []CuiqiuDomainSettings{}
	for rows.Next() {
		settings, scanErr := scanCuiqiuDomainSettings(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, settings)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetCuiqiuDomainSettings(ctx context.Context, domain string) (CuiqiuDomainSettings, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT domain, api_base, encrypted_token, domain_id, smtp_host, smtp_port, smtp_mode,
		       webhook_verified_at, last_tested_at, last_test_ok, last_test_error, updated_at
		FROM cuiqiu_domain_settings WHERE domain = $1
	`, normalizeEmailDomain(domain))
	settings, err := scanCuiqiuDomainSettings(row)
	if errors.Is(err, sql.ErrNoRows) {
		return CuiqiuDomainSettings{}, ErrNotFound
	}
	return settings, err
}

type cuiqiuDomainSettingsScanner interface {
	Scan(dest ...any) error
}

func scanCuiqiuDomainSettings(scanner cuiqiuDomainSettingsScanner) (CuiqiuDomainSettings, error) {
	var settings CuiqiuDomainSettings
	var webhookVerifiedAt sql.NullTime
	var lastTestedAt sql.NullTime
	err := scanner.Scan(
		&settings.Domain, &settings.APIBase, &settings.EncryptedToken, &settings.DomainID,
		&settings.SMTPHost, &settings.SMTPPort, &settings.SMTPMode,
		&webhookVerifiedAt, &lastTestedAt, &settings.LastTestOK, &settings.LastTestError, &settings.UpdatedAt,
	)
	if webhookVerifiedAt.Valid {
		settings.WebhookVerifiedAt = webhookVerifiedAt.Time
	}
	if lastTestedAt.Valid {
		settings.LastTestedAt = lastTestedAt.Time
	}
	return settings, err
}

func (s *PostgresStore) SaveCuiqiuDomainSettings(ctx context.Context, input CuiqiuDomainSettings) (CuiqiuDomainSettings, error) {
	normalized, err := normalizeCuiqiuDomainSettingsRecord(input)
	if err != nil {
		return CuiqiuDomainSettings{}, err
	}
	normalized.UpdatedAt = time.Now().UTC()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO cuiqiu_domain_settings (
		  domain, api_base, encrypted_token, domain_id, smtp_host, smtp_port, smtp_mode,
		  webhook_verified_at, last_tested_at, last_test_ok, last_test_error, updated_at
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, NULLIF($8, '')::timestamptz, NULLIF($9, '')::timestamptz, $10, $11, $12)
		ON CONFLICT (domain) DO UPDATE SET
		  api_base = EXCLUDED.api_base,
		  encrypted_token = EXCLUDED.encrypted_token,
		  domain_id = EXCLUDED.domain_id,
		  smtp_host = EXCLUDED.smtp_host,
		  smtp_port = EXCLUDED.smtp_port,
		  smtp_mode = EXCLUDED.smtp_mode,
		  webhook_verified_at = EXCLUDED.webhook_verified_at,
		  last_tested_at = EXCLUDED.last_tested_at,
		  last_test_ok = EXCLUDED.last_test_ok,
		  last_test_error = EXCLUDED.last_test_error,
		  updated_at = EXCLUDED.updated_at
	`,
		normalized.Domain, normalized.APIBase, normalized.EncryptedToken, normalized.DomainID,
		normalized.SMTPHost, normalized.SMTPPort, normalized.SMTPMode,
		nullableTimeText(normalized.WebhookVerifiedAt), nullableTimeText(normalized.LastTestedAt), normalized.LastTestOK, normalized.LastTestError, normalized.UpdatedAt,
	)
	return normalized, err
}

func (s *PostgresStore) MarkCuiqiuDomainWebhookVerified(ctx context.Context, domain string, verifiedAt time.Time) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE cuiqiu_domain_settings
		SET webhook_verified_at = $2
		WHERE domain = $1
	`, normalizeEmailDomain(domain), verifiedAt.UTC())
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) GetMonitorWorkSchedule(ctx context.Context) (MonitorWorkSchedule, error) {
	var settings MonitorWorkSchedule
	var weekdays []byte
	err := s.db.QueryRowContext(ctx, `
		SELECT enabled, timezone, start_minute, end_minute, weekdays, effective_from, updated_at
		FROM monitor_work_schedule_versions
		ORDER BY effective_from DESC, id DESC
		LIMIT 1
	`).Scan(
		&settings.Enabled, &settings.Timezone, &settings.StartMinute, &settings.EndMinute,
		&weekdays, &settings.EffectiveFrom, &settings.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return MonitorWorkSchedule{}, ErrNotFound
	}
	if err != nil {
		return MonitorWorkSchedule{}, err
	}
	if err := json.Unmarshal(weekdays, &settings.Weekdays); err != nil {
		return MonitorWorkSchedule{}, err
	}
	return settings, nil
}

func (s *PostgresStore) ListMonitorWorkScheduleVersions(ctx context.Context) ([]MonitorWorkSchedule, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT enabled, timezone, start_minute, end_minute, weekdays, effective_from, updated_at
		FROM monitor_work_schedule_versions
		ORDER BY effective_from ASC, id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MonitorWorkSchedule{}
	for rows.Next() {
		var settings MonitorWorkSchedule
		var weekdays []byte
		if err := rows.Scan(
			&settings.Enabled, &settings.Timezone, &settings.StartMinute, &settings.EndMinute,
			&weekdays, &settings.EffectiveFrom, &settings.UpdatedAt,
		); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(weekdays, &settings.Weekdays); err != nil {
			return nil, err
		}
		out = append(out, settings)
	}
	return out, rows.Err()
}

func (s *PostgresStore) SaveMonitorWorkSchedule(ctx context.Context, input MonitorWorkSchedule) (MonitorWorkSchedule, error) {
	input, err := normalizeMonitorWorkSchedule(input)
	if err != nil {
		return MonitorWorkSchedule{}, err
	}
	weekdays, err := json.Marshal(input.Weekdays)
	if err != nil {
		return MonitorWorkSchedule{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return MonitorWorkSchedule{}, err
	}
	defer func() { _ = tx.Rollback() }()
	const scheduleLockID int64 = 541632442070405151
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock($1)`, scheduleLockID); err != nil {
		return MonitorWorkSchedule{}, err
	}
	var hasEnabled bool
	if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM monitor_work_schedule_versions WHERE enabled)`).Scan(&hasEnabled); err != nil {
		return MonitorWorkSchedule{}, err
	}
	input.EffectiveFrom = time.Now().UTC()
	if input.Enabled && !hasEnabled {
		if _, err := tx.ExecContext(ctx, `DELETE FROM monitor_work_schedule_versions`); err != nil {
			return MonitorWorkSchedule{}, err
		}
		input.EffectiveFrom = monitorScheduleHistoryStart
	}
	err = tx.QueryRowContext(ctx, `
		INSERT INTO monitor_work_schedule_versions (
			enabled, timezone, start_minute, end_minute, weekdays, effective_from, updated_at
		)
		VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
		RETURNING effective_from, updated_at
	`, input.Enabled, input.Timezone, input.StartMinute, input.EndMinute, weekdays, input.EffectiveFrom).
		Scan(&input.EffectiveFrom, &input.UpdatedAt)
	if err != nil {
		return MonitorWorkSchedule{}, err
	}
	if err := tx.Commit(); err != nil {
		return MonitorWorkSchedule{}, err
	}
	return input, nil
}

func (s *PostgresStore) GetSLASettings(ctx context.Context) (SLASettings, error) {
	var settings SLASettings
	err := s.db.QueryRowContext(ctx, `
		SELECT first_response_minutes, response_minutes, resolution_minutes, updated_at
		FROM sla_settings
		WHERE id = 'global'
	`).Scan(
		&settings.FirstResponseMinutes,
		&settings.ResponseMinutes,
		&settings.ResolutionMinutes,
		&settings.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return SLASettings{}, ErrNotFound
	}
	return settings, err
}

func (s *PostgresStore) SaveSLASettings(ctx context.Context, input SLASettings) (SLASettings, error) {
	input, err := normalizeSLASettings(input)
	if err != nil {
		return SLASettings{}, err
	}
	err = s.db.QueryRowContext(ctx, `
		INSERT INTO sla_settings (
			id, first_response_minutes, response_minutes, resolution_minutes, updated_at
		)
		VALUES ('global', $1, $2, $3, NOW())
		ON CONFLICT (id) DO UPDATE SET
			first_response_minutes = EXCLUDED.first_response_minutes,
			response_minutes = EXCLUDED.response_minutes,
			resolution_minutes = EXCLUDED.resolution_minutes,
			updated_at = EXCLUDED.updated_at
		RETURNING updated_at
	`, input.FirstResponseMinutes, input.ResponseMinutes, input.ResolutionMinutes).
		Scan(&input.UpdatedAt)
	return input, err
}

func (s *PostgresStore) GetRecordCategories(ctx context.Context) ([]RecordCategoryOption, error) {
	var raw []byte
	err := s.db.QueryRowContext(ctx, `SELECT categories FROM record_category_settings WHERE id = 'global'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return records.DefaultCategories(), nil
	}
	if err != nil {
		return nil, err
	}
	var categories []RecordCategoryOption
	if err := json.Unmarshal(raw, &categories); err != nil {
		return nil, err
	}
	return records.NormalizeCategories(categories), nil
}

func (s *PostgresStore) SaveRecordCategories(ctx context.Context, input []RecordCategoryOption) ([]RecordCategoryOption, error) {
	categories := records.NormalizeCategories(input)
	if len(categories) == 0 {
		return nil, fmt.Errorf("%w: record categories are required", ErrInvalid)
	}
	raw, err := json.Marshal(categories)
	if err != nil {
		return nil, err
	}
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO record_category_settings (id, categories, updated_at)
		VALUES ('global', $1, $2)
		ON CONFLICT (id) DO UPDATE SET categories = EXCLUDED.categories, updated_at = EXCLUDED.updated_at
	`, raw, time.Now().UTC())
	return categories, err
}

type scanner interface {
	Scan(dest ...any) error
}

func scanShop(row scanner) (Shop, error) {
	var shop Shop
	var metadata []byte
	if err := row.Scan(&shop.ID, &shop.DisplayName, &shop.Platform, &shop.ExternalID, &shop.Status, &metadata, &shop.CreatedAt, &shop.UpdatedAt); err != nil {
		return Shop{}, err
	}
	shop.Metadata = unmarshalMetadata(metadata)
	return shop, nil
}

func scanShopSource(row scanner) (ShopSource, error) {
	var source ShopSource
	var metadata []byte
	if err := row.Scan(&source.ID, &source.ShopID, &source.Type, &source.Provider, &source.Address, &source.Status, &metadata, &source.CreatedAt, &source.UpdatedAt); err != nil {
		return ShopSource{}, err
	}
	source.Metadata = unmarshalMetadata(metadata)
	return source, nil
}

func scanShopifyInstallation(row scanner) (ShopifyInstallation, error) {
	var installation ShopifyInstallation
	err := row.Scan(
		&installation.ShopDomain,
		&installation.ShopID,
		&installation.AccessToken,
		&installation.Scope,
		&installation.InstalledAt,
		&installation.UpdatedAt,
	)
	return installation, err
}

func scanShopifyAppProfile(row scanner) (ShopifyAppProfile, error) {
	var profile ShopifyAppProfile
	var deployedAt sql.NullTime
	err := row.Scan(
		&profile.ShopID,
		&profile.ShopDomain,
		&profile.ClientID,
		&profile.EncryptedClientSecret,
		&profile.EncryptedAutomationToken,
		&profile.ExtensionHandle,
		&profile.DeployStatus,
		&profile.DeployVersion,
		&profile.DeployMessage,
		&deployedAt,
		&profile.CreatedAt,
		&profile.UpdatedAt,
	)
	if err != nil {
		return ShopifyAppProfile{}, err
	}
	if deployedAt.Valid {
		profile.DeployedAt = deployedAt.Time
	}
	profile.HasClientSecret = profile.EncryptedClientSecret != ""
	profile.HasAutomationToken = profile.EncryptedAutomationToken != ""
	return profile, nil
}

func scanEmailInstallation(row scanner) (EmailInstallation, error) {
	var installation EmailInstallation
	err := row.Scan(
		&installation.ShopID,
		&installation.Mailbox,
		&installation.Provider,
		&installation.AccessToken,
		&installation.RefreshToken,
		&installation.Scope,
		&installation.ExpiresAt,
		&installation.InstalledAt,
		&installation.UpdatedAt,
	)
	if err != nil {
		return EmailInstallation{}, err
	}
	installation.AccessToken, err = decryptEmailCredential(installation.AccessToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	installation.RefreshToken, err = decryptEmailCredential(installation.RefreshToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	return installation, nil
}

func scanKnowledge(row scanner) (KnowledgeEntry, error) {
	var entry KnowledgeEntry
	var tags []byte
	var reviewedAt sql.NullTime
	if err := row.Scan(&entry.ID, &entry.SupersedesID, &entry.Scope, &entry.ShopID, &entry.Title, &entry.Answer, &tags, &entry.Status, &entry.ConversationID, &entry.SubmittedBy, &entry.ReviewedBy, &entry.ReviewNote, &entry.CreatedAt, &entry.UpdatedAt, &reviewedAt); err != nil {
		return KnowledgeEntry{}, err
	}
	if len(tags) > 0 {
		if err := json.Unmarshal(tags, &entry.Tags); err != nil {
			return KnowledgeEntry{}, err
		}
	}
	if reviewedAt.Valid {
		entry.ReviewedAt = reviewedAt.Time
	}
	return entry, nil
}

func nullableTimeText(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}

func nullableTimeValue(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.UTC()
}

func scanConversation(row scanner) (Conversation, error) {
	return scanConversationValues(row, nil, nil, false)
}

func scanConversationWithCustomerLastMessage(row scanner) (Conversation, error) {
	var customerLastMessageAt time.Time
	var lastMessageDirection string
	conversation, err := scanConversationValues(row, &customerLastMessageAt, &lastMessageDirection, true)
	if err == nil {
		conversation.CustomerLastMessageAt = customerLastMessageAt
		conversation.LastMessageDirection = lastMessageDirection
	}
	return conversation, err
}

func scanConversationValues(row scanner, customerLastMessageAt *time.Time, lastMessageDirection *string, includeUnread bool, extras ...any) (Conversation, error) {
	var conversation Conversation
	var recordUpdatedAt sql.NullTime
	var closedAt sql.NullTime
	values := []any{
		&conversation.ID,
		&conversation.ShopID,
		&conversation.SourceID,
		&conversation.CustomerName,
		&conversation.CustomerEmail,
		&conversation.Subject,
		&conversation.Status,
		&conversation.AssignedAgentID,
		&conversation.LastMessageAt,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
		&conversation.Kind,
		&conversation.ReplyAllowed,
		&conversation.Classification,
		&conversation.RecordPrimary,
		&conversation.RecordSecondary,
		&conversation.RecordTertiary,
		&conversation.RecordRemark,
		&conversation.RecordClassified,
		&conversation.RecordAutoFilled,
		&recordUpdatedAt,
		&conversation.RecordUpdatedBy,
		&conversation.RecordOrderNumber,
		&closedAt,
	}
	if customerLastMessageAt != nil {
		values = append(values, customerLastMessageAt)
	}
	if lastMessageDirection != nil {
		values = append(values, lastMessageDirection)
	}
	if includeUnread {
		values = append(values, &conversation.Unread)
	}
	values = append(values, extras...)
	err := row.Scan(values...)
	if recordUpdatedAt.Valid {
		conversation.RecordUpdatedAt = recordUpdatedAt.Time
	}
	if closedAt.Valid {
		conversation.ClosedAt = closedAt.Time
	}
	return conversation, err
}

func scanMessage(row scanner) (Message, error) {
	var message Message
	var metadata []byte
	err := row.Scan(
		&message.ID,
		&message.ConversationID,
		&message.Direction,
		&message.Type,
		&message.Body,
		&metadata,
		&message.SenderName,
		&message.SenderEmail,
		&message.SourceMessageID,
		&message.CreatedAt,
	)
	message.Metadata = unmarshalMetadata(metadata)
	return message, err
}

func scanUser(row scanner) (User, error) {
	var user User
	var permissions []byte
	var dataScopes []byte
	var shopScopeIDs []byte
	err := row.Scan(
		&user.ID,
		&user.Email,
		&user.DisplayName,
		&user.Role,
		&user.Status,
		&user.Department,
		&user.SkillGroup,
		&user.ReceptionLimit,
		&user.ReceptionOnline,
		&permissions,
		&user.PermissionsCustomized,
		&dataScopes,
		&user.ShopScope,
		&shopScopeIDs,
		&user.WorkbenchShopScope,
		&user.ConversationScope,
		&user.SystemAdmin,
		&user.PasswordHash,
		&user.CreatedAt,
		&user.UpdatedAt,
	)
	if err == nil && len(permissions) > 0 {
		err = json.Unmarshal(permissions, &user.Permissions)
	}
	if err == nil && len(dataScopes) > 0 {
		err = json.Unmarshal(dataScopes, &user.DataScopes)
	}
	if err == nil && len(shopScopeIDs) > 0 {
		err = json.Unmarshal(shopScopeIDs, &user.ShopScopeIDs)
	}
	return user, err
}

func marshalMetadata(values map[string]string) ([]byte, error) {
	if values == nil {
		values = map[string]string{}
	}
	return json.Marshal(values)
}

func unmarshalMetadata(raw []byte) map[string]string {
	if len(raw) == 0 {
		return nil
	}
	out := map[string]string{}
	if err := json.Unmarshal(raw, &out); err != nil || len(out) == 0 {
		return nil
	}
	return out
}

func prefixedID(prefix string) string {
	return prefix + "_" + strings.ReplaceAll(uuid.NewString(), "-", "")
}

func isForeignKeyError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23503")
}

func isUniqueConstraintError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}
