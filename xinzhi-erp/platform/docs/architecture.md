# XZ ERP Architecture

> **Status: PREPARATION_ONLY / CONDITIONAL_DEPLOYMENT_ALLOWED (2026-09-06).**
> The current approved target and preparation contract are in
> [production-customer-service-integration-preparation.md](production-customer-service-integration-preparation.md).
> This is not an implementation or production rollout claim. Product menus,
> fields and exclusions remain governed by
> [locked-product-scope-boundaries.md](locked-product-scope-boundaries.md).

## Current approved target

- One enterprise with ERP and the original customer-service business. Preserve
  the original customer-service accounts, passwords, identifiers, permissions,
  histories and origin; associate ERP identities only through reviewed mappings.
  Do not restore One, match accounts automatically by email or union privileges.
- Keep independent workspaces, business sessions and owned databases. Shared
  identity does not require migrating the production customer-service database
  into the earlier single-database layout below. Identity verification for ERP
  must not implicitly make customer-service agents available for reception.
- Shop-app onboarding stays in customer service; public SaaS onboarding stays
  in ERP. Each credential-owning service performs its own Shopify authorization
  and provider calls. Both businesses use controlled service interfaces and a
  stable enterprise/shop mapping; credentials do not cross into business DTOs.
- Reuse the existing ERP connector port and independent SaaS Connector.
  A per-shop active business-operation route, capability verification and
  durable command receipts must precede switching; do not execute the same
  mutation through both sources or automatically uninstall the old chat app.
- Preparatory deployment is conditionally authorized after verifying that
  existing system usage is unaffected and production integration remains
  disabled. There is not yet a new runtime slice to deploy. Production
  integration, real account merge, shop-authorization switching and copied-UAT
  retirement still wait for the user's separate notice and scoped authorization.

## Historical architecture notes — not the current migration instruction

All sections below retain earlier design and implementation context. Their
copied-customer-service target, independent native-identity target, single
credential-owner assumption, single-database topology and shared delivery
package are superseded where they conflict with the current target above.
They are not evidence that a migration has occurred. The old One plan in
[peer-business-identity-migration.md](peer-business-identity-migration.md)
remains retired; the deployed copied-service login baseline is recorded in
[shared-erp-customer-service-identity.md](shared-erp-customer-service-identity.md).

## Product boundary

ERP and the copied customer service are independent identity and business boundaries,
each with native credentials, account administration, entry URLs and sessions.
One is retired from their local authentication implementation; deployment is pending
the native-account checks in [native-business-identity.md](native-business-identity.md).
ERP owns catalog, orders, inventory and fulfillment. The Shopify connector
is the sole technical owner of installation credentials and provider API
access; neither ERP nor customer service duplicates that ownership.

The supported ERP experience is browser based. The imported customer-service
copy retains its Go service, frontend and necessary local-browser support. The
shared application switcher links accessible peer businesses, without an ERP
customer-service module or mandatory ERP sign-in. The workbench remains the copied customer-service
application on its dedicated origin; it is not embedded or rewritten inside an
ERP React page and does not modify the original customer-service repository or
production instance.

## Technology decisions

- Frontend: React + TypeScript, one web design system and route-level module boundaries.
- ERP backend: Java 25 + Spring Boot 4.1 modular monolith.
- Customer-service backend: retain and adapt the existing Go service instead of
  rewriting it in Java.
- Identity: each business verifies its own native credentials and sessions.
  ERP uses its existing IAM and platform administration. Copied customer service
  uses existing tenant partitions and local account/role/shop-scope checks.
  Tenant input selects a partition but never grants membership. No browser token
  is shared and neither business requires One or the other business to sign in.
- Shopify integration: one platform-owned connector boundary; ERP and customer
  service do not independently own Shopify credentials or call Shopify Admin API.
  Internal calls must authenticate the workload, bind the operation and canonical
  tenant/shop mapping, reject replay, and keep provider secrets out of business
  DTOs and logs.
- Shopify lifecycle: ERP initiates and displays public-app installation,
  reauthorization, suspension and removal for a canonical shop. The connector
  performs OAuth, token rotation, scope verification, webhook handling and
  programmatic uninstall. Customer service only consumes the resulting shop
  projection and owns Support Chat channel binding, behavior and runtime; the
  Shopify Theme App Extension owns only per-theme storefront appearance and
  featured-product settings. Customer service never offers a second Shopify
  authorization flow.
- Source and delivery: the ERP Java service, retained Go customer-service
  service, customer-service frontend/business logic and connector adaptations
  live in one repository and one versioned deployment package.
- Initial runtime shape: independently restartable containers on one server, not
  a distributed microservice estate.
- Primary data platform: one PostgreSQL instance and one `xz_platform` database.
  Bounded contexts use separately owned schemas and database roles.
- ERP-owned schemas use Flyway-only migrations. The imported customer-service
  schema keeps a separate migration history; migration tools must never share a
  history table or version space.
- Files and exports: S3-compatible object storage when the first file-heavy module is implemented.
- Cache and distributed locks: Redis only when a use case requires it.
- Asynchronous work: transactional outbox first; add a message broker only after measured throughput requires one.
- Deployment: containers built locally or in CI, never compiled on the production server.

The ERP modular monolith keeps core transactions manageable while the domain is
still changing. The Go customer-service service and the Shopify connector retain
process boundaries because mature code already exists and their failure/restart
profiles differ from ERP core. A single-server container deployment keeps current
operations simple without hard-coding services to localhost or preventing later
extraction.

These are internal Xinzhi platform boundaries. The single submitted Shopify app
includes both complete workspaces; it does not make one business a child of the other.

## Data platform and service ownership

The target business data shape uses PostgreSQL schema/role isolation. Existing
native identity records and historical mappings remain in place; Connector storage is not
claimed to have migrated merely because a target schema appears below:

| Schema | Canonical owner | Purpose |
|---|---|---|
| `iam` | ERP native identity and authorization | Credentials, accounts, historical mappings, ERP roles, permissions and data scopes |
| `erp_core` | ERP platform/order/product | Shops, customers, catalog and canonical orders |
| `fulfillment` | ERP warehouse/fulfillment | Warehouses, inventory facts, reservations, packages and shipment facts |
| `customer_service` | Customer-service service | Conversations, messages, tickets, assignments, templates and service automation |
| `shopify_connector` | Shopify connector | App profiles, encrypted credential material, webhook inbox and sync checkpoints |
| `integration` | ERP integration boundary | Versioned, least-privilege read projections exposed to customer service |

Schema ownership is enforced by distinct database roles. Sharing a database does
not authorize shared writes:

The imported customer-service service now has a local synthetic contract for a
fixed `customer_service` schema, its own checksum migration history, a migration
owner and a DML-only runtime role. Before migration SQL, it fails closed on role,
search-path, actual cluster/database/server identity, ownership, exact
current/default grants, or cross-schema create/write drift. Its synthetic
schema-role initializer is fresh-volume-only and refuses existing schemas,
roles, user objects and named-volume takeover; it does not inspect or migrate
legacy `public` data. Production enablement and real data migration remain
separately authorized work and have not been performed.

- customer service may write only `customer_service`;
- customer service may read only explicitly defined `integration` projections;
- ERP business writes go through ERP application services and state machines;
- Shopify credential material is never exposed through `integration`;
- order, inventory, money and fulfillment mutations from customer service use
  authenticated ERP command APIs with permission, idempotency and audit checks.

For the initial single-database deployment, `integration` may use ordinary views
or projection tables maintained from a PostgreSQL transactional outbox. A broker
and a second database are not required. The boundary remains versioned so a
separate read store or server can be introduced later without changing business
ownership.

## ERP technical module map

This map describes bounded technical ownership, not permission to add product
menus. The locked product-scope document always controls which entries are
visible or developed.

1. Native identity and business authorization: existing ERP credentials, account
   administration, roles, permissions, data scopes and business audit.
2. Platform and shop center: canonical shop identity, Shopify business
   authorization state, connector health and lifecycle actions. Credential
   material remains connector-owned and is represented only by a non-secret
   reference.
3. Product: SPU/SKU, categories, variants, media and Shopify catalog mapping;
   the excluded Mabang “开发” and “刊登” modules are not part of this boundary.
4. Orders and fulfillment: Shopify order ingestion, in-scope order operations,
   packages and shipment facts; Brazil NFe/NCM invoicing is excluded.
5. Procurement: purchase-related workflows only while supplier-facing features
   remain paused.
6. Inventory and warehouse: inventory facts plus only the six warehouse menus
   allowed by the locked scope.
7. Logistics: carrier, channel, label and tracking behavior within in-scope
   entries.
8. Customer-service integration: controlled order/shop APIs only, no ERP-owned
   customer-service navigation shell. All customer-service operations remain in
   the peer copied service.
9. Operational reporting and settings within in-scope menus; Cloud BI and
   finance features do not enter active scope.

## Multi-tenant and permission model

- Every business row belongs to a `tenant_id`.
- Shop access is a data scope, separate from feature permission.
- Permissions use stable codes such as `orders.read` and `orders.approve`.
- Roles aggregate permissions; user-role and role-permission assignments are tenant-scoped.
- Sensitive actions write immutable audit records with actor, resource, request ID, source and details.
- Platform credentials are never stored in the browser or application logs.

## Customer-service source reuse

The current customer-service system and original repository remain unchanged.
The ERP repository contains an isolated source copy whose provenance and import
exclusions are recorded in
[`../customer-service/IMPORTED_FROM.md`](../customer-service/IMPORTED_FROM.md).

- Reuse the copied Go backend, frontend and business behavior; do not rewrite
  the service in Java.
- Each business is directly reachable. The common switcher opens the peer in a
  new tab; the peer verifies its own native session. Missing/unsafe URLs fail closed.
- ERP owns store/platform-authorization relationships, integration health and
  exception summaries. Customer service owns conversations, tickets,
  assignments, email/plugin configuration, live queues, agent load and detailed
  performance reporting. Customer-service email authorization is never exposed
  as an ERP shop-channel mutation, and the same operational metric is not
  independently implemented in both systems.
- The copied service starts only its native tenant router. Old One/ERP SSO flags
  cannot select federated login. Existing tenant/user IDs, roles, shops and history
  are preserved; login never provisions unknown tenants or promotes old tokens.
- Customer service owns its native accounts, conversations, messages, tickets,
  assignments and local business authorization. No replacement identity platform
  or automatic credential/data migration is included.
- Shopify credentials stay in the authorized connector boundary and never
  enter browser storage, business DTOs or logs.
- Development does not access the original repository at runtime, production
  databases, production secrets, real stores or live traffic.
- Production migration, deployment or traffic switching requires separate
  explicit authorization.

## Shopify shop lifecycle ownership

The three user-visible shop actions are intentionally different and must not
be collapsed into one status update:

| Action | ERP effect | Connector effect | Customer-service effect |
|---|---|---|---|
| Suspend / resume | Pauses or resumes new ERP business sync and commands | Installation and credentials remain unchanged | Conversations, Support Chat and email continue independently |
| Unbind and uninstall | Projects authorization as revoked and blocks Shopify business commands | Calls Shopify `appUninstall`, clears connector-owned credentials, disables connector-managed sources and invalidates caches | The storefront app embed becomes unavailable; email channels are unchanged |
| Delete shop | Soft-deletes the ERP directory entry by archiving it; historical orders and audit facts remain | Allowed only after the installation is absent or revoked | The imported shop projection can be hidden; customer-service records remain subject to their own retention rules |

Reauthorization always reuses the existing canonical ERP shop. Authorization
failure, missing scopes and connector unavailability are separate recoverable
states: retry/reinstall is offered for authorization failure, while connector
unavailability offers a status recheck and does not silently revoke or delete
an installation.

## Environments and domains

- Local development: Docker Compose plus independently restartable Java, Vite
  and imported Go customer-service processes on the developer machine. The
  customer-service runtime has its own `/healthz` check and is started/stopped
  by the repository local-development entry.
- Temporary staging: isolated `/opt/erp-staging` stack on the current server, bound only to `127.0.0.1:18888` and accessed through an SSH tunnel.
- Existing production: `kf.xzkj.ai` remains unchanged during development.
- Target ERP domain: `erp.xzkj.ai` after DNS access and a dedicated TLS route are available.
- Initial production target: one dedicated server running independently
  restartable containers and one PostgreSQL instance, with resource limits,
  backups and restore evidence.
- Scale-out target: customer service, Shopify connector, PostgreSQL and object
  storage can move to separate capacity without changing their interfaces when
  measured load or availability requirements justify it.

The peer switcher navigates to customer service on its dedicated origin in a
new tab. Direct customer-service login does not require ERP. The service is
never embedded with an iframe. Any production domain or redirect change
requires separate authorization.

## Non-negotiable safety rules

- Development and staging never connect to real stores.
- ERP staging never uses the customer-service production database, volumes or secrets.
- Load tests and bulk imports do not run on the shared current server.
- Backups and restore drills precede any production data migration.
- Every release has health checks, bounded resources and a rollback artifact.
