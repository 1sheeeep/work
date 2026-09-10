# Shopify connector runtime

Shopify Admin API ownership belongs to one platform connector. ERP and
customer-service business code must call its versioned internal HTTP contracts;
they must not own Shopify OAuth, credentials, token refresh, or Admin API
clients.

The independent runtime entrypoint is `cmd/shopify-connector`. It is built as a
separate process/container from `cmd/support-server`; `deploy/connector.Dockerfile`
provides the container build. The runtime currently owns the installation v1
foundation:

- OAuth authorization starts through a service-token-authenticated internal
  endpoint that creates a persistent one-time grant. The browser first visits
  the connector authorize endpoint to bind that grant to a Secure, HttpOnly,
  SameSite cookie; the public callback requires the same browser cookie,
  verifies Shopify HMAC plus the bounded signed state, and atomically consumes
  the grant before token exchange terminates inside the connector process.
- installation DTOs contain canonical tenant/shop identity and request and
  correlation IDs, but never serialize authorization codes or access tokens;
- the connector-owned file repository encrypts the complete payload with
  AES-256-GCM and preserves unique canonical, legacy-shop and domain bindings
  across restarts. Writes use copy-on-write and publish their in-memory snapshot
  only after the encrypted file has been atomically replaced;
- required scopes are checked before an installation is saved;
- installation lifecycle operations are serialized per canonical tenant/shop,
  so revoke effects cannot mark a concurrently replaced installation;
- revoke clears the token before applying customer-service source disablement
  and cache invalidation. Failed effects remain retryable and completed revokes
  are idempotent; a missing connector-owned installation fails closed and never
  claims that unmigrated legacy effects were applied;
- internal calls reuse `XZ_ERP_CONNECTOR_TOKEN` or
  `ERP_XZ_ERP_APP_CONNECTOR_TOKEN`. No second authentication stack is added.

The runtime now owns `POST /api/v1/erp-connector/shopify/connection` with the
`shopify.connector.connection.v3` contract. It reports the canonical
tenant/shop identity, connector repository state, normalized granted scopes,
the repository probe time, and the Shopify-verified shop name and
myshopify.com domain captured at OAuth completion. `CONNECTED` means that an `INSTALLED` record
and connector-owned credential exist; it does not claim a live Shopify Admin
API request succeeded and it does not include theme-embed readiness.

The runtime also owns
`POST /api/v1/erp-connector/shopify/product-catalog` with the
`shopify.connector.product-catalog.v1` contract. It resolves the canonical
installation and `read_products` authorization inside the connector, keeps the
provider credential inside that process, and returns only the catalog DTO
allowlist. Product variants are fully cursor-paginated; missing or repeated
cursors, disappearing parent products, malformed provider responses, and
provider failures all fail closed instead of returning a truncated page.

The runtime also owns `POST /api/v1/erp-connector/shopify/order-catalog` with
the `shopify.connector.order_catalog.v1` contract. It applies the same
connector-owned installation and credential boundary with the `read_orders`
gate, fully cursor-paginates every order's line items, and retains the explicit
11-item probe that rejects orders with more than 10 non-pageable fulfillments.
Only the existing order, amount, address and fulfillment-summary allowlist is
returned.

The runtime additionally owns the ERP read-side ReturnCatalog,
LocationCatalog, InventoryLevel and DisputeCatalog contracts. Return orders,
their returns, and every return's line items are cursor-paginated to
completion. The other three readers retain their existing whitelist and exact
scope gates; none of these providers contains a mutation.

The runtime owns the ERP InventorySet and FulfillmentPublish write contracts.
InventorySet retains compare-before-set quantities, the provider idempotency
key and the existing stale/rejected safe outcomes. Shopify Payments dispute
support is metadata-only; evidence stays in Shopify Admin and is not exposed
through a connector contract. FulfillmentPublish completely reads
fulfillment orders and line items before either recovering an exact tracking
and quantity match or issuing the existing fulfillmentCreate mutation; its
non-pageable fulfillment overflow probe still fails closed. Both use only
connector-owned credentials and their existing exact scope gates.

For the existing ERP Java base URL, `cmd/support-server` forwards these
connection, six read-side routes and these three write routes to the independent runtime
through the same typed HTTP client. Configure the support server with
`XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL` and the same service token. The base
URL must use HTTPS, except that loopback HTTP is permitted for a separate local
process. Missing, insecure, recursive, malformed, or mismatched targets fail
closed; the support server never falls back to its legacy Shopify token path.
The remaining Customer, Support, order edit and cancellation routes have not
yet been migrated.

Required runtime configuration:

- `SHOPIFY_CONNECTOR_DATA_FILE`
- `SHOPIFY_CONNECTOR_ENCRYPTION_KEY` (base64-encoded 32-byte key)
- `SHOPIFY_CONNECTOR_CALLBACK_URL`
- `SHOPIFY_APP_API_VERSION` (an explicit quarterly Admin API version)
- `SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE`: use `customer-service` when the
  deployment owns customer-service Shopify sources/caches, or the explicit
  `connector-only` mode when the connector is the only Shopify credential/data
  owner and no such downstream state exists
- the existing Shopify app API key, secret and scopes variables
- one of the existing connector service-token variables above

`customer-service` mode also requires
`XZ_CUSTOMER_SERVICE_INTERNAL_BASE_URL`. `connector-only` mode deliberately
does not call the customer-service server; it is suitable for the isolated ERP
review environment and must not be used after customer-service Shopify sources
or caches are introduced there.

For safe local whole-system development, run
`platform\scripts\start-local-dev.ps1` from the repository root. It builds this
existing entrypoint, binds it only to `127.0.0.1:8790`, uses an independent
encrypted scratch repository path that was proven absent before startup, and
uses the shared synthetic workload token. Random identity probes must return
`NOT_CONFIGURED`, but they are behavior smoke rather than proof of whole-repository
contents. External HTTP is routed to a closed loopback sink while connector
loopback calls remain available. The launcher does not invoke OAuth or migration
entrypoints and does not inherit real Shopify credentials.
The matching root stop script verifies the recorded executable and command line;
it never kills an arbitrary listener on port 8790 and removes scratch artifacts
only from the exact owner record.

Real local OAuth is an explicit, separate mode. Put the unpublished test app
credentials only in the current PowerShell process and pass the exact public
HTTPS callback that is registered for that app:

```powershell
$env:XZ_ERP_SHOPIFY_APP_API_KEY = "<test-app-api-key>"
$env:XZ_ERP_SHOPIFY_APP_API_SECRET = "<test-app-api-secret>"
.\tools\start-shopify-connector-dev.ps1 -OAuthTest `
  -CallbackUrl "https://<public-origin>/shopify/oauth/callback"
```

The launcher refuses OAuth mode when either credential or the exact HTTPS
callback is missing, stores neither credential in the repository, and keeps
the connector and its encrypted scratch data on the local workstation. The
public ingress must forward only the two OAuth paths to the loopback OAuth
gateway. Stop the verified offline connector before switching modes.

The separate one-shot `cmd/shopify-connector-migrate` entrypoint can import a
stable snapshot of historical installations into the connector-owned encrypted
repository. It reads exactly one explicitly configured legacy source directly:
`SHOPIFY_LEGACY_DATA_FILE` for a FileStore snapshot or
`SHOPIFY_LEGACY_DATABASE_URL` for a read-only PostgreSQL repeatable-read
snapshot. Legacy `enc:v1:` values require the explicit
`SHOPIFY_LEGACY_CREDENTIALS_ENCRYPTION_KEY`; the tool never falls back to
`AI_SETTINGS_ENCRYPTION_KEY`, a business access-token variable, or a
customer-service HTTP token-transfer endpoint. The target continues to use
`SHOPIFY_CONNECTOR_DATA_FILE` and `SHOPIFY_CONNECTOR_ENCRYPTION_KEY`.

The import preflights the complete non-empty batch and performs one
copy-on-write target commit. Target commits take a cross-process file lock and
compare a persisted repository generation, so either a concurrently active
writer or a stale connector/migrator handle fails closed instead of replacing
newer state. Exact reruns are idempotent; an empty source, invalid mapping,
hostname, token, scope, timestamp, uniqueness conflict, decryption failure,
source instability, stale target generation, or target persistence failure
imports zero records. Command output contains only status and counts. Running
it against any real legacy store, database, credential, or key requires
separate explicit user authorization; adding this command does not authorize
or execute such access.

This remains a migration foundation, not a compliance completion claim. The
one-shot tool does not delete or modify the old store, switch the old OAuth
callback, or replace existing customer-service Shopify readers and writers.
Historical installation data remains in the customer-service stores until a
separately authorized migration run and later cutover; those paths still
require contract-by-contract migration and must not be extended or use the
legacy environment-token fallback.

## Shopify compliance-request handoff

The connector accepts Shopify's mandatory privacy webhooks at
`POST /webhooks/shopify/compliance`. After HMAC, topic, domain, payload, and
installation checks, it stores an idempotent pending event containing only the
canonical tenant/shop identity and Shopify numeric references; contact values
from the webhook payload are not persisted.

XZ ERP can use the existing connector service token with these internal,
`Cache-Control: no-store` endpoints:

- `GET /internal/v1/shopify/compliance-requests` returns at most 100 pending
  compliance events.
- `POST /internal/v1/shopify/compliance-requests/complete` accepts `eventId`
  and a topic-compatible fixed outcome. `customers/data_request` permits
  `exported` or `not_found`; redaction topics permit `anonymized`, `deleted`,
  or `not_found`.
- `GET /internal/v1/shopify/protected-data-access-events` returns only the
  latest 100 encrypted-repository access events. It accepts no query input,
  requires the existing Connector service token, sets `Cache-Control:
  no-store`, and returns actor/internal-resource metadata and fixed field
  categories without recipient values.

Completion is idempotent, contradictory outcomes fail with conflict, and the
encrypted repository preserves completed state across restart. The Java ERP
connector gateway can strictly read pending requests and explicitly record
completion. The ERP platform-admin console now invokes those calls on demand for
bounded export, delivery confirmation, and anonymization of ERP-held Shopify
order data. Customer-service-held data coverage, an approved retention/deletion
procedure, and exact deployed synthetic evidence remain mandatory before any
public-app end-to-end compliance claim.
