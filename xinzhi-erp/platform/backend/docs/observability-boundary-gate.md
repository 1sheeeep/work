# Observability exposure and cardinality boundary

This contract is repository-local evidence for the XZ ERP Actuator, health,
logging, and telemetry boundary. It does not create a metrics product,
exporter, dashboard, alert, public monitoring endpoint, or production network
policy.

## Edge responsibility

The repository Nginx edge has two public probe routes:

- `/healthz` is an edge-process liveness response.
- `/readyz` is a dependency-aware edge response backed by an internal
  subrequest to direct-backend `/actuator/health/readiness`.

Both routes suppress access logging and return bounded, generic text. Root
`/actuator` and every path beneath `/actuator/` return generic
`404 text/plain` before the SPA fallback. `/api/actuator` and every path
beneath `/api/actuator/` return the same response before the `/api/` proxy.
The deny is case-insensitive, and real-Nginx tests cover exact, trailing-slash,
duplicate-slash, dot, encoded-character, and encoded-separator facts.

Actuator probes inherit the approved access log. Its `path` field is the
query-free normalized `$uri`; query, request line, headers, cookies, and body
are excluded. A denied probe must be logged as its normalized Actuator path,
never disguised as `/index.html`. `/healthz`, `/readyz`, readiness variants,
and readiness fallback keep `access_log off`.

## Direct-backend responsibility

Spring Security permits only `/actuator/health` and
`/actuator/health/**`. It explicitly denies `/actuator` and
`/actuator/**` before business/API authorization rules. The fixed security
entry point and denial handler return generic JSON; they do not return
host/port self links.

The real Spring/PostgreSQL 16 matrix covers anonymous, tenant,
base `SYSTEM_ADMIN`, and entered-tenant `SYSTEM_ADMIN` sessions:

- health, Liveness, and Readiness remain available with hidden details;
- every other named Actuator surface is `401` or `403`;
- `/api/actuator/**` retains its pre-existing `401`, `403`, or `404`
  behavior and is not made public.
- an unknown business path with unique path, query, and header canaries retains
  its existing `401`, `403`, or `404` status without reflecting a canary in
  the response, application log, or either audit table.

Spring Boot 4.1 binds error rendering under `spring.web.error`. The base
application therefore sets `spring.web.error.include-path=never`, and the
production safety environment post-processor inserts the same value at highest
precedence so an external `always` override cannot reopen path reflection.
The obsolete `server.error.include-path` key is not accepted as evidence. This
does not add or replace an API error envelope.

The local and staging Compose files publish no backend host port. The backend
joins only `app` and `data`; only the web service joins staging
`public_ingress`. These are repository topology facts. They are not proof of
production network isolation, firewall policy, TLS behavior, load-balancer
routing, or a deployed direct-backend boundary.

## Health and recovery contract

Liveness contains only `livenessState`. Readiness contains
`readinessState,db`. Both hide details and components.

- Liveness answers whether the process should be restarted and must not depend
  on database membership.
- Readiness removes an instance from service when the database is unavailable
  and returns it only after database recovery.

The existing `DatabaseResiliencePostgresql16GateTest`,
`ProductionReadinessIntegrationTest`, server-readiness checker, and real Nginx
readiness tests remain the authoritative database-failure and recovery
evidence. The observability gate must not weaken or replace them.

## Sensitive data and cardinality

Health, denial, error, and request-log surfaces must not expose a JDBC URL,
database host/port/name/user, tenant or user identity, resource or session
identifier, token, password, hash, credential, request canary, or stack detail.

No custom `MeterRegistry`, `ObservationRegistry`, meter builder, binder, or
cardinality API exists in production source. Introducing one requires an
explicit review and checker update. Tags must not contain tenant, user,
resource, raw path, query, header, credential, or error-detail values. The
runtime gate warms one unknown route and then sends 128 unique bounded
failures; the overall meter identity set may grow by at most four while
`http.server.requests` may grow by at most one series, and no canary or UUID
may appear in a tag.

## Fail-closed execution

The checker has a fixed repository root. It accepts no path, URL, environment
override, database endpoint, or credential. It reads only fixed regular files
and selected production source types, refuses aliases, and never reads
`.env` or process environment values.

Run from the repository root with the repository dependencies already cached:

```powershell
$runtimeRoot = Join-Path $env:USERPROFILE '.cache\codex-runtimes\erp-pg16-gate'
$env:JAVA_HOME = Join-Path $runtimeRoot 'jdk-25'
$env:Path = "$(Join-Path $runtimeRoot 'apache-maven-3.9.11\bin');$env:Path"
Set-Location platform/backend
mvn.cmd -o -Dtest=ObservabilityBoundaryPostgresql16GateTest test
Set-Location ../..
node --test --test-reporter=junit --test-reporter-destination=platform/backend/target/observability-edge-runtime.junit.xml platform/scripts/http-routing-edge-runtime.test.mjs
node platform/scripts/observability-boundary-gate-check.mjs
node --test platform/scripts/observability-boundary-gate-check.test.mjs
```

The PG16 test uses Testcontainers 1.21.4 with `neverPull`; missing Docker,
the already-local PostgreSQL 16 image, Maven cache, a test report, evidence,
positive test count, or `0 skipped` is a hard failure. The real edge test uses
the already-local repository Nginx image and never pulls or skips. The final
checker requires fresh fixed-path Java and edge JUnit reports with zero
failures, errors, and skips.

## Limits

This gate proves the current repository configuration and isolated loopback
runtime only. It does not prove a deployed public edge, TLS/HSTS, DNS, a
production load balancer, production network isolation, log transport or
retention, metric exporter access, dashboards, alerts, capacity, or on-call
response. Those remain integration and operations acceptance items.
