# Local UAT smoke CLI

## Shopify public review smoke

`shopify-public-review-smoke.mjs` performs a credential-free, read-only check of the seven fixed public review pages, including the merchant data-processing terms. It requires HTTPS, follows no redirects, caps every response at 512 KiB, requires HTML and page-specific markers, and rejects unresolved or validation-only content. Run it only against the exact authorized submission deployment:

```powershell
node platform/scripts/shopify-public-review-smoke.mjs --base-url https://erp.xzkj.ai

# Verify the official company website, legal entity and purpose-specific inboxes.
node platform/scripts/shopify-company-identity-smoke.mjs
node --test platform/scripts/shopify-public-review-smoke.test.mjs
```

`--allow-http-loopback` exists only for an explicitly selected local `localhost`/loopback server. The script never accepts credentials in the URL and never prints response bodies.

## Shopify protected-data access review

`shopify-protected-data-access-review.mjs` reads the Connector's fixed internal
access-event endpoint and emits a pseudonymized JSON review report to standard
output. It requires HTTPS, follows no redirects, accepts the service token only
from `XZ_ERP_CONNECTOR_TOKEN` or `ERP_XZ_ERP_APP_CONNECTOR_TOKEN`, rejects
conflicting token variables, caps the response at 256 KiB and 100 events, and
strictly rejects unexpected fields, customer values, duplicate IDs, or unsorted
events. It never prints the service token or raw tenant, shop, actor, or event
identifiers.

Run it only from an approved administrative environment against the exact
authorized Connector origin. Capture the pseudonymized output only in the
company-approved restricted evidence system:

```powershell
node platform/scripts/shopify-protected-data-access-review.mjs --base-url <authorized-connector-origin>
node --test platform/scripts/shopify-protected-data-access-review.test.mjs
```

`--allow-http-loopback` is limited to an explicitly selected local test
runtime. The tool performs no write, completion, deletion, or retention action.

## Windows Maven/Mockito agent Unicode-cache gate

`windows-maven-agent-path-gate.mjs` is the offline, fail-closed Maven test
entrypoint for a Windows default Maven cache whose absolute path contains
non-ASCII characters. It first verifies a real regular `mvn.cmd` in PATH. If
PATH has no usable executable, it derives exactly
`%USERPROFILE%\\.codex\\tmp\\erp-production-readiness-toolchain\\maven\\apache-maven-3.9.11\\bin\\mvn.cmd`
from `homedir()`; the fallback rejects symlinks/reparse escapes and requires the
resolved file to remain inside the fixed toolchain root. It never accepts a
caller-supplied executable path.

On that exact platform/path combination only, it creates a random task-owned
ASCII NTFS junction under `X:\\Users\\Public`, points it to the current user's
existing `.m2\\repository`, and passes the junction only as the fixed
`maven.repo.local` argument to Maven/Surefire. It never copies or deletes the
cache; it rejects completion if the cache snapshot differs before versus after
Maven (including a Maven failure), verifies the junction target before cleanup,
and removes only the junction itself in `finally`. The Windows command line is
quoted as one controlled `cmd.exe` command with verbatim argument passing so
spaces and non-ASCII usernames are preserved.

```powershell
node --check platform/scripts/windows-maven-agent-path-gate.mjs
node --test platform/scripts/windows-maven-agent-path-gate.test.mjs
node platform/scripts/windows-maven-agent-path-gate.mjs
node platform/scripts/windows-maven-agent-path-gate.mjs --full
```

The smoke entrypoint runs seven fixed Mockito-backed test classes and requires
each class to execute at least one test. `--full` runs the complete Maven test
suite. Both use `--offline`, require zero Surefire failures, errors, and skips,
and fail if Maven, verified Java 25, the cache, the safe
junction parent, reports, cache snapshot, or cleanup is unavailable. A valid
existing `JAVA_HOME` is verified; when it is absent, only the fixed
homedir-derived JDK 25.0.4+7 layout is allowed. The child process receives the
verified `JAVA_HOME` and puts its `bin` before the controlled Maven bin in PATH.
On non-Windows or a pure-ASCII default cache path, no junction or Maven
repository override is created. This gate never downloads, copies, or upgrades
dependencies.

## Backend and Web container runtime minimum-privilege gate

`container-runtime-security-gate.mjs` is the fixed-image, fixed-Compose,
fail-closed Docker Desktop Linux gate for backend/Web runtime identity,
read-only root filesystems, zero Linux capabilities, `no-new-privileges`,
bounded `/tmp`, healthcheck/port contracts, and effective container UID/GID and
kernel security state.

```powershell
node --check platform/scripts/container-runtime-security-gate.mjs
node --check platform/scripts/container-runtime-security-gate.test.mjs
node --test platform/scripts/container-runtime-security-gate.test.mjs
node platform/scripts/container-runtime-security-gate.mjs
```

It accepts no input, uses only `--pull=never`
`xz-erp-local-backend:latest` and `xz-erp-local-web:latest`, normalizes Compose
without environment interpolation, reports only stable issue codes, and
requires `skipped=0`. Rebuild the fixed images from the current repository
before running it. Exact contracts, integration commands, evidence boundaries,
and limitations are documented in
[the container runtime minimum-privilege gate](../docs/container-runtime-security-gate.md).

## Deserialization and dynamic code-execution surface gate

`dynamic-code-execution-gate-check.mjs` is the fixed-root, offline,
fail-closed source and runtime-result gate for Jackson polymorphism, native
serialization, XML/YAML construction, expression/template/script engines,
JNDI/LDAP/RMI, reflective loading, process execution, query construction, and
log lookup/input surfaces. It accepts no arguments, path, URL, environment,
credential, or other input; rejects symbolic sources; reads no `.env`; and
requires the real Spring/PostgreSQL 16 suite to report exactly four tests with
zero failures, errors, and skips.

```powershell
node --check platform/scripts/dynamic-code-execution-gate-check.mjs
node --check platform/scripts/dynamic-code-execution-gate-check.test.mjs
node --test platform/scripts/dynamic-code-execution-gate-check.test.mjs
node platform/scripts/dynamic-code-execution-gate-check.mjs
```

The source fact matrix, inert-canary rules, exact offline Maven/PG16 command,
audit boundary, evidence, stop condition, and limitations are
documented in
[the deserialization and dynamic code-execution surface gate](../backend/docs/dynamic-code-execution-surface-gate.md).

## Observability exposure and cardinality gate

The fixed-root checker and its evidence contract are documented in
[`observability-boundary-gate.md`](../backend/docs/observability-boundary-gate.md).
Run the real Spring/PostgreSQL 16 test and real Nginx JUnit reporter first, then
run:

```powershell
node platform/scripts/observability-boundary-gate-check.mjs
node --test platform/scripts/observability-boundary-gate-check.test.mjs
```

The checker accepts no arguments or environment-supplied target. Missing,
stale, failed, zero-test, or skipped runtime evidence is a hard failure.

## HTTP routing trust boundary gate

`http-routing-boundary-gate.mjs` locks the current Nginx proxy URI, Spring path
matching/method-override, trust-domain, production Tomcat parser-log, and
server-wide query-free access-log facts. It is offline, repository-locked,
rejects external input and symbolic sources, reads no process environment, and
reports `skipped=0`.

```powershell
node --check platform/scripts/http-routing-boundary-gate.mjs
node platform/scripts/http-routing-boundary-gate.mjs
node --test platform/scripts/http-routing-boundary-gate.test.mjs
node --test platform/scripts/http-routing-edge-runtime.test.mjs
```

The exact production-profile Spring/PostgreSQL 16 command, path/method/session
matrix, edge/direct differences, redaction evidence, Content-Length /
Transfer-Encoding limitation, and responsibility boundary are documented in
[the HTTP routing trust boundary gate](../backend/docs/http-routing-trust-boundary-gate.md).

## Frontend build and static-delivery security gate

`frontend-build-security-gate.mjs` is the offline, fixed-root, fail-closed
scanner for the formal Vite `dist` tree and the repository Nginx static
boundary. It accepts no input, reads no environment or user configuration,
rejects missing/aliased/unbounded artifacts, reports no matched values, and
always reports `skipped=0`.

```powershell
node --check platform/scripts/frontend-build-security-gate.mjs
node platform/scripts/frontend-build-security-gate.mjs
node --test platform/scripts/frontend-build-security-gate.test.mjs
node --test platform/scripts/frontend-static-runtime.test.mjs
```

The runtime test requires only the already-local
`xz-erp-local-web:latest` image and uses `--pull=never`. Missing Docker or image
state is a hard failure. Build rules, the narrowly locked TanStack Router
dependency constant, Nginx path matrix, responsibility boundary, evidence, and
limitations are documented in
[the frontend delivery security gate](../frontend/docs/frontend-delivery-security-gate.md).

## Browser origin and request-authority trust boundary gate

`browser-origin-trust-boundary-gate.mjs` is the offline companion to the real
Spring/PG16 browser-origin integration gate. It locks the current stateless
bearer, no-authentication-cookie, no-CORS-policy, relative-Location, and
repository-edge forwarding facts. It fails if those facts drift without
review, accepts no external path/origin/URL/credential input, performs no
network or Docker operation, does not read `.env`, and reports `skipped=0`.

```powershell
node --check platform/scripts/browser-origin-trust-boundary-gate.mjs
node platform/scripts/browser-origin-trust-boundary-gate.mjs
node --test platform/scripts/browser-origin-trust-boundary-gate.test.mjs
```

The executable runtime coverage, fact matrix, responsibility boundary, and
production GAPs are documented in
[the browser-origin trust boundary gate](../backend/docs/browser-origin-trust-boundary-gate.md).

## Nginx API access-log redaction gate

`nginx-api-access-log-gate.mjs` is an offline, fail-closed check of the
repository-owned Nginx server-wide access-log schema. It locks the repository root,
reads only the regular non-symbolic `platform/frontend/nginx.conf`, accepts no
path, URL, environment, credential, or other input, performs no network or
Docker operation, and reports `skipped=0`.

The server-default `api_access` JSON format allows only `time`, direct `peer`,
`method`, query-free normalized `path`, `status`, response `bytes`, and
`duration`. The gate rejects schema drift and any log variable derived from a
query string, request/header/cookie/authorization value, request body,
response header, filesystem/internal path, authenticated user, or upstream.
Health and readiness endpoints retain `access_log off`.

Run the offline gate and its positive/negative tests from the repository root:

```powershell
node --check platform/scripts/nginx-api-access-log-gate.mjs
node platform/scripts/nginx-api-access-log-gate.mjs
node --test platform/scripts/nginx-api-access-log-gate.test.mjs
```

The separate real-container test uses only the already-local
`xz-erp-local-web:latest` image and the repository Nginx configuration. It
creates its own disposable stub backend, Docker networks, edge container,
loopback port, and temporary files; it removes them in `finally`. Missing
Docker or image state is a hard failure and never triggers a pull or skip.

```powershell
node --test platform/scripts/nginx-api-access-log-runtime.test.mjs
```

The runtime gates run `nginx -t`, prove successful proxying plus 404/503,
malformed URI, and cross-location logging, and read only their own edge
container logs. They inject query,
Referer, Authorization, Cookie, Origin, Forwarded/X-Forwarded, Host, and
User-Agent canaries and proves none of them or the stub upstream details are
present. It also proves the currently deliberate fact that `/healthz` and
`/readyz` do not create access-log records.

## API contract gate

`api-contract-gate.mjs` is the offline, source-derived Spring API contract
gate. It compares the real Controller/DTO/exception/security sources with the
integrity-checked baseline at
`../contracts/api-contract-baseline.json`. It fails closed for breaking
endpoint, trust-domain, authority, request-parameter/DTO, response, and
explicit error-mapping changes, and requires an explicit reviewed baseline
refresh for new endpoints. It accepts no repository path, URL, environment, or
credential input.

```powershell
node platform/scripts/api-contract-gate.mjs
node --test platform/scripts/api-contract-gate.test.mjs
```

Full scope, refresh procedure, coverage, and limitations are in the
[API contract gate document](../docs/api-contract-gate.md).

## Audit coverage and redaction gate

`audit-coverage-gate.mjs` consumes the passing API contract facts and requires
an explicit, source-verified classification for every write endpoint. It
distinguishes authentication/session security events, platform-admin
operations, tenant IAM operations, committed tenant business writes, and the
supplemental attempted-only platform-admin tenant-write filter.

```powershell
node --check platform/scripts/audit-coverage-gate.mjs
node platform/scripts/audit-coverage-gate.mjs
node --test platform/scripts/audit-coverage-gate.test.mjs
```

The command is offline, accepts no arguments or external root/path/URL, does
not inspect `.env`, never executes production source, rejects symbolic links,
and reports `skipped=0`. See the
[audit coverage and redaction gate document](../docs/audit-coverage-gate.md)
for the action/resource mapping, no-op semantics, PostgreSQL 16 coverage, and
capability boundary.

## API resource boundary gate

`api-resource-boundary-gate.mjs` derives the current list/DTO/server boundary
facts from the API contract extractor and committed runtime configuration. It
hard-gates only existing explicit limits. Missing body-byte, decompression,
page-number, content-encoding, and duplicate-parameter policy remains a named
GAP and is not replaced with an invented threshold.

```powershell
node --check platform/scripts/api-resource-boundary-gate.mjs
node platform/scripts/api-resource-boundary-gate.mjs
node --test platform/scripts/api-resource-boundary-gate.test.mjs
```

The complete fact matrix, six-advice 415 mapping, real PostgreSQL 16 test
environment, runtime evidence, and responsibility boundary are in the
[API resource boundary gate document](../docs/api-resource-boundary-gate.md).

`local-uat-smoke.mjs` is a non-destructive, Node 24 ESM smoke check for the
local XZ ERP edge/UAT entrypoint. It checks edge liveness and edge-to-backend
readiness, authenticates a SYSTEM_ADMIN, reads system administrators and
enterprises, enters one enterprise by code, checks the tenant identity and
supplier list, and revokes both temporary sessions in the normal path and in
best-effort cleanup.

It does not create, update, archive, or delete business data. The only writes
are login/session creation and session revocation. It does not read browser
storage, `.env` files, production configuration, or real secrets.

## Usage

PowerShell example (the value is a placeholder, not a repository secret):

```powershell
$env:XZ_ERP_UAT_PLATFORM_PASSWORD = '<placeholder-password>'
node platform/scripts/local-uat-smoke.mjs `
  --base-url http://127.0.0.1:18888 `
  --platform-username <platform-admin-username> `
  --tenant-code <tenant-code> `
  --supplier-code <supplier-business-code>
```

When `--supplier-code` is supplied, the CLI resolves exactly one matching
supplier inside the entered tenant and reads its first SKU-mapping page with a
strict V39 response contract. Omit the option to keep the original smoke scope.

The probe sequence always calls `<base-url>/healthz` first and accepts only
HTTP 200 with `text/plain` body `ok`, then calls `<base-url>/readyz` and
accepts only HTTP 200 with `text/plain` body `ready` (either body may have one
trailing newline). API requests continue through the same edge URL under
`/api/v1/**`.

Only `http://127.0.0.1` and `http://localhost` are accepted by default. The
compose UAT entrypoint is `http://127.0.0.1:18888`. A
non-loopback or otherwise isolated address requires an explicit
`--allow-non-loopback` flag. Passwords are accepted only through
`XZ_ERP_UAT_PLATFORM_PASSWORD`; plaintext password command-line flags are
rejected.

Run the built-in tests with:

```powershell
node --test platform/scripts/local-uat-smoke.test.mjs
```

The CLI prints only check stages and safe failure classifications. It never
prints tokens, passwords, `Authorization`, full wire responses, or error
details.

## Server readiness checker

`server-readiness-check.mjs` is a separate static, read-only repository check.
It performs no network calls and does not inspect `.env`, process environment
values, credentials, running containers, or Docker state. It checks required
files, the accepted sparse Flyway baseline/order rules, committed
compose/example secret literals, and fail-closed production-profile defaults.

Run it and its Node 24 tests from the repository root:

```powershell
node platform/scripts/server-readiness-check.mjs
node --test platform/scripts/server-readiness-check.test.mjs
node --check platform/scripts/server-readiness-check.mjs
```

Exit code `0` means every static rule passed, `1` means a readiness rule failed,
and `2` means invocation/internal checker failure. Output contains only status,
rule name, and repository-relative location; matched content is never printed.

The current repository is expected to return `0` for its implemented static
rules. That result is not a production-readiness claim. Full scope and
limitations are in
[the server readiness requirements](../docs/server-readiness-requirements.md#13-readiness-checker).

## Database resilience PostgreSQL 16 gate

The database resilience gate starts a one-time PostgreSQL 16 Testcontainers
instance and the real production-profile application. It verifies the
liveness/readiness split, bounded pool exhaustion, database outage and
same-process recovery, protected supplier GET and warehouse POST fail-closed
behavior, redaction, wrong-credential behavior, supplier tenant isolation, and
absence of a failed warehouse write or warehouse success audit record.

After the Maven runtime test, run the fixed-root checker and its tests:

```powershell
node platform/scripts/database-resilience-gate-check.mjs
node --test platform/scripts/database-resilience-gate-check.test.mjs
node --check platform/scripts/database-resilience-gate-check.mjs
```

The checker accepts no arguments or external inputs. Exact Docker Desktop and
Maven commands, the production threshold fact matrix, and capability
limitations are in the
[database resilience PG16 gate](../backend/docs/database-resilience-pg16-gate.md).

## Flyway production migration rehearsal

`flyway-migration-rehearsal.mjs` is a fail-closed local/CI gate for the
repository's immutable Flyway history and an isolated PostgreSQL 16 migration
rehearsal. It is not a production migration job or release orchestrator.

The default command:

- verifies strict, unique migration versions and every SHA-256 in
  `flyway-migration-manifest.json`;
- refuses changed, removed, duplicated, malformed, or newly inserted historical
  migrations;
- starts its own one-use PostgreSQL 16 container from the exact digest pinned in
  `platform/compose.yaml`, bound to a random loopback port;
- uses the repository's Maven/Flyway dependency lock in offline mode to prove an
  empty database migration, V38-to-latest upgrade, validation, and hard failure
  for duplicate and tampered migrations;
- requires an evidence record with zero skipped checks and never starts the ERP
  application; and
- removes only the temporary directory and container whose random ownership
  marker it verifies.

It does not accept a database URL, reuse a running ERP database, read `.env` or
database credential environment variables, print a password/JDBC URL, pull an
image, deploy, or connect to a non-loopback target. Docker, Java 25, Maven, the
pinned PostgreSQL image, and already-cached Maven dependencies are prerequisites.
Missing prerequisites are a hard failure, never a skip.

Run from the repository root:

```powershell
node platform/scripts/flyway-migration-rehearsal.mjs --check-only
node platform/scripts/flyway-migration-rehearsal.mjs
node --test platform/scripts/flyway-migration-rehearsal.test.mjs
node --check platform/scripts/flyway-migration-rehearsal.mjs
```

Future migration update procedure:

1. Read the highest version in the repository and the target database.
2. Add only reviewed migrations above both current maxima.
3. Run
   `node platform/scripts/flyway-migration-rehearsal.mjs --update-manifest`.
   Historical names and hashes must still match. The command runs the full PG16
   rehearsal before writing the new deterministic manifest entry.
4. Review and commit the new SQL and manifest change together.

`--update-manifest` cannot bless an edit, removal, rename, duplicate, or
lower/equal version. It never writes a migration SQL file.

## JPA/Flyway schema drift PostgreSQL 16 gate

The schema drift gate applies the real Flyway V1→V39 history to a one-use
`postgres:16-alpine` database, boots Hibernate with `ddl-auto=validate`, and
compares all current JPA entity mappings with PostgreSQL catalog facts. It also
checks critical constraints, indexes, optimistic locking, delete behavior, and
tenant composite references, including deliberate negative schema mutations.

Run the fixed-root result checker and its tests after the Maven runtime gate:

```powershell
node platform/scripts/schema-drift-gate-check.mjs
node --test platform/scripts/schema-drift-gate-check.test.mjs
node --check platform/scripts/schema-drift-gate-check.mjs
```

The exact cached Maven Docker command, responsibility split, classifications,
and limitations are in the
[JPA/Flyway schema drift PG16 gate](../backend/docs/jpa-flyway-schema-drift-pg16-gate.md).
