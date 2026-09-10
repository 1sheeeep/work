# Access scopes and protected customer data

Shopify requires requested scopes to be necessary and demonstrable. The final submitted scope list must match the production build tested by the reviewer. A future roadmap is not sufficient evidence for a scope.

> **Approved product boundary:** one public Shopify application contains independent ERP and customer-service businesses with one shared Connector and Theme App Extension. Both businesses use the same ERP account, with separate business sessions, permissions and tenant/shop scope. Direct-login passwords are transiently relayed to ERP and never persisted as customer-service credentials; ERP bearer tokens are not returned to the customer-service browser. Current read-only App Home is not proof of compliant embedded setup and management. Each requested Shopify scope and protected field must have an implemented, verifiable reviewer workflow and the required approval before submission.

## Frozen complete ERP and customer-service scope inventory

`read_shopify_payments_dispute_evidences` and `write_shopify_payments_dispute_evidences` are Shopify-restricted scopes. Shopify Support confirmed that this app is not eligible because its Partner organization has less than one year of Shopify experience. They are therefore explicitly excluded from the current version, and the ERP dispute view is metadata-only.

Hard gates: retain `{{SHOPIFY_READ_ALL_ORDERS_APPROVAL_REFERENCE}}` for the historical-orders flow, and verify that neither denied dispute-evidence scope appears in the exact release build or review claims. The complete inventory below contains every Shopify Admin API scope that the current ERP and customer-service product boundary genuinely needs. Do not remove a required scope as a shortcut, and do not add unrelated candidate scopes without a new real business workflow and eligibility review.

| Scope | Merchant-facing purpose | Reviewer proof |
| --- | --- | --- |
| `read_all_orders` | Search and import orders older than Shopify's default order window for initial ERP migration, long-running after-sales traceability, and customer-service order lookup. | Existing “拉取平台订单” flow with the explicit “仅检索 60 天以前的历史订单” mode, scope preflight, server-enforced cutoff query, preview, and selected import. |
| `read_products` | Preview Shopify products and variants and match them to ERP SKU records. | Product preview and SKU-matching import. |
| `read_customers` | Search a tenant-scoped customer directory for order fulfillment and after-sales identification. | Customer Directory showing basic contact data, broad location, order count, spend, and last-order link. |
| `read_locations` | Resolve Shopify locations for ERP warehouse mapping and inventory publication. | Location-to-warehouse mapping. |
| `read_shopify_payments_disputes` | Show dispute amount, status, type, order link, reason, timestamps, and processing deadline. | Metadata-only Dispute Management list; evidence stays in Shopify Admin. |
| `write_inventory` | Read the current level and publish a guarded ERP available-inventory value. | Inventory preview, explicit publish, synchronized result, and safe retry. |
| `write_merchant_managed_fulfillment_orders` | Read merchant-managed fulfillment orders and publish an ERP shipment and tracking number. | Shipment handover and Shopify fulfillment result. |
| `write_order_edits` | Read calculated-order state and add/edit eligible lines or line discounts before fulfillment. | Quantity, mapped-item, custom-item, and discount scenarios with explicit confirmation. |
| `write_orders` | Read/import current orders, update an eligible shipping address, or cancel an eligible order. | Order preview/import/detail plus address and cancellation scenarios. |
| `write_returns` | Read, approve/decline, refund, and close eligible Shopify returns. | Return list, decision, refund preview, explicit refund confirmation, and synchronized result. |

The frozen complete target string is:

`read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns`

Shopify documents that many write scopes include their corresponding read capability, so redundant `read_inventory`, `read_merchant_managed_fulfillment_orders`, `read_order_edits`, `read_orders`, and `read_returns` scopes are intentionally omitted. `read_shopify_payments_disputes` supplies only the operational dispute metadata used by this release. Evidence reading and writing are not requested or implemented and remain in Shopify Admin.

This ten-scope inventory is the final current-release boundary, not a fallback.

The ERP fulfillment flow supports merchant-managed locations only. Do not request `read/write_assigned_fulfillment_orders`, `read/write_third_party_fulfillment_orders`, or generic `read/write_fulfillments` for this flow. A carrier or shipping-label API can supply a tracking number independently; that does not turn the Shopify fulfillment order into an assigned or third-party fulfillment-service order.

The storefront-chat activation flow adds no Admin API scope. Customer service derives recent widget activity from the existing `shopify_chat` source heartbeat and generates Shopify's official `activateAppId={api_key}/{handle}` theme-editor deep link only for an explicit copy action. It does not query themes, automatically open or control a browser, poll Shopify, or add `read_themes`.

## Explicitly excluded scopes: do not submit without a later approved scope change

| Scope group | Reason excluded and reconsideration gate |
| --- | --- |
| `write_products`, `read_publications`, `write_publications` | Product create/update/publish UI, permission, durable command, audit, retry and reviewer scenario. |
| `read_draft_orders`, `write_draft_orders` | Draft-order list/create/edit UI and reviewer scenario. |
| `read_fulfillments`, `write_fulfillments`, `read_assigned_fulfillment_orders`, `write_assigned_fulfillment_orders`, `read_third_party_fulfillment_orders`, `write_third_party_fulfillment_orders` | Excluded from the ERP merchant-managed fulfillment flow. Reconsider only if the product later becomes or controls a Shopify FulfillmentService workflow. |
| `read_shipping`, `write_shipping` | A real delivery/shipping configuration workflow. |
| `read_discounts`, `read_price_rules` | A visible discount reconciliation workflow. |
| `read_markets` | A visible market/currency/region workflow. |
| `read_shopify_payments_payouts` | A payout reconciliation interface and reviewer scenario. |
| Any dispute-evidence read, write, upload, or submission scope | Future eligibility plus a complete supported evidence workflow, validation, retention controls, and reviewer scenario. No evidence feature is submitted now. |

## Protected customer data request draft

The approved first-review path retains the Level 2 fields. The deployed build, listing, reviewer instructions, screencast, privacy policy, and Partner Dashboard answers must all tell this same data-use story.

### Business purpose

Xinzhi ERP is an order, fulfillment, and storefront support system. It uses customer data only to let an authorized merchant import, identify, support, and fulfill the merchant's own Shopify orders, and uses visitor-submitted chat data only to maintain and answer the requested support conversation. The app does not sell customer data, build advertising profiles, or use the data for unrelated marketing.

### Data fields required

| Data | Purpose | Visibility/storage rule |
| --- | --- | --- |
| Order identifier | Identify the merchant's order and prevent duplicate import. | Tenant-scoped operational records; no cross-shop search. |
| Recipient name | Identify the correct delivery recipient during warehouse preparation and order-specific support. | Visible only to authorized order users; omitted from security audit details. |
| Shipping address | Prepare and verify delivery for the merchant's order. | Visible only to authorized order users; omitted from security audit details. |
| Phone | Resolve delivery-contact issues for the merchant's order. | Tenant-scoped; not used for Xinzhi ERP marketing. |
| Email | Identify the order recipient and resolve order-specific support issues. | Tenant-scoped; not used for Xinzhi ERP marketing. |
| Order line items, quantities and amounts | SKU mapping, warehouse preparation and order reconciliation. | Tenant-scoped order records. |
| Storefront message and attachment | Let the visitor request support and let an authorized merchant agent reply. | Tenant- and shop-scoped customer-service records; file validation and retention controls apply. |
| Random visitor/conversation identifier | Maintain chat continuity across page loads without using Shopify credentials. | Scoped by shop and not used for advertising tracking. It remains session-only unless Shopify's Customer Privacy API allows preference processing, in which case the widget can persist it across visits. |
| Page and product context | Show the merchant where the visitor opened the support request. | Stored only with the relevant conversation. |
| Visitor-entered order number and email | Perform the visitor-requested order-status lookup. | Voluntary workflow input; not used for marketing. |

In Partner Dashboard, select the protected fields for **name**, **address**, **phone**, and **email** individually. Do not request fields outside this table. The embedded order endpoint returns these four fields only for the order preview route; product and session routes do not return order contact data.

### Data minimization and access controls

- Tenant and shop ownership is checked on every ERP command and connector request.
- Role permissions and shop data scopes restrict order, inventory, fulfillment, returns, disputes, and customer-directory access.
- Review access covers the complete submitted customer-service lifecycle with native `workbench.access`, `conversations.claim`, `conversations.reply`, `conversations.transfer`, `conversations.close`, `tickets.view`, `tickets.manage` and the documented channel/configuration permissions. Restrict resources to the synthetic review shop. ERP CHAT access and customer_service.read allow secure entry; customer-service seat permissions and shop assignments are checked separately.
- Shopify access tokens remain in the unified connector and are never returned to ERP Java or the browser.
- Provider errors are mapped to fixed safe errors; logs and audits exclude token, address and sensitive dispute content.
- Catalog readers fail closed on detected nested truncation rather than silently importing incomplete data.
- Uninstall disables the installation; privacy webhooks support data access and erasure processing.

The complete Level 2 control/evidence matrix and unresolved operational evidence are tracked in `10-level2-data-protection-evidence.md`.

### Level 1 privacy decisions required by the Level 2 route

Level 2 does not replace Level 1. Before submission, the privacy owner must separately confirm and evidence all four items below; OAuth scope approval alone is not customer consent:

- storefront consent decisions apply to the widget's optional persistent preference storage; the widget reads Shopify's Customer Privacy API, defaults to session-only storage, and enables persistent continuity only while preference processing is allowed;
- whether any processing is legally classified as a data sale or sharing and, when applicable, how opt-out requests are received and enforced;
- that the reviewed path performs no profiling, scoring, prediction, or automated decision with legal or similarly significant customer effects, or otherwise provides an opt-out and manual-processing route;
- approved merchant privacy/data-protection terms covering processing roles, responsibilities, retention, transfers, and subprocessors.

The reviewed first-version purpose remains order fulfillment and order-specific support only. It does not use recipient fields for advertising, profiling, lead generation, data sale, or unrelated marketing. These product statements still require privacy-owner confirmation against the exact submission build and actual operating practices.

### Public privacy and retention fields to complete

2026-09-08: The retention, backup and deletion policy answers below reuse section 10 of the [owner-approved 2026-08-17 terms](14-merchant-data-processing-terms-draft.md). They are not new legal decisions or verified current operating facts. Exact-build all-store deletion, encrypted backup/restore, legal-retention applicability and completion receipts remain required under `L2-DEL-01` and the submission checklist. Remaining supplier/region and transfer fields require current evidence. Do not present policy approval as proof that operating controls have passed.

- Legal entity, official company website and physical business address: `SHOPIFY_PUBLIC_LEGAL_NAME`, `SHOPIFY_PUBLIC_COMPANY_WEBSITE`, `SHOPIFY_PUBLIC_BUSINESS_ADDRESS`
- Operational retention policy → `SHOPIFY_PUBLIC_ORDER_RETENTION`: Personal data is retained only while the merchant uses the service and it remains necessary for fulfillment, after-sales work, or support. Verified access, deletion, and Shopify redaction requests must complete within 30 days after receipt. Legally required transaction/security facts are retained only in de-identified form and only to the necessary extent.
- Backup policy → `SHOPIFY_PUBLIC_BACKUP_RETENTION`: Encrypted rolling backups are retained for no more than 30 days. Deleted personal data expires within that period and is not restored for normal operations; applicable deletion requests are reapplied after disaster recovery.
- Privacy request response email: `privacy@xzkj.ai`; named privacy officer/contact or approved not-applicable wording → `SHOPIFY_PUBLIC_PRIVACY_OFFICER`
- Merchant deletion procedure → `SHOPIFY_PUBLIC_DELETION_PROCESS`: Verify requester identity/authority and Shopify webhook signatures, durably record the request, and have an authorized administrator execute the applicable export, anonymization or deletion. Retry and escalate failures. Webhook receipt alone is not completion; verified requests must complete within 30 days.
- Subprocessors and processing regions: `{{SUBPROCESSORS_AND_REGIONS}}` → `SHOPIFY_PUBLIC_SUBPROCESSORS`, `SHOPIFY_PUBLIC_PROCESSING_REGIONS`
- International or other data-transfer safeguards: `{{TRANSFER_MECHANISM}}` → `SHOPIFY_PUBLIC_TRANSFER_MECHANISM`

These entries require real legal and operational decisions; an example or inferred value is not acceptable. The public routes intentionally return HTTP 503 until every required public field is configured. Webhook receipt creates a durable pending compliance event, and the ERP platform-admin console now executes export/delivery confirmation and ERP-held Shopify order-data anonymization. `L2-DEL-01` remains a production-evidence blocker until customer-service-held data is covered, the operating procedure is approved, and a synthetic request completes against the exact deployed build. Do not submit the protected-data form while any placeholder remains, any app-held data store is outside the approved procedure, or the deployed privacy URL does not render the approved values.

Official privacy-policy guidance snapshot checked 2026-08-06: [Shopify privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements). Recheck the live page immediately before submission.
