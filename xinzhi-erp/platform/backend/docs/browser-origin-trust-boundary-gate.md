# Browser Origin, CSRF, and Request-Authority Trust Boundary Gate

## Purpose and change boundary

This gate records and tests the browser and reverse-proxy trust facts of the
stateless bearer-token ERP. The repository edge extension now includes a
server-wide, query-free Nginx access-log format and real-container negative
gate. It does not define a production origin, hostname, TLS/HSTS policy,
trusted-proxy topology, log collector/destination, retention/access policy, or
new CORS allowlist. The extension changes no backend runtime source, API
contract, permission, state transition, dependency, or Flyway migration.
V1-V39 remain unchanged and V40 remains unallocated.

The executable application evidence is
`BrowserOriginTrustBoundaryIntegrationTest`. It starts the real Spring
application and security filter chain, explicitly applies Spring Framework's
forwarded-header filter in MockMvc, migrates a test-owned
`postgres:16-alpine` container with Testcontainers 1.21.4, builds all state
through APIs, and removes its container after the test. Docker startup failure
is a test failure; there is no Docker-unavailable skip or external JDBC
fallback.

The offline source gate is
`platform/scripts/browser-origin-trust-boundary-gate.mjs`. It accepts no path,
origin, URL, environment, or credential input and prints no matched source.
It rejects silent introduction of application or Nginx CORS policy,
credentialed wildcard CORS, servlet sessions or cookie surfaces, non-stateless
security, request-derived/absolute controller locations, and drift in the
documented repository-edge forwarding facts.

## Current fact matrix

| Concern | Application fact | Repository edge fact | Production responsibility |
| --- | --- | --- | --- |
| CORS policy | No `http.cors()`, `CorsFilter`, `CorsConfigurationSource`, or `@CrossOrigin` is configured. Responses contain no `Access-Control-Allow-*` headers, so browsers cannot grant a hostile origin read access. | `frontend/nginx.conf` adds no CORS header and does not reflect `$http_origin`. | **TODO (OPS/P0):** select explicit public host/origin allowlists. Same-origin remains the default; any exception requires an exact HTTPS origin and reviewed methods/headers. |
| Preflight | Unauthenticated preflight to protected APIs receives 401. `OPTIONS` to the four public JSON login/redemption routes receives Spring MVC's implicit 200 response. Neither response contains any `Access-Control-Allow-*` header, so neither grants browser cross-origin access. | `/api/` has no edge OPTIONS override, so the request is proxied to the application. | The public edge must preserve fail-closed browser behavior and must not synthesize wildcard or credentialed CORS. |
| Authentication transport | `BearerTokenAuthenticationFilter` reads only `Authorization: Bearer …`. Spring form login and HTTP Basic are disabled. | `/api/` forwards ordinary request headers to the application; it does not synthesize Authorization. | TLS termination and authorization-header handling require integrated pre-production review. |
| CSRF | CSRF is explicitly disabled. This is valid only because authentication is not ambiently attached by the browser. Authenticated writes succeed without a CSRF token only when the caller explicitly supplies a valid bearer token. | No edge cookie-to-Authorization translation exists. | If authentication ever moves to cookies, CSRF protection and the complete cookie contract must be implemented and reviewed before release. |
| Cookies and servlet sessions | The security chain is `STATELESS`; form login, Spring logout, and request cache are disabled. Tests prove Cookie/JSESSIONID/access-token cookie values do not authenticate, no servlet session is created, and `Set-Cookie` is empty. Database session rows contain token hashes; they are not browser cookies or servlet sessions. | The repository API proxy does not synthesize cookies. The readiness subrequest explicitly hides upstream `Set-Cookie`. | A future authentication cookie would require `Secure`, `HttpOnly`, approved `SameSite`, narrow domain/path, rotation, logout invalidation, and CSRF protection. |
| Browser token storage | The current frontend adapter uses `sessionStorage`, not an authentication cookie or persistent local storage. | Static assets and `/api/` share the repository-local edge origin. | The bearer-token/XSS model and CSP still require production security acceptance. |
| Host | Application resource creation uses origin-relative `/api/v1/...` Location values and does not build URLs from request authority. Hostile Host values are not reflected in headers, safe errors, or captured logs. | `/api/` sets upstream `Host $host`. `server_name _` is a local/UAT catch-all, not a production host allowlist. | **TODO (OPS/P0):** canonical production host allowlist and rejection behavior. |
| Forwarded headers | `server.forward-headers-strategy: framework` is explicit. Runtime tests apply the framework filter with hostile `Forwarded` and `X-Forwarded-*` values and prove no open redirect, absolute external Location, response/header secret, internal prefix, or log leakage. | The repository edge writes `X-Real-IP` from `$remote_addr`, appends `X-Forwarded-For`, and writes `X-Forwarded-Proto` from `$scheme`. It does not prove removal of every inbound `Forwarded`, `X-Forwarded-Host`, `X-Forwarded-Prefix`, or prior `X-Forwarded-For` value. | **GAP (OPS/P0):** the public edge must remove all inbound forwarded headers, write canonical values, and restrict application reachability to trusted proxies. |
| Referer and null/file Origin | `Referer`, `Origin: null`, and file-origin canaries do not appear in response headers or logs and receive no CORS permission. Referer is not an authentication or authorization input. | No repository edge rule treats Referer as trusted identity. | The production referrer policy remains an edge/browser-hardening decision. |
| Redirects and Location | Authentication, redemption, tenant enter/leave, authorization errors, validation errors, and reads do not redirect or emit Location. Successful resource creation may emit only an origin-relative, query-free, fragment-free `/api/v1/...` Location. | The API proxy currently preserves application responses. | The public edge must not rewrite relative API locations into an untrusted absolute authority. |
| Cache and security headers | Covered 401, 403, fixed 415 `invalid_request`, 2xx login/token, 204 redemption/leave, 200 reads, and 201 writes retain `no-store`, `no-cache`, `max-age=0`, `must-revalidate`, `Pragma: no-cache`, `Expires: 0`, `nosniff`, and no `Set-Cookie`. | Edge integration must preserve or strengthen these headers. | HSTS is not asserted on HTTP MockMvc. Production TLS/HSTS ownership remains at the approved edge. |
| Error and log redaction | Response-header and captured application-log surfaces exclude bearer tokens, one-time credentials, passwords, hostile Origin/Referer/Host/Forwarded canaries, and internal prefix canaries. | **RESOLVED for the repository edge:** the server default uses the JSON `api_access` format with only time, direct peer, method, normalized query-free `$uri`, status, response bytes, and duration. Real-container tests cover success/404/503 API responses plus malformed URI and normalization into static locations; query, Referer, Authorization, Cookie, Origin, Forwarded/X-Forwarded, Host, User-Agent, body, and upstream canaries do not enter any enabled access log. `/healthz` and `/readyz` retain `access_log off`. | **GAP (OPS/P0 before a public edge):** repeat the negative test at the actual public edge and collector; approve destination, collection transforms, retention, access control, deletion, and incident-use policy. The logged direct peer address is personal/operational data. Do not treat or log client-reported X-Forwarded-For as the source-IP record. |

Absence of `Access-Control-Allow-Origin` is a browser read barrier, not a
server-side authorization check. A non-browser caller can send any Origin, and
a caller that already possesses a valid bearer token can invoke the API.
Authentication, permission, and tenant checks therefore remain mandatory on
every endpoint. Conversely, a hostile browser origin cannot automatically
attach the bearer token, and preflight does not receive permission to send an
Authorization header.

## Runtime coverage

| Flow | Hostile-origin evidence |
| --- | --- |
| SYSTEM_ADMIN authentication | failed and successful login, administrator activation credential issue/redemption, and second administrator login |
| Enterprise authentication | tenant activation credential redemption and enterprise login |
| Tenant switching | SYSTEM_ADMIN tenant enter, tenant bearer use, tenant leave, revoked tenant-session 401, and surviving base session |
| Ambient credential negative | forged `JSESSIONID`, `access_token`, and Authorization-like cookie values fail with 401 and create no servlet session |
| Simple requests | Cookie-only reads for IAM, product, order, warehouse, and supplier APIs and cookie-only writes for IAM, product, order, and warehouse APIs receive 401. Enterprise and SYSTEM_ADMIN form logins receive the fixed, redacted 415 `invalid_request` envelope; no request succeeds or receives CORS permission. |
| Preflight | login, both credential exchanges, tenant enter/leave, IAM, product, order, warehouse, and supplier routes are locked to the current protected-401/public-200 facts, always without CORS permission |
| Representative reads | IAM members, products, orders, warehouses, and suppliers succeed only with an explicit tenant bearer and remain cross-origin unreadable |
| Representative writes | IAM member, product/SPU/SKU, order, and warehouse creation succeed with explicit bearer authentication and no CSRF token; resource Locations stay relative |
| Trust-domain denial | base SYSTEM_ADMIN on enterprise product API and enterprise user on platform-admin API receive 403 |
| Origin variants and proxy inputs | hostile HTTPS Origin, `Origin: null`, file Origin, forged Referer, Host, Forwarded, and `X-Forwarded-*` values |

## Commands

From the repository root:

```powershell
node --check platform/scripts/browser-origin-trust-boundary-gate.mjs
node platform/scripts/browser-origin-trust-boundary-gate.mjs
node --test platform/scripts/browser-origin-trust-boundary-gate.test.mjs
node --check platform/scripts/nginx-api-access-log-gate.mjs
node platform/scripts/nginx-api-access-log-gate.mjs
node --test platform/scripts/nginx-api-access-log-gate.test.mjs
node --test platform/scripts/nginx-api-access-log-runtime.test.mjs
```

The PG16 test uses the repository's fixed Docker verification shape:

```powershell
docker run --rm `
  --mount "type=bind,source=$((Get-Location).Path),target=/workspace" `
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -w /workspace/platform/backend `
  --entrypoint sh xz-erp-maven:security-baseline-cache `
  -lc "mvn -B -Dtest=cn.xzkj.erp.security.BrowserOriginTrustBoundaryIntegrationTest test"
```

## Limits and required integration review

The application runtime test is not a production browser, CDN, load balancer,
TLS terminator, or cloud trusted-proxy test. The static and real-container
Nginx gates prove the repository configuration and its local fixed
Nginx-Alpine runtime; they do not prove a future public edge or log collector.
Before production, the release owner still needs an integrated pre-production
test that covers the approved hostname and exact HTTPS origin, direct-backend
denial, removal and canonical replacement of all inbound forwarded headers,
TLS redirects before credentials are accepted, HSTS after certificate
acceptance, real edge error responses, collector transforms, and production
access-log redaction. OPS must separately approve the direct-peer address as
personal/operational data, including retention, access, deletion, and incident
use.

The former application-protocol GAP for unsupported form media on
`POST /api/v1/platform-admin/auth/login` is resolved by merged production
commit `e6e0f28`: `PlatformAdminExceptionHandler` now returns the fixed,
redacted 415 `invalid_request` envelope. The source-level ownership of that
six-advice mapping remains
`platform/scripts/api-resource-boundary-gate.mjs`, with its real-PG envelope
evidence in `ApiResourceBoundaryIntegrationTest`; this browser gate composes
that contract with hostile Origin, request-authority, cache/security-header,
cookie, response, and application-log assertions instead of defining a
duplicate runtime contract.

The former repository edge logging GAP is resolved by
`frontend/nginx.conf`, `nginx-api-access-log-gate.mjs`, and
the access-log and HTTP-routing real-container tests. The approved server-wide
record is deliberately
minimal: `time`, direct `peer`, `method`, query-free normalized `path`,
`status`, response `bytes`, and `duration`. It excludes the full request line,
query/args, Referer, User-Agent, Cookie, Authorization, Origin,
Forwarded/X-Forwarded values, request body, response headers, authenticated
identity, server/filesystem paths, and upstream address/headers/timing.

This resolution is scoped to the repository edge. The real public
CDN/load-balancer/ingress, logging agent, collector, storage, and exports remain
unverified. Production hostname/TLS/HSTS/CSP, trusted-proxy canonicalization,
log destination, retention/access controls, and deletion policy remain
explicit operations decisions.
