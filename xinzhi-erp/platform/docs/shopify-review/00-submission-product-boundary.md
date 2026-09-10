# Xinzhi ERP Shopify submission product boundary

This file is the canonical product boundary for the current Shopify App Store submission. Later review copy, reviewer steps, media, runtime configuration, and evidence must follow it.

## One public app, two complete business workspaces

- Shopify sees one regular public app named `Xinzhi ERP`, one App ID, one installation, one OAuth grant, one scope set, one Connector, and one uninstall relationship.
- The merchant receives two coordinated business workspaces under that application: the independent Xinzhi ERP web admin and the independent customer-service workbench.
- ERP owns store authorization, products, orders, inventory, fulfillment, returns/refunds, customers, and dispute-metadata workflows.
- Customer service is a first-class submitted business workspace, not an optional add-on or a single chat demonstration. It owns Shopify-channel binding, widget behavior, conversations, assignment, claiming, replies, transfer, closing, tickets, and the customer-service management surfaces present in the exact build.
- `Xinzhi Chat` is the Theme App Extension delivered by the same public app. A merchant may choose whether to enable the app embed on a theme, but the extension and its customer-service workflow are included in this submission.

## Login and system boundary

- Access requires an account provisioned and authorized by Xinzhi staff. This applies to every user and business, without exception. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access.
- Reuse platform-admin provisioning, enterprise application entitlements, account status and user/role/store permissions. Store linking neither creates an enterprise/user nor expands existing access. Unapproved users receive contact guidance, not protected business data. Review accounts must be pre-approved using these same controls, without an approval bypass.

- The reviewer uses one ERP enterprise code, account and password. In ERP, select Customer service to enter the copied workbench without a second password.
- ERP and customer service are peer businesses with separate workspaces. At the direct workbench URL, enter the same ERP enterprise code, account and password to sign in without leaving the page. The direct form is deployed to copied-CS UAT; real-account exact-build verification remains open.
- ERP and customer service share the existing ERP account. No One service or central portal is required. ERP issues a short-lived, single-use, enterprise/user/origin-bound entry grant; customer service retains its own business session, seat permissions and shop assignments. Direct-login credentials are relayed transiently to ERP, not stored as customer-service passwords; ERP bearer tokens are never returned to the customer-service browser. Matching emails do not link identities.
- Shopify embedded experience is a release gate. Keep the independent ERP and customer-service workspaces; complete installation, account linking, configuration and connection management in Shopify Admin, with the necessary operational status. Shopify's integration guidance allows standalone ERP operations and continuously monitored customer conversations; it does not certify our current status/read-only App Home. Verify the exact supported journey, and seek review guidance if its boundary remains unclear, before freezing media.

## Domain and review routing

- `https://kf.xzkj.ai` is the stable production customer-service origin. It remains unchanged while the replacement framework is validated.
- `https://kf-uat.xzkj.ai` is the isolated customer-service review/UAT origin.
- The shared Connector keeps the production origin as its default and applies the UAT origin only to `xinzhi-app-lab.myshopify.com` through the per-shop origin override.
- Future production migration keeps `kf.xzkj.ai` stable and switches only its reverse-proxy upstream after approved migration, acceptance, and rollback checks. The two public hostnames are never swapped.

## Required review story

The exact-build review and screencast cover both workspaces in one coherent flow:

1. Install and authorize `Xinzhi ERP` once.
2. Verify connection state and submitted scopes.
3. Complete the documented ERP product, order, inventory, fulfillment, return/refund, customer, and dispute-metadata scenarios.
4. Open Customer service from ERP without another password; also verify direct same-account password login at the workbench URL without navigation. Neither path requires a second Shopify authorization. Reject entry-grant replay and raw ERP session tokens, and verify corresponding parent-session revocation and account-access revocation invalidate protected access. Direct password login creates a separate parent session, not global single sign-out.
5. Verify the bound Shopify channel, configure and enable the included Theme App Extension, and send a synthetic storefront message.
6. Demonstrate the prepared customer-service lifecycle: claim/assignment, reply, transfer, close or reopen, and a related synthetic ticket.
7. Verify the storefront receives the reply, then disable the embed.
8. Uninstall the single app and verify that both ERP Shopify access and the storefront-chat Shopify relationship stop; reinstall restores the existing tenant/shop relationship without duplication.

Only features that exist and work in the exact submission build may be advertised or selected as structured listing features. Non-Shopify channels may remain visible as part of the customer-service product, but they are not used to justify Shopify scopes unless the reviewer instructions explicitly demonstrate them.

## Current preparation baseline

Confirmed on 2026-09-04 after recovering the decisions in ERP开发主统筹（十五） and ERP开发主统筹（十六）: retain App ID `407894786049`, the frozen ten scopes, ERP/Connector ownership of Shopify authorization and publishing, both business workspaces and the included extension. The later decision to remove One supersedes the historical identity plan. Original customer-service migration is an internal operation, not an advertised review feature. Pricing remains free. Local preparation has resumed; no deployment, shop action or formal submission is implied.

The existing-account linking slice is implemented locally. A verified Shopify grant first enters encrypted `AUTHORIZED_UNLINKED` storage with business/configuration access locked. App Home issues a short-lived proof and opens the native ERP confirmation page; the page clears the URL fragment before routing and uses bounded session storage through native login and retries. ERP verifies the native enterprise administrator and current shop-authorization permission, commits the canonical shop before remote confirmation, then projects the Connector's confirmed result. Creating a shop additionally requires shop-write permission. Ordinary employees and system-administrator impersonation are excluded; employee-level shop scoping is not claimed as complete. Configuration failures retain the same ownership but keep business access locked. Browser fixtures and targeted tests passed; this is not a deployed or real-shop installation acceptance.

App Home now includes local plugin setup guidance: a JWT-scoped read-only check of this app installation's enterprise/address metadata, an advisory published-theme extension signal, an official theme-editor link and the verified independent customer-service destination. It does not enable the theme, rewrite configuration, authenticate a customer-service user or prove messaging. No additional Shopify scopes, host swaps or new app identity were introduced.

The user has resolved the no-account journey: contact Xinzhi staff for provisioning and approval, then use the existing-account linking flow. There is no public self-service signup. This product decision does not close exact-build Admin onboarding/connection-management or independent customer-service/plugin acceptance. Explain the genuine controlled-access model to Shopify review; the non-self-service exception is guidance, not approval of this application. Preserve existing ownership and mappings; do not auto-claim by email/domain or create dummy tenants to bypass review gates.

References checked 2026-09-04: [Shopify integration guidance](https://shopify.dev/docs/apps/build/integrating-with-shopify), [App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements). Internal readiness checks are not Shopify approval.
