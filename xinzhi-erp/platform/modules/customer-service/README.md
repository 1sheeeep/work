# XZ Customer Service Module

This directory is the portable customer-service business module intended for
direct integration into the final host system. It is not an ERP submodule and
it is not a copy of the legacy desktop customer-service application.

## Ownership boundary

- The host system owns user sessions, navigation and deployment.
- This module owns customer-service workflows, including returns/refunds and
  Shopify Payments disputes.
- Shopify OAuth, secrets, access tokens, webhooks and Admin API calls remain in
  the Shopify Connector.
- This module calls the Connector only through tenant/shop-scoped HTTPS
  contracts. It never reads the ERP database and never stores Shopify secrets.
- ERP keeps only its customer-service entry/health surface and its own
  inventory, order-read and fulfillment workflows.

## Portable layout

- `permissions/shopify-capabilities.json`: capability ownership and the OAuth
  scopes ultimately required by the single published Shopify app. This is a
  planning/validation manifest; it does not change an app configuration.
- `backend/connectorclient`: dependency-free Go client for the scoped Connector
  contract. Feature packages build on this client.
- `backend/returns` and `backend/disputes` own their host-authorized workflows;
  HTTP handlers remain host adapters so the module does not impose a web
  framework on the final system.
- `frontend` packages expose host-agnostic pages and typed API clients.
- Future `migrations` are module-owned and must not add foreign keys to ERP
  tables; tenant, shop, user and order references remain external identifiers.

## Integration rule

Each capability is considered mergeable only when its backend contract,
frontend flow, migrations, permission checks, idempotency/recovery behavior and
tests are complete. The final host integrates completed capabilities directly;
the legacy customer-service production system does not need an intermediate
deployment.

## Current extraction status

- Connector foundation and connection probe: complete.
- Return request approval/decline contract and host authorization port:
  complete.
- Selected return-line refund preview and execution: complete. Amounts,
  currencies and original-payment transactions come only from Shopify's
  suggested financial outcome. A short-lived signed preview is revalidated
  before execution, and uncertain writes resolve to `APPLIED`, `PENDING` or
  `REVIEW_REQUIRED` after reading Shopify transaction state.
- Shipping and duty refund selection: complete. Operators may select full
  shipping refund and may select each duty as `FULL` or `PROPORTIONAL`.
  The module never accepts a manually entered shipping, duty or transaction
  amount; Shopify calculates every amount in the signed preview and the
  Connector revalidates that preview before execution.
- Dispute catalog and evidence edit/submit contracts, authorization ports and
  tenant-isolation validation: complete.
- Host-neutral return/refund and dispute pages: complete. The React package
  accepts a typed host API and explicit capability flags; it does not import
  ERP authentication, routing or API clients. Responsive light/dark styles and
  permission/read-only states are included.
- ERP legacy return/dispute routes, pages and Spring handlers: removed. The
  Connector remains the sole Shopify credential and Admin API owner.
