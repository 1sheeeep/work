# Reviewer test instructions

## Contact and environment

- App submission contact: `developer@xzkj.ai`
- Emergency developer email: `developer@xzkj.ai`
- Emergency developer phone: `+86 180 0262 9295`
- Production app URL: `https://erp.xzkj.ai/shopify/app`
- Development store: `https://xinzhi-app-lab.myshopify.com`
- ERP enterprise code: `xinzhi`; the native ERP form requires this field. Verify the existing tenant and account against the exact isolated review build before reuse.
- Existing ERP reviewer email: `uat.erp@example.com`; verify its native credential, active account, effective ERP permissions and review-store scope.
- Customer-service tenant: existing partition explicitly mapped by ERP tenant/user IDs; no second login identifier.
- Customer-service reviewer: the same ERP account with CHAT access and prepared seat permissions.
- Reviewer credentials: provide one verified ERP enterprise code, account and password only in the restricted Shopify review field. Never put passwords in this repository.
- Test shop display name: `Xinzhi App Lab`
- Screencast URL: `{{REVIEW_SCREENCAST_URL}}`

The Xinzhi ERP app includes ERP, customer service and Xinzhi Chat. Use one ERP account: App Home → ERP → Customer service, without another password. The direct workbench URL also accepts the same ERP enterprise code, account and password on-page. Each business retains separate sessions and permissions. The direct form is deployed to copied-CS UAT; exact-build real-account login, installation and complete business-flow acceptance remain required.

### Required access through an existing ERP role

| ERP permission | Reviewer use |
| --- | --- |
| `platform:read` | Resolve the read-only Shopify platform directory used by the prepared store and product-preview selector. This is a tenant business-directory permission, not platform-system administration. |
| `shop:read` | Open the tenant store list, authorization summary, location mapping, and Shopify inventory preview. |
| `shop:authorization:write` | Install, refresh, revoke, and reinstall the prepared review store. |
| `products.read` | Open the ERP product module and its read-only online-product preview. |
| `products.listing.read` | Preview Shopify products and use mapped variants in an eligible order edit. |
| `orders.read` | Preview/import orders, query customer records, and view returns and disputes. |
| `orders.write` | Import the synthetic order, update an eligible shipping address, decide a return, and refund. |
| `orders.shopify_edit.write` | Edit an eligible unfulfilled Shopify order. |
| `warehouses.read` | View the preconfigured Shopify-location-to-ERP-warehouse mapping. |
| `inventory.read` | View the ERP balance and Shopify inventory comparison. |
| `inventory.shopify.publish` | Publish one explicit synthetic inventory value. |
| `fulfillments.read` | Open the prepared ERP fulfillment plan and package. |
| `fulfillments.ship.write` | Publish the prepared shipment and tracking number to Shopify. |

### Required customer-service permissions under the shared ERP account

| Customer-service permission | Reviewer use |
| --- | --- |
| `workbench.access` | Enter the customer-service workspace. |
| `conversations.claim` | Claim the prepared unassigned conversation. |
| `conversations.reply` | Reply to the prepared visitor message. |
| `conversations.transfer` | Transfer to the prepared synthetic agent. |
| `conversations.close` | Close and reopen the prepared conversation. |
| `tickets.view`, `tickets.manage` | Inspect, create and update the synthetic ticket. |
| `shops.view`, `shops.channels.manage`, `shops.assign` | Inspect/configure the prepared channel and agent assignments. |
| `visitor_schemes.manage` | Manage the prepared widget behavior scheme. |

ERP checks the shared account, active session, CHAT access and customer_service.read. Customer service checks the existing mapped seat status, business permissions and shop assignments. Never match accounts by email or copy passwords.

Use an existing tenant role whose effective permissions include the routes and actions above. Do not build or depend on a reviewer-specific permission module merely for submission. Broader tenant business permissions are acceptable when they are already part of that role, but platform-system administration is unnecessary and the reviewer steps must not navigate to unrelated modules. Prepare the location mapping, fulfillment package, chat visitor scheme, and agent assignment before review so the reviewer can follow the documented path without configuration work. Verify the effective permission list, not only the role name.

## Preconditions prepared by the developer

1. Every product, customer, order, address, phone, email, return, refund, tracking number, and dispute is synthetic.
2. The store contains multiple products and variants with SKU values that match prepared ERP listings.
3. Separate disposable orders are prepared for import/address update, order edit, shipment publication, and return/refund. Do not reuse one order across incompatible state-changing scenarios.
4. A clearly labelled synthetic customer, such as `Review Customer A`, has a visible recent-order link. Keep person-like contact fields out of public listing screenshots.
5. The Shopify-location-to-ERP-warehouse mapping is already configured and one inventory balance differs safely from the Shopify available quantity.
6. One return is in a state that can be approved and refunded with a Shopify-calculated refund preview.
7. Shopify Payments test mode is enabled where available, and a test dispute has been generated with Shopify's documented disputed-transaction test card. Confirm that its metadata is visible before recording; evidence is reviewed and managed only in Shopify Admin.
8. The single ERP reviewer account has the prepared ERP tenant and review-store scope; its existing mapped customer-service seat has the permissions above. Verify canonical IDs without creating or claiming duplicate identities.
9. Two synthetic customer-service agents/queues, one unassigned storefront conversation, and one disposable related ticket are prepared so claim, reply, transfer, close/reopen, and ticket actions remain isolated.
10. The **Support Chat** app embed under **Xinzhi ERP** starts disabled on the published review theme. The review store is explicitly routed to `https://kf-uat.xzkj.ai`; the production default remains `https://kf.xzkj.ai`. The synthetic visitor scheme and reviewer agent assignment are prepared before recording.
11. The final complete scope inventory requests exactly:

   `read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns`

   Matching read scopes are omitted only where Shopify explicitly grants the read capability with the write scope. The dispute workflow reads metadata only through `read_shopify_payments_disputes`; evidence remains in Shopify Admin.
12. Shopify has approved `read_all_orders` for the initial historical-order migration and long-running after-sales/customer-service lookup workflow: `{{SHOPIFY_READ_ALL_ORDERS_APPROVAL_REFERENCE}}`.
13. Shopify confirmed that App ID `407894786049` is not eligible for the two restricted dispute-evidence scopes because the Partner organization has less than one year of Shopify experience. The final build therefore excludes both scopes and every evidence-read/write feature or claim.
14. Complete the Shopify Admin installation, account-linking, configuration and connection-management journey, plus each workspace's native permission checks, before recording. A connection-status page with links is not acceptance evidence. The single ERP reviewer account and its mapped customer-service seat must reach all submitted features; permission-denied and cross-tenant cases are separate isolation tests.
15. Use the fixture separation and evidence checklist in `16-parallel-review-preparation.md`. Prepared names are not claims that records have already been created in Shopify.

## Test flow

### 1. Install and authorize

1. Install Xinzhi ERP from the Shopify-owned review surface.
2. Expand the permission groups and compare them with the exact scope set above.
3. Complete Shopify authorization and verify that the current store's Xinzhi ERP app reopens in Shopify Admin. Do not reuse a saved callback URL or send its authorization parameters to support. A status-only page does not complete the embedded business acceptance.
4. After Shopify authorization, choose **Link an existing ERP account**, then **Open ERP confirmation**. Use the prepared, staff-provisioned and authorized native ERP enterprise administrator, enterprise code and password; this first-link path requires the existing `tenant_admin` role and `shop:authorization:write`, plus `shop:write` if creating the canonical store. Confirm the Shopify-verified store and ERP enterprise. Return to App Home and retry the connection. The implementation is local only; exact-build persistent installation acceptance remains open. Do not submit this draft yet.

Access requires an account provisioned and authorized by Xinzhi staff for every user and business, without exception. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access. Users without approval contact staff through Support; they cannot access protected workflows. Supply a pre-approved isolated test account covering all submitted features before review, using normal permission checks without a reviewer-only bypass. Verify unapproved, disabled and access-revoked accounts cannot access protected data, and installing/retrying/reinstalling does not create enterprises or users.

Expected: Shopify authorization completes before account linking, without manual entry of a `myshopify.com` domain, and Xinzhi ERP shows the prepared store as connected. Verify that the documented review path needs no developer-supplied OTP, VPN, browser extension, special browser profile, private authorization link, or developer assistance; do not disable normal account security merely to meet this preparation requirement.

### 2. Verify store and scope state

1. In Shopify App Home, choose **Recheck ERP connection** under **Connection management**. Confirm the prepared store and saved connection. **Credential last updated** is a persistence timestamp, not proof of a live Shopify API check.
2. Choose **Check current Shopify permissions**. Compare the Shopify-reported required permissions with the frozen ten-scope configuration. Missing permissions, release/configuration mismatch and an unavailable check are separate results. Successful scope inspection alone does not verify the Connector token or native business access.
3. If an update is required, reopen Xinzhi ERP from Shopify Apps and complete Shopify's permission prompt if displayed, then recheck. Required-scope updates follow the released managed-install configuration, not an optional-scope request or an ERP login redirect. Persistent mismatch requires support investigation; do not uninstall as a permissions troubleshooting step.
4. Open the independent Xinzhi ERP workspace with its native account and select **EN** if needed. Go to **Settings > Channel Authorization > Store List**, open the prepared store and review its authorization state. Run the documented read-only API preview separately.

Expected: the store domain is `xinzhi-app-lab.myshopify.com`, the connection is active, all ten submitted scopes are covered, and unrelated scopes are not shown as submitted.

### 3. Review products and customer records

1. Open the Shopify product catalog preview and refresh once.
2. Confirm the synthetic product, variant, status, SKU, and ERP match result.
3. Open **Orders > Customer Directory**, query the prepared synthetic customer, and follow the recent-order link.

Expected: product refresh does not modify Shopify. The customer page shows only the minimum contact data, broad location, order count/spend, and recent-order relation needed for fulfillment and after-sales; it has no customer edit, marketing, export, conversation, or ticket action.

### 4. Import and safely edit eligible orders

1. Open the Shopify order preview, select the prepared import order, and choose **Import selected orders**.
2. Enable **Only search historical orders older than 60 days**, preview the prepared historical order, and import it. This mode fails closed unless `read_all_orders` is granted and the server adds the older-than-60-days cutoff.
3. Open the imported order and compare recipient, address, lines, totals, payment, and fulfillment state with Shopify Admin.
4. On the dedicated address test order, update one harmless synthetic shipping-address field and confirm the synchronized Shopify result.
5. On the separate unfulfilled edit order, change one line quantity or add one mapped variant/line discount, confirm explicitly, and compare the resulting lines and total with Shopify Admin.

Expected: import writes only to the tenant ERP workspace. Shopify writes occur only after explicit confirmation, use eligible disposable orders, and display the synchronized provider result. Do not continue an edit after fulfillment has started.

### 5. Map the location and publish inventory

1. Open the prepared location mapping and verify the Shopify location maps to exactly one ERP warehouse.
2. Open the prepared inventory balance and choose the Shopify inventory action.
3. Review ERP available quantity versus current Shopify quantity, then confirm **Publish to Shopify** once.
4. Verify the completed publication in ERP and Shopify Admin.

Expected: ERP shows the before/after comparison before writing, publishes only after confirmation, and safely resumes or reports an uncertain result without encouraging duplicate submission.

### 6. Publish the prepared fulfillment

1. Open the dedicated prepared fulfillment plan/package.
2. Confirm its item quantities, merchant-managed location, carrier, tracking number, and tracking URL.
3. Publish the shipment to Shopify and compare the resulting fulfillment/tracking state in Shopify Admin.

Expected: the app publishes only the prepared merchant-managed fulfillment quantities and tracking data. It does not buy a label or act as a third-party fulfillment service.

### 7. Process the prepared return and refund

1. Open **Orders > Returns and Refunds** and select the prepared return request.
2. Approve the request.
3. Enter an eligible refund quantity and choose **Preview refund**.
4. Compare Shopify's calculated amount and original payment method, then explicitly confirm the refund.

Expected: ERP never accepts a hand-entered refund amount. The page shows the synchronized applied, pending, or manual-review outcome and prevents blind duplicate submission.

### 8. Review test-dispute metadata

1. Open **Orders > Dispute Management** and select the prepared test dispute.
2. Review the synthetic order, amount, reason, state, timestamps, and processing deadline.
3. Refresh and confirm the metadata remains synchronized.
4. If evidence handling must be demonstrated, open the prepared dispute in Shopify Admin; do not enter or copy evidence into Xinzhi ERP.

Expected: Xinzhi ERP reads only the dispute metadata needed for operational follow-up. It cannot read, edit, upload, save, or submit evidence; all evidence handling remains in Shopify Admin.

### 9. Review the customer-service workspace and storefront support chat

1. In ERP select **Customer service** to enter `https://kf-uat.xzkj.ai` with the same account and no second password. Also open the workbench directly and sign in with the same ERP enterprise code, account and password without leaving the page. Confirm the enterprise and prepared review-store permissions; no second Shopify authorization occurs.
2. Review the customer-service overview, the prepared store/channel, agent assignment, queue or conversation list, tickets, and the available management surfaces. Do not open unrelated real records.
3. Open **Shopify channel**. Confirm that authorization is owned by Xinzhi ERP, the customer-service channel is bound, and the storefront widget says **Awaiting plugin enablement** when no load has been recorded. Review the prepared instant-answer and behavior settings.
4. In Shopify App Home, select **Check plugin setup** under **Xinzhi Chat setup**. Verify **App configuration matches** and the configured UAT address. Missing/mismatched data or an unavailable check must keep links locked; do not substitute a different enterprise or manually overwrite app data. A matched address does not prove the shared account's customer-service access or channel assignment works.
5. Select **Open theme editor (new tab)**. Alternatively, the customer-service channel's **Copy plugin enable link** copies the same official deep link for manual use in the matching store browser; it must not automatically open, switch or control that browser. Enable **Support Chat** under **Xinzhi ERP** in **App embeds**, customize and save the published theme. Return to App Home and recheck. Its theme-presence signal is advisory, not evidence of a saved toggle or working messages.
6. Manually preview the storefront, open the widget, and send a synthetic message.
7. Return to the customer-service workbench, claim the prepared conversation, reply, and verify that its synthetic customer/order context is tenant-scoped.
8. Create or update the related synthetic ticket, transfer the conversation to the prepared synthetic agent or queue, then close and reopen it using the documented controls.
9. Return to the storefront and verify that the reply arrives. Refresh the Shopify source through the normal customer-service page and confirm the recent widget load is shown. Disable the app embed and verify that the widget disappears.

Expected: ERP and customer service are separate, complete peer businesses in the same submitted Shopify application. Per-theme appearance and featured products are saved by Shopify's theme editor; customer-service operations stay in its workspace. No second Shopify authorization or automatic control of a store browser session occurs. Only synthetic records change. Embedded Shopify acceptance remains a separate prerequisite; this external-workspace scenario does not close it.

### 10. Uninstall and reinstall

1. In App Home **Connection management**, read the shared ERP/customer-service/Xinzhi Chat impact, then choose **Open Shopify app settings**. In Shopify **Settings > Apps**, select Xinzhi ERP and confirm **Uninstall** using an authorized merchant account. Opening settings itself must not revoke credentials or delete business accounts. This navigation and confirmation still require exact-build isolated Shopify acceptance.
2. Refresh the ERP authorization state and attempt a documented Shopify-backed read.
3. Generate a fresh authorization link, reinstall in the same development store, refresh status, and open the app again.

Expected: uninstall disables the credential and stops Shopify reads/writes. Reinstall restores the existing tenant-scoped store connection without creating a duplicate ERP store record.

## Negative checks

- Missing scopes produce a safe authorization message, not a provider error or credential.
- Cross-tenant shop or resource identifiers are rejected.
- Direct customer-service access uses the same ERP credentials on-page; ERP-to-customer-service entry remains passwordless. Verify wrong credentials, throttled attempts, disabled seats and permission denial stay on the login page. Reject raw ERP tokens, entry-grant replay and tenant/user/origin mismatch. Corresponding parent-session revocation, disabled accounts, removed CHAT access and expiry must end protected access (HTTP validation cache at most 5 seconds; WebSocket checks every 15 seconds). Direct login creates a separate ERP parent session; signing out of another browser session is not global sign-out.
- Invalid or expired authorization links do not connect a store.
- State-changing actions require their dedicated ERP permission and explicit user confirmation.
- Ineligible order, return, refund, inventory, fulfillment, or dispute state fails closed.
- The UI never exposes an access token, Shopify raw error, real customer value, or sensitive dispute content in an audit event.
- Disabling the app embed removes the storefront widget; an unavailable activation-status API leaves the official theme-editor link usable and does not request theme-reading access.

## Explicit exclusions

The submitted build does not write or publish product data, continuously synchronize the full historical order archive without an explicit merchant action, manage draft orders, perform customer marketing, reconcile payouts, read/edit/upload/submit dispute evidence, or buy shipping labels. The customer-service workbench is fully part of the submitted application; the state-changing review remains bounded to prepared synthetic Shopify conversations, agents/queues, and tickets. Non-Shopify channels do not justify any Shopify scope unless the exact reviewer instructions explicitly demonstrate them.
