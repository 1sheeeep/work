# Production JDBC log redaction gate

## Production policy

The `production` profile keeps application error signals while preventing
Hibernate from writing database identifiers into normal application logs:

- `org.hibernate.orm.jdbc.error` is fixed at `ERROR`. Hibernate 7.4.1 emits
  expected SQL and constraint failures at `WARN`, so their SQLState, constraint
  name, PostgreSQL detail/where text, tenant UUID, and business values are not
  logged.
- `org.hibernate.orm.connections.pooling` is fixed at `WARN`. This suppresses
  the Hibernate startup metadata message that contains the JDBC URL while
  preserving warning and error signals from that logger.

Both values are also production safety overrides. Environment variables cannot
lower either threshold. Root, JPA, Hibernate, Hikari, PostgreSQL, and project
loggers are not globally disabled. Project exception handlers continue to emit
their fixed, argument-free `ERROR` summaries for unexpected failures.

The policy changes logging only. Exceptions still propagate to the existing
handlers, transaction rollback remains unchanged, and API response contracts
remain unchanged.

## PostgreSQL 16 evidence

`CrossModulePostgresqlConcurrencyGateTest` and
`CrossModuleTenantIsolationIntegrationTest` start their application context
with the real `production` profile after applying migrations to their owned
`postgres:16-alpine` Testcontainers database.

The concurrency gate captures application logs only around a real simultaneous
tenant-scoped unique-key race. It proves:

- one write wins and one returns the existing
  `409/resource_conflict` envelope;
- the resolved cause chain is Hibernate
  `ConstraintViolationException` to PostgreSQL `PSQLException`;
- one business row and one success audit commit;
- captured application logs contain no Hibernate JDBC error event or database,
  tenant, business, credential, URL, or SQL canary.

The tenant-isolation gate captures logs around a forced audit insert failure.
It proves:

- the business row and success audit roll back together;
- the response remains the existing safe `500/internal_error`;
- the resolved cause chain is Hibernate `GenericJDBCException` to PostgreSQL
  `PSQLException`;
- the only captured event is the fixed project `ERROR` summary, with no
  throwable or database detail.

The same production context invokes the unexpected-failure handler with a
non-database exception and proves that the fixed project `ERROR` signal remains.
The log capture appender uses a `CopyOnWriteArrayList`, so concurrent request
events are collected safely.

## Required commands

From the repository root in PowerShell:

```powershell
$backendPath = (Resolve-Path 'platform/backend').Path
docker run --rm `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -v "${backendPath}:/workspace" `
  -v erp-maven-cache:/root/.m2 `
  -w /workspace `
  maven:3.9.11-eclipse-temurin-25 `
  mvn -B `
  '-Dtest=CrossModulePostgresqlConcurrencyGateTest' test

docker run --rm `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -v "${backendPath}:/workspace" `
  -v erp-maven-cache:/root/.m2 `
  -w /workspace `
  maven:3.9.11-eclipse-temurin-25 `
  mvn -B `
  '-Dtest=CrossModuleTenantIsolationIntegrationTest' test
```

The Testcontainers and Flyway harness runs before the production application
context and may report its ephemeral test JDBC URL in Maven output. Those lines
are test infrastructure logs, not application production logs. The assertions
capture the application logging pipeline around each failure operation.
