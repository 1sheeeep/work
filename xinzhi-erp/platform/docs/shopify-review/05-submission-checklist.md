# Submission checklist

Do not submit while any required item is unchecked or any `{{...}}` placeholder remains.

## Identity and contact

- [ ] The exact submission uses the existing `Aspen Ridge International Trade LLC` organization and `Xinzhi ERP` App ID `407894786049`; no second test app or stale `Xinzhi ERP Dev` identifier remains in runtime configuration or Partner entry fields.
- [ ] The company owner has confirmed the legal entity, registration country/region, business address, monitored business email, and authority to operate the Xinzhi ERP app, brand, domain, support mailbox, and privacy mailbox.
- [x] Developer/company website uses the canonical `https://www.xzkj.ai/`; on 2026-08-21 its home, company identity, contact, privacy and terms pages returned HTTP 200 without an extra redirect and consistently identified `Aspen Ridge International Trade LLC` and the purpose-specific `xzkj.ai` inboxes.
- [x] The corporate website is used only for company/developer identity. App URL, support, privacy, terms, data-processing terms and deletion fields continue to use the application-specific `https://erp.xzkj.ai/shopify/...` routes; verified in release `20260821T103155Z-company-site-bb0de70e`.
- [ ] The App Store registration truthfully declares whether any Associated Developer Account exists; a different operator or company name is not used to avoid a required disclosure.
- [ ] Legal entity name matches the Partner organization and public privacy policy.
- [ ] Submission email is monitored; `noreply@shopify.com` is allowlisted.
- [ ] Emergency developer email and phone are current.
- [ ] API contact email and application domains do not misuse the Shopify name.
- [ ] `support@xzkj.ai` is configured as the required support email, actively monitored, and receives a synthetic Shopify-style relay test.
- [ ] `privacy@xzkj.ai` is actively monitored and a synthetic access/deletion request completes the documented verification and escalation path.
- [ ] Email DNS has working MX, SPF and an approved DMARC policy. MX/SPF and the current `_dmarc.xzkj.ai` policy are published; the monitored external receive, reply and escalation tests for `developer@`, `support@` and `privacy@` still must pass before submission.

## Production deployment

- [ ] App URL, OAuth redirect URLs, compliance webhook URLs, privacy URL and support URL use valid HTTPS.
- [x] `SHOPIFY_PUBLIC_COMPANY_WEBSITE=https://www.xzkj.ai/` is present in Connector release `20260821T103155Z-company-site-bb0de70e`, and every public Xinzhi ERP policy/support page links it with the same legal entity.
- [ ] Application domains and API contact email contain neither `Shopify` nor `Example` (including misspellings or abbreviations intended to imitate Shopify).
- [ ] Production uses a supported Shopify API version and GraphQL Admin API only.
- [ ] The public app version uses TOML-managed installation and app-specific webhooks; no REST Admin API request occurs in the review path.
- [ ] The accepted embedded Shopify business journey loads through the current App Bridge script before other scripts; a status-only home with external links is not treated as the completed embedded experience.
- [ ] Shopify connection-home authentication works without third-party cookies or local storage, including Chrome incognito.
- [ ] Install, reinstall and uninstall all require/clear the correct OAuth state.
- [ ] No manual shop-domain input is used to start installation.
- [ ] Compliance webhooks validate HMAC and are reachable from the public internet.
- [ ] Real production secrets come from the approved secret store; example values are not deployed.

## Functional QA

- [ ] Every feature named in the listing works with the prepared ERP reviewer account, its verified customer-service seat and permissions, and the test store. The two workspaces share ERP credentials; additional synthetic staff used to demonstrate transfer are not a second reviewer login system.
- [ ] Product, customer, order, inventory, fulfillment, return/refund, and dispute metadata matches Shopify Admin after refresh; no evidence content or evidence action appears in Xinzhi ERP. The 2026-08-27 enterprise-admin runtime recheck confirmed the return and metadata-only dispute pages load without errors and expose no evidence action; exact reviewer-identity comparison and the remaining write scenarios are still open.
- [ ] The review build exposes only functionality named in the final listing and proven by the reviewer instructions.
- [ ] Read-only operations remain non-mutating; every Shopify write requires the dedicated ERP permission, an eligible synthetic record, explicit confirmation, and a visible synchronized or safely uncertain result.
- [ ] Missing scopes and cross-tenant identifiers fail closed without raw provider errors.
- [ ] Public privacy, deletion, support, guide and landing pages return 200 only after the exact legal name, physical address, processing regions, subprocessors, transfer safeguards, operational retention, backup retention/deletion, verified deletion process, and privacy-officer/contact wording are approved and configured.
- [ ] No 3xx loop, 4xx/5xx page, placeholder, beta banner or inaccessible navigation blocks the review path.
- [ ] Login, store authorization, OAuth completion, embedded product preview and embedded order preview are fully usable in English.
- [ ] The ERP language switch persists, and the embedded app honors Shopify's `locale` parameter with an English fallback for reviewers.
- [ ] Resolve and evidence the Shopify Admin installation, linking, configuration and connection-management journey on the exact build. Current connection/read-only App Home is insufficient evidence. Retain independent ERP and customer-service operations and verify the supported path, including Theme App Extension settings; do not claim official approval from the standalone-workspace guidance alone.
- [ ] **Copy plugin enable link** only copies the official theme-editor deep link. The reviewer manually opens it in the prepared store environment; no automatic browser open, switch, login, authorization, polling, or `read_themes` access occurs.
- [ ] Verify one ERP login → Customer service with no second password, plus direct same-account password login without navigation. Check mapped seat status, permissions, shop scopes, one-time-grant replay/mismatch rejection, corresponding parent-session/account-access revocation and WebSocket expiry. Direct login has a separate parent session, not global single sign-out. No second Shopify authorization occurs.
- [ ] The exact customer-service build exposes the submitted business workspace to the reviewer account: overview, Shopify channel, conversations/queues, assignment, claim, reply, transfer, close/reopen, related tickets, and the management surfaces advertised in the listing.
- [ ] The storefront widget, synthetic message, conversation claim/assignment, agent reply, transfer, close/reopen, related synthetic ticket, storefront receipt, embed disable, and uninstall behavior all work in the exact review environment without a second Shopify authorization. Shopify version `xinzhi-erp-20260822-175140` is published and the user confirmed the corrected plugin is usable; the expanded two-workspace evidence pack remains open.
- [ ] The shared Connector keeps `https://kf.xzkj.ai` as the default customer-service origin and applies `https://kf-uat.xzkj.ai` only to `xinzhi-app-lab.myshopify.com`; `platform/infra/review/verify-customer-service-origin-routing.sh` passes against the deployed Connector environment without printing its values. The installed review-store metafield and public widget asset are re-read before recording; no production installation is repointed to UAT.

## Scope and protected data

- [x] Final TOML scopes match the demonstrable scope table; future scopes are removed or optional as appropriate. The repository gate locked all five manifest/runtime definitions to the exact ten-scope value on 2026-08-20.
- [x] The exact build excludes the two denied dispute-evidence scopes and contains no evidence read/write/upload/submission UI or claim; evidence handling remains in Shopify Admin. Current code gates and public content checks pass.
- [x] The deployed runtime scope value exactly matches `shopify.app.toml`; no broader fallback scope set is active. The healthy review Connector reported ten scopes and zero denied evidence scopes on 2026-08-20.
- [ ] `read_all_orders` was approved in Partner Dashboard for App ID `407894786049` on 2026-08-17; archive a durable internal approval reference, and verify the explicit older-than-60-days preview/import mode, server-enforced cutoff, and missing-scope failure against the exact submission build.
- [ ] Every submitted write scope has a real reviewer scenario; all future or undemonstrated scopes are absent from the review version and listing.
- [ ] Protected customer data request is completed before app review starts.
- [x] The product decision is Level 2: name, address, phone, and email are used only for customer/order identification, fulfillment, delivery contact, and order-specific after-sales work.
- [ ] Partner Dashboard requests name, address, phone, and email individually and no unnecessary protected field.
- [ ] The Shopify connection home's read-only order preview and the external ERP order import/detail demonstrate the same minimum-purpose Level 2 workflow described in the listing and privacy answers.
- [ ] The customer directory demonstrates only minimum records and recent-order association, with no customer edit, marketing, export, conversation, or ticket action.
- [ ] The privacy policy discloses storefront messages, attachments, first-party continuity identifiers/storage, page/product context, optional order lookup input, purpose, retention, deletion, and the no-advertising/no-unrelated-tracking limit.
- [ ] Retention, deletion, backup, subprocessor, processing-region, transfer-safeguard, physical-address and privacy-officer/contact fields contain real policy decisions and match the deployed privacy page.
- [ ] `customers/data_request`, `customers/redact`, and `shop/redact` are processed end to end: durable receipt, verified export/anonymization/deletion execution, bounded retry/escalation, completion evidence, and no customer contact values in logs/outbox metadata.
- [ ] The deployed storefront widget defaults to session-only continuity storage, enables persistent continuity only when Shopify reports preference processing is allowed, and removes persistent continuity data after that permission is withdrawn.
- [ ] Applicable data-sale/sharing opt-outs are enforced, or the privacy owner has approved the documented no-sale/no-cross-context-advertising determination.
- [ ] The exact submission build performs no legally or similarly significant automated customer decision, or provides a verified opt-out and manual-processing path.
- [x] Merchant privacy/data-protection terms covering roles, responsibilities, retention, transfers, and subprocessors were approved by the company/privacy owner on 2026-08-17, published at `https://erp.xzkj.ai/shopify/data-processing-terms`, and verified against the exact deployed connector and ingress images.
- [ ] Production customer/order data and backups are encrypted, with recorded retention and deletion evidence.
- [ ] Test and production data, credentials, databases, and storage are demonstrably separated.
- [x] The company/security owner approved practical DLP controls for exports, logs, support material and staff devices on 2026-08-17; the policy does not claim commercial DLP software or controls that are not deployed.
- [x] The owner reviewed the current production access boundary on 2026-08-17: only the owner/system administrator has privileged backend access, employees use named role-scoped production-page accounts with strong passwords, and quarterly review plus same-day role-change/offboarding revocation is required; ordinary employee MFA is not falsely claimed.
- [x] Protected-data access logs have an approved minimum 180-day retention and monthly/incident-triggered review process; keep the separate production-sample evidence gate open until the first real redacted review record is collected.
- [ ] An approved incident-response policy, owner, contact chain, and exercise record are available.

## Listing and media

- [ ] App name is `Xinzhi ERP` in Shopify Dev Dashboard, TOML, the listing, embedded UI, and public pages.
- [ ] Pricing is exactly Free, the exact review build exposes no paid plan or charge flow, and no Shopify Billing API or off-platform app payment is used.
- [ ] Exact-build account wording uses one ERP enterprise code/account/password for both workspaces; the shared reviewer credentials are supplied only in Shopify's restricted review field. Verify ERP-to-customer-service entry, direct same-account login, mapped-seat permissions and shop scope separately. Historical ERP login evidence alone does not prove current customer-service access.
- [ ] Primary English listing uses the reviewed copy and contains only released functionality.
- [ ] Primary category is `Orders and shipping` → `Inventory` → `ERP`; secondary category is `Store management` → `Support` → `Helpdesk`; every selected ERP, Helpdesk, and Chat structured feature is demonstrable in the exact review build.
- [ ] Languages lists only full-product UI languages; English reviewer-path support is not misrepresented as full ERP English support.
- [ ] The app is submitted as a regular app, not a Sales Channel.
- [x] Icon is 1200 × 1200 PNG and follows the asset sheet.
- [ ] Feature media is complete and accessible.
- [ ] 3–6 screenshots are 1600 × 900, include app UI, use synthetic data and have alt text.
- [ ] Demo store URL opens the useful demonstration context.
- [ ] Demo store URL is a tested direct path into the prepared embedded-app demonstration page, not only the development-store domain.
- [ ] Online Store is declared required because the reviewed support-chat feature uses a Theme App Extension; the app embed is included in the exact deployed app version.
- [ ] Review screencast and exact test instructions are provided in English or with English subtitles.
- [ ] Reviewer instructions disclose staff-provisioned, prior-approved access for every user/business, with no self-service signup. Supply a pre-approved isolated review account and reproduce native login and post-OAuth linking without review-time staff approval. Verify no developer-supplied OTP, VPN, extension, special browser profile, or assistance is needed without weakening normal security. Unapproved/disabled/revoked accounts must not access protected data; Shopify installation/reinstallation must not create enterprises/users or grant system access.
- [ ] Reviewer credentials remain valid for the full review period.
- [ ] The review store contains separate synthetic disposable records for order editing, inventory, fulfillment, return/refund, a Shopify Payments test dispute, storefront conversations, two prepared agents/queues, and a related customer-service ticket; no state-changing scenario reuses an incompatible record.

## Automated and repository gates

- [ ] Partner Dashboard automated checks pass immediately before submission.
- [ ] Go full tests pass on the frozen submission commit.
- [ ] Frontend typecheck and full tests pass on the frozen submission commit.
- [ ] Java unit tests and PostgreSQL/Testcontainers gates pass in a Docker-capable environment on the frozen submission commit.
- [ ] API contract and audit coverage gates pass on the frozen submission commit.
- [ ] Secret scan, dependency review and `git diff --check` pass on the frozen submission commit.
- [ ] Final deployed commit/version is recorded for the exact Level 2 submission build. Current published app version is `xinzhi-erp-20260822-175140`, backed by ERP/customer-service UAT deployment `20260822T170905Z-chat-settings-45e07b85`; it is not the final submission build until the remaining owner, signed-in, media and legal gates close.
- [ ] `node platform/scripts/shopify-public-review-smoke.mjs --base-url https://erp.xzkj.ai` passes against that exact build. Current deployed baseline: 7/7 on 2026-08-23 after app version `xinzhi-erp-20260822-175140`; rerun against the later exact final submission build, and complete product-owner visual confirmation below.

The five repository gates above were reopened on 2026-09-04 because the identity/navigation/dependency changes no longer match the 2026-08-06 evidence in `09-engineering-readiness-evidence.md`. That historical evidence is preserved. Current targeted successes are recorded separately in `16-parallel-review-preparation.md`; they do not justify checking a frozen-build full-suite requirement.

## Submission authorization

- [ ] Product owner confirms the listed functionality and pricing.
- [ ] Legal/privacy owner confirms public policy and protected-data answers.
- [ ] Engineering owner confirms the exact deployed version and negative test results.
- [ ] The authorized Partner account owner performs the actual submission.
