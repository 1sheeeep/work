package platform

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

const (
	testPostgresRuntimePassword   = "not-a-real-secret-customer-service-runtime"
	testPostgresMigrationPassword = "not-a-real-secret-customer-service-migrator"
)

func TestPostgresStoreConfigRequiresFixedSchemaAndSeparateConnections(t *testing.T) {
	valid := PostgresStoreConfig{
		DatabaseURL:          "postgres://customer_service_runtime:not-a-real-secret-runtime@synthetic.invalid/app",
		MigrationDatabaseURL: "postgres://customer_service_migrator:not-a-real-secret-migrator@synthetic.invalid/app",
		Schema:               CustomerServiceDatabaseSchema,
	}
	if _, err := normalizePostgresStoreConfig(valid); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	for _, input := range []PostgresStoreConfig{
		{},
		{DatabaseURL: valid.DatabaseURL, Schema: valid.Schema},
		{DatabaseURL: valid.DatabaseURL, MigrationDatabaseURL: valid.MigrationDatabaseURL, Schema: "public"},
		{DatabaseURL: valid.DatabaseURL, MigrationDatabaseURL: valid.MigrationDatabaseURL, Schema: "customer_service;DROP SCHEMA public"},
	} {
		if _, err := normalizePostgresStoreConfig(input); err == nil {
			t.Fatalf("unsafe config was accepted: %#v", input)
		}
	}
	for _, migrationURL := range []string{
		"postgres://customer_service_migrator:not-a-real-secret@other.synthetic.invalid:5432/app",
		"postgres://customer_service_migrator:not-a-real-secret@synthetic.invalid:5433/app",
		"postgres://customer_service_migrator:not-a-real-secret@synthetic.invalid/other_app",
		"postgres://customer_service_migrator:not-a-real-secret@standby.synthetic.invalid:5433,synthetic.invalid:5432/app",
	} {
		runtimeURL := valid.DatabaseURL
		if strings.Contains(migrationURL, "standby.synthetic.invalid") {
			runtimeURL = "postgres://customer_service_runtime:not-a-real-secret@synthetic.invalid:5432,standby.synthetic.invalid:5433/app"
		}
		_, err := normalizePostgresStoreConfig(PostgresStoreConfig{
			DatabaseURL:          runtimeURL,
			MigrationDatabaseURL: migrationURL,
			Schema:               valid.Schema,
		})
		if err == nil || !strings.Contains(err.Error(), "same endpoint") {
			t.Fatalf("same-name different PostgreSQL target was accepted: %q err=%v", migrationURL, err)
		}
	}
	identity := databaseIdentity{
		database: "app", databaseOID: 16384, systemIdentifier: "synthetic-cluster",
		serverAddress: "127.0.0.1", serverPort: 5432,
	}
	for name, different := range map[string]databaseIdentity{
		"database":           {database: "other", databaseOID: identity.databaseOID, systemIdentifier: identity.systemIdentifier, serverAddress: identity.serverAddress, serverPort: identity.serverPort},
		"database oid":       {database: identity.database, databaseOID: 16385, systemIdentifier: identity.systemIdentifier, serverAddress: identity.serverAddress, serverPort: identity.serverPort},
		"cluster identifier": {database: identity.database, databaseOID: identity.databaseOID, systemIdentifier: "other-cluster", serverAddress: identity.serverAddress, serverPort: identity.serverPort},
		"server address":     {database: identity.database, databaseOID: identity.databaseOID, systemIdentifier: identity.systemIdentifier, serverAddress: "127.0.0.2", serverPort: identity.serverPort},
		"server port":        {database: identity.database, databaseOID: identity.databaseOID, systemIdentifier: identity.systemIdentifier, serverAddress: identity.serverAddress, serverPort: 5433},
	} {
		if sameDatabaseIdentity(identity, different) {
			t.Fatalf("different %s passed actual database identity comparison", name)
		}
	}
}

func TestPostgresConfigurationErrorsDoNotExposeDSNSecrets(t *testing.T) {
	secret := "do-not-log-this-password"
	_, err := OpenPostgresStore(context.Background(), PostgresStoreConfig{
		DatabaseURL:          "postgres://customer_service_runtime:" + secret + "@%invalid",
		MigrationDatabaseURL: "postgres://customer_service_migrator:" + secret + "@%invalid",
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err == nil {
		t.Fatal("invalid DSN was accepted")
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "postgres://") {
		t.Fatalf("database error exposed connection material: %q", err)
	}
}

func TestPostgresSchemaRoleContract(t *testing.T) {
	adminURL := strings.TrimSpace(os.Getenv("XZDESK_TEST_POSTGRES_ADMIN_URL"))
	if adminURL == "" {
		t.Skip("XZDESK_TEST_POSTGRES_ADMIN_URL is not set")
	}
	ctx := context.Background()
	adminDB, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatalf("open synthetic admin database: %v", err)
	}
	defer adminDB.Close()
	bootstrapPath := filepath.Join("..", "..", "deploy", "postgres-init", "001_customer_service_schema_roles.sql")
	bootstrap, err := os.ReadFile(bootstrapPath)
	if err != nil {
		t.Fatalf("read schema-role bootstrap: %v", err)
	}
	if _, err := adminDB.ExecContext(ctx, string(bootstrap)); err != nil {
		t.Fatalf("apply schema-role bootstrap: %v", err)
	}
	if _, err := adminDB.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS public.erp_boundary_sentinel (
		  id INTEGER PRIMARY KEY,
		  payload TEXT NOT NULL DEFAULT ''
		);
		INSERT INTO public.erp_boundary_sentinel(id, payload) VALUES (1, 'unchanged')
		  ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload;
		CREATE OR REPLACE VIEW public.erp_boundary_view AS SELECT id FROM public.erp_boundary_sentinel;
		CREATE OR REPLACE FUNCTION public.erp_boundary_routine() RETURNS void
		  LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
		REVOKE ALL ON public.erp_boundary_sentinel FROM PUBLIC,
		  customer_service_runtime, customer_service_migrator;
		REVOKE ALL ON public.erp_boundary_view FROM PUBLIC,
		  customer_service_runtime, customer_service_migrator;
		REVOKE ALL ON FUNCTION public.erp_boundary_routine() FROM PUBLIC,
		  customer_service_runtime, customer_service_migrator;
		CREATE ROLE customer_service_boundary_escape NOLOGIN;
		GRANT INSERT ON public.erp_boundary_sentinel TO customer_service_boundary_escape
	`); err != nil {
		t.Fatalf("create synthetic cross-schema sentinel: %v", err)
	}

	runtimeURL := postgresURLForRole(t, adminURL, customerServiceRuntimeRole, testPostgresRuntimePassword)
	migrationURL := postgresURLForRole(t, adminURL, customerServiceMigrationRole, testPostgresMigrationPassword)
	store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          runtimeURL,
		MigrationDatabaseURL: migrationURL,
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatalf("open bounded postgres store: %v", err)
	}
	defer store.Close()
	if state := postgresCompatibilityState(t, ctx, adminDB); state != "compatible" {
		t.Fatalf("fresh schema did not pass the helper's read-only compatibility query: %q", state)
	}
	runtimeIdentity, err := validateDatabaseIdentity(ctx, store.db, customerServiceRuntimeRole)
	if err != nil {
		t.Fatalf("validate actual runtime database endpoint: %v", err)
	}
	migrationIdentityDB, err := openCustomerServiceDatabase(migrationURL)
	if err != nil {
		t.Fatalf("open actual migration database endpoint: %v", err)
	}
	migrationIdentity, err := validateDatabaseIdentity(ctx, migrationIdentityDB, customerServiceMigrationRole)
	migrationIdentityDB.Close()
	if err != nil {
		t.Fatalf("validate actual migration database endpoint: %v", err)
	}
	if runtimeIdentity.systemIdentifier == "" || runtimeIdentity.databaseOID == 0 ||
		runtimeIdentity.serverAddress == "" || runtimeIdentity.serverPort == 0 ||
		!sameDatabaseIdentity(runtimeIdentity, migrationIdentity) {
		t.Fatalf("database roles did not reach one actual PostgreSQL server: runtime=%#v migration=%#v", runtimeIdentity, migrationIdentity)
	}

	var database, user, schema, searchPath string
	if err := store.db.QueryRowContext(ctx, `
		SELECT current_database(), current_user, current_schema(), current_setting('search_path')
	`).Scan(&database, &user, &schema, &searchPath); err != nil {
		t.Fatalf("read runtime identity: %v", err)
	}
	if database == "" || user != customerServiceRuntimeRole || schema != CustomerServiceDatabaseSchema ||
		normalizeSearchPath(searchPath) != CustomerServiceDatabaseSchema+",pg_catalog" {
		t.Fatalf("unexpected runtime identity: db=%q user=%q schema=%q path=%q", database, user, schema, searchPath)
	}

	rows, err := store.db.QueryContext(ctx, `
		SELECT filename, sha256 FROM customer_service_schema_migrations ORDER BY filename
	`)
	if err != nil {
		t.Fatalf("read isolated migration history: %v", err)
	}
	applied := map[string]string{}
	var appliedOrder []string
	for rows.Next() {
		var filename, checksum string
		if err := rows.Scan(&filename, &checksum); err != nil {
			t.Fatalf("scan migration history: %v", err)
		}
		applied[filename] = checksum
		appliedOrder = append(appliedOrder, filename)
	}
	rows.Close()
	expectedEntries, err := migrationFiles.ReadDir("migrations")
	if err != nil {
		t.Fatalf("read embedded migrations: %v", err)
	}
	var expected []string
	for _, entry := range expectedEntries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".sql") {
			expected = append(expected, entry.Name())
			raw, err := migrationFiles.ReadFile("migrations/" + entry.Name())
			if err != nil {
				t.Fatalf("read embedded migration %s: %v", entry.Name(), err)
			}
			digest := sha256.Sum256(raw)
			if applied[entry.Name()] != hex.EncodeToString(digest[:]) {
				t.Fatalf("migration %s checksum was not recorded exactly", entry.Name())
			}
		}
	}
	sort.Strings(expected)
	if strings.Join(appliedOrder, "\n") != strings.Join(expected, "\n") {
		t.Fatalf("migration order mismatch:\nwant=%v\ngot=%v", expected, appliedOrder)
	}

	passwordHash, err := hashPassword("synthetic-password")
	if err != nil {
		t.Fatalf("hash synthetic password: %v", err)
	}
	created, err := store.CreateUser(ctx, User{
		Email:        prefixedID("schema-role") + "@example.test",
		DisplayName:  "Synthetic Schema Role",
		Role:         UserRoleAgent,
		PasswordHash: passwordHash,
	})
	if err != nil || created.ID == "" {
		t.Fatalf("runtime role could not write customer_service data: user=%#v err=%v", created, err)
	}
	if _, err := store.db.ExecContext(ctx, `INSERT INTO public.erp_boundary_sentinel(id) VALUES (1)`); err == nil {
		t.Fatal("runtime role wrote outside the customer_service schema")
	}
	if _, err := store.db.ExecContext(ctx, `
		INSERT INTO customer_service_schema_migrations(filename, sha256)
		VALUES ('999_tamper.sql', repeat('a', 64))
	`); err == nil {
		t.Fatal("runtime role modified migration history")
	}
	reopened, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          runtimeURL,
		MigrationDatabaseURL: migrationURL,
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatalf("reopen store with existing migration history: %v", err)
	}
	reopened.Close()

	rawRuntimeDB, err := sql.Open("pgx", runtimeURL)
	if err != nil {
		t.Fatalf("open raw runtime database: %v", err)
	}
	defer rawRuntimeDB.Close()
	if _, err := rawRuntimeDB.ExecContext(ctx, `SET search_path = public, pg_catalog`); err != nil {
		t.Fatalf("set synthetic wrong search_path: %v", err)
	}
	if _, err := validateDatabaseIdentity(ctx, rawRuntimeDB, customerServiceRuntimeRole); err == nil {
		t.Fatal("wrong runtime search_path passed validation")
	}
	if _, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          migrationURL,
		MigrationDatabaseURL: migrationURL,
		Schema:               CustomerServiceDatabaseSchema,
	}); err == nil {
		t.Fatal("migration role was accepted as the runtime role")
	}
	const passwordCanary = "synthetic-password-canary-must-not-appear"
	badRuntimeURL := postgresURLForRole(t, adminURL, customerServiceRuntimeRole, passwordCanary)
	if _, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          badRuntimeURL,
		MigrationDatabaseURL: migrationURL,
		Schema:               CustomerServiceDatabaseSchema,
	}); err == nil {
		t.Fatal("wrong runtime database password was accepted")
	} else if strings.Contains(err.Error(), passwordCanary) || strings.Contains(err.Error(), "postgres://") {
		t.Fatalf("runtime connection failure exposed the DSN: %q", err)
	}
	store.Close()
	syntheticMigrationDB, err := sql.Open("pgx", migrationURL)
	if err != nil {
		t.Fatalf("open migration role for synthetic routine: %v", err)
	}
	if _, err := syntheticMigrationDB.ExecContext(ctx, `
		CREATE FUNCTION customer_service.schema_boundary_routine() RETURNS void
		LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$
	`); err != nil {
		syntheticMigrationDB.Close()
		t.Fatalf("create synthetic customer-service routine: %v", err)
	}
	if _, err := syntheticMigrationDB.ExecContext(ctx, `CREATE TEMP TABLE forbidden_migrator_temp(id INTEGER)`); err == nil {
		syntheticMigrationDB.Close()
		t.Fatal("migration role created a temporary table")
	}
	if _, err := syntheticMigrationDB.ExecContext(ctx, `UPDATE public.erp_boundary_sentinel SET payload = 'migrator-write' WHERE id = 1`); err == nil {
		syntheticMigrationDB.Close()
		t.Fatal("migration role wrote an external column")
	}
	syntheticMigrationDB.Close()
	if _, err := rawRuntimeDB.ExecContext(ctx, `CREATE TEMP TABLE forbidden_runtime_temp(id INTEGER)`); err == nil {
		t.Fatal("runtime role created a temporary table")
	}
	if _, err := rawRuntimeDB.ExecContext(ctx, `UPDATE public.erp_boundary_sentinel SET payload = 'runtime-write' WHERE id = 1`); err == nil {
		t.Fatal("runtime role wrote an external column")
	}
	if _, err := rawRuntimeDB.ExecContext(ctx, `SELECT customer_service.schema_boundary_routine()`); err == nil {
		t.Fatal("runtime role executed a customer-service migration routine")
	}

	var customerSequence string
	if err := adminDB.QueryRowContext(ctx, `
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'customer_service' AND c.relkind = 'S'
		ORDER BY c.relname LIMIT 1
	`).Scan(&customerSequence); err != nil {
		t.Fatalf("find customer-service sequence: %v", err)
	}
	if _, err := adminDB.ExecContext(ctx, `CREATE SEQUENCE public.erp_boundary_sequence`); err != nil {
		t.Fatalf("create synthetic external sequence: %v", err)
	}

	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT TRUNCATE ON customer_service.shops TO customer_service_runtime`,
		`REVOKE TRUNCATE ON customer_service.shops FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT SELECT ON customer_service.shops TO customer_service_runtime WITH GRANT OPTION`,
		`REVOKE GRANT OPTION FOR SELECT ON customer_service.shops FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`REVOKE DELETE ON customer_service.shops FROM customer_service_runtime`,
		`GRANT DELETE ON customer_service.shops TO customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT INSERT ON customer_service.shops TO customer_service_boundary_escape`,
		`REVOKE INSERT ON customer_service.shops FROM customer_service_boundary_escape`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT CREATE ON SCHEMA customer_service TO customer_service_boundary_escape`,
		`REVOKE CREATE ON SCHEMA customer_service FROM customer_service_boundary_escape`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT REFERENCES ON customer_service.customer_service_schema_migrations TO customer_service_runtime`,
		`REVOKE REFERENCES ON customer_service.customer_service_schema_migrations FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT UPDATE ON SEQUENCE customer_service.`+customerSequence+` TO customer_service_runtime`,
		`REVOKE UPDATE ON SEQUENCE customer_service.`+customerSequence+` FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT INSERT ON public.erp_boundary_sentinel TO customer_service_migrator`,
		`REVOKE INSERT ON public.erp_boundary_sentinel FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT INSERT ON public.erp_boundary_view TO customer_service_runtime`,
		`REVOKE INSERT ON public.erp_boundary_view FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT INSERT ON public.erp_boundary_view TO customer_service_migrator`,
		`REVOKE INSERT ON public.erp_boundary_view FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT EXECUTE ON FUNCTION public.erp_boundary_routine() TO customer_service_runtime`,
		`REVOKE EXECUTE ON FUNCTION public.erp_boundary_routine() FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT EXECUTE ON FUNCTION public.erp_boundary_routine() TO customer_service_migrator`,
		`REVOKE EXECUTE ON FUNCTION public.erp_boundary_routine() FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT USAGE ON SEQUENCE public.erp_boundary_sequence TO customer_service_migrator`,
		`REVOKE USAGE ON SEQUENCE public.erp_boundary_sequence FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT SELECT ON SEQUENCE public.erp_boundary_sequence TO customer_service_migrator`,
		`REVOKE SELECT ON SEQUENCE public.erp_boundary_sequence FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT UPDATE ON SEQUENCE public.erp_boundary_sequence TO customer_service_runtime`,
		`REVOKE UPDATE ON SEQUENCE public.erp_boundary_sequence FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT SELECT ON SEQUENCE public.erp_boundary_sequence TO customer_service_runtime`,
		`REVOKE SELECT ON SEQUENCE public.erp_boundary_sequence FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT CREATE ON SCHEMA public TO customer_service_runtime`,
		`REVOKE CREATE ON SCHEMA public FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT CREATE ON SCHEMA public TO customer_service_migrator`,
		`REVOKE CREATE ON SCHEMA public FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT CREATE ON DATABASE xz_erp_synthetic TO customer_service_runtime`,
		`REVOKE CREATE ON DATABASE xz_erp_synthetic FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT CREATE ON DATABASE xz_erp_synthetic TO customer_service_migrator`,
		`REVOKE CREATE ON DATABASE xz_erp_synthetic FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT TEMPORARY ON DATABASE xz_erp_synthetic TO customer_service_runtime`,
		`REVOKE TEMPORARY ON DATABASE xz_erp_synthetic FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT TEMPORARY ON DATABASE xz_erp_synthetic TO customer_service_migrator`,
		`REVOKE TEMPORARY ON DATABASE xz_erp_synthetic FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT UPDATE(payload) ON public.erp_boundary_sentinel TO customer_service_runtime`,
		`REVOKE UPDATE(payload) ON public.erp_boundary_sentinel FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT UPDATE(payload) ON public.erp_boundary_sentinel TO customer_service_migrator`,
		`REVOKE UPDATE(payload) ON public.erp_boundary_sentinel FROM customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT UPDATE(display_name) ON customer_service.shops TO customer_service_runtime`,
		`REVOKE UPDATE(display_name) ON customer_service.shops FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT customer_service_boundary_escape TO customer_service_runtime`,
		`REVOKE customer_service_boundary_escape FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT customer_service_migrator TO customer_service_boundary_escape`,
		`REVOKE customer_service_migrator FROM customer_service_boundary_escape`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER TABLE public.erp_boundary_sentinel OWNER TO customer_service_runtime`,
		`ALTER TABLE public.erp_boundary_sentinel OWNER TO postgres`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		 GRANT TRUNCATE, REFERENCES, TRIGGER ON TABLES TO customer_service_runtime`,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		 REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLES FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		 GRANT SELECT, UPDATE ON SEQUENCES TO customer_service_runtime`,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		 REVOKE SELECT, UPDATE ON SEQUENCES FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator
		 GRANT SELECT ON TABLES TO customer_service_runtime`,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator
		 REVOKE SELECT ON TABLES FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER ROLE customer_service_runtime CREATEDB`,
		`ALTER ROLE customer_service_runtime NOCREATEDB`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER TABLE customer_service.shops OWNER TO postgres`,
		`ALTER TABLE customer_service.shops OWNER TO customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER FUNCTION customer_service.schema_boundary_routine() OWNER TO customer_service_runtime`,
		`ALTER FUNCTION customer_service.schema_boundary_routine() OWNER TO customer_service_migrator`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER FUNCTION customer_service.schema_boundary_routine() SECURITY DEFINER`,
		`ALTER FUNCTION customer_service.schema_boundary_routine() SECURITY INVOKER`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT EXECUTE ON FUNCTION customer_service.schema_boundary_routine() TO customer_service_runtime`,
		`REVOKE EXECUTE ON FUNCTION customer_service.schema_boundary_routine() FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT EXECUTE ON FUNCTION customer_service.schema_boundary_routine() TO PUBLIC`,
		`REVOKE EXECUTE ON FUNCTION customer_service.schema_boundary_routine() FROM PUBLIC`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`GRANT EXECUTE ON FUNCTION customer_service.schema_boundary_routine() TO customer_service_boundary_escape`,
		`REVOKE EXECUTE ON FUNCTION customer_service.schema_boundary_routine() FROM customer_service_boundary_escape`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		 GRANT EXECUTE ON FUNCTIONS TO customer_service_runtime`,
		`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		 REVOKE EXECUTE ON FUNCTIONS FROM customer_service_runtime`)
	assertPostgresPrivilegeDriftRejected(t, ctx, adminDB, runtimeURL, migrationURL,
		`ALTER ROLE customer_service_runtime SET search_path = public`,
		`ALTER ROLE customer_service_runtime SET search_path = customer_service, pg_catalog`)
	assertPendingMigrationDriftRejectedWithoutChanges(t, ctx, adminDB, runtimeURL, migrationURL)

	finalStore, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL: runtimeURL, MigrationDatabaseURL: migrationURL,
		Schema: CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatalf("schema-role contract did not recover after synthetic grants were revoked: %v", err)
	}
	finalStore.Close()
}

func assertPostgresHelperDriftRejected(
	t *testing.T,
	ctx context.Context,
	adminDB *sql.DB,
	driftSQL string,
	restoreSQL string,
) {
	t.Helper()
	if _, err := adminDB.ExecContext(ctx, driftSQL); err != nil {
		t.Fatalf("apply synthetic helper drift: %v", err)
	}
	if state := postgresCompatibilityState(t, ctx, adminDB); state != "drift" {
		t.Fatalf("helper compatibility query accepted synthetic drift %q: %q", driftSQL, state)
	}
	if _, err := adminDB.ExecContext(ctx, restoreSQL); err != nil {
		t.Fatalf("restore synthetic helper drift: %v", err)
	}
	if state := postgresCompatibilityState(t, ctx, adminDB); state != "compatible" {
		t.Fatalf("helper compatibility query did not recover after %q: %q", restoreSQL, state)
	}
}

func assertPostgresPrivilegeDriftRejected(
	t *testing.T,
	ctx context.Context,
	adminDB *sql.DB,
	runtimeURL string,
	migrationURL string,
	grantSQL string,
	revokeSQL string,
) {
	t.Helper()
	historyBefore := postgresMigrationHistoryFingerprint(t, ctx, adminDB)
	if _, err := adminDB.ExecContext(ctx, grantSQL); err != nil {
		t.Fatalf("apply synthetic privilege drift: %v", err)
	}
	if state := postgresCompatibilityState(t, ctx, adminDB); state != "drift" {
		t.Fatalf("helper compatibility query accepted synthetic privilege drift %q: %q", grantSQL, state)
	}
	if store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL: runtimeURL, MigrationDatabaseURL: migrationURL,
		Schema: CustomerServiceDatabaseSchema,
	}); err == nil {
		store.Close()
		t.Fatalf("synthetic privilege drift was accepted: %s", grantSQL)
	}
	if historyAfter := postgresMigrationHistoryFingerprint(t, ctx, adminDB); historyAfter != historyBefore {
		t.Fatalf("migration history changed before privilege drift failed: before=%q after=%q", historyBefore, historyAfter)
	}
	if _, err := adminDB.ExecContext(ctx, revokeSQL); err != nil {
		t.Fatalf("revoke synthetic privilege drift: %v", err)
	}
	if state := postgresCompatibilityState(t, ctx, adminDB); state != "compatible" {
		t.Fatalf("helper compatibility query did not recover after revoke %q: %q", revokeSQL, state)
	}
}

func assertPendingMigrationDriftRejectedWithoutChanges(
	t *testing.T,
	ctx context.Context,
	adminDB *sql.DB,
	runtimeURL string,
	migrationURL string,
) {
	t.Helper()
	var pendingFilename, pendingChecksum string
	if err := adminDB.QueryRowContext(ctx, `
		DELETE FROM customer_service.customer_service_schema_migrations
		WHERE filename = (SELECT MAX(filename) FROM customer_service.customer_service_schema_migrations)
		RETURNING filename, sha256
	`).Scan(&pendingFilename, &pendingChecksum); err != nil {
		t.Fatalf("create synthetic pending migration state: %v", err)
	}
	if pendingFilename == "" || pendingChecksum == "" {
		t.Fatal("synthetic pending migration state did not remove one history row")
	}
	for name, drift := range map[string][2]string{
		"default ACL": {
			`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
			 GRANT TRUNCATE ON TABLES TO customer_service_runtime`,
			`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
			 REVOKE TRUNCATE ON TABLES FROM customer_service_runtime`,
		},
		"runtime external create": {
			`GRANT CREATE ON SCHEMA public TO customer_service_runtime`,
			`REVOKE CREATE ON SCHEMA public FROM customer_service_runtime`,
		},
		"migrator external write": {
			`GRANT INSERT ON public.erp_boundary_sentinel TO customer_service_migrator`,
			`REVOKE INSERT ON public.erp_boundary_sentinel FROM customer_service_migrator`,
		},
		"database TEMP": {
			`GRANT TEMPORARY ON DATABASE xz_erp_synthetic TO customer_service_runtime`,
			`REVOKE TEMPORARY ON DATABASE xz_erp_synthetic FROM customer_service_runtime`,
		},
		"column ACL": {
			`GRANT UPDATE(payload) ON public.erp_boundary_sentinel TO customer_service_runtime`,
			`REVOKE UPDATE(payload) ON public.erp_boundary_sentinel FROM customer_service_runtime`,
		},
		"function default ACL": {
			`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
			 GRANT EXECUTE ON FUNCTIONS TO customer_service_runtime`,
			`ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
			 REVOKE EXECUTE ON FUNCTIONS FROM customer_service_runtime`,
		},
	} {
		if _, err := adminDB.ExecContext(ctx, drift[0]); err != nil {
			t.Fatalf("apply synthetic pending-migration %s drift: %v", name, err)
		}
		historyBefore := postgresMigrationHistoryFingerprint(t, ctx, adminDB)
		objectsBefore := postgresSchemaObjectFingerprint(t, ctx, adminDB)
		if store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
			DatabaseURL: runtimeURL, MigrationDatabaseURL: migrationURL,
			Schema: CustomerServiceDatabaseSchema,
		}); err == nil {
			store.Close()
			t.Fatalf("pending migration ran despite pre-transaction %s drift", name)
		}
		if historyAfter := postgresMigrationHistoryFingerprint(t, ctx, adminDB); historyAfter != historyBefore {
			t.Fatalf("pending migration history changed before %s drift failed: before=%q after=%q", name, historyBefore, historyAfter)
		}
		if objectsAfter := postgresSchemaObjectFingerprint(t, ctx, adminDB); objectsAfter != objectsBefore {
			t.Fatalf("schema objects changed before pending migration %s drift failed: before=%q after=%q", name, objectsBefore, objectsAfter)
		}
		if _, err := adminDB.ExecContext(ctx, drift[1]); err != nil {
			t.Fatalf("restore synthetic pending-migration %s drift: %v", name, err)
		}
	}
	store, err := OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL: runtimeURL, MigrationDatabaseURL: migrationURL,
		Schema: CustomerServiceDatabaseSchema,
	})
	if err != nil {
		t.Fatalf("apply pending migration after drift recovery: %v", err)
	}
	store.Close()
}

func postgresMigrationHistoryFingerprint(t *testing.T, ctx context.Context, adminDB *sql.DB) string {
	t.Helper()
	var fingerprint string
	if err := adminDB.QueryRowContext(ctx, `
		SELECT COALESCE(string_agg(filename || ':' || sha256, ',' ORDER BY filename), '')
		FROM customer_service.customer_service_schema_migrations
	`).Scan(&fingerprint); err != nil {
		t.Fatalf("read migration history fingerprint: %v", err)
	}
	return fingerprint
}

func postgresSchemaObjectFingerprint(t *testing.T, ctx context.Context, adminDB *sql.DB) string {
	t.Helper()
	var fingerprint string
	if err := adminDB.QueryRowContext(ctx, `
		SELECT md5(COALESCE(string_agg(item, E'\n' ORDER BY item), ''))
		FROM (
		  SELECT format('relation:%s:%s:%s:%s', c.relname, c.relkind,
		    pg_get_userbyid(c.relowner), COALESCE(c.relacl::text, '')) AS item
		  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname = 'customer_service'
		    AND c.relkind IN ('r','p','S','v','m','f')
		  UNION ALL
		  SELECT format('column:%s:%s:%s:%s:%s:%s', c.relname, a.attname,
		    format_type(a.atttypid, a.atttypmod), a.attnotnull,
		    COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), COALESCE(a.attacl::text, '')) AS item
		  FROM pg_class c
		  JOIN pg_namespace n ON n.oid = c.relnamespace
		  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
		  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
		  WHERE n.nspname = 'customer_service'
		    AND c.relkind IN ('r','p','v','m','f')
		  UNION ALL
		  SELECT format('routine:%s:%s:%s:%s:%s:%s', routine.proname,
		    pg_get_function_identity_arguments(routine.oid),
		    pg_get_userbyid(routine.proowner), routine.prosecdef,
		    COALESCE(routine.proacl::text, ''), pg_get_functiondef(routine.oid)) AS item
		  FROM pg_proc routine JOIN pg_namespace n ON n.oid = routine.pronamespace
		  WHERE n.nspname = 'customer_service'
		) objects
	`).Scan(&fingerprint); err != nil {
		t.Fatalf("read customer-service schema object fingerprint: %v", err)
	}
	return fingerprint
}

func postgresCompatibilityState(t *testing.T, ctx context.Context, adminDB *sql.DB) string {
	t.Helper()
	path := filepath.Join("..", "..", "deploy", "postgres-init", "verify_customer_service_schema_roles.sql")
	query, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read schema-role compatibility query: %v", err)
	}
	var state string
	if err := adminDB.QueryRowContext(ctx, string(query)).Scan(&state); err != nil {
		t.Fatalf("execute schema-role compatibility query: %v", err)
	}
	return state
}

func TestFreshBootstrapRejectsExistingSchemaBeforeMutations(t *testing.T) {
	adminURL := strings.TrimSpace(os.Getenv("XZDESK_TEST_POSTGRES_ADMIN_URL"))
	if adminURL == "" {
		t.Skip("XZDESK_TEST_POSTGRES_ADMIN_URL is not set")
	}
	ctx := context.Background()
	adminDB, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatalf("open synthetic admin database: %v", err)
	}
	defer adminDB.Close()
	const existingDatabase = "xz_erp_existing_schema_synthetic"
	if _, err := adminDB.ExecContext(ctx, `CREATE DATABASE xz_erp_existing_schema_synthetic`); err != nil {
		t.Fatalf("create synthetic existing-schema database: %v", err)
	}
	existingURL := postgresURLForDatabase(t, adminURL, existingDatabase)
	existingDB, err := sql.Open("pgx", existingURL)
	if err != nil {
		t.Fatalf("open synthetic existing-schema database: %v", err)
	}
	defer existingDB.Close()
	if _, err := existingDB.ExecContext(ctx, `CREATE SCHEMA customer_service AUTHORIZATION postgres`); err != nil {
		t.Fatalf("create pre-existing synthetic schema: %v", err)
	}
	bootstrapPath := filepath.Join("..", "..", "deploy", "postgres-init", "001_customer_service_schema_roles.sql")
	bootstrap, err := os.ReadFile(bootstrapPath)
	if err != nil {
		t.Fatalf("read schema-role bootstrap: %v", err)
	}
	rolesBefore := postgresRoleContractFingerprint(t, ctx, adminDB)
	defaultsBefore := postgresDefaultACLFingerprint(t, ctx, existingDB)
	objectsBefore := postgresSchemaObjectFingerprint(t, ctx, existingDB)
	if _, err := existingDB.ExecContext(ctx, string(bootstrap)); err == nil {
		t.Fatal("fresh bootstrap accepted an existing customer_service schema")
	} else if strings.Contains(err.Error(), "not-a-real-secret") {
		t.Fatalf("fresh-bootstrap refusal exposed synthetic credentials: %v", err)
	}
	if rolesAfter := postgresRoleContractFingerprint(t, ctx, adminDB); rolesAfter != rolesBefore {
		t.Fatalf("fresh-bootstrap refusal changed roles: before=%q after=%q", rolesBefore, rolesAfter)
	}
	if defaultsAfter := postgresDefaultACLFingerprint(t, ctx, existingDB); defaultsAfter != defaultsBefore {
		t.Fatalf("fresh-bootstrap refusal changed default ACLs: before=%q after=%q", defaultsBefore, defaultsAfter)
	}
	if objectsAfter := postgresSchemaObjectFingerprint(t, ctx, existingDB); objectsAfter != objectsBefore {
		t.Fatalf("fresh-bootstrap refusal changed schema objects: before=%q after=%q", objectsBefore, objectsAfter)
	}
	var owner string
	if err := existingDB.QueryRowContext(ctx, `
		SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname = 'customer_service'
	`).Scan(&owner); err != nil || owner != "postgres" {
		t.Fatalf("fresh-bootstrap refusal changed schema ownership: owner=%q err=%v", owner, err)
	}
}

func TestPostgresRejectsNonemptySchemaWithoutHistory(t *testing.T) {
	adminURL := strings.TrimSpace(os.Getenv("XZDESK_TEST_POSTGRES_ADMIN_URL"))
	if adminURL == "" {
		t.Skip("XZDESK_TEST_POSTGRES_ADMIN_URL is not set")
	}
	ctx := context.Background()
	adminDB, err := sql.Open("pgx", adminURL)
	if err != nil {
		t.Fatalf("open synthetic admin database: %v", err)
	}
	defer adminDB.Close()
	const legacyDatabase = "xz_erp_legacy_synthetic"
	if _, err := adminDB.ExecContext(ctx, `CREATE DATABASE xz_erp_legacy_synthetic`); err != nil {
		t.Fatalf("create synthetic legacy database: %v", err)
	}
	legacyAdminURL := postgresURLForDatabase(t, adminURL, legacyDatabase)
	legacyAdminDB, err := sql.Open("pgx", legacyAdminURL)
	if err != nil {
		t.Fatalf("open synthetic legacy database: %v", err)
	}
	defer legacyAdminDB.Close()
	ensureSyntheticCustomerServiceRoles(t, ctx, adminDB)
	if _, err := legacyAdminDB.ExecContext(ctx, `
		REVOKE TEMPORARY ON DATABASE xz_erp_legacy_synthetic
		  FROM PUBLIC, customer_service_migrator, customer_service_runtime;
		CREATE SCHEMA customer_service AUTHORIZATION customer_service_migrator;
		REVOKE ALL ON SCHEMA customer_service FROM PUBLIC;
		GRANT USAGE, CREATE ON SCHEMA customer_service TO customer_service_migrator;
		GRANT USAGE ON SCHEMA customer_service TO customer_service_runtime;
		REVOKE CREATE ON SCHEMA customer_service FROM customer_service_runtime;
		ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO customer_service_runtime;
		ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator IN SCHEMA customer_service
		  GRANT USAGE ON SEQUENCES TO customer_service_runtime;
		ALTER DEFAULT PRIVILEGES FOR ROLE customer_service_migrator
		  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, customer_service_runtime
	`); err != nil {
		t.Fatalf("prepare bounded synthetic legacy schema: %v", err)
	}
	runtimeURL := postgresURLForRole(t, legacyAdminURL, customerServiceRuntimeRole, testPostgresRuntimePassword)
	migrationURL := postgresURLForRole(t, legacyAdminURL, customerServiceMigrationRole, testPostgresMigrationPassword)
	legacyMigrationDB, err := sql.Open("pgx", migrationURL)
	if err != nil {
		t.Fatalf("open synthetic legacy migration database: %v", err)
	}
	defer legacyMigrationDB.Close()
	if _, err := legacyMigrationDB.ExecContext(ctx, `
		CREATE TABLE customer_service.legacy_without_history(id INTEGER PRIMARY KEY)
	`); err != nil {
		t.Fatalf("create synthetic legacy relation: %v", err)
	}
	if state := postgresCompatibilityState(t, ctx, legacyAdminDB); state != "drift" {
		t.Fatalf("helper compatibility query accepted nonempty schema without history: %q", state)
	}

	_, err = OpenPostgresStore(ctx, PostgresStoreConfig{
		DatabaseURL:          runtimeURL,
		MigrationDatabaseURL: migrationURL,
		Schema:               CustomerServiceDatabaseSchema,
	})
	if err == nil || !strings.Contains(err.Error(), "nonempty but has no migration history") {
		t.Fatalf("nonempty schema without history was not rejected: %v", err)
	}
	var historyExists bool
	if err := legacyAdminDB.QueryRowContext(ctx, `
		SELECT to_regclass('customer_service.customer_service_schema_migrations') IS NOT NULL
	`).Scan(&historyExists); err != nil {
		t.Fatalf("inspect rejected schema: %v", err)
	}
	if historyExists {
		t.Fatal("rejected legacy schema was modified")
	}
}

func ensureSyntheticCustomerServiceRoles(t *testing.T, ctx context.Context, adminDB *sql.DB) {
	t.Helper()
	if _, err := adminDB.ExecContext(ctx, `
		DO $roles$
		BEGIN
		  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'customer_service_migrator') THEN
		    CREATE ROLE customer_service_migrator LOGIN
		      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
		      PASSWORD 'not-a-real-secret-customer-service-migrator';
		  END IF;
		  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'customer_service_runtime') THEN
		    CREATE ROLE customer_service_runtime LOGIN
		      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
		      PASSWORD 'not-a-real-secret-customer-service-runtime';
		  END IF;
		END
		$roles$;
		ALTER ROLE customer_service_migrator SET search_path = customer_service, pg_catalog;
		ALTER ROLE customer_service_runtime SET search_path = customer_service, pg_catalog
	`); err != nil {
		t.Fatalf("prepare synthetic customer-service roles: %v", err)
	}
}

func postgresRoleContractFingerprint(t *testing.T, ctx context.Context, adminDB *sql.DB) string {
	t.Helper()
	var fingerprint string
	if err := adminDB.QueryRowContext(ctx, `
		SELECT md5(COALESCE(string_agg(
		  format('%s:%s:%s:%s:%s:%s:%s', rolname, rolsuper, rolcreatedb,
		    rolcreaterole, rolreplication, rolbypassrls, COALESCE(rolconfig::text, '')),
		  ',' ORDER BY rolname), ''))
		FROM pg_roles
		WHERE rolname IN ('customer_service_migrator', 'customer_service_runtime')
	`).Scan(&fingerprint); err != nil {
		t.Fatalf("read customer-service role fingerprint: %v", err)
	}
	return fingerprint
}

func postgresDefaultACLFingerprint(t *testing.T, ctx context.Context, adminDB *sql.DB) string {
	t.Helper()
	var fingerprint string
	if err := adminDB.QueryRowContext(ctx, `
		SELECT md5(COALESCE(string_agg(
		  format('%s:%s:%s:%s', pg_get_userbyid(defaclrole), defaclnamespace,
		    defaclobjtype, COALESCE(defaclacl::text, '')),
		  ',' ORDER BY defaclrole, defaclnamespace, defaclobjtype), ''))
		FROM pg_default_acl
		WHERE defaclrole IN (
		  SELECT oid FROM pg_roles
		  WHERE rolname IN ('customer_service_migrator', 'customer_service_runtime')
		)
	`).Scan(&fingerprint); err != nil {
		t.Fatalf("read customer-service default ACL fingerprint: %v", err)
	}
	return fingerprint
}

func postgresURLForRole(t *testing.T, adminURL, user, password string) string {
	t.Helper()
	parsed, err := url.Parse(adminURL)
	if err != nil {
		t.Fatalf("parse synthetic postgres URL: %v", err)
	}
	parsed.User = url.UserPassword(user, password)
	return parsed.String()
}

func postgresURLForDatabase(t *testing.T, sourceURL, database string) string {
	t.Helper()
	parsed, err := url.Parse(sourceURL)
	if err != nil {
		t.Fatalf("parse synthetic postgres URL: %v", err)
	}
	parsed.Path = "/" + database
	return parsed.String()
}
