# Database resilience PostgreSQL 16 gate

## Contract and evidence

The production health groups separate process state from database readiness:

- `/actuator/health/liveness` contains only `livenessState`. A running
  application remains HTTP 200 `UP` while PostgreSQL is unavailable or the
  bounded test pool is exhausted.
- `/actuator/health/readiness` contains `readinessState,db`. It is HTTP 503
  `DOWN` when no database connection can be obtained and returns to HTTP 200
  `UP` after connectivity recovers, without restarting the application.
- Both groups hide components and details.

An otherwise valid bearer token whose authentication/session lookup fails with
Spring's `DataAccessResourceFailureException` receives HTTP 503 and the fixed
security response
`{"code":"service_unavailable","message":"Service is temporarily unavailable"}`.
The response is JSON, uses `Cache-Control: no-store`, and receives the existing
security headers. Credential failures remain 401. Other runtime failures are
not reclassified. Production log filtering is limited to connection-unavailable
events from the Spring database health indicator and the exact Hibernate/Hikari
connection loggers; unrelated database and application errors remain visible.

`DatabaseResiliencePostgresql16GateTest` starts a private one-time
`postgres:16-alpine` Testcontainers instance, migrates synthetic data through
Flyway V39, and starts the real production-profile application. It proves:

- available-database liveness/readiness;
- bounded pool exhaustion and a stable-endpoint database outage;
- fixed, redacted 503 responses and captured logs for a protected supplier GET
  and warehouse POST;
- no failed warehouse write or warehouse success audit record, plus unchanged
  supplier fixture count and cross-tenant supplier isolation;
- wrong credentials remain 401; and
- readiness and protected reads recover on the same application instance.

The outage uses Docker pause/unpause so the Testcontainers host port remains
stable. The gate accepts no database, URL, JDBC, credential, path, or
environment input and has no skip path. It does not inspect or connect to the
repository Compose database or any external database.

Run from the repository root:

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
  '-Dtest=DatabaseResiliencePostgresql16GateTest' test

node platform/scripts/database-resilience-gate-check.mjs
node --test platform/scripts/database-resilience-gate-check.test.mjs
node --check platform/scripts/database-resilience-gate-check.mjs
```

The static checker has a repository root derived only from its own location,
accepts no arguments, reads only fixed repository artifacts and main sources,
rejects unsafe/symlinked paths, and never reads `.env`, settings, credential
files, environment values, Docker, Compose, URLs, or JDBC inputs. It also
requires the local Surefire report to contain one executed test with zero
failures, errors, and skips plus the fixed dependency/database evidence line.

## Production threshold fact matrix

No Hikari or transaction timeout threshold is explicitly configured by the
production profile or production Java code. The following values are observed
framework defaults for the dependency versions exercised by this gate; they
are facts, not approved production sizing or product contracts.

| Concern | Explicit production value | Observed dependency/default fact |
| --- | --- | --- |
| Hikari maximum pool size | none | 10 |
| Hikari minimum idle | none | 10 |
| Hikari connection timeout | none | 30,000 ms |
| Hikari validation timeout | none | 5,000 ms |
| Hikari idle timeout | none | 600,000 ms |
| Hikari maximum lifetime | none | 1,800,000 ms |
| Hikari leak detection threshold | none | 0 ms (disabled) |
| Hikari initialization failure timeout | none | 1 ms |
| Spring transaction default timeout | none | `TIMEOUT_DEFAULT` / -1 |

Evidence versions are Spring Boot 4.1.0, HikariCP 7.0.2, Spring TX 7.0.8,
Testcontainers 1.21.4, and PostgreSQL 16.14. The integration test uses
test-only pool size and acquisition/validation timing overrides to make
exhaustion deterministic and bounded; those values are not production
configuration. Adding, removing, or changing any production Hikari or
transaction timeout threshold intentionally fails the static gate and requires
explicit architecture/operations review.

## Capability boundary

This gate is finite functional fault evidence. It is not a production capacity,
load, soak, high-availability, failover, replication, RPO/RTO, cloud topology,
proxy/TLS, deployment, or production recovery proof. It makes no database
connection-budget or timeout recommendation and uses no production data,
shops, secrets, or infrastructure.
