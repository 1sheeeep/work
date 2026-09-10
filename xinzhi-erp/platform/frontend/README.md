# Xinzhi ERP Web

Browser-only React application shell for Xinzhi ERP. This frontend is intentionally
isolated from the legacy customer-service system and from production shops,
credentials, and data.

## Development

```text
npm install
npm run dev
npm run test
npm run typecheck
npm run build
```

Vite proxies `/api` to `http://localhost:8080` during local development. No
backend address, account, password, or token is embedded in the frontend.

## Application structure

```text
src/
  api/          Shared HTTP client and normalized API errors
  auth/         Authentication contract, adapter, session state, route guard
  components/   Persistent application shell and navigation
  modules/      Declarative ERP module catalog and route metadata
  pages/        Login, dashboard, module placeholders, and not-found state
```

`moduleDefinitions.ts` is the source of truth for module labels, navigation
groups, routes, expected API namespaces, exact stable permission codes, and
readiness states. Adding a module route should begin there.

`App.tsx` builds a TanStack Router route tree from that catalog:

- protected and public routes are separate layout branches;
- ERP pages are nested below the authenticated application shell;
- dashboard and module page implementations are loaded with route-level
  `lazy` imports;
- each route carries typed `staticData` used for navigation context;
- layout-level error components handle render and chunk-loading failures without
  disclosing internal error text;
- the guard is a layout route, so permission routes can be added without
  coupling authentication logic to page components.

### Route map

| Route | Module |
| --- | --- |
| `/login` | Public login |
| `/` | Protected ERP workspace |
| `/shops` | Shop center |
| `/shops/$shopId?syncPage&syncSize` | Protected shop detail and sync history |
| `/products?view&status&keyword&page&size&spuId&skuPage&listingPage` | Protected product identity and Shopify listing matching |
| `/orders` | Order center |
| `/procurement` | Procurement |
| `/inventory` | Inventory and warehouse |
| `/logistics` | Logistics |
| `/analytics` | Reporting and analytics |
| `/automation` | Automation |
| `/settings` | Organization, IAM, tenant settings, and audit |

Unknown protected routes resolve to the in-app not-found page. A signed-out
visitor is redirected to `/login`, with the intended internal URL preserved.

## Authentication contract

The frontend depends on the `AuthAdapter` interface in `src/auth/authApi.ts`.
The default HTTP adapter maps this IAM wire contract into the frontend's domain
types in that one file; page and route code never parse authentication responses.

### `POST /api/v1/auth/login`

Request:

```json
{
  "tenantCode": "string",
  "username": "string",
  "password": "string"
}
```

IAM successful response:

```json
{
  "tokenType": "Bearer",
  "accessToken": "opaque-bearer-token",
  "expiresAt": "ISO-8601-timestamp",
  "tenant": { "id": "uuid", "code": "string", "name": "string" },
  "user": { "id": "uuid", "username": "string", "displayName": "string" },
  "permissions": ["orders.read"]
}
```

The adapter stores the returned bearer token only in `sessionStorage`, never in
persistent local storage.

### `GET /api/v1/auth/me`

Uses the `Authorization: Bearer <accessToken>` header and returns:

```json
{
  "tenant": { "id": "uuid", "code": "string", "name": "string" },
  "user": { "id": "uuid", "username": "string", "displayName": "string" },
  "permissions": ["orders.read"],
  "expiresAt": "ISO-8601-timestamp"
}
```

It returns `401` when no valid session exists. The bootstrap request opts out of
the global 401 handler, and `AuthProvider` version-checks it, so an older result
cannot clear a newer login.

### `DELETE /api/v1/auth/session`

Invalidates the server-side session and may return `204`. The browser always
clears local credentials, including when the remote session has already
expired.

### Error envelope

Non-2xx JSON responses should use:

```json
{
  "code": "stable.machine_readable_code",
  "message": "Safe user-facing message",
  "details": {}
}
```

The shared client also reads an optional `X-Request-Id` response header.
Transport errors, timeouts, common HTTP status codes, and non-JSON responses
are normalized as `ApiError`.

## Identity and tenant context

`useAuth()` exposes:

- `currentTenant` and `currentUser`
- the complete `session`
- `status` (`initializing`, `authenticated`, `unauthenticated`, `unavailable`)
- `login`, `logout`, and `retry`
- `hasPermission(permission)`

The tenant identifier for business data must come from the authenticated server
context. Pages must not accept a tenant ID from a URL or form and forward it as
an authorization boundary.

## Shop Center

`/shops` uses `src/modules/shopCenterApi.ts` as its only platform-center wire
adapter. It calls the backend under `/api/v1/platform-center`:

- `GET /platforms?includeArchived&page&size` requires `platform:read` and is
  fetched once per page load (maximum 200 entries), never once per shop row.
- `GET /shops?includeArchived&page&size` requires `shop:read`; the tenant is
  supplied only by the bearer principal.
- `POST /shops` requires `shop:write` and sends only `platformId`,
  `externalShopRef`, and `displayName`.
- `GET /shops/{shopId}` requires `shop:read`. The URL parameter is validated
  as a UUID before a request is made.
- `GET /platforms/{platformId}` requires `platform:read`. Shop detail fetches
  this once, only for an operator who has that permission; it is never fetched
  per list row.
- `GET /shops/{shopId}/sync-jobs?page&size` requires `shop:sync:read`. It is
  fetched only on the detail route and only for operators with that permission.
  The `syncPage` and `syncSize` URL values are bounded to `0..9999` and
  `1..100` respectively.
- `POST /shops/{shopId}/sync-jobs` requires `shop:sync:write` and sends only
  `{ "jobType": "FULL" | "ORDERS" | "PRODUCTS" | "INVENTORY" }`. The UI
  makes the operator confirm before it creates a queued task; a `409` safely
  explains that an equivalent open task exists.
- `POST /shops/{shopId}/archive` requires `shop:write`. The UI requires an
  explicit confirmation naming the shop and explaining that authorization is
  revoked and open sync tasks are cancelled. It offers no hard delete.

The UI never sends or accepts `tenantId` or `X-Tenant-Id`. Authorization uses
only safe DTO fields (`credentialConfigured` and its type); it does not display
or accept `credentialReference`, raw OAuth values, or keys. Detail presents
only safe authorization metadata: status, configured/reference type,
provider-account reference, scopes, safe timestamps, and version. It discards
any accidentally supplied authorization diagnostic fields. Sync history maps
only the backend's safe error summary and deliberately omits error codes and
other internal diagnostics. `shop:read` remains the list and detail route
guard. `platform:read`, `shop:write`, `shop:authorization:write`,
`shop:sync:read`, and `shop:sync:write` are used for visibility of their
respective reads or operations. The authorization area is read-only in this
phase; it does not start OAuth or collect a credential. Frontend controls
remain usability guidance; the backend is authoritative for every request.

## Integration notes

- Keep IAM response translation in `authApi.ts`; do not duplicate token or
  session handling inside pages.
- Business API calls should use `apiClient.request()` so timeouts, credentials,
  bearer headers, error messages, and request IDs stay consistent.
- Module placeholders deliberately contain no sample orders, revenue, shops, or
  other production-looking data.
- The permission-gated Customer Service entry opens the independently deployed
  customer-service web application in a new browser window. ERP does not embed
  it or pass browser session data; development configuration remains loopback-only.
- Navigation, dashboard cards, and direct module routes all require the exact
  `requiredPermission` configured in `moduleDefinitions.ts`. The client 403 is
  usability guidance only; every business API must still enforce authorization
  on the server.

## Product Center first phase

`/products` exposes four bounded, URL-backed product identity views through its
only wire adapter, `src/modules/productCenterApi.ts`, under
`/api/v1/product-center`:

- `GET /spus?status&keyword&page&size` requires `products.read`; absent status
  preserves the backend default that hides archived SPUs.
- `GET /skus?spuId&page&size` requires `products.read`; the master view supplies
  a validated SPU UUID, while the inventory-identity and online-match views use
  the existing tenant-wide SKU query.
- `GET /listings?page&size` requires `products.listing.read`, is requested only
  for `view=online`, and never runs without that permission.
- New online matches can select only active shops whose platform catalog code is
  `SHOPIFY`. The product module writes local mapping metadata and never invokes
  the Shopify connector.
- `view=inventory` shows SKU identity only, with no stock balance or derived
  availability. `view=bundle` is an inert boundary until BOM, archive,
  inventory-algorithm, and migration contracts are approved.

The URL query is shareable and bounded: keywords are trimmed to 100 characters,
page values are `0..9999`, and page sizes are `1..100`. The adapter sends no
tenant selector or tenant header. It projects only safe business fields from
SPU, SKU, and listing DTOs; it does not retain credential references, OAuth
data, raw platform payloads, or server error messages. Existing create, update,
archive, and optimistic-concurrency actions remain gated by `products.write` or
`products.listing.write`; no batch, OAuth, inventory, or real-platform
synchronization action is exposed.

The IAM foundation currently publishes `shop:read` for Shop Center and
`platform:read` for organization/IAM settings; those two catalog entries match
that contract. The remaining business-module codes use the documented dotted
module-action convention and must be added to IAM role definitions before their
entries are granted to users.

## Router dependency decision

The former `react-router-dom@7.18.1` dependency reported high-severity
advisories in `npm audit --omit=dev`. The particular RSC path was not reachable
from this static Vite SPA, but the delivery rule is no high-severity production
dependency. Pinning the audit-suggested React Router `7.11.0` was tested and
still produced high-severity findings, so it was not shipped.

The application now uses `@tanstack/react-router@1.170.18`: a mature, typed
data router supporting nested/layout routes, route context and `beforeLoad`
guards, lazy route components, route metadata, pending states, and error
components. This preserves the ERP extension path without the observed audit
finding. Replacing the router is an intentional architecture decision, not an
`npm audit fix --force` result; the route catalog remains framework-neutral and
is the main future migration seam.

## UX baseline

The shell uses semantic color tokens, visible keyboard focus, a skip link,
route-change focus management, responsive drawer navigation, explicit loading
and error states, 44-pixel interactive targets, and
`prefers-reduced-motion` handling. Module pages use an intentional empty state
until real APIs are available.
