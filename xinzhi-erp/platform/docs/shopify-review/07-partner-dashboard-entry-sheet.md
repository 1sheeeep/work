# Partner Dashboard entry sheet

Use this sheet only after the exact build, legal answers, protected-data request, final media, and reviewer credentials are confirmed. It does not authorize payment, installation, or submission.

## Application values

### Required account access disclosure

Access requires an account provisioned and authorized by Xinzhi staff. This applies to every user and business, without exception. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access. Users without approved access contact staff via the support page. Provide a pre-approved isolated test account covering all submitted features in the restricted testing fields; it uses the same authorization checks as ordinary accounts, with no reviewer-only bypass. Explain the actual non-self-service onboarding model to Shopify; do not claim an exemption has already been approved.

| Partner field | Value |
| --- | --- |
| Organization / legal entity | `Aspen Ridge International Trade LLC` |
| Registration country/region | `United States` — company owner must verify against the registration record |
| Registered physical business address | `758 Locust Ave, Lochbuie, Colorado 80603, United States` — confirmed by the company owner |
| Monitored business email | `developer@xzkj.ai` — monitoring owner and coverage still require confirmation |
| Developer / company website | `https://www.xzkj.ai/` — canonical URL; the bare domain redirects here |
| Public company identity | `https://www.xzkj.ai/about/` — identifies `Aspen Ridge International Trade LLC` as the operator |
| Public company contact | `https://www.xzkj.ai/contact/` — publishes the same support, development and privacy inbox mapping used below |
| Brand/domain authorization reference | `{{COMPANY_AUTHORIZATION_REFERENCE}}` — the public website is corroborating evidence, but the approved internal ownership/authorization reference is still required |
| Associated Developer Account declaration | `No` — the historical `Weyr Uetgy LLC` Partner account belonged to and was controlled by that independent company. The current owner only provided development assistance, never owned or controlled that company or its Partner account, and ended that work. `Aspen Ridge International Trade LLC` has no ownership, control or common-control relationship with the historical company or account. |
| Dev organization ID | `229977658` |
| App ID | `407894786049` |
| Client ID | `6cef3dfc6b0d74e7c2709232f2938696` (public identifier only) |
| App name | `Xinzhi ERP` |
| App URL | `https://erp.xzkj.ai/shopify/app` |
| Privacy policy URL | `https://erp.xzkj.ai/shopify/privacy` |
| Terms URL | `https://erp.xzkj.ai/shopify/terms` |
| Merchant data processing terms URL | `https://erp.xzkj.ai/shopify/data-processing-terms` |
| Data deletion URL | `https://erp.xzkj.ai/shopify/data-deletion` |
| Support URL | `https://erp.xzkj.ai/shopify/support` |
| Reviewer guide URL | `https://erp.xzkj.ai/shopify/guide` |
| Support email | `support@xzkj.ai` — must be actively monitored |
| Privacy email | `privacy@xzkj.ai` — must have a verified request workflow |
| API contact email | `developer@xzkj.ai` |
| Submission contact email | `developer@xzkj.ai` |
| Emergency developer email | `developer@xzkj.ai` |
| Emergency developer phone | `+86 180 0262 9295` |
| Enterprise email DNS status | SpaceMail MX and SPF verified; `_dmarc.xzkj.ai` currently publishes `v=DMARC1; p=none; rua=mailto:developer@xzkj.ai` (reverified 2026-08-25). Monitored external receive/reply/escalation tests remain required. |
| Review store | `xinzhi-app-lab.myshopify.com` |
| Review store display name | `Xinzhi App Lab` |
| Demo store URL | `{{DEMO_STORE_URL}}` — direct useful Shopify connection-home path |
| ERP enterprise code / reviewer email | `xinzhi` / `uat.erp@example.com`; verify the existing native account and exact review build before reuse |
| Customer-service reviewer | Same ERP reviewer account; existing mapped seat and review-store permissions, no second password |
| Frozen complete requested scopes | `read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns` |
| Read all orders approval | `{{SHOPIFY_READ_ALL_ORDERS_APPROVAL_REFERENCE}}`; required for historical migration and long-running after-sales/customer-service lookup |
| Restricted dispute-evidence status | Shopify denied both restricted scopes because the Partner organization has less than one year of Shopify experience. They are not requested in this release; evidence remains in Shopify Admin. |
| Protected fields | Name, address, phone, email; requested individually |
| Pricing | Free; no recurring, one-time, usage, or off-platform app fee |
| Account access | One ERP account links the authorized store and enters Customer service through ERP. Supply one verified credential set in the restricted review field |
| App type | Regular app; not a Sales Channel |
| Online Store / Shopify POS required | Yes / No; Online Store is required because the submitted customer-service workspace includes the `Xinzhi Chat` Theme App Extension. Merchants may choose whether to enable the embed on a theme. |
| Primary / secondary category | `Orders and shipping` → `Inventory` → `ERP` / `Store management` → `Support` → `Helpdesk` |
| Primary listing language | English |
| Full-product UI language | Simplified Chinese only; validate English reviewer instructions/subtitles against the exact final path before submission |
| Listing visibility | Fully visible |

The exact requested scopes, TOML, runtime environment, listing copy, reviewer instructions, public privacy policy, and video must agree. Omit matching read scopes only where Shopify explicitly grants the read capability with the write scope. No dispute-evidence scope or capability is included in this release.

Use the canonical `https://www.xzkj.ai/` only for the developer/company website field. Keep the app URL, support URL, privacy policy, terms, data-processing terms and deletion URL on the application-specific `https://erp.xzkj.ai/shopify/...` routes; the corporate website policies explicitly cover the public website rather than Xinzhi ERP's Shopify data processing.

## App Store registration and USD 19 payment

This is the registration step that precedes listing submission. Completing the payment does not publish the app or submit it for review.

| Registration field | Value / manual boundary |
| --- | --- |
| Account ownership | `Entity` |
| Entity / business name | `Aspen Ridge International Trade LLC` |
| Country / region | `United States` — verify against the company registration record before confirming |
| Physical business address | `758 Locust Ave, Lochbuie, Colorado 80603, United States` |
| Business email | `developer@xzkj.ai` |
| Associated Developer Accounts | `No` — use the ownership/control explanation recorded above; the unrelated historical company account is not declared merely because development assistance was previously provided |
| Registration fee | One-time `USD 19`, if Shopify presents it for this account |
| Cardholder, billing address and payment method | Enter manually from the actual payer and card statement. Do not assume the registered company address is also the card billing address, and do not store payment details in this repository. |

Before the authorized account owner confirms payment, re-read the legal entity, country, address, email and Associated Developer Account answer on the live Shopify page. Stop if Shopify displays a materially different question or asks for information not covered by this sheet; capture only a redacted screenshot and resolve the wording before continuing.

## Reviewer account permissions

ERP effective permissions: `platform:read`, `shop:read`, `shop:authorization:write`, `products.read`, `products.listing.read`, `orders.read`, `orders.write`, `orders.shopify_edit.write`, `warehouses.read`, `inventory.read`, `inventory.shopify.publish`, `fulfillments.read`, `fulfillments.ship.write`.

Native customer-service effective permissions: `workbench.access`, `conversations.claim`, `conversations.reply`, `conversations.transfer`, `conversations.close`, `tickets.view`, `tickets.manage`, `shops.view`, `shops.channels.manage`, `shops.assign`, `visitor_schemes.manage`.

ERP validates the shared account, active session, enterprise and CHAT access. Customer service checks the mapped seat and business/shop permissions. Verify one reviewer credential set and canonical IDs. Do not auto-link emails, copy passwords or create dummy store ownership.

Each account is tenant-scoped and uses an existing local business role whose effective permissions cover its review path above. No reviewer-only module or special permission branch is required. Roles may contain other tenant business permissions, but platform-system administration is unnecessary and the instructions do not direct the reviewer into unrelated modules.

## Protected-customer-data purpose

Request name, address, phone, and email only. Xinzhi ERP uses them to identify the merchant's customer/order, prepare fulfillment, resolve delivery issues, and process order-specific after-sales work. It does not use them for advertising, profiling, lead generation, data sale/sharing, or unrelated marketing.

## Submission note skeleton

```text
Install Xinzhi ERP in the prepared development store. After Shopify authorization, use the tested native ERP account-linking flow to associate the Shopify-verified store with the authorized ERP enterprise. The exact tested credentials are supplied in Shopify's restricted reviewer-credential field. This draft must not be submitted until the new-store linking flow has been implemented and verified.

Use the single prepared ERP enterprise code, account and password supplied in Shopify's restricted reviewer field. Enter Customer service from ERP without another password, or enter those same credentials directly at the workbench URL without leaving the page. Customer service relays direct-login credentials transiently to ERP, never stores a second password, and creates its own session after validating the short-lived ERP grant and existing mapped seat. Raw ERP bearer tokens are not accepted as customer-service sessions or returned to the customer-service browser.

The submitted public Shopify app provides two complete, coordinated business workspaces under one Xinzhi ERP product. ERP handles product/SKU matching, customer and order identification, current and older-than-60-days order import, eligible order edits, location mapping, guarded inventory publication, merchant-managed fulfillment, returns/refunds, and dispute-metadata follow-up. Customer service handles the Shopify channel, Xinzhi Chat Theme App Extension, conversations/queues, assignments, claim/reply/transfer/close actions, related tickets, and the management surfaces present in the exact build. Both workspaces use the same app installation, Connector, scope set, tenant/shop relationship, and uninstall lifecycle.

The reviewer signs in once with the prepared ERP account, then selects Customer service in ERP to enter without another password. The direct workbench URL also provides on-page login using the same ERP enterprise code, account and password. Each business checks its own permissions and store assignments. Review Shopify-channel binding, the included Theme App Extension, a synthetic visitor message, claim/reply/transfer/close, a related ticket and storefront receipt without a second Shopify authorization. Historical order access is restricted to the explicit migration/traceability mode. Product publishing, customer marketing, payout reconciliation and dispute-evidence operations are not offered. Uninstall revokes the shared Shopify relationship for both businesses; reinstall reuses the canonical relationship. The Shopify Admin setup, configuration and connection-management journey, and both external workspace workflows, require exact-build verification before this draft is submitted.

Guide: https://erp.xzkj.ai/shopify/guide
Screencast: {{REVIEW_SCREENCAST_URL}}
Support: https://erp.xzkj.ai/shopify/support
```

Never place Client Secret, reviewer password, OTP, token, payment information, identity document, or unredacted customer data in Git, screenshots, logs, or chat. Reviewer credentials belong only in Shopify's restricted submission field or another approved secure handoff.
