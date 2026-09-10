package installations

// This guide is public and credential-free. It describes the review workflow;
// rendering it is not evidence that identity, embedded or store tests passed.
const reviewerGuideContent = `<article class="review-guide">
<h1>Xinzhi ERP Installation Guide</h1>
<p><strong>Prior approval required.</strong> Access requires an account provisioned and authorized by Xinzhi staff. This applies to every user and business, without exception. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access. Contact <a href="mailto:{{.SupportEmail}}">{{.SupportEmail}}</a> for account provisioning and access approval; never send passwords or tokens.</p>
<p>One Xinzhi ERP Shopify installation connects ERP operations and an independent customer service workbench. They share the store installation and Connector, but each workspace checks its own business permissions and store access.</p>
<p>For review, use only the prepared development store and separate synthetic, disposable records. One verified ERP account and enterprise code are supplied in the restricted review instructions; customer service uses that same account. Never send passwords, access tokens or customer payment information to support.</p>
<h2>On this page</h2>
<ul class="guide-contents">
<li><a href="#install">Install and link your account</a></li>
<li><a href="#erp-workflows">Review ERP workflows</a></li>
<li><a href="#support-chat">Enable storefront support</a></li>
<li><a href="#conversation-lifecycle">Complete a support conversation and ticket</a></li>
<li><a href="#uninstall">Disable, uninstall and reinstall</a></li>
<li><a href="#recovery">Troubleshooting and safe recovery</a></li>
</ul>

<h2 id="install">1. Install and link your account</h2>
<ol>
<li>Install Xinzhi ERP from the Shopify review or App Store surface and inspect the requested permission groups. Complete Shopify authorization before linking a Xinzhi account; do not manually enter a shop domain to start installation.</li>
<li>Choose <strong>Link an existing ERP account</strong>, then <strong>Open ERP confirmation</strong>. Use your staff-provisioned and authorized account through <strong>ERP native login</strong> with its enterprise code, email and password. A native enterprise administrator must confirm the Shopify-verified <code>myshopify.com</code> store and permitted ERP enterprise. Return to Shopify Admin and retry the connection. If you do not have approved access, contact Xinzhi staff first. No enterprise or account is created by installation, login attempts or linking. Reviewers use the pre-approved test account supplied in the restricted instructions, with the same permission checks as other users.</li>
<li>An <strong>Authorized, linking pending</strong> state confirms only the Shopify authorization step. It does not create an ERP store or grant access to orders, customers or storefront configuration. These remain locked until the native administrator completes linking.</li>
<li>Open the app in Shopify Admin and verify the documented installation, account linking, configuration and connection-management workflow. A connection-status page alone is not the complete embedded business experience. Independent ERP operations and continuously monitored customer conversations may use their own workspaces; external links alone do not prove that the required in-Admin setup and management work. Stop a blocked scenario and contact support.</li>
<li>In the ERP Store List, verify that the prepared store is Authorized and the submitted scope checklist is complete. Use the same store throughout the ERP and customer-service scenarios.</li>
</ol>
<p>ERP and customer service share the existing ERP account without One. Select Customer service in ERP to enter without another password. At the direct workbench URL, enter the same ERP enterprise code, account and password to sign in without leaving the page. Each business retains separate sessions and permission checks. Direct-login passwords are transiently relayed to ERP, not stored as customer-service credentials; ERP bearer tokens are not returned to the customer-service browser. Matching emails do not link identities.</p>

<h2 id="erp-workflows">2. Review ERP workflows</h2>
<p>Complete the matching scenario before claiming a requested scope works. Check the displayed before/after values and Shopify's result; an empty list or a successful login is not proof of a business action.</p>
<ol>
<li><strong>Products and customers:</strong> preview the prepared products and variants, compare SKU mappings (<code>read_products</code>), and find the synthetic customer's recent-order relationship (<code>read_customers</code>). These reads do not edit Shopify products or customer profiles.</li>
<li><strong>Current orders:</strong> preview and import the prepared order. Import writes ERP-local records only. Use a separate eligible disposable order for an explicitly confirmed address update or cancellation (<code>write_orders</code>).</li>
<li><strong>Historical orders:</strong> select the older-than-60-days mode and preview an order that actually meets that cutoff before importing it (<code>read_all_orders</code>). If the store has no qualifying test order or approval is missing, this scenario remains unverified; do not change local dates to simulate it.</li>
<li><strong>Order edits:</strong> on a separate unfulfilled order, review and confirm a quantity, mapped-line or discount change (<code>write_order_edits</code>). Do not reuse an order after fulfillment has begun.</li>
<li><strong>Inventory:</strong> inspect the location-to-warehouse mapping (<code>read_locations</code>), compare ERP and Shopify quantities, then confirm one prepared publication (<code>write_inventory</code>).</li>
<li><strong>Fulfillment:</strong> inspect the prepared package, merchant-managed location, quantities and test tracking details, then confirm shipment publication (<code>write_merchant_managed_fulfillment_orders</code>). This does not buy a shipping label or act as a third-party fulfillment service.</li>
<li><strong>Returns and refunds:</strong> approve the eligible prepared return, review Shopify's calculated refund preview and explicitly confirm the operation (<code>write_returns</code>). Do not substitute a hand-entered refund amount.</li>
<li><strong>Disputes:</strong> review the prepared test-dispute status, amount, reason, related order and processing deadline (<code>read_shopify_payments_disputes</code>). Xinzhi ERP does not read, edit, upload or submit dispute evidence; merchants handle evidence in Shopify Admin.</li>
</ol>

<h2 id="support-chat">3. Enable storefront support</h2>
<ol>
<li>In Shopify Admin, open <strong>Xinzhi Chat setup</strong> and select <strong>Check plugin setup</strong>. App configuration must match the bound enterprise and the configured service address. A mismatch or unavailable result leaves setup links locked; contact support rather than changing enterprise IDs or destinations manually. This check does not validate customer-service credentials or agent assignments.</li>
<li>In ERP select <strong>Customer service</strong> to open the workbench without another password. Direct workbench access accepts the same ERP enterprise code, account and password on-page. Verify the correct enterprise and prepared review store; this does not request a second Shopify authorization.</li>
<li>Open the store's <strong>Shopify channel</strong>. Confirm that authorization belongs to the shared Xinzhi ERP application and that the customer-service source is bound. Verify the prepared agent assignment, instant answers and behavior scheme.</li>
<li>From App Home select <strong>Open theme editor (new tab)</strong>. Alternatively, the customer-service Shopify channel's <strong>Copy plugin enable link</strong> copies the official deep link for manual use in the matching store's browser. The copy action never opens, switches, or controls a browser. No automatic browser navigation or <code>read_themes</code> permission is required.</li>
<li>Enable <strong>Support Chat under Xinzhi ERP</strong> in <strong>App embeds</strong>, configure the prepared welcome message and appearance, and save the published theme. Return to App Home and check again. Theme detection is advisory and covers only the published theme; a detected embed is not proof that its toggle was saved or that messaging works.</li>
<li>Preview the storefront manually, open the widget and send a clearly synthetic visitor message. Theme-specific appearance and featured products are managed in Shopify's theme editor; conversation operations stay in customer service.</li>
</ol>

<h2 id="conversation-lifecycle">4. Complete a support conversation and ticket</h2>
<ol>
<li>In the customer service workbench, <strong>claim the conversation</strong> and verify its prepared shop and customer/order context before replying.</li>
<li>Send a reply and verify that the storefront widget receives it.</li>
<li><strong>Create or update the related ticket</strong> and confirm the association and saved result.</li>
<li><strong>Transfer the conversation</strong> to the prepared synthetic agent or queue and verify the new assignment.</li>
<li>With the appropriately authorized assigned agent, <strong>close and reopen the conversation</strong>. Confirm the final status and return to the storefront to verify the result.</li>
</ol>
<p>Provide one verified ERP reviewer account with access to both submitted businesses and the prepared stores. ERP session tokens are rejected as customer-service sessions: entry uses a short-lived, single-use proof and a separate customer-service session. An ERP-only account does not receive customer-service access automatically. Verify disabled accounts, corresponding parent-session revocation, revoked access and session expiry. Direct password login creates its own ERP parent session; signing out of another ERP browser session is not global sign-out. A role name or Shopify scope list alone does not prove this isolation.</p>

<h2 id="uninstall">5. Disable, uninstall and reinstall</h2>
<ol>
<li><strong>Disable the app embed</strong> in the prepared theme, save and verify that the storefront widget disappears. This does not uninstall the app.</li>
<li>Uninstall the single Xinzhi ERP application from Shopify Admin. Verify that ERP Shopify access and the customer-service Shopify relationship stop; uninstall must not leave an active Shopify credential.</li>
<li>Reinstall from the Shopify-owned surface and complete Shopify authorization again. Confirm that the existing tenant/store connection is reused without a duplicate store record. Recheck the channel and any theme enablement needed before resuming chat.</li>
</ol>
<p>Uninstall revokes access; it is not proof that all stored operational records have been deleted. Follow the <a href="/shopify/data-deletion">Data Access and Deletion</a> process for verified data requests. Never run a whole-store redaction test on a shared review store.</p>

<h2 id="recovery">6. Troubleshooting and safe recovery</h2>
<ul>
<li><strong>Account or workspace unavailable:</strong> verify the supplied ERP account, existing tenant, customer-service access, local seat permissions and store assignments. Retry through Customer service in ERP. Do not create a duplicate store, copy a password or auto-link an email.</li>
<li><strong>Missing Shopify scope:</strong> use the application's documented reauthorization flow and recheck the scope checklist. A local role change cannot grant a Shopify scope.</li>
<li><strong>Widget missing:</strong> check the matching store and theme, save the enabled embed, verify the bound Shopify channel and refresh the storefront. Recent widget activity alone does not prove that a visitor received a reply.</li>
<li><strong>Write result uncertain:</strong> retain the original operation and input, refresh its status and use its documented reconciliation/retry action. Do not submit a second refund, shipment or inventory update merely because the first response is delayed.</li>
<li><strong>Review step blocked:</strong> stop that scenario and record its visible safe error. Do not replace a missing function with a mock screenshot or mark the scenario passed.</li>
</ul>
<p>Reviewer help: <a href="mailto:{{.SupportEmail}}">{{.SupportEmail}}</a>. Include the workflow, prepared store and approximate time, without credentials or customer data.</p>
</article>`
