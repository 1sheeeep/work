# Review screencast script and subtitles

This is the scenario order for the final recording, not a timed or approved script. Final timestamps, narration, and English subtitles are produced only after the exact test deployment passes product-owner visual acceptance.

Preparation uses one shared ERP account and separate business permissions: check scope coverage, narration, synthetic-record separation, and required evidence now. Do not record a successful login, linking or embedded workflow that is not yet working in the exact deployment. The complete two-workspace review has no fixed three-minute limit; allow enough time to show the actual confirmations and results.

## Recording rules

- Explain that every user/business requires an account provisioned and authorized by Xinzhi staff. Self-service registration is not available, and Shopify installation does not grant system access. Show the contact guidance and use a pre-approved isolated reviewer account for the actual linking/business demonstration. This is ordinary controlled onboarding, not a reviewer-only bypass. Do not alter final subtitles until the corresponding exact-build recording exists.

- Use only the prepared development store and synthetic disposable records.
- Record at 1920 × 1080 or 1600 × 900 with browser zoom at 100%.
- Keep every permission group, explicit confirmation, provider result, uninstall, and reinstall visible.
- Cuts may remove waiting time but must not hide a state-changing action or change the record between confirmation and result.
- Never expose credentials, access tokens, authorization-link query strings, inboxes, browser password managers, internal hostnames, or real customer data.

## Scenario order

| Sequence | Screen and action | Evidence to narrate |
| --- | --- | --- |
| 1 | Title card identifying Xinzhi ERP and synthetic test data. | One public Shopify app provides two complete business workspaces: the independent ERP web admin and the independent customer-service workbench. |
| 2 | Shopify-owned installation page with permission groups expanded. | Every final requested scope maps to a demonstrated ERP or support workflow; redundant read scopes are implied by matching write scopes where Shopify specifies that behavior. |
| 3 | OAuth completion, verified native ERP account linking, and the accepted Shopify Admin journey. | Show the Shopify-verified store, actual native login/link/return sequence, and usable setup, configuration and connection management. This chapter is blocked until implemented and verified; do not substitute the current status-only App Home or claim that links close the requirement. Independent ERP/customer-service operations remain in their own workspaces. |
| 4 | ERP store detail and submitted-scope checklist. | Tenant-scoped connection is active; unrelated future scopes are absent. |
| 5 | Product preview and customer directory. | Product/SKU matching is read-only. Customer data is minimal, used only for fulfillment and after-sales, and has no edit/marketing/ticket action. |
| 6 | Current order preview/import and one eligible order edit. | Import is ERP-local; the Shopify write uses a separate disposable order and explicit confirmation. |
| 7 | Historical-order preview/import. | Enable the older-than-60-days mode, show `read_all_orders` coverage, preview the prepared historical order, and import it. |
| 8 | Location mapping and inventory publication. | Show ERP versus Shopify quantity before the single confirmed write and then show synchronized result. |
| 9 | Prepared fulfillment publication. | Publish only merchant-managed quantities and tracking; no label purchase or third-party fulfillment-service claim. |
| 10 | Return and refund. | Approve the prepared return, use Shopify's calculated refund preview, confirm once, and show the provider result. |
| 11 | Test-dispute metadata. | Show amount, status, type, reason, order, timestamps, and processing deadline through `read_shopify_payments_disputes`; state that evidence remains in Shopify Admin. |
| 12 | Select Customer service in ERP; also verify direct same-account password login without navigation. | ERP entry needs no additional password; direct entry uses the same ERP credentials. Hide password entry. Show conversations, queues, tickets, assignments and settings. Verify business permissions and no second Shopify authorization. |
| 13 | Manual theme-editor step, storefront widget, and complete prepared customer-service lifecycle. | Copy the official plugin enable link, manually enable **Support Chat**, and send a synthetic visitor message. In the workbench claim the conversation, reply, verify customer/order context, create or update the related ticket, transfer the conversation, close/reopen it, and show receipt in the widget. State that no browser is opened or controlled and no `read_themes` access is used. |
| 14 | Disable the app embed, then uninstall and reinstall. | The widget disappears when disabled; uninstall stops Shopify data access; reinstall restores the existing ERP store record without duplication. |
| 15 | End card with support URL/email. | State that the single submitted application completed both the ERP and customer-service business workflows, plus the explicit non-Shopify-scope exclusions. |

## Subtitle status

`assets/subtitles/xinzhi-erp-review-en.srt` is an obsolete structural draft from the former two-scope plan. It must be replaced after visual acceptance. The replacement must use sequential, non-overlapping cues, cover every scenario above, and be verified with the exported video muted.

## Prepared English subtitle copy (untimed; not yet accepted)

The visible product UI remains Simplified Chinese. Use the following English copy in the same order as the scenario table. Split a row into multiple cues when the matching action takes longer; do not combine captions across a cut or state-changing confirmation.

| Sequence | English subtitle copy |
| --- | --- |
| 1 | `This review uses the Simplified Chinese Xinzhi ERP interface and synthetic data in a dedicated development store.` `English subtitles explain every reviewer action and permission.` |
| 2 | `Shopify displays the requested permission groups before installation.` `The application scope checklist maps all ten submitted scopes to the workflows demonstrated here.` |
| 3 | Use only after the chapter passes acceptance: `Shopify authorization completes before account linking.` `We use the prepared native ERP account and return to the application with the verified review store already selected.` Record the implemented embedded functions and prepare their exact narration at acceptance; do not narrate a future screen as present. |
| 4 | `The external ERP store detail shows the review store as connected and all ten submitted permissions as granted.` `No unrelated future permission is requested.` |
| 5 | `The read_products permission loads synthetic products and variants for SKU matching.` `The read_customers permission provides only the customer details needed for fulfillment and after-sales support.` |
| 6 | `The current order is previewed and imported into ERP.` `The write_orders and write_order_edits permissions are used only for the prepared disposable order after explicit confirmation.` |
| 7 | `The older-than-sixty-days option demonstrates read_all_orders on a prepared historical order.` `The order is previewed before it is imported into ERP.` |
| 8 | `The read_locations permission maps the Shopify location to the ERP warehouse.` `The write_inventory action shows the before value, requires confirmation, and then displays Shopify's result.` |
| 9 | `The write_merchant_managed_fulfillment_orders permission publishes only the prepared merchant-managed quantity and synthetic tracking details.` `Xinzhi ERP does not purchase labels or claim third-party fulfillment.` |
| 10 | `The write_returns workflow uses a prepared return and Shopify's calculated refund preview.` `The refund is executed only after the reviewer sees and confirms the exact amount.` |
| 11 | `The read_shopify_payments_disputes permission loads only the synthetic dispute metadata needed for operational follow-up.` `Xinzhi ERP does not read, edit, upload, save, or submit dispute evidence; all evidence handling remains in Shopify Admin.` |
| 12 | `Select Customer service in ERP and enter with the same account, without another password.` `At the direct workbench URL, sign in on-page with the same ERP account and password. Business permissions remain separate; no second Shopify authorization is required.` |
| 13 | `Shopify's theme editor owns per-theme chat appearance and featured products, and Copy plugin enable link only copies the official URL without read_themes.` `A synthetic visitor message is claimed, answered, transferred, closed or reopened, and connected to a synthetic ticket in the independent customer-service workbench before the storefront reply is verified.` |
| 14 | `Disabling the app embed removes the storefront widget.` `Uninstalling revokes Shopify access, and reinstalling restores the existing ERP store connection without creating a duplicate.` |
| 15 | Use only after all chapters pass: `This demonstrates the ERP and customer-service workspaces included in one Xinzhi ERP application.` `All writes used disposable synthetic records and explicit confirmation.` |

## Final SRT timing rules

- Replace the obsolete SRT only after the exact recording is exported; never estimate final timestamps from this document.
- Keep cues sequential and non-overlapping, with no more than two lines per cue. Prefer complete sentence units and keep each visible cue long enough to read at normal speed.
- Start each cue when its described UI state becomes visible and end it before the next cut, confirmation, or materially different state.
- Preserve scope identifiers exactly as written. Do not translate, shorten, or substitute permission names.
- Watch the exported video muted from start to finish and verify that every action, warning, confirmation, provider result, disable, uninstall, and reinstall step remains understandable.

Final recording URL: `{{REVIEW_SCREENCAST_URL}}`
