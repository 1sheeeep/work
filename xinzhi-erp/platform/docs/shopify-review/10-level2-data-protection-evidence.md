# Level 2 protected customer data evidence

This document maps the first-review Level 2 route to evidence. It is a submission gate, not a claim that Shopify has approved the app. Do not mark an item complete without evidence from the exact production build and operating environment.

Official requirements snapshot checked 2026-08-17: [Shopify protected customer data](https://shopify.dev/docs/apps/launch/protected-customer-data). Recheck the live official page immediately before submission because App Store requirements can change.

Privacy-policy content snapshot checked 2026-08-06: [Shopify privacy requirements](https://shopify.dev/docs/apps/launch/privacy-requirements). The exact production policy must describe actual data sources and purposes, retention, processing regions, subprocessors/transfers, rights, contact details, physical address, and privacy-officer/DPO applicability where required.

## Requested protected fields and minimum purpose

| Shopify protected field | Minimum merchant-facing purpose | Reviewer proof |
| --- | --- | --- |
| Name | Identify the merchant's customer and delivery recipient during fulfillment and order-specific after-sales work. | Customer directory, order preview, and imported ERP order detail. |
| Address | Prepare and verify delivery; customer directory shows only broad location. | Customer directory, order preview, and imported ERP order detail. |
| Phone | Identify a customer/order and resolve delivery-contact issues. | Customer directory, order preview, and imported ERP order detail. |
| Email | Identify a customer/order and resolve order-specific after-sales work, including a visitor-requested authenticated or order-number/email support lookup. | Customer directory, order preview, imported ERP order detail, and the synthetic storefront support conversation. |

The order path reads these fields through the order capability implied by `write_orders`; the customer-directory path uses `read_customers`. Neither purpose justifies `write_customers`. The fields are not used for advertising, profiling, lead generation, data sale/sharing, or Xinzhi ERP marketing.

## Level 1 and Level 2 control matrix

| Requirement | Current evidence | Status before submission |
| --- | --- | --- |
| Data minimization and stated purpose | The connector returns recipient fields from the order endpoint and a separate customer catalog returns only name, email, phone, broad location, order count/spend, and last-order summary. Listing, reviewer instructions, and protected-data draft state the fulfillment/after-sales purpose. Protected-field redaction or a non-empty GraphQL `errors` response fails closed without exposing provider diagnostics. | Implemented locally; verify exact deployed build and Partner field approval. |
| Transparency and privacy policy | Public routes fail closed until every required field is configured. Exact connector image `20260817T055557Z-merchant-dpa-b775eda5`, routed by derived web image `20260817T061005Z-dpa-route-b775eda5`, serves HTTP 200 privacy, deletion, terms, merchant data-processing terms, support and guide pages with the legal entity/address, the current `xzkj.ai` support/privacy contacts, actual regions/subprocessors/transfer controls, 30-day deletion/backup wording and the current consent-aware browser-storage behavior; stale UAT/Gmail copy is absent. | Deployed content and the seven-page credential-free smoke were verified 2026-08-17; the contact-email refresh is recorded separately in current engineering evidence. Retain owner approval and final screenshot evidence before submission. |
| Customer consent decisions | The storefront widget reads Shopify's Customer Privacy API and listens for consent changes. It defaults chat continuity to session storage, uses persistent first-party storage only while preference processing is allowed, and removes persistent continuity data if that permission is withdrawn. It does not use recipient or chat data for analytics, advertising, or marketing. | Implemented locally; verify the exact deployed widget with both preference consent states before submission. |
| Opt-out from data sale or sharing | The reviewed path states that it does not sell recipient data, build advertising profiles, or share it for cross-context behavioral advertising. | Privacy owner must confirm the legal classification and document how applicable opt-out requests are received and enforced. |
| Significant automated decision-making | The reviewed path imports and displays order/recipient data; it does not profile, score, predict, or make a legal or similarly significant automated decision about a customer. | Product and privacy owners must confirm this remains true in the exact submission build; otherwise an opt-out/manual-processing workflow is required. |
| Merchant privacy/data-protection agreement | The company/privacy owner approved the bilingual terms on 2026-08-17. The English publication forms part of the Terms of Service, uses install/access/continued use as acceptance, covers roles, instructions, data scope, security, subprocessors, transfers, retention, rights requests and termination, and is publicly available without credentials at `https://erp.xzkj.ai/shopify/data-processing-terms`. | `OWN-16` / `L1-DPA-01` complete for the deployed version; retain the approval record, publication date and exact-version smoke result. |
| Subprocessors, regions, and transfers | The deployed privacy and data-processing pages list Amazon Web Services, merchant-enabled DeepSeek/Google/Microsoft integrations, the Cuqiu enterprise mailbox, Singapore processing and the applied transport/access/contractual safeguards. | Runtime disclosure and owner approval are complete for the deployed version; re-review any provider, region or transfer change before publication. |
| Retention and deletion | Compliance webhook receipt is HMAC-validated, idempotently persisted, and contact-data-free; uninstall revokes credentials. The administrator flow combines ERP export/anonymization with tenant-scoped customer-service export/redaction covering conversations, messages, tags, knowledge, tickets, comments, and local attachments. The deployed public policy limits operational retention to merchant use/fulfillment/support need, requires verified deletion/redaction within 30 days, and limits encrypted backups to 30 days. On 2026-08-17 the exact deployed `customers/redact` path completed for one isolated synthetic customer/order: the connector accepted a valid signed webhook, the platform administrator confirmed anonymization, all populated ERP personal fields were cleared, the customer-service export fell from 2 records to 0, transaction facts remained, and both customer-service and connector retries returned `alreadyCompleted=true`. The responsible owner approved a minimum weekly pending-request review, same-day retry after a detected failure, administrator escalation after another failure, and completion within 30 days. | Customer-redaction production/UAT evidence and the practical retry/escalation cadence are verified. Keep the overall deletion gate open until `shop/redact` is exercised only in a disposable isolated shop/snapshot; never run it against the shared review store. |
| Encryption in transit | Public endpoints use valid HTTPS. Production API-to-PostgreSQL is configured with `sslmode=verify-full`; the server certificate includes `DNS:postgres`, PostgreSQL reports SSL on, and live `pg_stat_ssl` evidence showed encrypted connections. | Production evidence verified 2026-08-17; retain a redacted screenshot/export with owner and collection time. |
| Encryption at rest | Credentials use application encryption. PostgreSQL, uploads, TLS material, staging and backups are on the provider-encrypted `/data` disk, and the restricted production evidence preflight passed for database, uploads and backups. | Production evidence verified 2026-08-17; retain the provider-console screenshot and restricted evidence reference. |
| Encrypted backups | Production systemd creates only `age` encrypted archives and checksums with a 30-day cap. Three formal backups succeeded; one was independently downloaded, hash-checked, decrypted and restored into PostgreSQL 16.14 with 28 tables and 743 uploads reconciled. Legacy/plaintext rollback copies were deleted after a fresh verified backup and explicit approval. | Production backup, retention, restore and legacy-disposition evidence verified 2026-08-17; private identity remains offline and must never be submitted. |
| Separation of test and production data | Review instructions require synthetic data in a dedicated development store. Infrastructure/account separation must be demonstrated. | Production evidence required. |
| Data-loss prevention | Code prevents Shopify/ERP tokens from reaching the browser and avoids contact data in compliance-event payloads. The widget necessarily stores a random continuity identifier and conversation identifier in first-party browser storage, not an authorization credential. The company/security owner approved `15-level2-security-operations-policy.md` on 2026-08-17, covering exports, logs, support material, staff devices, prohibited destinations and incident escalation without claiming commercial DLP software. | Policy and existing technical controls are approved; retain a dated control checklist for any follow-up review. |
| Staff access limitation | Tenant/shop checks and ERP roles restrict application access. The owner confirmed on 2026-08-17 that only the company owner/system administrator accesses Shopify administration, cloud, servers and databases; employees use named production-page accounts with role-scoped access. Quarterly review and same-day role-change/offboarding revocation are now approved rules. | Current owner review and policy are recorded; retain future review and revocation evidence. |
| Strong passwords and account protection | The owner confirmed that employee accounts use independent strong passwords. The system uses one-way password hashing and role controls. Ordinary employee MFA is not enabled and is not claimed; the approved policy requires unique strong passwords and prioritizes MFA for supported privileged third-party accounts. | Owner decision and policy are recorded; retain a redacted password-policy control screenshot or checklist if Shopify requests evidence. |
| Access logs | Successful order preview/import/detail and customer-directory reads fail closed through customer-value-free audit boundaries. Customer-directory audit records only tenant/shop identity, actor/request context, access surface, result count, and protected-field category; it excludes the query, email, phone, address, and returned customer values. Connector review tooling remains service-token-only, bounded, no-store, redirect-safe, and pseudonymized. The approved policy restricts log access, sets at least 180-day retention and requires monthly and incident-triggered review. | Code, tests and operating policy are complete; a real production redacted sample and first dated monthly review remain required as follow-up evidence. |
| Incident response | The company/security owner approved `15-level2-security-operations-policy.md` on 2026-08-17. It defines containment, evidence preservation, scope assessment, recovery, owner/privacy escalation, merchant notification and post-incident review without claiming automatic alerts or a fixed notification-hour promise. | Policy and contact roles are approved; first dated synthetic tabletop exercise remains required as follow-up evidence. |

## Evidence to attach or retain for a Shopify follow-up

Use the evidence IDs, redaction rules, owner worksheet, and acceptance fields in
`11-owner-input-and-production-evidence-pack.md`. Store raw evidence in the
company-approved restricted system, not in this repository.

- Screenshots or exports showing production encryption-at-rest and encrypted-backup settings.
- Backup retention, restore-test, and deletion-SLA evidence.
- Test/production account, database, secret, and storage separation evidence.
- DLP policy or controls covering exports, logs, support tools, and staff devices.
- Role/access review, MFA/password policy, privileged-access approval, and offboarding records.
- Protected-data access-log sample with customer values redacted, plus retention/review policy.
- Approved incident-response policy with notification ownership and last exercise date.
- Approved retention/deletion schedule, complete subprocessor list, processing regions, transfer safeguards, physical business address, privacy-officer/DPO applicability, and merchant deletion behavior.
- Fresh deployed `L1-PRIVACY-POLICY-01` evidence showing the public privacy URL returns 200 and renders the same approved facts without placeholders.
- Privacy-owner applicability record for customer consent, data-sale/sharing opt-out, and significant automated decision-making, including the implemented request path where applicable.
- Approved merchant data-protection/privacy terms, publication date and exact-version public smoke evidence covering processing roles, responsibilities, retention, transfers and subprocessors (current deployed evidence completed 2026-08-17; retain for follow-up).

## 2026-08-17 deployed synthetic customer-redaction evidence

The test used deliberately unique values under tenant
`7d055c24-3a32-4d28-bac2-b512fa1423b6` and development shop
`xinzhi-app-lab.myshopify.com`. It did not reuse a real customer or order.
Before the test, restricted encrypted/snapshot backups were placed under
`/data/xzdesk/migration-safety/shopify-privacy-synthetic-20260816T181144Z`.

- Customer-service creation temporarily changed only Xinzhi App Lab from
  login-required to guest access. The public API returned 201 for the single
  synthetic conversation, and the setting was immediately restored. Browser
  verification then showed both configured stores again required login.
- Before redaction, the tenant-scoped customer-service compliance export found
  exactly one conversation and one message (`recordCount=2`). The ERP database
  contained one matching order and one line. Five order-level and 17
  profile-level target fields were populated.
- The deployed Connector image
  `xz-erp-shopify-connector:20260816T174459Z-privacy-final-1d14363` accepted a
  real HMAC-SHA256 signed `customers/redact` delivery with HTTP 204. Its event
  ID was
  `shopify-compliance/customers/redact/shopify-uninstall:l2-customer-redact-20260817`.
- The platform-admin UI showed one pending customer-deletion request, required
  an irreversible-action confirmation, completed it, displayed
  `个人信息已匿名化，处理结果已同步。`, and then showed zero pending requests.
- After redaction, every one of the 28 ERP target columns was null; the 22 that
  had held synthetic values therefore fell to zero. The order still retained
  USD 12.34 total, USD 2.34 shipping, `RECEIVED` status, and its one USD 10.00
  order line. The customer-service compliance export returned zero matching
  records. The ERP execution recorded `record_count=3`, `ANONYMIZED`, no error,
  and both redaction and connector-completion timestamps.
- Repeating the same customer-service redaction returned
  `alreadyCompleted=true` with the original two-record receipt. Repeating the
  same Connector completion also returned `alreadyCompleted=true`; the pending
  Connector list remained empty. The encrypted Connector repository remained
  mode 600 and had a post-completion SHA256 digest recorded in restricted
  operational evidence.
- The customer-service tenant snapshot advanced from revision 31 to revision
  48 while the login-setting changes, synthetic creation, redaction receipt,
  and restoration were persisted. Only revision, byte length, and MD5 were
  observed; raw tenant/customer content was not copied into this repository.
- On 2026-08-17 the responsible owner approved the operational cadence: the
  platform administrator reviews pending privacy requests at least weekly; a
  detected failure is retried that day; another failure is recorded and
  escalated to the system administrator for investigation; applicable requests
  are completed within 30 days. This deliberately does not claim daily review
  or automatic email alerts that the organization cannot consistently perform.
- The UAT SSO hostname exposed a missing live Caddy route during the test.
  `kf-uat.xzkj.ai` was added as a dedicated reverse proxy to
  `erp-customer-service-uat-web:8080`; live config SHA256 is
  `e246d735404b66e700da2a325bc205df4301d9ffcf301cbbdbd132e81af71bf0`.
  Caddy validation passed, and UAT customer service, production customer
  service, and ERP readiness all returned HTTP 200.

Focused verification after the live operation passed the two relevant Go
packages, 42 executable Java privacy/connector tests, 49 Node review/data
protection tests, the six-page deployed review smoke, Caddy validation, and
public health checks. The PostgreSQL Testcontainers integration class reported
zero executable tests on this workstation because Docker Desktop was not
available; the exact deployed PostgreSQL rows above were independently queried
before and after the operation instead.

## Stop condition

The Level 2 route is demonstrable in the local code and reviewer materials, but the protected-data application is not ready to submit while any row above is blocked or lacks exact production/legal evidence. Never replace missing evidence with an inferred or example answer.
