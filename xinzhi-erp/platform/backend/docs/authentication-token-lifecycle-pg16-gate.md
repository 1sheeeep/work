# Authentication Token Lifecycle PostgreSQL 16 Gate

## Purpose

`AuthenticationTokenLifecyclePostgresql16GateTest` is the fail-closed runtime
gate for the existing XZ ERP bearer-session and one-time password-credential
contracts. It boots the real Spring application and
`springSecurityFilterChain`, migrates one test-owned
`postgres:16-alpine` Testcontainers database through Flyway V39, uses synthetic
identities only, and destroys the container after the suite. Docker,
Testcontainers, PostgreSQL, migration, or test startup failure is a gate
failure; there is no skip path.

The gate was established from `main` baseline
`ca4b69228292ae1b30b8c9e59f4997a5401e425c`. It does not define a new product
contract. Its assertions preserve the existing controller status codes,
idempotency behavior, permission boundaries, state transitions, and error
envelopes.

## Covered trust domains and lifecycle facts

| Trust domain | Positive lifecycle | Fail-closed and replay coverage |
| --- | --- | --- |
| Tenant user session | Login issues a unique 43-character bearer token; own tenant business and identity requests succeed. | Logout, own-session revocation, user disable, tenant suspension, password reset, and `expires_at == now` make the old token unusable. A tenant cannot revoke another tenant's session. |
| `SYSTEM_ADMIN` base session | Login and platform administration succeed for an active administrator. | Logout, administrator disable/delete, password reset, and `expires_at == now` make the old token unusable. A base token cannot act as a tenant token. |
| `SYSTEM_ADMIN` tenant session | Entering an active tenant issues a distinct token bounded by its base session and tenant. | Leaving the tenant, base-session logout/expiry, administrator disable/delete, tenant suspension, and tenant-session expiry deny subsequent tenant access. A tenant-session token cannot access base-session routes. |
| Tenant password credential | Activation/reset issue returns the existing one-time issuance response; redemption activates or resets the subject. | Revoked, consumed, expired-at-boundary, deleted/disabled subject, and replayed credentials fail with the existing uniform `400` error. PostgreSQL locking permits one concurrent redemption transition and one success audit. |
| Platform password credential | Activation/reset issue returns the existing one-time issuance response; redemption activates or resets the administrator. | Revoked, consumed, expired-at-boundary, deleted subject, and replayed credentials fail with the existing uniform `401` error. PostgreSQL locking permits one concurrent redemption transition and one success audit. |

Generated session and credential tokens are stored only as 64-character
SHA-256 hashes. The formal issuance endpoints return a raw one-time credential
once; this is the existing delivery contract. Credential redemption and
password-reset responses are empty, and their audit details and captured
application logs contain neither raw tokens, passwords, nor their hashes.

Forged 43-character tokens, malformed token lengths or alphabets, wrong
credentials, and repeated low-cost failures must not return `500`, create a
success audit, or expose request secrets. Failed login attempts retain the
existing failure-audit contract.

## Concurrency responsibility boundary

One-time credential redemption is single-winner: concurrent requests produce
one `204` and one existing safe credential error (`400` for tenant credentials,
`401` for platform credentials), one password state, and one redemption/reset
success audit.

Logout is already an idempotent `204` contract once a request has authenticated.
Two requests may both pass bearer authentication before either transaction
commits, so concurrent callers may observe `204/204`; a later request observes
`401`. The gate therefore requires only `204` or `401` responses, at least one
`204`, one persisted revocation, and exactly one revocation audit. It does not
silently redefine idempotent logout as a conflict API.

## Fixed-root checker

`platform/scripts/auth-token-lifecycle-gate-check.mjs` reads only the canonical
Surefire report under this repository root. It accepts no report path, URL,
JDBC value, credential, or `.env` argument and rejects database, credential,
report-path, and dotenv environment overrides. It also rejects missing,
aliased, stale, empty, failed, errored, or skipped reports; missing required
test cases; and missing runner evidence for:

- live Docker API negotiation evidence;
- Testcontainers `1.21.4`;
- owned image `postgres:16-alpine`;
- a live PostgreSQL 16 server;
- Flyway V39.

## Docker Desktop command

The Maven and PostgreSQL images must already exist locally. From the repository
root in PowerShell:

```powershell
$backendPath = (Resolve-Path 'platform/backend').Path
docker run --rm --pull never `
  -v /var/run/docker.sock:/var/run/docker.sock `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -v "${backendPath}:/workspace" `
  -v erp-maven-cache:/root/.m2 `
  -w /workspace `
  maven:3.9.11-eclipse-temurin-25 `
  mvn -B `
  '-Dtest=AuthenticationTokenLifecyclePostgresql16GateTest' test
node platform/scripts/auth-token-lifecycle-gate-check.mjs
node --test platform/scripts/auth-token-lifecycle-gate-check.test.mjs
```

A missing local image, Docker socket incompatibility, absent API-version
property, zero tests, or any skipped test is a failed gate.

## Change and ownership boundaries

This gate changes only tests, the test-owned fixture, its fixed-root checker,
and this responsibility document. It changes no production Java, API shape,
permission code, database ownership, error envelope, state machine, dependency
version, production configuration, or migration. V1 through V39 are unchanged,
and V40 remains unallocated and unused.

The gate validates application behavior before an external proxy and does not
claim distributed revocation across another database, browser-side token
storage policy, edge access-log policy, production secret management, or
production deployment readiness. Those remain release-integration
responsibilities.
