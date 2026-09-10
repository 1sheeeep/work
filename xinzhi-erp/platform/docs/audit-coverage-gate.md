# Audit coverage and redaction gate

## Purpose

`platform/scripts/audit-coverage-gate.mjs` is an offline, fail-closed gate for
every state-changing `POST`, `PUT`, `PATCH`, and `DELETE` endpoint in the
reviewed API contract. A synchronous `POST .../exports` endpoint is treated as
read-only only when every required authority ends in `.read`; changing its
path or authority makes it audit-relevant again. The gate separates six
endpoint evidence classes:

- tenant authentication/session security events;
- tenant IAM and credential administration successes;
- transactionally committed tenant business writes;
- tenant writes that are permanently fail-closed and cannot emit success audit;
- platform-admin authentication/session security events; and
- transactionally committed platform-admin operations.

The machine-readable source of the classification and approved action/resource
contract is
`platform/contracts/audit-coverage-baseline.json`. The gate first runs the API
contract gate, then requires the current set of write endpoints to match the
audit classification exactly. A new write endpoint cannot inherit a category
or exception implicitly.

`PlatformAdminTenantWriteAuditFilter` remains separate supplemental evidence.
Its `platform_admin.tenant_write_attempted` row is written before controller
execution and therefore proves only that a system administrator attempted a
tenant write. It never counts as transactionally committed success evidence.

## Current coverage

The current contract contains 166 state-changing endpoints, all explicitly
classified. Twenty synchronous read-authorized export endpoints are outside
that count because they return generated content without changing state:

| Evidence class | Endpoints |
| --- | ---: |
| Tenant business transactional success | 128 |
| Tenant IAM transactional success | 12 |
| Tenant security event | 7 |
| Platform-admin transactional success | 15 |
| Platform security event | 4 |
| Tenant fail-closed without success | 0 |
| Attempted-only supplemental filter | 1 filter, not an endpoint success |

The established business endpoints are source-traced from the controller call to a
`@Transactional` application service and an atomic audit recorder:

| Controller operation | Approved action | Resource |
| --- | --- | --- |
| `ProductCenterController#createSpu` | `product_spu.created` | `product_spu` |
| `ProductCenterController#updateSpu` | `product_spu.updated` | `product_spu` |
| `ProductCenterController#archiveSpu` | `product_spu.archived` | `product_spu` |
| `ProductCenterController#createSku` | `product_sku.created` | `product_sku` |
| `ProductCenterController#updateSku` | `product_sku.updated` | `product_sku` |
| `ProductCenterController#archiveSku` | `product_sku.archived` | `product_sku` |
| `ProductCenterController#createListing` | `product_listing.created` | `product_listing` |
| `ProductCenterController#updateListing` | `product_listing.updated` | `product_listing` |
| `ProductCenterController#archiveListing` | `product_listing.archived` | `product_listing` |
| `ShopCenterController#createPlatform` | `platform.created` | `platform` |
| `ShopCenterController#archivePlatform` | `platform.archived` | `platform` |
| `ShopCenterController#createShop` | `shop.created` | `shop` |
| `ShopCenterController#archiveShop` | `shop.archived` | `shop` |
| `ShopCenterController#updateAuthorization` | `shop_authorization.updated` | `shop_authorization` |
| `ShopCenterController#createSyncJob` | `shop_sync_job.created` | `shop_sync_job` |
| `ShopCenterController#updateSyncJob` | `shop_sync_job.status_changed` | `shop_sync_job` |
| `WarehouseController#createWarehouse` | `warehouse.created` | `warehouse` |
| `WarehouseController#updateWarehouse` | `warehouse.updated` | `warehouse` |
| `WarehouseController#archiveWarehouse` | `warehouse.archived` | `warehouse` |
| `WarehouseController#createLocation` | `warehouse_location.created` | `warehouse_location` |
| `WarehouseController#updateLocation` | `warehouse_location.updated` | `warehouse_location` |
| `WarehouseController#archiveLocation` | `warehouse_location.archived` | `warehouse_location` |
| `OrderCenterController#createOrder` | `order.created` | `order` |
| `OrderCenterController#importShopifyCatalog` | `order.created` per imported order | `order` |
| `OrderCenterController#updateShopifyShippingAddress` | `order.shopify.shipping_address.updated` | `order` |
| `ProductCenterController#importShopifyCatalogListings` | `product_listing.created` per imported listing | `product_listing` |
| `FulfillmentController#publishShopifyFulfillment` | `fulfillment.shopify.published` | `fulfillment_package` |
| `OrderShopifyEditController#addVariant` | `order.shopify.variant.added` | `order_line` |
| `OrderShopifyEditController#addCustomItem` | `order.shopify.custom_item.added` | `order_line` |
| `OrderShopifyEditController#updateLineQuantity` | `order.shopify.line_quantity.updated` | `order_line` |
| `OrderCenterController#changeStatus` | `order.status_changed` | `order` |
| `OrderCenterController#changeLineSkuMatch` | `order.line.sku_matched` or `order.line.sku_unmatched` | `order_line` |
| `TrackingNumberController#importNumbers` | `logistics.tracking_numbers.imported` | `tracking_number_batch` |
| `TrackingNumberController#archive` | `logistics.tracking_number.archived` | `tracking_number` |

The baseline contains the endpoint-level action/resource mapping for all 33
security, IAM, credential, and platform-admin operations as well.

## Success, no-op, and failure semantics

A committed business audit is recorded after the aggregate write in the same
transaction. Shopify order quantity editing and fulfillment publication first complete or recover the
external mutation, then atomically commit the corresponding local state, command marker and audit;
if that local finalization fails, the recoverable reservation remains
instead of being misreported as a confirmed local success. The recorder requires
an existing transaction, so an audit insert failure rolls back the paired local
business write. Validation, authentication,
authorization, not-found, conflict, optimistic/concurrent failure, and database
constraint failure do not leave a committed success audit.

An exact idempotent replay or terminal no-op that does not change persistent
state does not create a second success row. This applies to existing listing
replays, already-archived resources, unchanged sync-job terminal replays,
unchanged order transitions, and already-revoked sessions or credentials.
These are state-change rules, not endpoint exceptions.

There are no write-endpoint audit exceptions in the current baseline. Failed
public login or credential redemption may emit a separately defined security
failure event, but never a success event.

## Detail boundary

New business audit details use only stable versions, enum states, counts, and
same-tenant related UUIDs. They do not contain request bodies, free-form names
or notes, contact information, credential references, passwords, tokens,
database/JDBC/SQL text, constraint names, or exception messages. Request IDs
are accepted only when they match `^[A-Za-z0-9._:-]{1,100}$`; source IP uses the
servlet remote address, matching the established actor pattern.

The real PostgreSQL 16 test executes all 22 newly covered product, shop, and
warehouse writes and requires exactly one approved success row with the correct
tenant, actor, action, resource, and version detail. It also proves both order
actor directions, cross-tenant isolation, 400/401/403/404/409 failures, audit
insert rollback, V39 concurrent loser rollback, and absence of supplied secret
markers from audit details.

## Commands

Run from the repository root:

```powershell
node --check platform/scripts/audit-coverage-gate.mjs
node platform/scripts/audit-coverage-gate.mjs
node --test platform/scripts/audit-coverage-gate.test.mjs
```

The PostgreSQL test must use its own Testcontainers PostgreSQL 16 instance.
Docker unavailability is a failure, never a skip. The approved nested Maven
container invocation mounts `/var/run/docker.sock`, uses
`TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal`, and passes the quoted
It does not accept an external JDBC URL.

## Capability boundary

The static gate parses the repository's current conventional Spring controller
and Java service structure; it is not a general Java compiler or control-flow
proof. It verifies reviewed action constants, resource literals, controller
calls, actor extraction, transaction annotations, and atomic recorder evidence.
The PostgreSQL test supplies the runtime transaction and tenant proof for the
high-risk business paths.

The gate does not deploy, connect a real shop, inspect `.env`, read process
secrets, follow symbolic links, accept a repository root/path/URL argument, or
execute production Java source.
