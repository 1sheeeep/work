# API resource consumption and denial-of-service boundary gate

This gate records and tests only boundaries that already exist in the XZ ERP
API. It does not choose production request-size, decompression, rate, or
pagination policy. A missing boundary is a `GAP`, not an invitation for a test
to invent a threshold.

The owned deliverables are:

- `platform/scripts/api-resource-boundary-gate.mjs`, an offline source-fact
  checker;
- `platform/scripts/api-resource-boundary-gate.test.mjs`, fail-closed checker
  tests;
- `ApiResourceBoundaryIntegrationTest`, a bounded MockMvc test running the real
  Spring application against a one-use PostgreSQL 16 container;
- this responsibility and evidence record.

The gate does not edit runtime configuration, endpoint or DTO contracts,
permissions, migrations, or product policy. The only approved production
change is the six-advice safe 415 mapping recorded below. The work never
contacts a real shop or production resource, and it does not read `.env`,
credentials, or arbitrary paths.

## Server and parser fact matrix

| Boundary | Source fact | Classification | Hard gate |
| --- | --- | --- | --- |
| Unknown JSON properties | `spring.jackson.deserialization.fail-on-unknown-properties: true` | Explicit application policy | Yes |
| DTO field and collection sizes | Bean Validation annotations on request DTOs | Explicit API policy | Yes, representative limits plus the general API contract gate |
| JSON request body bytes | No application property and no Nginx `client_max_body_size` in the repository | GAP; edge/container default only | No |
| Decompressed request bytes or ratio | No request decompression policy or decompressed-size property | GAP | No |
| JSON nesting depth | No application `StreamReadConstraints` customization | Dependency default | Runtime rejection is sampled; the dependency's numeric default is not promoted to an ERP contract |
| `Content-Type` support | Spring message converters determine support; six scoped advice explicitly map unsupported media to safe 415 | Explicit error mapping over framework detection | Yes |
| `Content-Encoding` | No application request decompressor or explicit rejection policy | Container/framework default | Runtime malformed-gzip sample only |
| `413 Payload Too Large` | No application/edge request-body byte limit | Undefined | No 413 assertion |
| Repeated query parameters | No explicit duplicate-parameter policy | Framework binding default | Safety-only runtime sample; first/last-value semantics are not a contract |
| Test database | `postgres:16-alpine` via Testcontainers `1.21.4` | Explicit verification environment | Yes |

Tomcat form-post or swallow defaults are not treated as JSON body-size limits.
MockMvc exercises the real Spring handler/filter/advice path but not a network
socket or Nginx/Tomcat connector rejection path, so it cannot prove a
container-level 413.

## Representative DTO matrix

| Trust/module | Endpoint shape | Existing declared limit sampled |
| --- | --- | --- |
| Enterprise authentication | `POST /api/v1/auth/login` | password 128 |
| Credential redemption | `POST /api/v1/auth/password-credentials/redeem` | token 512; new password 128 |
| Platform administrator | `POST /api/v1/platform-admin/tenants` | tenant name 160 |
| Enterprise IAM | `PUT /api/v1/iam/members/{id}/roles` | assignment IDs 200 |
| Platform/shop center | representative POST/PUT DTOs | platform display name 160; authorization scopes 40 |
| Product | `POST /api/v1/product-center/spus` | name 200; description 2,000 |
| Order | `POST /api/v1/order-center/orders` | order lines 200 |
| Warehouse | `POST /api/v1/warehouse-center/warehouses` | name 200 |

Unknown-field rejection is also covered across authentication, platform
administrator, IAM, platform/shop, product, order, and warehouse
by `ApiErrorRedactionIntegrationTest`.

## List-endpoint matrix

The executable matrix tracks all 57 list endpoints. All use integer
`page`/`size`, declare `page >= 0`, and declare a positive maximum page size.
Values outside the Java integer range fail binding with 400. Fourteen endpoints
also declare an explicit page-number maximum; the remaining 43 intentionally
preserve an `undefined` page maximum. This gate does not convert them to cursor
paging or silently choose a new maximum. The table below is a representative
route-level record; `ALL_LIST_OPERATIONS` in the checker is the complete locked
inventory.

| Endpoint | Page maximum | Size maximum | Bounded text filter |
| --- | ---: | ---: | ---: |
| `/api/v1/auth/sessions` | 1,000,000 | 100 | — |
| `/api/v1/iam/audit-logs` | 1,000,000 | 100 | action 160; resourceType 100 |
| `/api/v1/iam/members` | 1,000,000 | 100 | — |
| `/api/v1/iam/permissions` | 1,000,000 | 100 | — |
| `/api/v1/iam/roles` | 1,000,000 | 100 | — |
| `/api/v1/iam/members/{id}/sessions` | 1,000,000 | 100 | — |
| `/api/v1/iam/members/{id}/password-credentials` | 1,000,000 | 100 | — |
| `/api/v1/order-center/orders` | 1,000,000 | 200 | keyword 100 |
| `/api/v1/order-center/sku-match-queue` | 1,000,000 | 200 | keyword 100 |
| `/api/v1/logistics/tracking-numbers` | undefined | 200 | channel 100; keyword 120 |
| `/api/v1/platform-admin/system-admins` | 1,000,000 | 200 | — |
| `/api/v1/platform-admin/tenants` | 1,000,000 | 200 | — |
| `/api/v1/platform-center/platforms` | undefined | 200 | — |
| `/api/v1/platform-center/shops` | undefined | 200 | — |
| `/api/v1/platform-center/shops/{id}/sync-jobs` | undefined | 200 | — |
| `/api/v1/product-center/listings` | undefined | 200 | keyword 100 |
| `/api/v1/product-center/skus` | undefined | 200 | keyword 100 |
| `/api/v1/product-center/spus` | undefined | 200 | keyword 100 |
| `/api/v1/suppliers` | undefined | 200 | query 100 |
| `/api/v1/suppliers/{id}/sku-mappings` | undefined | 200 | query 120 |
| `/api/v1/warehouse-center/warehouses` | undefined | 200 | keyword 100 |
| `/api/v1/warehouse-center/warehouses/{id}/locations` | undefined | 200 | keyword 100 |

The real-PG test sends negative pages, `2147483648`, and size maximum plus one
to every row. It sends every bounded text filter at maximum plus one. Existing
tenant-isolation gates remain authoritative for data ownership and are run with
this gate; an invalid pagination request is not itself proof of tenant
isolation.

## Unsupported-media handler matrix

The baseline `f48f6ce` allowed broad advice fallbacks to catch
`HttpMediaTypeNotSupportedException` and return 500. After explicit approval,
production commit `5f67316` added only the following mappings. Every
mapping uses a fixed message, does not log, and does not expose the received
content type, supported types, request body, path, or exception text.

| Scoped advice | Representative write | Status | Envelope |
| --- | --- | ---: | --- |
| `AuthExceptionHandler` | `POST /api/v1/auth/login` | 415 | `code`, `message` |
| `PasswordCredentialExchangeExceptionHandler` | `POST /api/v1/auth/password-credentials/redeem` | 415 | `code`, `message` |
| `IamExceptionHandler` | `POST /api/v1/iam/members` | 415 | `code`, `message` |
| `PlatformAdminExceptionHandler` | `POST /api/v1/platform-admin/tenants` | 415 | `code`, `message` |
| `ApiExceptionHandler` | `POST /api/v1/product-center/spus` | 415 | `code`, `message`, empty `details` |
| `OrderApiExceptionHandler` | `POST /api/v1/order-center/orders` | 415 | `code`, `message`, empty `details` |

All six return code `invalid_request` and the fixed message
`Content type is not supported`.

## Runtime response evidence

The bounded test inputs are at most hundreds of small DTO items or tens of
kilobytes. They are designed to prove rejection paths without attempting to
exhaust memory, disk, connections, or threads.

| Request condition | Observed result after `5f67316` | Contract status |
| --- | --- | --- |
| DTO string/array above declared maximum | 400, safe envelope, no mutation | Passing |
| Unknown property | 400, safe envelope, no mutation | Passing in existing redaction gate |
| Malformed or truncated JSON | 400 `invalid_request` | Passing |
| 1,200-level nested JSON sample | 400, no stack/path/body echo | Passing sample; numeric parser default is not an ERP threshold |
| Empty JSON body with JSON content type | 400 | Passing |
| Gzip-encoded JSON bytes with `Content-Encoding: gzip` | 400, not decompressed | Safe sample; explicit encoding policy remains a GAP |
| Missing `Content-Type` with a body, six scoped writes | 415 `invalid_request`, scoped JSON envelope | Passing |
| `Content-Type: text/plain` with a body, six scoped writes | 415 `invalid_request`, scoped JSON envelope | Passing |
| Malformed JSON with `application/json`, six scoped writes | Existing 400 envelope | Passing; no status regression |
| 25 repeated unsupported-media requests | Stable 415; no WARN/ERROR or secret/body echo | Passing bounded stability sample |
| Total body above a server byte threshold | Not tested because no formal threshold exists | GAP; no 413 is claimed |

The baseline defect and reproduction were reported before runtime modification.
Only the six mappings above were approved; no global advice, request-size
threshold, content-encoding policy, pagination limit, or other error status was
changed.

## Redaction and resource-safety assertions

Rejected responses and captured logs must not contain:

- `Authorization` or any presented session token;
- activation credentials, passwords, or request-body canaries;
- JDBC URLs, PostgreSQL/constraint details, SQL identifiers, stack traces, or
  local filesystem paths.

The tests assert that tenant, user, session, password credential, product, and
order counts do not change across the six-domain media-type matrix. Successful
IAM/order/platform-admin audit counts also remain unchanged; the body canary is
absent from both audit stores. A platform-admin tenant-write-attempt audit may
still be produced by its existing filter and is not reclassified as success.
Tests use a 45-second timeout and finite loops. These results are protocol and
resource-boundary evidence only; no local request duration or count is reported
as production throughput/capacity.

## Run

Offline source checks from the repository root:

```powershell
node --check platform/scripts/api-resource-boundary-gate.mjs
node platform/scripts/api-resource-boundary-gate.mjs
node --test platform/scripts/api-resource-boundary-gate.test.mjs
```

The real PostgreSQL 16 test is run in the fixed Java 25/Maven 3.9.11 image with
the repository mounted at `/workspace`:

```text
TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal
/var/run/docker.sock:/var/run/docker.sock
mvn -B \
  -Dtest=cn.xzkj.erp.security.ApiResourceBoundaryIntegrationTest test
```

The test must report six tests with zero failures, errors, and skipped tests.
Its media-type matrix contains 12 scoped 415 requests, six malformed-JSON 400
requests, and 25 bounded repeated 415 requests.
