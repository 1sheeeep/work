# Backend egress and SSRF boundary gate

## Decision

Approved production HTTP egress is limited to four source-locked adapters: the
ERP-to-XZ ERP App Connector, the Chuda logistics connector, the Hualei-family
logistics connector, and the ITDIDA-family logistics connector. Each adapter
uses configuration-owned base URLs and fixed API paths; request bodies and
persisted business data cannot choose a destination. The gate source-locks the
reviewed adapters, related network-shaped model fields, migrations, and
loopback-only tests. Any source drift or additional client fails closed pending
another security review.

This approval does not allow the ERP backend to call Shopify directly. Shopify
credentials and Admin API calls remain exclusively inside the Connector.

The fixed-root gate is:

```text
platform/scripts/backend-egress-boundary-gate.mjs
```

Run it from any directory without arguments:

```powershell
node platform/scripts/backend-egress-boundary-gate.mjs
node --test platform/scripts/backend-egress-boundary-gate.test.mjs
```

The executable derives the repository root from its own checked-in location. It
rejects every CLI argument and does not read `process.env`, proxy variables,
`.env` files, URLs, credentials, or caller-supplied paths.

## Source-derived inventory

The current gate result is:

| Surface | Repository fact |
| --- | --- |
| Production Java | 598 inspected files |
| Production HTTP clients | 4 source-locked files |
| Production outbound allowlist | 4 source-locked entries |
| Production DNS/socket APIs | 0 |
| Production process execution APIs | 0 |
| Production proxy/redirect processing | 0 |
| `URI.create` in production | 17 relative `/api/v1/...` response `Location` values |
| Backend dependencies | 12 reviewed Maven coordinates |
| Reviewed network-shaped configuration/resource findings | 30 |
| Backend network test files | 8, all test traffic pinned to `127.0.0.1` |

The eight reviewed test-only network surfaces are:

- `ProductionReadinessIntegrationTest`: local readiness probe to the
  random-port application on `127.0.0.1`.
- `DatabaseResiliencePostgresql16GateTest`: local API and health requests to
  the random-port application on `127.0.0.1`.
- `HttpRoutingTrustBoundaryIntegrationTest`: local HTTP and raw-socket
  requests to `127.0.0.1`, with Java HTTP redirects explicitly disabled.
- `ObservabilityBoundaryPostgresql16GateTest`: local API, health, and
  Actuator requests to the random-port application on `127.0.0.1`, with Java
  HTTP redirects explicitly disabled.
- `XzErpAppChannelConnectorGatewayTest`: a source-locked suite whose actual
  requests use one-time `127.0.0.1` servers and whose synthetic public URLs are
  parsed/validated response data, not contacted destinations.
- `ChudaLogisticsProviderConnectorTest`: loopback token and channel fixtures
  with redirects disabled and bounded responses.
- `HualeiLogisticsProviderConnectorTest`: loopback account-authentication
  fixtures for the provider's documented `selectAuth.htm` contract.
- `ItdidaLogisticsProviderConnectorTest`: loopback login and channel fixtures
  for the shared ITDIDA contract used by the two configured providers.

`FlywayMigrationRehearsalIT` and `Pg16BackupRestoreRehearsalIT` parse JDBC
connection strings with `URI`; they do not implement HTTP egress. PostgreSQL
JDBC connections, Testcontainers database networking, Actuator server
endpoints, compose health checks, and the repository Nginx-to-backend upstream
are not business HTTP clients and are outside this gate's egress definition.

Shop authorization stores an opaque `vault://` or `credential://` reference.
The current runtime validates and stores that reference but does not dereference
it or use it as a network destination. Fulfillment tracking/provider URL fields
and Connector response URLs are passive business/response values; the reviewed
client never uses them as request destinations.

## Fail-closed invariants

The gate walks canonical regular files under backend production Java,
production resources, and backend tests. A missing required file or directory,
symbolic-link alias, unparseable dependency, zero declared gate tests, or a
skipped gate test is a failure.

Outside the exact source-locked review set, production fails when any of the
following appears:

- an HTTP client, URL connection, low-level DNS/socket API, process execution,
  proxy selector/environment lookup, or redirect-following surface;
- a `URI.create` call other than a relative `/api/v1/...` response
  `Location`;
- a URL/URI/endpoint/host/port/proxy/redirect/callback/webhook/destination
  request or domain field, SQL column, or unreviewed application property;
- request authority or an unreviewed request header, including `Forwarded` and
  `X-Forwarded-*`;
- an added, removed, or renamed Maven dependency.

The four adapters are the complete reviewed client set. Their exact source
hashes are the outbound allowlist; the gate rejects an added client, removed
review item, hash drift, or a renamed dependency. Reviewed destination
configuration is limited to `erp.channel-connector.xz-erp-app.base-url`, the
nine named `erp.logistics-connector.<provider>.base-url` properties, and the
separate deployment-owned label base URL for Shandianhou small parcels. Those
values are never accepted from tenant requests or stored business data.

The XZ ERP App adapter requires HTTPS for public hosts and restricts HTTP to
loopback or an explicitly enabled single-label private service. Chuda and
ITDIDA require HTTPS outside their loopback tests. The Hualei-family providers
publish HTTP account-authentication endpoints, while the Shandianhou Shangpai
variant uses the same reviewed adapter over HTTPS with its documented `/api`
prefix. That adapter accepts HTTP or HTTPS only from the deployment-owned base
URL. Every adapter rejects userinfo,
query, fragment, and path-traversal components, uses fixed request paths,
enforces a bounded timeout and response size, and explicitly uses
`HttpClient.Redirect.NEVER`. Tokens and account secrets are never surfaced in
connector results or logs; the ITDIDA token is sent only in its documented
fixed `Authorization` header.

When a candidate network location exists in a newly introduced client or
dynamic URI surface, the gate additionally reports forbidden:

- `file`, `jar`, `gopher`, and `ftp` schemes;
- userinfo, fragments, scheme-relative/UNC locations, backslashes, encoded
  delimiter/control confusion, and non-canonical numeric hosts;
- IPv4 and IPv6 loopback, unspecified, private, carrier-grade NAT, link-local,
  benchmarking, and multicast ranges;
- `localhost`, Docker host aliases, and known AWS/Azure/Alibaba/Google metadata
  addresses or names.

Candidate network locations found outside the reviewed adapters fail regardless
of hostname because no additional allowlist entry exists. Redirects are not
followed or processed, so cross-host and HTTPS-to-HTTP downgrades have no
permitted transition. No request-controlled proxy or redirect setting is
accepted.

## Negative-test coverage

The Node suite creates disposable source fixtures and a one-time
`127.0.0.1` HTTP stub. It covers:

- new client, reviewed-source drift, and dependency failures;
- request-controlled and persisted dynamic network destinations;
- all forbidden schemes and authority forms listed above;
- IPv4/IPv6 local, private, link-local/metadata, multicast, Docker-host, and
  numeric-host cases;
- DNS, socket, process, redirect, proxy, and forwarded-header trust surfaces;
- unreviewed/non-loopback test clients;
- missing files, source aliases, zero tests, skipped tests, and external CLI
  input;
- credential redaction and zero stub requests even when proxy and target
  environment variables point at the stub.

The suite uses no public DNS name resolution and makes no external request.
All fixture directories and the loopback listener are removed or closed by the
test lifecycle.

## Ownership and change procedure

This gate owns detection of the current reviewed-egress boundary. It does not add
runtime filters, permissions, API fields, state transitions, migrations,
dependencies, or deployment network policy.

A future production integration or change to the reviewed Connector surface
must stop at this gate and obtain explicit approval for its API/config/data
contract and threat model before refreshing a hash or adding an allowlist
entry. That review must define exact destinations and paths, DNS/address
handling, redirect and proxy behavior, timeouts, response limits, credential
handling, error redaction, and negative tests. A mechanical baseline refresh is
not approval.

The gate is a repository regression control, not a host/container egress
firewall. Deployment-level network policy remains operations-owned defense in
depth. Database connectivity and edge reverse-proxy policy continue to be
covered by their existing dedicated readiness, routing, resource-boundary, and
configuration gates.
