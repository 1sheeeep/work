# Customer Service Module Integration

This module is designed to be copied or imported directly into the final host
system. The host owns authentication, tenant/shop membership, navigation and
HTTP routing. The module owns the returns/refunds workflow and a metadata-only
Shopify Payments dispute overview.

## 1. Backend wiring

1. Construct `connectorclient.Client` from a server-side HTTPS Connector URL
   and service token. Never expose either value to the browser.
2. Implement the `returns.Authorizer` and `disputes.Authorizer` ports from the
   host's own authorization system.
3. Construct `returns.Service` and `disputes.Service` once per process.
4. In every HTTP handler, derive `TenantID`, `ShopID` and `UserID` from the
   authenticated host session and shop membership. Do not accept those actor
   fields as trusted browser identity.
5. Translate the host request into the matching service command. Generate
   `CorrelationID` and `RequestID` at the host boundary and preserve the
   command `IdempotencyKey` across retries.

Capability mapping:

| Module capability | Host purpose |
| --- | --- |
| `customer-service.returns-refunds.manage` | Read return catalog, approve or decline a request, preview and execute a refund |
| `customer-service.disputes.read` | Read Shopify Payments dispute metadata; evidence remains in Shopify Admin |

The host adapters should expose the operations represented by
`frontend/src/contracts.ts`. Endpoint paths are intentionally host-defined;
the portable frontend accepts a `CustomerServiceApi` implementation instead
of importing a particular router or HTTP client.

## 2. Frontend wiring

Install the frontend package or copy it into the host workspace, then import:

```tsx
import {
  CustomerServiceWorkspace,
  type CustomerServiceApi,
} from '@xz/customer-service-module'
import '@xz/customer-service-module/styles.css'
```

Render `CustomerServiceWorkspace` with:

- the host's `CustomerServiceApi` adapter;
- only shops the signed-in user may access;
- capabilities calculated by the host session;
- an optional host-native confirmation function.

The module does not read cookies, local storage, ERP routes or ERP permission
codes. The host remains responsible for CSRF protection, authentication expiry
and safe error translation.

## 3. Refund safety contract

- The browser sends only selected return-line quantities, full-shipping choice
  and duty refund choices (`FULL` or `PROPORTIONAL`).
- The Connector obtains all amounts, currencies and original payment
  transactions from Shopify.
- The preview token is short-lived and binds the exact selection and Shopify
  amounts. Execution revalidates a fresh preview before calling Shopify.
- `PENDING` is not success. `REVIEW_REQUIRED` must create a visible manual
  review task in the host; neither state may be retried with a new
  idempotency key until Shopify state has been reconciled.

## 4. Verification before merge

Run from the copied module:

```powershell
cd backend
go test ./...
cd ..\frontend
npm.cmd install --ignore-scripts
npm.cmd run typecheck
npm.cmd test
```

Then verify the host adapters with authenticated tenant-isolation tests,
forbidden-capability tests, expired-session tests and an end-to-end test using
a non-production Shopify development store. Store authorization and app
installation remain manual operations.
