# HTTP path, method, and edge-to-Spring routing boundary gate

This gate records and verifies the current repository behavior for HTTP request
targets, methods, method-override headers, and the Nginx-to-Spring boundary. It
is local and pre-production evidence, not a new public API contract. In
particular, an observed Nginx or Spring status is not a promise that callers may
depend on it.

The owned deliverables are:

- `platform/scripts/http-routing-boundary-gate.mjs`, a repository-locked
  offline fact checker;
- `platform/scripts/http-routing-boundary-gate.test.mjs`, its fail-closed
  positive and negative tests;
- `platform/scripts/http-routing-edge-runtime.test.mjs`, a real local
  Nginx 1.28 edge with a bounded marker backend;
- `HttpRoutingTrustBoundaryIntegrationTest`, the production-profile Spring
  application on a real random Tomcat connector with PostgreSQL 16;
- the server-wide Nginx access-log safety fix and the exact production Tomcat
  parser-logger safety override; and
- this responsibility and evidence record.

No test deploys, contacts production or a real shop, reads `.env`, accepts a
JDBC URL or credential, decides a hostname/TLS/HSTS/trusted-proxy policy, or
changes an endpoint, permission, migration, proxy target, path parser, method
filter, response envelope, or status code.

## Authorized runtime corrections

Two leaks were reproduced and reviewed before runtime changes.

1. Nginx previously applied `api_access` only inside `location /api/`.
   Malformed URI parsing and normalization into a different location fell back
   to the inherited combined log and exposed the full request line and query.
   Commit `289d3f9` promotes the same minimal `api_access` format to the server
   default. `/healthz` and `/readyz` remain `access_log off`.
2. Tomcat's first invalid request-target parse error was logged at INFO with the
   complete target, query, exception, and stack. Commit `f48ec7e` sets only
   `org.apache.coyote.http11.Http11Processor` to `WARN` in the production
   profile and in `ProductionSafetyEnvironmentPostProcessor`. An environment
   attempt to set that exact logger to INFO or DEBUG cannot reopen it. WARN and
   ERROR logging elsewhere remains enabled.

The Tomcat change suppresses this parser's unsafe INFO/DEBUG detail. It does not
set a package-wide or global `OFF`, change the connector, relax or tighten
parsing, or suppress parser WARN/ERROR records.

## Source facts locked offline

| Fact | Current repository value | Drift behavior |
| --- | --- | --- |
| Nginx API location | regex-preferred prefix `location ^~ /api/` | fail |
| API upstream | `proxy_pass http://backend:8080;` with no URI component | fail |
| Other proxy target | internal readiness only, ending in `?` to remove client query | fail |
| Nginx slash setting | default merge behavior; no `merge_slashes off` | fail |
| Nginx enabled access logs | server-wide `api_access` only | fail |
| Access-log path | normalized, query-free `$uri` | fail |
| Probe logs | `/healthz`, `/readyz`, readiness variants/fallback are off | fail |
| Spring forwarding | `server.forward-headers-strategy: framework` | fail |
| Spring path matching/firewall | framework defaults; no repository customization | fail |
| Method override | no `HiddenHttpMethodFilter`, override filter/header support, or enablement property | fail |
| Public actuator matcher | existing `/actuator/health` family only | fail |
| Platform trust domain | `/api/v1/platform-admin/**` requires `SYSTEM_ADMIN` | fail |
| Tenant trust domain | base SYSTEM_ADMIN is excluded; tenant/entered-tenant bearer required | fail |
| Parser log safety | exact production logger forced to `WARN` twice | fail |
| Runtime database/image | Testcontainers `1.21.4`, `postgres:16-alpine` | fail |

The checker resolves its root from its own file, accepts no CLI input, reads no
process environment, validates canonical regular files, rejects symbolic links
in runtime sources, performs no network/Docker operation, and always reports
`skipped=0`.

## Direct Spring and PostgreSQL 16 matrix

The direct test starts the real production-profile application on
`server.port=0` after migrating a one-use PostgreSQL 16 container. It creates a
SYSTEM_ADMIN base session, a SYSTEM_ADMIN-entered tenant session, an ordinary
tenant session, and uses an anonymous caller.

| Target trust domain | Base SYSTEM_ADMIN | Entered tenant | Ordinary tenant | Anonymous |
| --- | ---: | ---: | ---: | ---: |
| platform-admin exact route | 200 | 403 | 403 | 401 |
| tenant business exact route | 403 | 200 | 200 | 401 |
| direct `/actuator/health` | 200 | 200 | 200 | 200 |
| unknown `/internal/...` | no 2xx | no 2xx | no 2xx | no 2xx |
| Spring `/index.html` | no 2xx | no 2xx | no 2xx | no 2xx |
| `/api/actuator/health` | no 2xx | no 2xx | no 2xx | no 2xx |

Every row is repeated with 22 bounded request-target forms: duplicate slash,
dot, dot-dot, lower/mixed-case encoded dot, encoded dot-dot, lower/upper
encoded slash, encoded/raw backslash, semicolon/matrix parameter, trailing dot,
trailing empty segment, encoded unreserved character, invalid percent and hex,
two invalid UTF-8 samples, encoded NUL/control, and a 2,048-character suffix.
Any form that reaches a controller must retain the normalized target's ordinary
authentication and authorization. Rejections may differ between the connector,
Spring Security firewall, and MVC; the test deliberately treats 400/401/403/404
and fixed safe 500 results as fail-closed rather than promoting one code to a
contract.

Representative current direct observations are:

- duplicate slash, dot segments, encoded dot/slash/backslash, matrix
  parameters, invalid percent, NUL, and raw backslash are rejected before a
  protected handler succeeds;
- an encoded unreserved path character can resolve to the exact route and then
  receives exactly the same trust-domain authorization;
- suffix and long unknown paths do not become actuator, platform, or tenant
  success across an unauthorized session; and
- any observed 500 retains the fixed `internal_error` / `An internal error
  occurred` envelope and fixed `Unexpected business API error` application
  log, without request details.

### Direct method facts

These are observed framework facts, not endpoint contract additions.

| Method | public `GET /api/v1/system/info` target | tenant collection with tenant bearer | base SYSTEM_ADMIN on tenant collection | anonymous on tenant collection |
| --- | ---: | ---: | ---: | ---: |
| GET | 200 | 200 | 403 | 401 |
| POST | 405 | 400 (empty body) | 403 | 401 |
| PUT | 405 | 405 | 403 | 401 |
| PATCH | 405 | 405 | 403 | 401 |
| DELETE | 405 | 405 | 403 | 401 |
| OPTIONS | 200 | 200 | 403 | 401 |
| TRACE | 405 | 405 | 405 | 405 |

`X-HTTP-Method-Override`, `X-Method-Override`, `X-Original-URL`,
`X-Rewrite-URL`, `Forwarded`, and `X-Forwarded-*` do not change the actual
method or handler path. A GET remains GET, a POST with GET override headers
remains POST, and tenant/platform requests continue to use the request target
instead of the rewrite headers.

## Real repository Nginx matrix

The edge test mounts the committed Nginx configuration read-only into the
already-local `xz-erp-local-web:latest` image using `--pull=never`. A second
container from the same image is a finite marker backend. Only the edge
container's logs are read. All containers, networks, loopback ports, and
temporary files are owned by a random test suffix and removed in `finally`.

| Edge request-target family | Current edge/stub observation |
| --- | --- |
| exact, duplicate slash, dot/dot-dot, encoded dot, encoded unreserved, encoded slash | resolves to the corresponding marker route |
| encoded backslash inside `/api/` | remains in the API proxy namespace but does not match the business marker (404) |
| encoded/raw backslash before the `/api/` separator | selects the static location; no backend marker |
| semicolon, trailing dot/empty segment, invalid UTF-8, bounded long suffix | proxied but does not match the exact marker (404) |
| invalid percent or encoded NUL | edge 400 |
| encoded control sample | proxied to the non-business marker (404) |
| dot-dot from tenant-looking path to platform path | marker backend normalizes to platform; the upstream wire-shape marker proves the original dot-dot was retained by `proxy_pass` without a URI |
| `/api/actuator/health` | non-actuator backend marker (404) |
| `/api/../actuator/health` and encoded-dot equivalent | static SPA 200, no backend/actuator marker |

The last two rows are intentionally distinguished: a static SPA 200 is not an
actuator 200 and does not expose the internal readiness subrequest. Because the
no-URI `proxy_pass` retains original dot/encoding shape on the upstream wire,
the direct Tomcat matrix remains authoritative for what real Spring rejects.
The marker backend's own normalization is not treated as Spring behavior.

Nginx preserves GET/POST/PUT/PATCH/DELETE/OPTIONS to the stub. TRACE is
currently edge 405. All rewrite/method-override/forwarded headers are ignored by
the routing marker. These observations remain framework facts only.

## Response and logging evidence

Across direct and edge tests, response status, headers, body, and Location are
checked against bearer tokens, activation/password values, query/header/body
canaries, JDBC/upstream identifiers, application classes, and stack details.
No response redirects or emits an internal absolute Location.

The Nginx server default emits exactly these seven JSON keys:
`time`, direct `peer`, `method`, normalized query-free `path`, `status`,
response `bytes`, and `duration`. Normal API, malformed `%GG`, malformed `%00`,
dot-to-static, every method, and a request carrying query, Authorization,
Cookie, Origin, Referer, Forwarded/X-Forwarded, override-header, User-Agent,
and body canaries all use that format. No combined record, query, sensitive
header, body, backend address, JDBC text, or upstream detail appears.

The production Tomcat test sends the raw backslash target first while an
environment source attempts to set the exact parser logger to DEBUG. The
effective property remains WARN; the response stays 400; the complete target,
query/token/password/credential canary, `IllegalArgumentException`, and parser
stack are absent. A normal unsupported-method WARN remains captured. Fixed
safe unknown-business ERROR records and envelopes remain visible in the larger
matrix, proving global observability was not disabled.

## Content-Length / Transfer-Encoding limit

One local, single-connection, connection-closing request with both
`Content-Length` and `Transfer-Encoding` is sent to each direct and edge
surface. It receives a non-success 4xx response. The test sends no second
request, no pipeline, no large body, and no connection-desynchronization
sequence. This is a bounded parser sample only and **does not prove resistance
to HTTP request smuggling**. True multi-hop desynchronization testing remains
uncovered and must use a separately approved, isolated specialist harness.

## Commands

From the repository root:

```powershell
node --check platform/scripts/http-routing-boundary-gate.mjs
node platform/scripts/http-routing-boundary-gate.mjs
node --test platform/scripts/http-routing-boundary-gate.test.mjs
node --test platform/scripts/http-routing-edge-runtime.test.mjs
node --check platform/scripts/nginx-api-access-log-gate.mjs
node platform/scripts/nginx-api-access-log-gate.mjs
node --test platform/scripts/nginx-api-access-log-gate.test.mjs
node --test platform/scripts/nginx-api-access-log-runtime.test.mjs
```

The direct PG16 command uses the fixed Docker Desktop shape:

```powershell
docker run --rm --pull=never `
  --mount "type=bind,source=$((Get-Location).Path),target=/workspace" `
  --mount type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock `
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal `
  -w /workspace/platform/backend `
  --entrypoint sh xz-erp-maven:security-baseline-cache `
  -lc "mvn -B -Dtest=cn.xzkj.erp.security.HttpRoutingTrustBoundaryIntegrationTest,cn.xzkj.erp.config.ProductionProfileConfigurationTest test"
```

## Limits and ownership

This is not a CDN, public load balancer, TLS, HTTP/2/3, trusted-proxy, or
collector test. It does not establish production hostname, HSTS, TLS redirect,
proxy trust, direct-backend reachability, log destination, retention, access,
deletion, or incident-use policy. The server-wide Nginx record still contains
the direct peer address and normalized path; operations must classify and
govern those fields before a public edge.

The current edge and Spring may reject the same raw target with different
codes, and the edge may normalize for location selection while forwarding the
original wire shape. Safety depends on authorization running against whatever
business endpoint Spring actually resolves. No observed normalization is
silently elevated into a new API or product contract.
