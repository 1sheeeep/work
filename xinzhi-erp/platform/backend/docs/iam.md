# IAM foundation

This module is the first identity and access-management boundary for XZ ERP. It
owns tenants, user accounts, roles, global permission definitions, tenant-local
assignments, authentication sessions, and security audit events. It does not
provision a bootstrap administrator and contains no default password or signing
secret.

## Domain and tenant boundary

- `tenants` is the root boundary. Users, roles, assignments, sessions, and audit
  events carry a non-null `tenant_id`.
- Repository methods that read tenant-owned aggregates require `tenantId`; an
  unscoped username or role-code lookup is intentionally absent.
- V10 adds composite foreign keys for user-role, role-permission, session, and
  audit relationships. A caller cannot associate a user or role from another
  tenant even if application filtering is wrong.
- After bearer authentication, `TenantContext.currentTenantId()` is populated
  from the verified session for the duration of the request and always cleared
  in a `finally` block. Request headers and request bodies never select the
  authenticated tenant.
- Feature permission and data scope are separate concepts. This phase implements
  feature permissions only; shop/data-scope grants belong to a later module.

## Password and login contract

Provisioning code must call `PasswordHashingService.hashForStorage(char[])`.
It enforces a 12–128 character boundary, writes only a Spring self-describing
Argon2id hash, and clears the caller-provided character array. Login verification
continues to accept existing self-describing BCrypt hashes so the upgrade does
not force an immediate password migration. Plaintext passwords must never be
persisted, logged, placed in audit details, or returned.

`POST /api/v1/auth/login` accepts:

```json
{
  "tenantCode": "acme",
  "username": "operator",
  "password": "supplied-out-of-band"
}
```

Tenant codes are lowercase canonical identifiers. Usernames are case-sensitive.
Every invalid tenant, username, password, disabled user, or disabled tenant
returns the same `401 invalid_credentials` response. A successful response
contains a 256-bit URL-safe opaque bearer token and expiry (eight hours by
default, configurable with `ERP_SESSION_TTL`, maximum 24 hours).

Successful login response:

```json
{
  "tokenType": "Bearer",
  "accessToken": "<opaque-256-bit-token>",
  "expiresAt": "2026-07-28T20:00:00Z",
  "tenant": {
    "id": "10000000-0000-0000-0000-000000000001",
    "code": "acme",
    "name": "Acme"
  },
  "user": {
    "id": "20000000-0000-0000-0000-000000000001",
    "username": "operator",
    "displayName": "Operator"
  },
  "permissions": ["orders.read"]
}
```

Only the SHA-256 digest of the bearer token is stored in `auth_sessions`. Clients
send the raw value as `Authorization: Bearer <token>`. `GET /api/v1/auth/me`
returns the same verified identity without credentials:

```json
{
  "tenant": {
    "id": "10000000-0000-0000-0000-000000000001",
    "code": "acme",
    "name": "Acme"
  },
  "user": {
    "id": "20000000-0000-0000-0000-000000000001",
    "username": "operator",
    "displayName": "Operator"
  },
  "permissions": ["orders.read"],
  "expiresAt": "2026-07-28T20:00:00Z"
}
```

The current V1 schema does not own a user email, so `email` is omitted rather
than synthesized. A future additive migration may add it to the `user` object as
an optional field. Tenant, user, permissions, and expiry in `/me` are derived
only from the authenticated server-side session; no request tenant selector is
accepted.

`DELETE /api/v1/auth/session` revokes the current session and returns `204`.
`PUT /api/v1/auth/password` accepts `currentPassword` and `newPassword`,
requires the current tenant-user session, and returns `204`. A wrong current
password uses the same `401 invalid_credentials` envelope. The password hash
changes atomically without revoking the current session or any other session.
The same transaction revokes every unconsumed, non-revoked activation or reset
credential for that account; already consumed credentials remain historical
records. Administrator password resets use the same credential-revocation and
session-preservation rules.
SYSTEM_ADMIN base sessions use
`PUT /api/v1/platform-admin/auth/password` with the same session-preservation
and open-credential revocation rules. TLS is mandatory outside isolated local
development.

Authentication and authorization failures use one JSON envelope. `details` may
be added later without changing `code` semantics:

```json
{
  "code": "authentication_required",
  "message": "Authentication is required"
}
```

- Invalid login: HTTP 401, `invalid_credentials`.
- Locked account or threshold-reaching failure: HTTP 429,
  `login_rate_limited`, with an integer `Retry-After` header.
- Invalid login fields: HTTP 400, `validation_failed`.
- Malformed or unreadable login JSON: HTTP 400, `invalid_request`.
- Missing, malformed, expired, or revoked bearer session: HTTP 401,
  `authentication_required`.
- Authenticated identity without a required authority: HTTP 403,
  `permission_denied`.

Account creation is covered by phase two and password activation/reset token
exchange by phase three. MFA, external credential delivery, and broader
recovery workflows remain required production-hardening work.

### Distributed account login throttling

V35 adds PostgreSQL-persistent, account-level login failure state keyed by
`tenant_id` and `user_id`. The composite foreign key can reference only a user
from the same tenant, and the table stores only failure count, window start,
lock expiry, and update time. It never stores tenant codes, usernames,
passwords, request bodies, tokens, hashes, IP addresses, or other presented
credentials. Unknown tenants and usernames still perform the existing dummy
password-hash verification but never create a throttle row, so attacker input
cannot cause unbounded table growth.

The default policy is five consecutive failures within 15 minutes followed by
a 15-minute lock. The fifth failure enters the lock and returns:

```json
{
  "code": "login_rate_limited",
  "message": "Too many failed login attempts"
}
```

The HTTP status is `429`; `Retry-After` is an integer number of seconds between
1 and the configured lock duration. A request made while locked still performs
password-hash verification before returning the same response. Invalid
passwords, disabled users, and users in non-active tenants count equally.
Failures before the threshold retain the generic `401 invalid_credentials`
contract. An expired failure window or lock starts a new window on the next
failure.

Configuration is server-side and shared across local, staging, and production:

```text
ERP_LOGIN_THROTTLE_MAX_FAILURES=5
ERP_LOGIN_THROTTLE_WINDOW=PT15M
ERP_LOGIN_THROTTLE_LOCK_DURATION=PT15M
```

The threshold is bounded to 2-100. Both durations are bounded to 1 minute-24
hours, and invalid values prevent application startup. PostgreSQL row locking
serializes concurrent failures across application instances. State and the
single `iam.login.throttled` transition audit commit in an independent
transaction so the subsequent 401/429 cannot roll them back. The throttled
audit has a null actor, the user UUID as resource, no source IP, and only
`maxFailures`, `windowSeconds`, and `lockDurationSeconds` details.

A successful password verification locks and clears any expired failure state
inside the same transaction that creates the session, reads permissions, and
writes `iam.login.succeeded`. If a concurrent request has already locked the
account, success is denied with the same 429. A transaction failure restores
the previous throttle state and creates no session.

This is distributed account-level protection, not an IP/WAF substitute. Online
deployments still require gateway-level IP and abuse throttling. This phase
does not add Redis, an unlock API, proxy-header/IP policy, MFA, notification, or
automatic administrative recovery.

## Permission code contract

Permissions are global definitions assigned through tenant-owned roles. Codes
use stable lowercase segments with one consistent delimiter. Core business
permissions may use dotted identifiers, while the platform/shop integration
contract uses colon identifiers:

```text
<module>.<action>
orders.read
orders.approve
inventory.stock.adjust

platform:read
platform:write
shop:read
shop:write
shop:authorization:write
shop:sync:read
shop:sync:write
```

The Java `PermissionCode` value object and V10 database check constraint enforce
the same formats and reject mixed delimiters. `PlatformPermissionCodes` is the
source-level contract for the seven platform/shop codes. Defining a code never
grants it; tenant roles must bind every permission explicitly.

Spring Security authorities use the permission code verbatim. Method security is
enabled, so Shop Center endpoints can use checks such as
`@PreAuthorize("hasAuthority('shop:read')")`. `ErpPrincipal` exposes the record
accessor `tenantId()`, which supports
`@AuthenticationPrincipal(expression = "tenantId")`; tenant selection must not
fall back to an `X-Tenant-Id` header. Codes are API contracts: rename by adding a
new code, migrating grants, then retiring the old code rather than changing
meaning in place.

## Audit port contract

Security-sensitive application services publish `SecurityAuditEvent` through
`SecurityAuditRecorder`. The PostgreSQL adapter appends to `audit_logs` with:

- tenant and authenticated actor (actor is null for failed login);
- stable action code (`iam.login.succeeded`, `iam.login.failed`,
  `iam.login.throttled`, `iam.session.revoked`);
- resource type/id, request id, source IP, and small structured details.

Audit details must never contain passwords, raw bearer tokens, password hashes,
credential material, or unnecessary personal data. Failed attempts for a known
tenant are audited. Unknown tenant codes cannot be written to the current
tenant-required audit schema and should additionally be covered by edge/service
rate-limit telemetry in a later operational layer.

Audit records are append-only by convention: application code exposes no update
or delete repository. Retention and cross-tenant/system-wide audit access are
separate future work.

## Tenant IAM administration (phase two)

Tenant IAM administration is exposed under `/api/v1/iam`. The authenticated
`ErpPrincipal` is the only source of tenant and actor IDs. `X-Tenant-Id` is
ignored, and tenant-owned IDs from another tenant return the same
`404 resource_not_found` response as an unknown ID.

All collection responses use:

```json
{
  "items": [],
  "page": 0,
  "size": 20,
  "totalElements": 0,
  "totalPages": 0
}
```

`page` is zero based and bounded to 1,000,000. `size` defaults to 20 and is
bounded to 1-100.

The current IAM user and role schemas have no soft-delete column. A missing
tenant-scoped row, including a cross-tenant ID, therefore has the single safe
`404 resource_not_found` interpretation.

### Members

- `GET /api/v1/iam/members` requires `iam:user:read`.
- `POST /api/v1/iam/members` requires `iam:user:write` and accepts only
  `username`, `displayName`, `initialPassword`, and `roleIds`.
- `PATCH /api/v1/iam/members/{userId}` requires `iam:user:write` and accepts
  `displayName` plus the current `version`.
- `PUT /api/v1/iam/members/{userId}/status` requires `iam:user:write` and
  accepts `ACTIVE` or `DISABLED` plus the current `version`.
- `GET /api/v1/iam/members/{userId}/roles` requires `iam:role:read` and
  returns the current tenant-scoped assignment IDs plus the member version.
- `PUT /api/v1/iam/members/{userId}/roles` requires `iam:role:write`.
- `PUT /api/v1/iam/members/{userId}/password` requires `iam:user:write`,
  accepts `newPassword` plus the current `version`, and returns 204.

New members are created in one transaction as `ACTIVE`, with an Argon2id hash,
the selected tenant-local roles, and `version = 0`. The username is immutable.
The response and audit row contain neither password nor hash, and direct
creation does not issue a `password_credentials` row. An enterprise
administrator may manage ordinary members; it cannot manage itself, another
protected enterprise administrator, or assign a protected system role. An
entered SYSTEM_ADMIN tenant session is the highest-privilege actor and may use
tenant IAM management writes, including protected enterprise-administrator
changes and protected system-role assignment, while remaining bound to the
selected tenant and the tenant-write audit trail. Password resets preserve
every existing session. There is no hard-delete endpoint.

### Member warehouse data scope (V40)

- `GET /api/v1/iam/members/{userId}/warehouse-scope` requires
  `iam:warehouse:scope:read`.
- `PUT /api/v1/iam/members/{userId}/warehouse-scope` requires
  `iam:warehouse:scope:write` and accepts only `version`, `mode`, and
  `warehouseIds`.
- `ALL` requires an empty ID list. `SELECTED` de-duplicates IDs and may be
  empty, which means deny all warehouses.

Only the tenant administrator and a SYSTEM_ADMIN in an entered tenant session
may govern the current tenant's member scopes. A tenant administrator has an
immutable synthetic `ALL` scope and no scope row; a modification returns
`409 protected_scope`. Unknown and cross-tenant members return the same 404.
For ordinary members, replacement locks the scope row, verifies its optimistic
version, locks newly added warehouses in stable UUID order, validates those
additions as same-tenant and not archived, then replaces the item set in one
transaction. Retained historical items are not revalidated, so a warehouse
archived after assignment can remain selected or be removed.

Warehouse feature permissions remain independent and are checked first.
Warehouse and location reads expose only allowed warehouses; a selected-empty
scope returns an empty warehouse page, and an unknown, cross-tenant, or
out-of-scope resource returns the same 404. Creating a warehouse requires
`ALL`; creating or changing a location requires visibility of its parent.
Archiving a warehouse retains historical scope items, but an archived warehouse
cannot be newly selected.

V40 initializes existing ordinary users with effective `warehouses.read` or
`warehouses.write` to `ALL`, and all other ordinary users to selected-empty.
New ordinary users always start selected-empty in the same creation
transaction. Role or feature-permission changes never expand this scope.
The update audit records only modes, counts, the scope version, and the normal
top-level request ID; it never records the selected ID list or request body.

### Roles and permissions

- `GET /api/v1/iam/roles` requires `iam:role:read`.
- `POST /api/v1/iam/roles` and `PATCH /api/v1/iam/roles/{roleId}` require
  `iam:role:write`.
- `GET /api/v1/iam/permissions` requires `iam:permission:read`; the global
  permission catalog is read-only.
- `GET /api/v1/iam/roles/{roleId}/permissions` requires
  `iam:permission:read` and returns the current assignment IDs plus the role
  version. Protected system roles are readable through this endpoint.
- `PUT /api/v1/iam/roles/{roleId}/permissions` requires
  `iam:permission:assign`.

Role codes are immutable after creation. API-created roles are never system
roles. Existing system roles cannot be updated or have their permission set
replaced through this API.

Both assignment write endpoints use complete replacement:

```json
{
  "ids": [
    "70000000-0000-0000-0000-000000000001"
  ],
  "version": 3
}
```

Both assignment query endpoints return the same minimal aggregate view:

```json
{
  "resourceId": "70000000-0000-0000-0000-000000000001",
  "assignmentIds": [
    "71000000-0000-0000-0000-000000000001"
  ],
  "version": 3
}
```

The caller must supply the aggregate's current version. Replaying the same set
with the current version is idempotent and does not increment the version or
write another audit event. A stale version returns
`409 optimistic_lock_conflict`.

### Audit query

`GET /api/v1/iam/audit-logs` requires `iam:audit:read`, is tenant-scoped, and
orders by `createdAt DESC, id DESC`. It supports exact `action` and
`resourceType` filters plus an optional half-open `[from,to)` time window.
Explicit time filters are limited to 90 days; a missing bound is filled to keep
the same maximum window.

Management writes record the authenticated actor, stable action, resource ID,
request ID, source IP, and a small whitelisted change summary in the same
transaction as the mutation. Password, token, secret, credential and personal
contact detail keys are rejected by the audit event contract.

The phase-two authorization codes are:

```text
iam:user:read
iam:user:write
iam:role:read
iam:role:write
iam:permission:read
iam:permission:assign
iam:audit:read
```

They are source contracts only. V21 creates no permission records, roles,
users, grants, passwords, or administrators.

### Administration errors

Administration errors retain the lowercase `{code,message}` envelope:

- malformed body or parameter: HTTP 400, `invalid_request`;
- validation or pagination failure: HTTP 400, `validation_failed`;
- unknown or cross-tenant resource: HTTP 404, `resource_not_found`;
- uniqueness or assignment race: HTTP 409, `conflict`;
- stale aggregate version: HTTP 409, `optimistic_lock_conflict`;
- protected system role: HTTP 409, `system_role_protected`;
- unexpected internal failure: HTTP 500, `internal_error`.

### Direct enterprise-administrator administration

SYSTEM_ADMIN base sessions create tenants through
`POST /api/v1/platform-admin/tenants`; the request includes
`adminUsername`, `adminDisplayName`, and `adminInitialPassword`. The tenant,
protected `tenant_admin` role, ACTIVE enterprise administrator, Argon2id hash,
permission assignments, and audit records commit together. The response
contains the tenant and enterprise-administrator view only.

Additional enterprise administrators use
`POST /api/v1/platform-admin/tenants/{tenantId}/enterprise-admins` with
`username`, `displayName`, and `initialPassword`. The username is immutable.
`PUT /api/v1/platform-admin/tenants/{tenantId}/enterprise-admins/{userId}`
changes `displayName` and `status` with the current `version`.
`PUT /api/v1/platform-admin/tenants/{tenantId}/enterprise-admins/{userId}/password`
resets the password with the current `version` and returns 204. Unknown,
cross-tenant, and tenant users without the protected role share
`404 resource_not_found`. Password changes do not revoke existing sessions,
and no direct operation creates or returns an activation credential.

## Member activation and password reset (phase three)

Phase three one-time password credentials remain as a compatibility API and
are not the default member-creation or enterprise-administrator flow. No
historical table, migration, or endpoint is removed. When explicitly used,
administrators deliver the returned opaque token through an approved
out-of-band channel. The plaintext token appears only in the successful
creation response; only its SHA-256 hash is stored.

`POST /api/v1/iam/members/{userId}/password-credentials` requires
`iam:user:write` and accepts:

```json
{
  "purpose": "ACTIVATION",
  "expiresInMinutes": 30
}
```

`purpose` is `ACTIVATION` or `PASSWORD_RESET`. `expiresInMinutes` is optional,
defaults to 30, and is bounded to 5–120. The default is configurable with
`ERP_PASSWORD_CREDENTIAL_TTL` but must remain inside the same bounds. A
successful response is HTTP 201:

```json
{
  "id": "81000000-0000-0000-0000-000000000001",
  "purpose": "ACTIVATION",
  "token": "<opaque-256-bit-token>",
  "expiresAt": "2026-07-28T14:30:00Z"
}
```

Issuing another open credential for the same member and purpose revokes the
previous one. `ACTIVATION` can be issued and redeemed only while the member is
`DISABLED`; redemption sets the account to `ACTIVE`. `PASSWORD_RESET` is valid
for `ACTIVE` or `DISABLED` members and preserves that status. Administrators
cannot issue either purpose for themselves. Cross-tenant and unknown member or
credential IDs return the same `404 resource_not_found`.

`DELETE /api/v1/iam/members/{userId}/password-credentials/{credentialId}`
requires
`iam:user:write` and returns 204. Repeating a revoke for the same scoped
credential is idempotent. There is no endpoint that re-reads plaintext tokens
or exposes stored credential material.

`GET /api/v1/iam/members/{userId}/password-credentials?page&size` requires
`iam:user:read` and returns only tenant-scoped credential metadata in
`createdAt DESC, id DESC` order:

```json
{
  "items": [
    {
      "id": "81000000-0000-0000-0000-000000000001",
      "purpose": "PASSWORD_RESET",
      "status": "REVOKED",
      "expiresAt": "2026-07-28T14:30:00Z",
      "createdAt": "2026-07-28T14:00:00Z",
      "consumedAt": null,
      "revokedAt": "2026-07-28T14:10:00Z"
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

The derived status is `CONSUMED`, `REVOKED`, `EXPIRED`, or `ACTIVE`, in that
terminal-state precedence. The response never contains the plaintext token,
token hash, creator ID, tenant ID, password data, or audit details. Unknown and
cross-tenant members return `404 resource_not_found`.

Public redemption accepts no tenant or user selector:

```http
POST /api/v1/auth/password-credentials/redeem
Content-Type: application/json
```

```json
{
  "token": "<opaque-256-bit-token>",
  "newPassword": "caller-supplied-password"
}
```

Success returns 204. In one transaction the service locks and consumes the
credential, writes an Argon2id hash, applies the purpose-specific status rule,
revokes every existing user session and other open password credentials, and
appends a sanitized audit event. Concurrent redemption has exactly one winner.
Unknown, expired, revoked, replayed, and status-incompatible credentials all
return the same safe response:

```json
{
  "code": "invalid_password_credential",
  "message": "Credential is invalid or expired"
}
```

The status is HTTP 400. Validation and malformed JSON retain
`validation_failed` and `invalid_request`. Request bodies reject unexpected
fields, including `tenantId`, `userId`, and `password` on the administrator
issuance endpoint.

V31 creates `password_credentials` with composite tenant foreign keys, a unique
SHA-256 token hash, purpose/state/expiry checks, a version column, and a partial
unique index that permits at most one open credential per tenant, user, and
purpose. It creates no users, credentials, roles, permissions, grants, passwords,
or seed data.

## Session visibility and forced sign-out (phase four)

Phase four reuses `auth_sessions` and adds no database migration. Tenant and
user scope come only from the authenticated `ErpPrincipal`; `X-Tenant-Id` is
ignored.

`GET /api/v1/auth/sessions` returns the authenticated user's sessions in
`createdAt DESC, id DESC` order. It uses the standard zero-based page envelope,
defaults to size 20, and limits size to 1–100:

```json
{
  "items": [
    {
      "id": "82000000-0000-0000-0000-000000000001",
      "createdAt": "2026-07-28T14:00:00Z",
      "expiresAt": "2026-07-28T22:00:00Z",
      "revokedAt": null,
      "current": true
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 1,
  "totalPages": 1
}
```

The response deliberately excludes token values and hashes, IP addresses,
headers, location, device data, and fingerprints. `current` compares each row
with `ErpPrincipal.sessionId`.

`DELETE /api/v1/auth/sessions/{sessionId}` revokes a session only when its
tenant and user match the authenticated principal. Unknown, other-user, and
cross-tenant IDs all return `404 resource_not_found`. Repeating a revoke for an
already revoked scoped session returns 204 and writes no second audit event.
Revoking the current session returns 204; its bearer fails authentication on
the next request. Each actual self-revocation records one
`iam.session.revoked` event.

## Initial tenant administrator bootstrap

V34 defines the canonical system-wide permission catalog with deterministic
UUIDs and code-idempotent metadata updates. It contains exactly these 20
permissions and creates no tenant, user, role, assignment, password, password
credential, or grant:

```text
platform:read
platform:write
shop:read
shop:write
shop:authorization:write
shop:sync:read
shop:sync:write
iam:user:read
iam:user:write
iam:role:read
iam:role:write
iam:permission:read
iam:permission:assign
iam:audit:read
products.read
products.write
products.listing.read
products.listing.write
orders.read
orders.write
```

The initial administrator bootstrap is disabled by default and has no HTTP
endpoint. It runs the normal backend image as a one-off, non-web process. The
same image, migration chain, configuration keys, and command shape are used
locally, in staging, and in production; only the image reference, database
configuration, mounted output directory, and secret injection differ.

Prepare an operator-owned directory on the Docker host. The output file itself
must not exist. Supply database secrets through the environment or the
environment's secret manager rather than placing them in shell history:

```sh
docker run --rm \
  --network <database-network> \
  --mount type=bind,src=/secure/erp-bootstrap,dst=/bootstrap-output \
  --env ERP_DB_URL \
  --env ERP_DB_USER \
  --env ERP_DB_PASSWORD \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_ENABLED=true \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_TENANT_CODE=acme \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_TENANT_NAME='ACME Tenant' \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_USERNAME=initial.admin \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_DISPLAY_NAME='Initial Administrator' \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_TOKEN_OUTPUT_PATH=/bootstrap-output/activation.token \
  --env ERP_BOOTSTRAP_INITIAL_ADMIN_TTL_MINUTES=30 \
  <the-same-backend-image-used-by-the-environment> \
  --spring.main.web-application-type=none
```

`ERP_BOOTSTRAP_INITIAL_ADMIN_TTL_MINUTES` must be between 5 and 120. The tenant
code, tenant name, username, display name, absolute container output path, and
TTL are all required. No initial password is accepted. If the tenant already
exists, it must be active, its supplied name must match, and it must not already
have a user assigned to `tenant_admin`.

The process takes a PostgreSQL transaction-scoped advisory lock keyed by tenant
code. It creates or reuses the eligible tenant, creates a protected system role
named `tenant_admin`, creates a disabled user with `password_hash = NULL`, binds
the explicitly reviewed `TenantAdminPermissionCodes.EXACT_CODES` set, and
creates an `ACTIVATION` credential. The permission consistency gate requires
that set to equal the current tenant-assignable permission catalog. A new
permission is not granted silently at runtime: the explicit contract must be
updated and pass review first.
`created_by_user_id` intentionally points to the new bootstrap user because no
authenticated actor exists before the first administrator. The database stores
only the SHA-256 token hash.

The raw activation token is written only to the requested new file. Creation
uses `CREATE_NEW`, never overwrites, and uses mode `0600` on Linux. The file and
its directory entry are forced to storage before the database transaction may
commit. A file failure rolls back the database, and a transaction rollback
removes a file created by that attempt. The token, token hash, output path, and
password never appear in stdout, logs, exceptions, or audit details.

Success is exit code zero plus the new activation file. Repeating bootstrap for
a tenant that already has a `tenant_admin` assignment fails without modifying
the existing administrator or issuing another token. There is no reissue mode.
The successful operation appends
`iam.bootstrap.admin_provisioned`; its actor and resource are the new user, and
its details contain only the role code, role UUID, and TTL.

The operator delivers the activation file through an approved secure channel.
The recipient redeems it through the existing
`POST /api/v1/auth/password-credentials/redeem` flow with a caller-chosen
password. Redemption writes an Argon2id password hash, changes the user to
`ACTIVE`, consumes the token once, and enables login with the exact
`tenant_admin` permission set.
