# Assets and screencast production sheet

Official App Store requirements and listing best practices were rechecked on 2026-09-04 and must be checked again immediately before submission. Final media is captured only from the exact accepted review build and synthetic development store. Current authority: [Shopify App Store requirements 4.4.4–4.4.5](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements#provide-clear-assets-and-descriptions) and Shopify's [App Store listing best practices](https://shopify.dev/docs/apps/launch/shopify-app-store/best-practices). The previously checked [2026 image-standard changelog](https://shopify.dev/changelog/clearer-standards-for-app-listing-images) is historical context, not a new verification in this pass.

## App icon and feature media

- Product-owner-supplied app icon: `assets/app-icon/xinzhi-erp-app-icon-1200.png` (1200 × 1200 PNG, with Shopify-safe padding).
- Feature-media draft: `assets/feature-media/xinzhi-erp-feature-media-1600x900.png` (1600 × 900).
- Keep the Xinzhi ERP brand, square source corners, one focal point, and no Shopify logo, review claim, pricing claim, guarantee, real data, or browser chrome.
- The app icon is the approved brand artwork; feature media remains a draft until product-owner visual approval.

## Final App Store screenshots

Capture 3–6 PNG files at 1600 × 900 from the exact submission build. Use the dedicated tenant-scoped reviewer account with an existing enterprise role that can complete the documented review flow, the Chinese product UI, synthetic data, and accurate English alt text in the listing. Shopify now requires every listing image to be unique and to show a different feature, view, or state. Screenshots must contain the app interface itself—not a desktop background, browser address bar/window, unrelated tab, logo-only frame, duplicate, or near-duplicate composition—and must avoid PII or sensitive information. Synthetic data that still looks like a real person's name, email address, phone number, street address, or order contact is not suitable for the public listing gallery; reserve protected-data demonstration for the private review screencast and instructions. The listing must identify Simplified Chinese as the supported product-UI language; screenshots do not need an English UI translation.

Capture prerequisites:

- Record the exact release ID and Git commit before capture; the reviewer store must show all 10 submitted scopes as granted.
- Use the dedicated reviewer role, Simplified Chinese UI, 100% zoom, and a 1600 × 900 app viewport. Do not capture an administrator account or a browser frame.
- Seed each screen with clearly synthetic, disposable records. Use the same review-store name and synthetic naming convention across the selected 3–6 images. Prefer non-personal labels such as `Review item A`; do not display person-like contact fields in listing screenshots even when the underlying record is synthetic.
- Capture each file directly from one real app screen. Do not create a collage or add marketing claims over the UI. Shopify Admin or the external ERP shell may appear only where it is the actual product surface; operating-system chrome and the browser frame must not appear.
- Move the pointer outside the captured app viewport before capture so it does not obscure a control or look like an added annotation.

Candidate 3–6-slot capture plan. The required minimum is files 01, 02 and 03: connection, ERP products, and customer service. Files 04–06 are optional only when they add a clearly distinct, accepted view. Filenames below are a future capture plan, not instructions to rename or promote existing drafts:

| File | Chinese UI route and required state | English listing alt text | Scope or feature evidence | Exclude from frame |
| --- | --- | --- | --- | --- |
| `01-connected-store.png` | 设置 → 渠道授权 → 店铺详情；审核店为“已连接”，权限卡显示 `10 / 10`，十项逐项为已授权。 | `Connected Shopify review store with all ten submitted app permissions granted in the external Xinzhi ERP admin.` | Exact submitted-scope boundary and connection state. | Authorization URL, tenant ID, administrator identity, notifications. |
| `02-product-inventory.png` | 商品 → 在线商品或库存查询；显示合成商品、变体、平台 SKU、库存 SKU 和已映射库位。 | `Synthetic Shopify products, variants, SKU mapping, and mapped inventory location in Xinzhi ERP.` | `read_products`, `read_locations`, and the inventory setup preceding `write_inventory`. | Real product names, unrelated stores, supplier cost, real stock. |
| `03-customer-service-workbench.png` | 复制客服工作台；选择一个实际页面展示合成会话的分配状态或关联工单，不拼接不同页面、不显示个人联系信息。 | `Synthetic support conversation and assignment state in the independent Xinzhi customer-service workbench.` | Submitted customer-service workspace; the complete channel and ticket lifecycle remains in the video. | Login grant, password manager, unrelated records, third-party credentials, any person-like contact data. |
| `04-inventory-preflight.png` | 仓库 → 库存查询 → Shopify 库存；打开一条合成 SKU 的只读发布预检，显示 ERP 可用量、Shopify 当前量和已映射地点，不执行发布。 | `Read-only Shopify inventory preflight comparing ERP and Shopify quantities for a mapped synthetic SKU.` | `read_locations` and the guarded preflight preceding `write_inventory`. | Person-like data, real stock, supplier cost, external credential or token. |
| `05-order-edit.png` | 订单 → 订单列表或订单详情；使用页面已有的收起/隐藏控件排除联系人字段，仅显示合成订单商品及明确编辑结果；如做不到则不选此图，不修图伪装。 | `Imported Shopify order with SKU details and an explicit order-edit result in Xinzhi ERP.` | `write_orders`, `write_order_edits`; protected-field evidence stays in the private review video. | Any recipient name, address, email, phone, credential, raw internal token, unrelated order. |
| `06-after-sales.png` | 售后 → 拒付管理；只显示合成争议的金额、状态、类型、原因、订单、时间和处理截止日，并提示证据在 Shopify Admin 处理。 | `Synthetic Shopify Payments dispute metadata in Xinzhi ERP, with evidence handling left in Shopify Admin.` | `read_shopify_payments_disputes`; return/refund remains demonstrated in the video. | Evidence content or controls, file-upload claim, card-network submission claim, real payment data. |

Never include real or person-like names, addresses, email addresses, phone numbers, order contacts, tokens, credentials, administrator identities, notifications, or private URLs in public listing screenshots. Synthetic records and amounts must be visibly associated with the prepared development store. The private reviewer screencast may demonstrate the minimum Level 2 fields only with obviously synthetic disposable records and no secrets.

Four current exact-build captures from deployed frontend commit `b56876e8` are retained under `assets/drafts`: `20260828-01-connected-store-b56876e8.png`, `20260828-02-product-sku-b56876e8.png`, `20260828-03-customer-reviewer-b56876e8.png`, and `20260828-04-order-preview-b56876e8.png`. They use the `UAT ERP Tester` identity, synthetic review-store data, real PNG encoding, and a 1600 × 900 app-only frame. The matching `.source.jpg` files preserve the direct browser captures.

The 2026-08-30 local visual review classifies the first two files as technically usable ERP candidates: they show distinct real app UI, contain no browser frame, and expose no customer contact values. The customer-directory capture is not suitable for the public listing because it shows person-like names, email addresses and phone numbers; the order-preview capture is not suitable because it shows person-like email addresses. All four captures also retain a visible mouse pointer, so a clean recapture is preferred before product-owner acceptance. Retain the files as evidence; do not alter them, promote the third or fourth file, or copy any draft into `assets/final` merely to satisfy the automated count. Because the submitted app contains two complete business workspaces, the final set must include at least one PII-free current-build customer-service screenshot; an ERP-only three-image set is no longer sufficient.

## Review screencast

The review video must show the complete permission-to-feature relationship without hiding setup or confirmation steps:

1. Shopify-owned installation surface and expanded permission groups.
2. Disclose that every user/business requires prior Xinzhi staff provisioning and approval; there is no self-service signup and installation does not grant system access. Show the contact guidance for unapproved access, then OAuth completion before native ERP account linking using the pre-approved test account, the actual login/link/return sequence without manual shop-domain entry, and the verified Shopify Admin setup, configuration and connection-management workflow. This chapter cannot be replaced with the current connection page and external links. Record the single ERP login and Customer service entry without a second password; also verify direct same-account password login at the workbench URL without navigation. Hide credential entry in the recording.
3. Connected store and exact submitted-scope checklist.
4. Product preview and customer directory.
5. Order import, address or eligible order edit on disposable synthetic records.
6. Location mapping, guarded inventory publication, and merchant-managed fulfillment publication.
7. Return approval/refund preview and confirmation.
8. Read test-dispute metadata and show that all evidence handling remains in Shopify Admin.
9. From ERP, select Customer service and enter with the same prepared ERP account without another password; also open the direct workbench URL and sign in on-page with the same ERP enterprise code, account and password. Verify the mapped seat, business permissions and review-store scope, then show Shopify channel status, conversations, assignments, tickets and settings and demonstrate synthetic claim, reply, transfer, close/reopen, ticket and storefront receipt.
10. Disable the app embed, then uninstall, verify stopped access, and reinstall without a duplicate ERP store record.

Use English narration or accurate English subtitles. Never expose passwords, access tokens, authorization-link query strings, email inboxes, browser password managers, or real customer data. Upload to a URL that the reviewer can open without requesting access.

`assets/subtitles/xinzhi-erp-review-en.srt` belongs to the retired two-scope recording plan and must not be submitted. Replace and retime it only after the exact test deployment has passed product-owner visual acceptance.

Final review video: `{{REVIEW_SCREENCAST_URL}}`

## Final visual QA

- [ ] Every visible feature exists in the exact submission build.
- [ ] All data is synthetic and every write uses a disposable record.
- [ ] The selected 3–6 screenshots match the approved filename, route, state, and English alt text table above.
- [ ] Every image is visually distinct and shows a different feature, view, or state; there are no duplicates or near-duplicates.
- [ ] No image contains a desktop background, browser address bar/window, unrelated tab, logo-only frame, review/test claim, or Shopify trademark misuse.
- [ ] Scope wording, listing copy, reviewer instructions, public policy, screenshots, and narration match.
- [ ] Text is readable at normal playback and the full flow remains understandable with audio muted.
- [ ] No secret, real or person-like customer value, private browser state, or unrelated real record appears; customer-service screenshots and video use only the prepared synthetic channel, conversations, assignments, and tickets.
