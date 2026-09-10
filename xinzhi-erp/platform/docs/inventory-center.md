# Inventory Center (V44 baseline, extended by V47)

## Scope

V44 established the first authoritative inventory quantity loop. V47 later
added fulfillment reservation facts at the same tenant + SKU + warehouse grain.
The current API therefore exposes both the V44 on-hand balance and the active
reservation projection; this document describes the current contract unless a
paragraph is explicitly marked as historical V44 scope.

- Balance key: tenant + SKU + warehouse.
- Quantity: signed Java/PostgreSQL `BIGINT`; zero deltas and the one
  non-reversible `BIGINT` minimum value are rejected.
- `reserved` is the sum of active fulfillment reservation quantities remaining
  after consumption and release.
- `available` is derived as `onHand - reserved`; subtraction must remain within
  the signed `BIGINT` range.
- Negative balances are valid facts. There is no limit, switch, approval, or
  alert policy in this release.
- Locations, disposition, lot, serial, UOM conversion, cost, currency, outbox,
  import, count, transfer and receipt remain out of inventory-center scope.
  Reservation commands and lifecycle belong to fulfillment; inventory-center
  only projects their active quantity into balance reads.

## Authorization and ownership

All endpoints derive the tenant from `ErpPrincipal`; DTOs contain no tenant
field and clients must not send `X-Tenant-Id`.

| Permission | Capability |
| --- | --- |
| `inventory.read` | Read balances and source-scoped projections exposed by allowed inventory workflows. |
| `inventory.adjust` | Create one adjustment or append one reversal. |

Both permissions are catalog-only in V44 and receive no automatic role grant.
Every endpoint also evaluates the V40 warehouse data scope. An out-of-scope,
cross-tenant, or mismatched resource is returned as the same safe 404.

## HTTP API

Root: `/api/v1/inventory-center`

### Balances

`GET /balances`

Query:

- `warehouseId?` UUID
- `skuId?` UUID
- `keyword?` max 100, matched against safe SKU code/name
- `page` default 0
- `size` default 50, range 1–200

Stable order is warehouse business code, SKU business code, then balance UUID.
The standard `PageEnvelope` item contains:

```text
id
skuId, skuBusinessCode, skuName
warehouseId, warehouseBusinessCode, warehouseName
onHand, reserved, available, version, updatedAt
```

`GET /balances/{balanceId}` returns the same item. Display fields are read-only
projections from product and warehouse master data, not copied ownership.

`GET /balance-summaries` accepts 1–50 repeated `skuId` UUID parameters and
returns `skuId`, `onHand`, `reserved`, and `available` totals across only the
requesting actor's visible warehouse scope. The response is unordered from a
business perspective and omits requested SKUs with no visible balance rows.
Callers that already obtained those SKU identities from a tenant-scoped product
read may display an omitted summary as zero within the visible scope; it must
never be treated as evidence about warehouses outside that scope. The endpoint
requires `inventory.read`, derives tenant and warehouse access from the
principal, and rejects batches above 50.

### Source-scoped event reads

Inventory-center exposes no general ledger-event browsing endpoint. The
allowed manual-movement workflow retains
`GET /manual-movements/{movementId}/ledger-events` under the inventory-center
root. It returns only events tied to that document; it is not a cross-document
ledger browse contract.

### Adjustment

`POST /adjustments`

Required headers:

- `Idempotency-Key`: 1–100 safe characters
- `X-Request-Id`: 1–100 safe correlation characters

Body:

```json
{
  "type": "OPENING_BALANCE | CORRECTION",
  "skuId": "UUID",
  "warehouseId": "UUID",
  "signedDelta": -5,
  "expectedVersion": 0,
  "reason": "SAFE_REASON_CODE",
  "note": "optional, redacted, max 500"
}
```

Only ACTIVE SKU and warehouse rows may receive a new adjustment. The service
locks both master rows and then the balance row before validating and writing.

### Reversal

`POST /ledger-events/{eventId}/reversal`

Uses the same required headers. Body:

```json
{
  "expectedVersion": 1,
  "reason": "REVERSAL_REASON",
  "note": "optional, redacted, max 500"
}
```

A reversal appends the exact opposite delta and references the original event.
It cannot target a reversal or an event already reversed. Master data must
still be ACTIVE, so archived facts remain read-only.

Both writes return:

```text
event: allowlisted event response
balance: allowlisted balance response at that command result
replayed: boolean
```

## Consistency and error semantics

- Event, projection, idempotency result and `SecurityAudit` commit in one
  PostgreSQL transaction.
- Scope is `(tenant, operation, Idempotency-Key)`.
- Same key and normalized fingerprint returns the original event and original
  balance snapshot without another event or audit.
- Same key with a different fingerprint returns safe 409 reason
  `idempotency_conflict`.
- Stale balance version returns `stale_version`.
- Inactive/archived master data returns `master_data_inactive`.
- A repeated/invalid reversal returns `reversal_not_allowed`.
- A nonzero balance blocks SKU/warehouse archive with
  `nonzero_inventory_balance`.
- Validation and numeric range failures are safe 400 responses.
- Internal SQL, exception messages, note text and request bodies are never
  returned.

Ledger events are protected by database append-only triggers. Reconciliation
replays signed deltas in ledger sequence order and must equal the balance
projection.
