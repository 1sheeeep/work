# Cross-Module PostgreSQL 16 Concurrency Gate

## Purpose and change boundary

`CrossModulePostgresqlConcurrencyGateTest` verifies the concurrency semantics
already implemented by the XZ ERP backend. It adds no runtime behavior, API
shape, permission, state transition, dependency, or migration. `V40` remains
unallocated.

The gate starts its own `postgres:16-alpine` Testcontainers database, applies
Flyway through `V39`, boots the real Spring application and security filter
chain, creates isolated test tenants through the API, and removes the database
container at JVM shutdown. It has no external JDBC option, `.env` reader,
Compose dependency, production credential, or Docker-unavailable skip path.

Every concurrent pair uses two executor threads, a ready latch, a shared start
latch, and independent HTTP request transactions. The tests assert both HTTP
results and committed PostgreSQL state. The accompanying
`pg16-concurrency-gate-check.mjs` rejects a missing report, zero tests, any
failure/error/skip, an incomplete testcase count, or missing Testcontainers
1.21.4, PostgreSQL 16,
`postgres:16-alpine`, and Flyway V39 evidence.

## Fact-derived contract classification

| Area and writes | Classification from current code and schema | Executable coverage |
| --- | --- | --- |
| Order creation with `(tenant_id, idempotency_key)` | Formal idempotency. `CreateOrderRequest.idempotencyKey`, `OrderIdempotencyLock`, request fingerprint comparison, and `uq_tenant_orders_idempotency` define same-request replay and changed-request conflict per tenant. | Sequential same-body replay returns the same order; changed fingerprint is `409/resource_conflict`; simultaneous same-key requests create one order and one `order.created` audit; the same key in two tenants creates two orders. |
| Order status and line SKU match | Formal optimistic-concurrency contract. Both requests carry order `version`; stale versions use the existing conflict envelope. SKU match increments the order aggregate version. | Two different status writes at version 0 yield one success and one 409. Two different SKU matches at version 0 yield one success and one 409. Final version is 1, final state is one winner, and exactly one formal success audit commits. |
| Product SPU, SKU, and listing update/archive | Formal optimistic-concurrency contract. Requests carry `version`; entities inherit `@Version`; the API handler maps stale/commit conflicts to `409/resource_conflict`. | Concurrent SPU updates and update-versus-archive races for SKU and listing each yield one success and one 409. Final row version is 1 and state is exactly one winner. |
| Warehouse and location update/archive | Formal optimistic-concurrency contract. Requests carry `version`; warehouse writes use a PostgreSQL pessimistic row lock and location writes serialize on their parent warehouse before checking the location version. | Concurrent warehouse updates and location update-versus-archive yield one success and one 409, with final version 1 and a single final state. |
| Tenant business-code uniqueness | Unique-constraint conflict, not idempotency. Current write coverage exercises tenant SPU and warehouse codes. Historical supplier and supplier/SKU uniqueness constraints remain schema facts but are not write APIs or executable coverage in this gate. | Concurrent same-tenant SPU and warehouse creates each yield one 201 and one safe 409 with one committed row. Historical supplier constraints remain covered by the schema-drift and server-readiness gates. |
| Global platform code, tenant shop reference, open sync job | Unique-constraint conflict, not idempotency. Platform code is global; shop reference and open job type are tenant/shop scoped. | Concurrent duplicates yield one 201 and one safe 409 with one committed row. Equal shop references in separate tenants both succeed. |
| Platform archive, shop archive, authorization update, sync status update | Client optimistic locking is not currently promised. Responses expose a JPA `version`, but these request DTOs carry no expected version. Archive has observed replay-like behavior and domain updates may still encounter JPA commit conflicts; neither observation is promoted to a product contract by this gate. | Their unique-create constraints are covered where applicable. Blind update/archival behavior is documented only; defining an expected-version or idempotency contract requires explicit product approval before tests can enforce it. |
| IAM session revocation and repeated credential/session operations | Existing IAM idempotency/conflict coverage; intentionally not duplicated by this cross-module gate. | Run the existing `IamSessionManagementIntegrationTest`, `SessionTokenServiceTest`, authentication tests, and complete backend verification alongside this gate. |

## Error, tenant, rollback, and audit assertions

All covered losing HTTP responses must be exactly:

```json
{
  "code": "resource_conflict",
  "message": "The request conflicts with the current resource state",
  "details": {}
}
```

The gate also rejects response bodies containing tenant IDs, resource IDs,
bearer tokens, submitted business identifiers, JDBC/PostgreSQL/SQLState text,
constraint names, duplicate-key details, `tenant_id`, or token-hash details.

Committed-state assertions prove that a failed transaction creates no duplicate
business row and cannot overwrite the winner. For the covered order writes with
formal business auditing, the losing or replayed transaction produces no
corresponding business success audit. Platform-admin tenant-write access
auditing is a separate formal audit stream and is not misclassified as a
business mutation.

## Docker Desktop command

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
node platform/scripts/pg16-concurrency-gate-check.mjs
```

The `-D` arguments are quoted because PowerShell otherwise rewrites native
arguments on some hosts. A Docker/Testcontainers startup failure is a gate
failure; it must not be converted to a skip.

## Current findings and limitations

No production defect was identified by the passing gate on baseline
`b71ffbf`.

The platform/shop-center request-version asymmetry described in the matrix is a
contract boundary, not a defect silently fixed by this task. If the product
requires deterministic client conflict detection for platform archive, shop
archive, authorization update, or sync status update, the user must first
approve request shapes, idempotency behavior, and state-transition rules.

The gate exercises current PostgreSQL behavior at `READ_COMMITTED`; it does not
claim serializable isolation, distributed multi-database coordination, or
idempotency for endpoints classified above as unique-conflict or uncommitted.
Formal audit assertions intentionally cover only audit actions present on the
baseline and do not depend on unmerged audit work.
