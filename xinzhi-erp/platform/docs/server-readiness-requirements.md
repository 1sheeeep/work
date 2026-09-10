# XZ ERP server readiness requirements

## 1. Purpose, scope, and status language

This document records the configuration requirements for eventually running XZ ERP on
online servers. It is not a deployment plan or deployment approval. It does not
authorize access to production, real shops, the customer-service production
project, production databases, running containers, or production secrets.

Repository claims use only these labels:

- **IMPLEMENTED**: the repository contains linked executable configuration or
  source evidence.
- **PARTIAL**: linked evidence exists, but it is not sufficient for production.
- **GAP**: no production-safe implementation is present. Production is blocked
  until the responsible release owner accepts and closes it.
- **TODO (OPS)**: an operator-owned value, service, drill, or decision is still
  required and cannot be inferred from source code.

The current repository is suitable only for development and isolated UAT. A
green application build is not production readiness, and the readiness checker
is only a static gate.

## 2. Environment separation

| Layer | Purpose and data | Network and integrations | Current evidence/status |
| --- | --- | --- | --- |
| Development (`local`) | Developer workstation; synthetic data only. `.env` is local and untracked. | Loopback HTTP; no real shop, mail, object storage, or customer-service production connection. | **IMPLEMENTED for local use**: [local Compose](../compose.yaml), [example environment](../.env.example), and [.gitignore](../.gitignore). |
| UAT (`uat`) | Isolated acceptance with synthetic or approved masked data. The repository's current `staging` resources are classified as UAT, not production-like pre-production. | Loopback binding or approved isolated tunnel only; no public traffic or real provider credentials. | **PARTIAL**: [staging Compose](../infra/staging/compose.staging.yaml) is loopback-bound and isolated, while [the staging script](../infra/staging/deploy-staging.sh) is a single-host Compose update. |
| Public review (`review`) | Shopify review and stakeholder acceptance with synthetic data only. It is not a production environment and must not receive real shops or customer-service production credentials. | Dedicated TLS hostname through the review edge; application and database ports remain private. | **PARTIAL**: [review edge Compose](../infra/review/compose.review.yaml) and [Caddy configuration](../infra/review/Caddyfile) provide a pinned single-host TLS edge in front of the isolated UAT application. |
| Pre-production (`preprod`) | Production-equivalent topology, release artifact, PostgreSQL major version, proxy behavior, and observability; masked/non-production data only. | Dedicated TLS hostname and isolated non-production provider sandboxes. | **GAP (P0 before production rehearsal)**: there is no pre-production profile or topology. |
| Production (`production`) | Real ERP workload and data on dedicated application capacity and an approved PostgreSQL service. | Public traffic only through the approved TLS edge; outbound providers enabled individually after acceptance. | **PARTIAL**: the fail-closed application [production profile](../backend/src/main/resources/application-production.yml) is implemented. Production topology, TLS edge, deployment resources, and approved secret delivery remain **GAP (P0)**. |

Environment names are explicit configuration, not hostname inference. A server
process must fail startup when `production` or `preprod` is requested without
that environment's complete profile. A production image must never inherit
local/UAT database endpoints, credentials, origins, bootstrap state, or
integration flags.

## 3. Configuration and secret injection

### Requirements

1. Build artifacts are environment-neutral. Secrets, hostnames, credentials,
   and environment identity are injected at runtime by the environment's
   approved secret/configuration system.
2. No password, token, private key, API key, provider credential, customer data,
   or production endpoint may be committed, baked into an image, placed in a
   command line, returned by a health endpoint, or printed in logs.
3. The `production` Spring profile must be selected explicitly. It requires
   `ERP_DB_URL`, `ERP_DB_USER`, and `ERP_DB_PASSWORD` without fallback values,
   fixes `erp.environment=production`, and does not permit
   `ERP_ENVIRONMENT` or direct `SPRING_DATASOURCE_*` overrides to change those
   contracts.
4. Bootstrap flags remain explicitly false during normal service startup.
   One-off recovery is covered in section 11.
5. Secret rotation must be possible without rebuilding the application image.
   The operations owner must document rotation and emergency revocation before
   production.
6. A production secret store, workload identity, file mount, or equivalent
   mechanism must be selected by operations. Plain Compose environment files
   are not the production secret-store contract.

**IMPLEMENTED locally**: [application.yml](../backend/src/main/resources/application.yml)
requires the database password and keeps both bootstrap flows disabled by
default. [The local example](../.env.example) contains an explicit placeholder,
and [.gitignore](../.gitignore) excludes `.env`.

**PARTIAL for isolated UAT**: [deploy-staging.sh](../infra/staging/deploy-staging.sh)
creates its local database password with restrictive file permissions. That is
not evidence of production secret management.

**IMPLEMENTED application boundary**:
[application-production.yml](../backend/src/main/resources/application-production.yml)
has no database fallback, disables both bootstrap flows and application Flyway,
keeps Hibernate validation, hides health details, and exposes only
`health,info`. The registered
[production safety processor](../backend/src/main/java/cn/xzkj/erp/config/ProductionSafetyEnvironmentPostProcessor.java)
requires all three `ERP_DB_*` values with a generic failure, binds the
datasource only through those values, and makes the safety-critical settings
higher priority than environment variables.
[Configuration tests](../backend/src/test/java/cn/xzkj/erp/config/ProductionProfileConfigurationTest.java)
cover each missing value, redaction, and attempted environment overrides.

**GAP/TODO (OPS/P0)**: no approved production secret store, workload identity,
file mount, delivery mechanism, rotation procedure, or emergency revocation
evidence exists. The application boundary does not close that operations-owned
requirement.

## 4. PostgreSQL 16, Flyway, and startup failure

### Database requirements

- The supported production major version is PostgreSQL 16. Major upgrades
  require a separate compatibility and restore rehearsal.
- Application schema changes are Flyway-only. Hibernate must remain
  `ddl-auto=validate`; application code must never create or update production
  schema implicitly.
- A release runs migrations exactly once through a release-controlled migration
  step or elected leader before new application instances receive traffic.
  Parallel application instances must not race to migrate production.
- Flyway validation, checksum mismatch, missing required migration, database
  connection failure, or Hibernate schema validation failure is a hard startup
  failure. The instance must never become ready after any such failure.
- `repair`, `baseline`, `clean`, `outOfOrder`, migration renumbering, and editing
  an applied migration are prohibited in automated production startup.
- Database credentials use least privilege. The operations design must decide
  whether migration and runtime identities are separated; until then this is a
  **TODO (OPS/P0)**.

**IMPLEMENTED foundation**:

- [local Compose](../compose.yaml) pins a PostgreSQL 16 image digest;
  [UAT Compose](../infra/staging/compose.staging.yaml) declares PostgreSQL 16.
- [pom.xml](../backend/pom.xml) includes Spring Boot Flyway and the PostgreSQL
  Flyway/database drivers.
- [application.yml](../backend/src/main/resources/application.yml) enables
  Flyway at `classpath:db/migration` and sets Hibernate to validate.
- The application
  [production profile](../backend/src/main/resources/application-production.yml)
  forces `spring.flyway.enabled=false` and `ddl-auto=validate`; future
  release-controlled migration execution is therefore separate from normal
  production application startup.
- [ProductionReadinessIntegrationTest](../backend/src/test/java/cn/xzkj/erp/config/ProductionReadinessIntegrationTest.java)
  prepares an isolated PostgreSQL 16 schema through Flyway, proves the
  production application starts without a Flyway bean, and proves empty-schema
  and unreachable-database startup failures.

**IMPLEMENTED offline migration integrity and isolated rehearsal**:

- [the deterministic SHA-256 manifest](../scripts/flyway-migration-manifest.json)
  records the repository's actual V1-V66 files. The
  [rehearsal checker](../scripts/flyway-migration-rehearsal.mjs) rejects
  malformed names, duplicate versions, inserted lower versions, missing files,
  and any name/checksum change. Its append-only update path first preserves the
  complete historical prefix, accepts only versions above the current maximum,
  and never writes migration SQL.
- The checker creates and ownership-labels its own one-use container from the
  PostgreSQL 16 digest pinned by local Compose. It accepts only the dynamically
  published loopback endpoint, does not accept an operator database URL, runs
  Maven offline against the repository's locked Flyway dependencies, and
  removes only resources whose random ownership markers still match.
- [FlywayMigrationRehearsalIT](../backend/src/test/java/cn/xzkj/erp/config/FlywayMigrationRehearsalIT.java)
  proves empty V1-to-latest migration, V38-to-latest upgrade, PostgreSQL major
  version 16, successful validation, duplicate-version rejection,
  applied-checksum tamper rejection, and zero pending/failed migrations for
  deliverable cases. The standalone gate requires all evidence with zero skips;
  any failure returns nonzero and the gate never invokes the ERP application.
- [Node negative tests](../scripts/flyway-migration-rehearsal.test.mjs) cover
  historical tampering, duplicate/out-of-order versions, path traversal,
  non-loopback and credential-bearing targets, command injection, secret
  redaction, invalid invocation, evidence completeness, and ownership-checked
  cleanup.

This is **PARTIAL for production readiness**. It proves a repeatable offline,
isolated migration gate, not production release behavior.

### Migration ordering requirements

The repository baseline at this document revision is:

```text
V1, V10, V20, V21, V30, V31, V32, V33, V34, V35, V36, V37, V38, V39,
V40, V42, V43, V44, V45, V46, V47, V48, V49, V50, V51, V52, V53, V54,
V55, V56, V57, V58, V59, V60, V61, V62, V63, V64, V65, V66, V67, V68,
V69, V70, V71, V72, V73, V74, V75, V76, V77, V78, V79, V80
```

This is intentionally sparse. Missing integers are legal and must not be
reported as gaps. A new migration must use a version greater than every
version already present in the repository or applied to the target database.
The static checker protects the V1-V66 names. The migration rehearsal manifest
also protects their contents. A later integer is accepted only through the
append-only manifest update after the full isolated PG16 rehearsal succeeds.
Missing integers remain legal. Applied files remain immutable; corrections use
a new globally increasing version.

**GAP (P0)**: the repository still has no single production migration
job/leader, production lock/lease design, release-controller abort/no-traffic
enforcement, real production-equivalent pre-production rehearsal, or proven
backup-before-migrate gate. The local/CI gate does not close any of these
operations and release-topology requirements.

## 5. Reverse proxy, TLS, forwarded headers, and browser security

### Edge and proxy requirements

1. Production TLS terminates only at an approved edge using an operations-owned
   certificate and modern TLS policy. HTTP redirects to HTTPS before
   authentication data is accepted.
2. Backend and web container ports are not publicly reachable. Only the
   designated reverse proxy network may reach them.
3. The public edge removes all inbound `Forwarded`, `X-Forwarded-*`, and
   `X-Real-IP` values, then writes canonical values. Application instances
   accept forwarded headers only from the trusted proxy path. Direct clients
   must not be able to spoof scheme or source IP.
4. Hostnames and origins use explicit allowlists. Production CORS is same-origin
   by default; any cross-origin exception requires an exact HTTPS origin,
   reviewed methods/headers, and no wildcard with credentials.
5. HSTS is enabled only after the production hostname and certificate path are
   verified. CSP, clickjacking, content-type, and referrer policies are set at
   the public edge and tested on error responses as well as the SPA.

**PARTIAL**: [frontend nginx.conf](../frontend/nginx.conf) proxies `/api/`,
sets forwarding headers, hides the Nginx version, adds several browser headers,
and implements the repository-local/UAT `/readyz` edge gate described in
section 6. [application.yml](../backend/src/main/resources/application.yml)
uses Spring's framework forwarded-header strategy. [Local Compose](../compose.yaml)
and [UAT Compose](../infra/staging/compose.staging.yaml) bind HTTP to loopback.
The pinned [public review edge](../infra/review/compose.review.yaml) terminates
automatic HTTPS for the synthetic-data review hostname, removes inbound
forwarding headers before writing canonical values, and reaches only the
external review network. This is review-environment evidence, not production
edge approval.

**GAP (P0)**: there is no production TLS edge, trusted-proxy source enforcement,
host/origin allowlist, HSTS, or CSP. The existing framework forwarded-header
setting alone is not proof that untrusted forwarded headers cannot reach the
application.

### CSRF, cookies, and sessions

The current authentication transport is an `Authorization: Bearer` token in a
stateless Spring Security chain. CSRF is therefore disabled and no
authentication cookie is issued. Evidence:
[SecurityConfig.java](../backend/src/main/java/cn/xzkj/erp/config/SecurityConfig.java),
[client.ts](../frontend/src/api/client.ts), and
[sessionStore.ts](../frontend/src/auth/sessionStore.ts). Browser tokens are
stored in `sessionStorage`, not persistent local storage.

Server-side session rows store only token hashes and expiry/revocation state;
see [V10](../backend/src/main/resources/db/migration/V10__iam_authentication_foundation.sql)
and [SessionTokenService.java](../backend/src/main/java/cn/xzkj/erp/iam/application/SessionTokenService.java).
Session TTL is bounded to at most 24 hours, so instances need no sticky session.

This CSRF decision is valid only while authentication is never ambiently sent
by a browser cookie. If authentication moves to cookies, production requires
`Secure`, `HttpOnly`, an approved `SameSite` value, narrow domain/path, rotation,
logout invalidation, and CSRF protection before release. **GAP (P1)**: the
browser-token/XSS model and CSP have not received production acceptance.

## 6. Health, liveness, and readiness

| Probe | Requirement | Evidence/status |
| --- | --- | --- |
| Process liveness | `/actuator/health/liveness`; must indicate only whether restart can help and must not expose details. | **IMPLEMENTED application boundary**: the production group contains only `livenessState`. The [database resilience PG16 gate](../backend/docs/database-resilience-pg16-gate.md) proves HTTP 200 `UP` during bounded pool exhaustion and database outage. |
| Backend readiness | `/actuator/health/readiness`; must remain non-ready until the release migration step and application schema validation complete and required database connectivity is healthy. | **IMPLEMENTED application boundary**: the production profile explicitly includes `readinessState,db`; the PG16 gate proves available-database `UP`, pool-exhaustion/outage HTTP 503 `DOWN`, hidden details, and automatic recovery on the same application instance. |
| Web liveness | `/healthz`; validates that Nginx can serve a response. | **IMPLEMENTED** in [nginx.conf](../frontend/nginx.conf) and both Compose files. |
| Repository edge readiness | Exact `/readyz` from the local/UAT entrypoint to backend `/actuator/health/readiness`, with no credentials or sensitive detail. | **IMPLEMENTED for local configuration; PARTIAL for repository UAT topology**: [nginx.conf](../frontend/nginx.conf), both Compose files, the [UAT update loop](../infra/staging/deploy-staging.sh), and the [real-Nginx Docker gate](../scripts/nginx-readiness.test.mjs). This is not a real pre-production or production load-balancer probe. |

Health responses and probe logs must not contain database errors, connection
strings, usernames, stack traces, provider status payloads, or secrets.

The repository edge probe requirement is:

- `/healthz` remains edge liveness: HTTP 200, `text/plain`, body `ok`.
- Exact `/readyz` allows only GET and HEAD. It sends an internal GET with no
  client headers or body to backend `/actuator/health/readiness`. Only an exact
  upstream HTTP 200 produces edge HTTP 200 with fixed body `ready`; every other
  upstream status, timeout, or connection failure produces a non-2xx fixed
  response. Upstream bodies and response headers are not forwarded.
- `/readyz` responses use `Cache-Control: no-store`. Query-bearing requests,
  case variants, and `/readyz/...` paths are rejected instead of reaching the
  SPA. POST and OPTIONS are rejected.
- The local and UAT web-container healthchecks use `/readyz`, while `/healthz`
  remains available for independent edge liveness. The UAT update loop and
  [local UAT smoke CLI](../scripts/local-uat-smoke.mjs) check the same edge
  readiness route before authenticated API checks.

Run the isolated runtime gate from the repository root:

```powershell
node --test platform/scripts/nginx-readiness.test.mjs
```

The gate creates uniquely named one-time containers and private test networks,
uses a simulated upstream, and never connects to a running ERP stack or an
external service. It covers real Nginx configuration loading, GET/HEAD,
POST/OPTIONS rejection, exact-path and SPA-negative behavior, upstream 200,
503, non-200 2xx, disconnect, timeout, fixed bodies, no-store, client-header
stripping, and upstream body/header canaries. It requires already-local
`xz-erp-local-web:latest` and `alpine:3` images by default (overridable with
`ERP_NGINX_TEST_IMAGE` and `ERP_ALPINE_TEST_IMAGE`); unavailable Docker or
images fail the gate rather than skip or pull.

Explicit liveness/readiness responsibility separation, pool exhaustion,
database loss, protected-request fail-closed behavior, redaction, and
same-process recovery are covered by the isolated PG16 gate. The repository
local/UAT edge path is covered as above. A real pre-production topology, probe
from an actual load balancer, trusted-proxy enforcement, TLS edge, and database
recovery in a production-equivalent topology remain **GAP (P0 before
production)**.

## 7. Logs, audit, metrics, and alerts

### Required production configuration

- Application logs are structured and include timestamp, severity, service,
  environment, release ID, request ID, route template, status, latency, and a
  safe error code. They exclude request/response bodies, authorization headers,
  cookies, tokens, passwords, credential references, personal data, and raw
  provider payloads.
- Proxy and application request IDs are propagated end to end. Source IP is
  recorded only after the trusted-proxy contract is enforced.
- Security and business audit events remain database records separate from
  diagnostic logs. Audit retention, access, export, and tamper monitoring need
  operations/security approval.
- Metrics cover request rate/error/latency, readiness, JVM/container saturation,
  database pool usage/waits, Flyway/startup failure, login throttling, and job
  failure/backlog. Metrics must not use tenant, user, shop, or request IDs as
  unbounded labels.
- Alerts require an owner, severity, threshold, evaluation window, runbook, and
  notification route. Minimum alerts are public availability, sustained 5xx,
  latency, restart loop, database saturation, pool exhaustion, disk/volume
  pressure, failed backup, failed restore drill, and migration failure.

**PARTIAL**: [UAT Compose](../infra/staging/compose.staging.yaml) rotates
`json-file` logs. Tenant IAM audit storage starts in
[V1](../backend/src/main/resources/db/migration/V1__identity_and_permissions.sql);
platform-administrator audit storage is defined in
[V37](../backend/src/main/resources/db/migration/V37__platform_system_administration.sql).

**GAP (P1)**: no production structured logging pipeline, retention policy,
metrics exporter, dashboards, alerts, or on-call runbooks are present.

## 8. Backup, restore, RPO, and RTO

These values are **TODO (OPS/P0)** and block production:

| Decision/evidence | Required value |
| --- | --- |
| Production database backup service, encryption, retention, and off-site/account boundary | TBD by operations |
| Point-in-time recovery capability and retained window | TBD by operations |
| Object-storage versioning/replication once enabled | TBD by operations |
| RPO by business domain | TBD by product + operations |
| RTO by business domain | TBD by product + operations |
| Restore drill frequency, isolated target, evidence retention, and owner | TBD by operations |
| Backup-before-migration gate and abort authority | TBD by operations |

Success means a timed restore drill from a real backup into an isolated target,
followed by Flyway/schema validation and approved reconciliation. A backup job
report without a restore drill is not readiness. The safety requirement already
appears in [architecture.md](architecture.md#non-negotiable-safety-rules), but
no executable production backup, scheduling, retention, PITR, or timed
pre-production restore-drill evidence exists in this repository.

**IMPLEMENTED repository-only logical recoverability gate; PARTIAL for
production readiness**:

- [the PostgreSQL 16 backup/restore gate](../scripts/pg16-backup-restore-rehearsal.mjs)
  accepts no operator JDBC URL, database/container name, or file path. It uses
  only a randomly owned one-use container created from the exact PostgreSQL 16
  digest pinned by local Compose, a dynamically published loopback port, random
  credentials, and an owner-checked temporary directory. It never uses the
  current Compose database or another running database.
- The gate migrates a source database from V1 to V80/latest with the immutable
  Flyway manifest, inserts the synthetic dataset below, creates a custom-format
  `pg_dump`, restores it into a checked-empty database, then requires Flyway
  history/validate, critical constraint/index/trigger checks, data
  reconciliation, and application Hibernate `ddl-auto=validate`.
- [the Java fixture and validator](../backend/src/test/java/cn/xzkj/erp/config/Pg16BackupRestoreRehearsalIT.java)
  use fixed synthetic UUIDs/timestamps and test-only one-way password/token
  hashes. No real credential, tenant, user, order, supplier, shop, or customer
  data is accepted.
- [the Node negative tests](../scripts/pg16-backup-restore-rehearsal.test.mjs)
  cover invalid invocation, command injection, nonempty targets, evidence
  completeness, redaction, unavailable Docker, and ownership-refusing cleanup.
  The real gate additionally proves that truncated and wrong-format archives,
  nonempty and wrong-schema targets, nonzero `pg_restore`, and target Flyway
  version/checksum mismatch cannot produce deliverable evidence.
- A successful run emits one fixed, secret-free JSON evidence record only after
  owner-checked container and temporary-directory cleanup. It requires
  `skipped=0`; failures emit no passing evidence.

The executable synthetic data dictionary is:

| Domain | Synthetic rows | Reconciliation invariant |
| --- | ---: | --- |
| Tenant and IAM | 2 tenants, users, roles, sessions, credentials, and audit rows | The same user name is legal in both tenants; password/token fields are one-way test hashes; actor/tenant foreign keys and audit timestamps survive exactly. |
| Shop and product | 1 global platform; 2 shops, SPUs, SKUs, and listings | Both tenants reuse the same business/external codes while every restored row retains its tenant owner. |
| Order | 2 orders and 2 lines | Order/line/shop/SKU tenant ownership, currency, quantity, minor-unit amount, match source, UUIDs, and timestamps match the source snapshot. |
| Warehouse | 2 warehouses and 2 locations | Both tenants reuse the same warehouse/location codes and composite foreign keys remain valid. |
| Supplier and V39 | 2 suppliers and 2 preferred supplier-SKU mappings | Supplier/SKU/mapping tenant ownership, V39 constraints, partial unique index, and write/delete triggers remain present and valid. |
| Schema metadata | 54 successful migrations through V80 plus the source sequence catalog | Flyway count/latest/checksums, critical constraints/indexes/triggers, UUID/time types, and sequence metadata match after restore. |

The restored database also rejects cross-tenant order/SKU,
warehouse/location, and supplier/SKU writes with foreign-key failures.

This gate proves only that the repository's current V1-V80 logical schema and
representative synthetic rows can round-trip through PostgreSQL 16
`pg_dump`/`pg_restore`. It is not a production backup solution, backup job,
backup-before-migration gate, PITR test, RPO/RTO decision, encrypted/off-site
retention design, restore authorization workflow, evidence-retention policy, or
timed drill from a real backup.

## 9. Rolling release and rollback boundary

Every release must have an immutable release ID, image digest/SBOM and
provenance evidence, configuration version, migration set, checksums, operator,
change approval, and rollback candidate. New instances become ready before old
instances drain. Graceful shutdown must exceed the load balancer's drain time
and remain within the application's configured shutdown phase.

Database changes use expand/migrate/contract compatibility:

1. Additive schema first; old and new application versions can overlap.
2. Backfill/reconcile through a separately controlled operation.
3. Switch reads/writes only after evidence.
4. Destructive cleanup occurs in a later release after the rollback window.

Application rollback is allowed only to a version proven compatible with the
already-applied schema and current configuration. Applied Flyway migrations are
never automatically rolled back or edited. A forward correction receives a new
version. If data semantics changed incompatibly, stop traffic/writes according
to the incident runbook instead of guessing a binary rollback.

**PARTIAL**: [build-staging-release.ps1](../tools/build-staging-release.ps1)
packages images, configuration, release metadata, and checksums.
[application.yml](../backend/src/main/resources/application.yml) enables
graceful shutdown. The repository [staging update script](../infra/staging/deploy-staging.sh)
waits for the dependency-aware `/readyz` path after its single-host Compose
update, but performs no traffic shift.

**GAP (P1, elevated to P0 for the first production release)**:
[deploy-staging.sh](../infra/staging/deploy-staging.sh) performs a single-host
Compose update and has no rolling traffic shift or automatic rollback. There is
no production release controller, compatibility gate, or rollback drill.

## 10. External adapters: disabled by default

Object storage, mail, and real platform/shop adapters are deny-by-default in
every environment. Future implementations must introduce explicit, independently
reviewed server-side flags equivalent to:

```text
ERP_OBJECT_STORAGE_ENABLED=false
ERP_MAIL_ADAPTER_ENABLED=false
ERP_PLATFORM_ADAPTERS_ENABLED=false
```

The exact names require explicit approval when those contracts are
implemented. An environment must fail closed if a flag is true but its endpoint,
credential reference, tenant/shop allowlist, TLS validation, timeout, retry,
idempotency, rate limit, audit, or kill switch is missing. Production provider
enablement is per adapter and per approved tenant/shop; a global production
default of true is prohibited.

**IMPLEMENTED negative boundary for the current shop center**:
the current module keeps provider secrets outside ERP business DTOs and does
not enable a real provider connection without explicit configuration.

**GAP/TODO**: [architecture.md](architecture.md#technology-decisions) describes
future S3-compatible storage, while mail/object-storage runtime adapters and
the explicit flags above do not exist. Absence of code is not treated as a
completed production kill switch.

## 11. Initial `SYSTEM_ADMIN` and server-side emergency recovery

Normal web service startup keeps platform-administrator bootstrap disabled. The
only accepted initialization/recovery path is an operator-approved, one-off,
non-web invocation of the same backend image against the intended database,
with a new owner-only output file:

```text
ERP_BOOTSTRAP_PLATFORM_ADMIN_ENABLED=true
ERP_BOOTSTRAP_PLATFORM_ADMIN_EMAIL=<approved-existing-or-initial-email>
# Or, mutually exclusively:
ERP_BOOTSTRAP_PLATFORM_ADMIN_USERNAME=<approved-existing-or-initial-email-or-phone>
ERP_BOOTSTRAP_PLATFORM_ADMIN_DISPLAY_NAME=<exact-approved-display-name>
ERP_BOOTSTRAP_PLATFORM_ADMIN_TOKEN_OUTPUT_PATH=<absolute-owner-only-container-path>
ERP_BOOTSTRAP_PLATFORM_ADMIN_TTL_MINUTES=<5-to-120>
ERP_BOOTSTRAP_PLATFORM_ADMIN_RECOVERY=<false-for-first-admin|true-for-recovery>
--spring.main.web-application-type=none
```

`ERP_BOOTSTRAP_PLATFORM_ADMIN_EMAIL` and
`ERP_BOOTSTRAP_PLATFORM_ADMIN_USERNAME` are mutually exclusive. Email-only
runbooks use the former; phone identifiers use the latter and are normalized
to E.164 before the administrator and one-time credential are created.

Database settings are injected by the server's secret mechanism and are not
shown in shell history. The output path must not exist. The one-time token is
delivered through an approved out-of-band channel, redeemed immediately, then
the file is securely removed according to the incident record. Normal service
is restarted only with the bootstrap flag false. Two-person approval, operator
identity, incident/change ID, start/end time, affected administrator, token-file
destruction, session revocation, and audit verification are required
operational records.

**IMPLEMENTED code boundary**:

- [application.yml](../backend/src/main/resources/application.yml) defaults the
  flag to false.
- [PlatformAdminBootstrapConfiguration.java](../backend/src/main/java/cn/xzkj/erp/platformadmin/bootstrap/PlatformAdminBootstrapConfiguration.java)
  allows the runner only when explicitly enabled and non-web.
- [InitialAdminBootstrapEnvironmentPostProcessor.java](../backend/src/main/java/cn/xzkj/erp/iam/bootstrap/InitialAdminBootstrapEnvironmentPostProcessor.java)
  fails if either bootstrap flow is enabled for a web process.
- [ProductionSafetyEnvironmentPostProcessor.java](../backend/src/main/java/cn/xzkj/erp/config/ProductionSafetyEnvironmentPostProcessor.java)
  forces both bootstrap flags false whenever the `production` profile is
  active, even when their environment variables are true.
- [PlatformAdminBootstrapProperties.java](../backend/src/main/java/cn/xzkj/erp/platformadmin/bootstrap/PlatformAdminBootstrapProperties.java)
  validates identity, absolute output path, TTL, and recovery mode.
- [PlatformAdminBootstrapService.java](../backend/src/main/java/cn/xzkj/erp/platformadmin/bootstrap/PlatformAdminBootstrapService.java)
  restricts initial creation, validates recovery identity/status, issues a
  short-lived credential, and writes audit.
- [BootstrapTokenFileStore.java](../backend/src/main/java/cn/xzkj/erp/iam/bootstrap/BootstrapTokenFileStore.java)
  creates a new owner-only file and never overwrites an existing path.

**GAP (P1 before production, P0 during an access-loss incident)**: there is no
approved production runbook, two-person control implementation, or recovery
drill evidence. This task did not invoke the flow.

## 12. Capacity and connection-pool validation

[Local Compose](../compose.yaml) and
[UAT Compose](../infra/staging/compose.staging.yaml) set container CPU/memory
limits. They are not production capacity evidence. No production Hikari pool
or transaction timeout threshold, PostgreSQL connection budget, JVM
heap/direct-memory budget, concurrency target, or load-test result is
committed. The exact observed dependency defaults and the gate that prevents
silent production-threshold drift are recorded in the
[database resilience PG16 gate](../backend/docs/database-resilience-pg16-gate.md).

The following are **TODO (OPS/engineering, P1 before production)**:

- peak and sustained requests/jobs per second, concurrent users, payload sizes,
  and dataset growth;
- web/backend replica minimum and maximum, CPU/memory requests/limits, JVM heap,
  direct memory, and graceful-drain timing;
- PostgreSQL `max_connections` budget across application replicas, migration,
  administration, and monitoring;
- Hikari maximum/minimum pool size, acquisition timeout, lifetime, leak
  detection policy, and the invariant
  `replicas × maxPool + reserved connections < database limit`;
- query latency/error targets, slow-query evidence, indexes, autovacuum/storage
  headroom, and batch/job concurrency;
- controlled load, soak, failover, pool-exhaustion, and recovery tests in
  pre-production without real shops or production data.

## 13. Readiness checker

The checker is Node 24 ESM with no added dependency. It is read-only, performs
no network calls, reads only repository files selected by fixed rules, refuses
symlinks/path escape, and never reads `.env`, user environment variable values,
credentials, running containers, or Docker state.

Run from the repository root:

```powershell
node platform/scripts/server-readiness-check.mjs
node --test platform/scripts/server-readiness-check.test.mjs
node --check platform/scripts/server-readiness-check.mjs
```

Exit codes:

- `0`: every static rule passed;
- `1`: at least one readiness rule failed;
- `2`: invalid invocation or internal checker failure.

Output contains only `[PASS|FAIL]`, a rule name, and a repository-relative file
location. It never prints matched content. The secret test uses a canary and
asserts that the value is absent from all output.

The current repository is expected to return `0` for the implemented static
rules. This does not mean production is ready: the checker has no rules that can
prove the remaining operations-owned TLS, secret-store, migration runner,
production backup/PITR/timed restore drill, rollout, or recovery evidence. The
separate repository-only logical backup/restore gate below is executable
runtime evidence, not a static-checker claim.

### Checker limitations

- It does not parse full YAML/Compose/Spring semantics; secret/default checks are
  conservative static patterns. It verifies the production profile and named
  safety-override tokens, while Java tests provide the runtime precedence and
  startup evidence.
- It does not scan `.env`, process environment values, untracked credentials,
  images, containers, databases, secret stores, or network endpoints.
- ERP production-profile checks exclude the independently deployed
  `platform/customer-service` production topology. Generic committed-secret
  scanning still covers that subtree; its runtime production configuration is
  accepted by the customer-service release gates rather than this ERP profile
  checker.
- It has no Git-history dependency. Instead it protects the named V1-V66
  baseline and rejects new lower-numbered versions. The baseline must be updated
  after integrating later migrations.
- It does not prove TLS, trusted proxy behavior, CORS, runtime health,
  PostgreSQL compatibility, production restore success, rollout safety,
  observability, provider disablement, or capacity. Those require the missing
  configuration and pre-production/operations evidence described above.

### Flyway migration rehearsal gate

The separate migration gate is:

```powershell
node platform/scripts/flyway-migration-rehearsal.mjs --check-only
node platform/scripts/flyway-migration-rehearsal.mjs
node --test platform/scripts/flyway-migration-rehearsal.test.mjs
node --check platform/scripts/flyway-migration-rehearsal.mjs
```

The default run requires Docker and a locally available copy of the exact
PostgreSQL 16 image digest, plus Java 25/Maven with the repository dependencies
already cached. It refuses to pull or silently skip. It prints only fixed stage
names, never child process output, passwords, usernames, or JDBC URLs.

When a migration is added above the manifest maximum,
`--update-manifest` verifies that every existing entry is unchanged, runs the
complete isolated PG16 rehearsal, and then appends the new deterministic hash.
It refuses historical edits and never modifies SQL. This executable evidence
does not implement the production migration job, locking, deployment abort,
backup, or pre-production topology.

### PostgreSQL 16 logical backup/restore gate

Run the separate isolated recoverability gate from the repository root:

```powershell
node platform/scripts/pg16-backup-restore-rehearsal.mjs
node --test platform/scripts/pg16-backup-restore-rehearsal.test.mjs
node --check platform/scripts/pg16-backup-restore-rehearsal.mjs
```

The default run accepts no arguments and requires Node 24, Docker, the exact
already-local PostgreSQL 16 image digest, Java 25, Maven, and already-cached
repository dependencies. Missing tools or images fail rather than pull or
skip. Child output is suppressed; stage output and the final JSON evidence do
not contain SQL, archive contents, passwords, usernames, JDBC URLs, tenant
identities, or fixture hashes.

The gate uses the Flyway manifest and shared ownership-checked cleanup helpers.
It makes no migration change, writes no migration SQL, starts no ERP web application,
connects no current/running database, and deletes only the randomly marked
container and temporary directory whose ownership still matches.

## 14. Production blocking GAP register

| Priority | GAP | Closure evidence required |
| --- | --- | --- |
| P0 | Approved production secret delivery, storage, rotation, and emergency revocation are absent. The application profile itself is implemented. | Secret-store/workload-identity design, runtime delivery evidence, rotation/revocation drill, and access review. |
| P0 | Production TLS edge, host/origin allowlists, and trusted-proxy enforcement are absent. | Edge configuration review plus direct/spoofed-header, TLS, CORS, and security-header tests. |
| P0 | Production backup scheduling/service, encryption/key handling, retention/off-site boundary, PITR, RPO/RTO, restore authorization/evidence retention, timed real-backup drill, and backup-before-migrate gate remain undecided/unimplemented. The repository has only a synthetic V1-V80 PostgreSQL 16 logical dump/restore gate. | Approved values and service design plus a timed, authorized isolated restore/reconciliation report from a real non-production backup. |
| P0 | Production migration leader/job, lock/lease, and release failure/abort procedure are absent. The repository has only a fail-closed local/CI PG16 rehearsal gate. | Production-equivalent pre-production rehearsal proving a single migration owner, lock behavior, hard release abort, backup prerequisite, and no application traffic/start on failure. |
| P0 | Database recovery in a production-equivalent topology and a probe from the real pre-production/production load balancer are not proven. Application DB membership plus the repository local/UAT edge gate and its isolated real-Nginx tests are implemented. | Database recovery and external edge-path tests in an approved pre-production topology, including TLS and trusted-proxy behavior, without sensitive details. |
| P1 | Structured logs, metrics, alerts, dashboards, retention, and runbooks are absent. | Observability acceptance with redaction and cardinality review. |
| P1 | Rolling rollout, compatibility gate, and rollback drill are absent. | Overlap/drain/rollback rehearsal with an already-migrated schema. |
| P1 | CSP and the `sessionStorage` bearer-token threat model lack production acceptance. | Security review and browser negative tests. |
| P1 | Adapter kill-switch flags do not yet exist because runtime adapters do not exist. | Contract-approved flags and fail-closed tests before any adapter is added/enabled. |
| P1 | Capacity, connection-pool, database budget, and load/soak results are absent. | Approved sizing sheet and pre-production test evidence. |
| P1 | `SYSTEM_ADMIN` recovery has code controls but no production runbook/drill. | Two-person runbook and isolated recovery exercise with audit evidence. |
