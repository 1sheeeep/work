package installations

import (
	"html/template"
	"net/http"
	"net/mail"
	"net/url"
	"strings"
	"time"
)

type publicPageData struct {
	Title             string
	LegalName         string
	CompanyWebsite    string
	SupportEmail      string
	PrivacyEmail      string
	EffectiveDate     string
	BusinessAddress   string
	ProcessingRegions string
	Subprocessors     string
	TransferMechanism string
	OrderRetention    string
	BackupRetention   string
	DeletionProcess   string
	PrivacyOfficer    string
}

const publicPageShell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{.Title}} | Xinzhi ERP</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#17233c;background:#f5f7fb;margin:0}main{max-width:840px;margin:40px auto;padding:40px;background:#fff;border:1px solid #dbe2ef;border-radius:12px}h1,h2{line-height:1.25}a{color:#1746c7}a:focus-visible{outline:3px solid #1746c7;outline-offset:3px;border-radius:2px}nav{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:32px}.meta{color:#52627a}code{background:#f0f3f8;padding:2px 5px;border-radius:4px}footer{display:flex;gap:8px 16px;flex-wrap:wrap;margin-top:40px;padding-top:24px;border-top:1px solid #dbe2ef;color:#52627a}@media(max-width:600px){body{background:#fff}main{margin:0;padding:24px 20px;border:0;border-radius:0}nav{gap:12px 16px;margin-bottom:24px}}.review-guide code{overflow-wrap:anywhere}.review-guide h2[id]{margin-top:32px;scroll-margin-top:24px}.guide-contents a{display:inline-flex;min-height:44px;align-items:center}</style></head><body><main><nav aria-label="Xinzhi ERP public information"><a href="/shopify/guide">Guide</a><a href="/shopify/privacy">Privacy</a><a href="/shopify/terms">Terms</a><a href="/shopify/data-processing-terms">Data processing</a><a href="/shopify/data-deletion">Data deletion</a><a href="/shopify/support">Support</a></nav>{{template "content" .}}<footer><span>Xinzhi ERP is provided by {{.LegalName}}.</span><a href="{{.CompanyWebsite}}">Company website</a></footer></main></body></html>`

const dataProcessingTermsContent = `<h1>Merchant Data Processing Terms</h1>
<p class="meta">Effective {{.EffectiveDate}}</p>
<p>These Merchant Data Processing Terms (the "Data Terms") form part of the Xinzhi ERP Terms of Service and apply when {{.LegalName}} (the "Provider") processes personal data on behalf of a merchant through Xinzhi ERP. By installing, accessing or continuing to use Xinzhi ERP on or after the effective date, the merchant accepts these Data Terms. If the merchant and Provider sign a separate data processing agreement, the signed agreement controls to the extent of a conflict.</p>
<h2>1. Roles</h2>
<p>For store, order, customer, recipient and storefront visitor data, the merchant determines the purposes and means of processing and acts as the controller, business or equivalent role under applicable data protection law. The Provider acts as the processor, service provider or equivalent role and processes that data only on the merchant's documented instructions.</p>
<p>When the Provider independently determines processing necessary for its own account administration, security, audit, compliance and support records, the Provider is responsible for that processing as described in the <a href="/shopify/privacy">Privacy Policy</a>. These Data Terms do not change the separate agreements that apply between Shopify, the merchant and the Provider.</p>
<h2>2. Merchant instructions and responsibilities</h2>
<p>The merchant instructs the Provider to process data for the purposes in these Data Terms through Shopify permissions authorized by the merchant and features enabled by the merchant. The merchant must have authority to provide the data and instructions, provide required notices and obtain consent where applicable, protect credentials, restrict access to authorized personnel, avoid submitting unnecessary sensitive data, review irreversible actions and provide accurate information needed to complete customer requests.</p>
<h2>3. Data subjects, data and duration</h2>
<p>Data subjects can include merchant customers, prospective customers, order recipients, storefront visitors and authorized merchant users. Processed data can include store, product and variant, location, inventory and merchant-managed fulfillment records; current and authorized historical order identifiers, line items, quantities, amounts, status, returns, refunds and dispute records; name, shipping address, broad location, phone and email; storefront support messages and attachments, visitor-provided order number or email, random browser and conversation identifiers and page or product context; and ERP account identifiers, permissions, support communications, security events and necessary audit records.</p>
<p>Processing begins when the merchant installs or enables a relevant feature and continues until the data is no longer needed to provide the service, the merchant stops using the service or the applicable deletion process is completed, subject to the retention rules below.</p>
<h2>4. Permitted purposes and limits</h2>
<p>The Provider processes data only to identify, import and match the merchant's own Shopify orders and products; publish inventory and perform warehouse, delivery and merchant-managed fulfillment work; perform eligible order edits, cancellations, returns, refunds, after-sales support and dispute-metadata monitoring; maintain visitor-initiated support conversations, requested order-status lookups and merchant-agent replies; and secure, authorize, audit, back up, recover and operate the service and handle compliance requests.</p>
<p>The Provider does not sell personal data or use Shopify customer or storefront support data for unrelated advertising, profiling, lead generation or Xinzhi ERP marketing. The reviewed service does not make automated decisions that have legal or similarly significant effects on customers.</p>
<h2>5. Data minimization and confidentiality</h2>
<p>The Provider processes only the minimum data required for enabled functionality and limits access to authorized personnel and systems that need it for their duties. Personnel with access to personal data are subject to confidentiality obligations. Data is scoped by merchant and shop and protected through role-based access controls.</p>
<h2>6. Security</h2>
<p>The Provider applies measures appropriate to the processing risk, including TLS for public endpoints and data in transit; encryption at rest for production data, credentials and backups; storage of Shopify credentials in the Connector service without returning them to browsers or ERP clients; tenant isolation, role controls, least-privilege access, audit controls and recovery procedures; and restrictions on tokens, addresses and protected customer data in logs and audit details.</p>
<p>To the extent permitted by law, after confirming that a security incident affects merchant personal data, the Provider will notify the merchant through its recorded contact information without undue delay and provide information reasonably available at that time.</p>
<h2>7. Subprocessors</h2>
<p>The merchant authorizes the Provider to use these subprocessors as necessary to provide the service:</p>
<ul><li>Amazon Web Services for hosting, database, encrypted storage and backups; the primary processing region is Singapore.</li><li>DeepSeek API for AI support assistance, only when the merchant enables the relevant integration.</li><li>Google and Microsoft for email integrations, only when the merchant enables the relevant integration.</li><li>Cuqiu enterprise email service for monitored privacy and support communications.</li></ul>
<p>The Provider requires subprocessors to process data only for the agreed service and to apply appropriate protections. The current list and material changes are disclosed in the Privacy Policy or updated Data Terms. A merchant that does not want to use an optional integration can leave it disabled or disable it.</p>
<h2>8. Processing locations and transfers</h2>
<p>The primary production processing region is Amazon Web Services Singapore. Shopify processes source-platform data in the regions described in Shopify's service and privacy terms. Merchant-enabled integrations can process data in regions published by the relevant provider.</p>
<p>International or other transfers are limited to the stated purposes and providers and protected by TLS, least-privilege access, data minimization and applicable provider contractual safeguards. These Data Terms do not claim an unsigned standard contractual clause, certification or adequacy decision. If applicable law requires additional transfer documentation, the parties will complete the required arrangement before that transfer.</p>
<h2>9. Retention, deletion and uninstall</h2>
<p>Personal data is retained only while the merchant uses the service and it remains necessary for fulfillment, after-sales work or support. Verified access, deletion and Shopify redaction requests are completed within 30 days after receipt. Transaction or security facts that must be retained by law are retained only in de-identified form and only to the necessary extent.</p>
<p>Encrypted rolling backups are retained for no more than 30 days. Deleted personal data expires from backups within that period and is not restored for normal operations. After disaster recovery, applicable deletion requests are reapplied.</p>
<p>Uninstall revokes Shopify credentials and removes the Theme App Embed from the installed app. After receiving and verifying a Shopify <code>customers/data_request</code>, <code>customers/redact</code> or <code>shop/redact</code> webhook, the Provider records the request, uses an authorized administrator to perform the applicable export, anonymization or deletion, and retries and escalates failures. Webhook receipt alone is not represented as completed deletion. More information is available in <a href="/shopify/data-deletion">Data Access and Deletion</a>.</p>
<h2>10. Data-subject requests</h2>
<p>The merchant is the primary contact for customer-rights requests. The Provider will reasonably assist the merchant in locating, exporting, correcting, restricting, anonymizing or deleting data held by the service. Merchants and data subjects can contact <a href="mailto:{{.PrivacyEmail}}">{{.PrivacyEmail}}</a>. The Provider can verify identity and authority before disclosing or deleting data.</p>
<h2>11. Assistance and evidence</h2>
<p>On reasonable request, the Provider can supply published policies, processing descriptions and appropriately redacted control evidence relevant to these Data Terms. To protect other merchants, system security and confidential information, the Provider will not disclose other tenants' data, keys, unredacted logs or uncontrolled production access. This limitation does not restrict a legally required regulatory inspection.</p>
<h2>12. Termination and priority</h2>
<p>After the merchant stops using the service or the service ends, the Provider handles remaining data under these retention and deletion rules and applicable law. If these Data Terms conflict with the main Terms of Service on personal-data processing, these Data Terms control. The main Terms of Service control all other matters.</p>
<h2>13. Contact</h2>
<p>{{.LegalName}} · {{.BusinessAddress}} · Privacy officer/contact: {{.PrivacyOfficer}} · <a href="mailto:{{.PrivacyEmail}}">{{.PrivacyEmail}}</a></p>`

func (h *Handler) publicPageData(title string) publicPageData {
	return publicPageData{
		Title: title, LegalName: h.config.PublicLegalName,
		CompanyWebsite: h.config.PublicCompanyWebsite,
		SupportEmail:   h.config.PublicSupportEmail, PrivacyEmail: h.config.PublicPrivacyEmail,
		EffectiveDate: h.config.PublicEffectiveDate, BusinessAddress: h.config.PublicBusinessAddress,
		ProcessingRegions: h.config.PublicProcessingRegions, Subprocessors: h.config.PublicSubprocessors,
		TransferMechanism: h.config.PublicTransferMechanism, OrderRetention: h.config.PublicOrderRetention,
		BackupRetention: h.config.PublicBackupRetention, DeletionProcess: h.config.PublicDeletionProcess,
		PrivacyOfficer: h.config.PublicPrivacyOfficer,
	}
}

func (h *Handler) publicPageReady(w http.ResponseWriter) bool {
	validEmail := func(value string) bool {
		parsed, err := mail.ParseAddress(value)
		return err == nil && parsed.Address == value && !strings.ContainsAny(value, "\r\n")
	}
	validPublicText := func(value string) bool {
		return value != "" && len(value) <= 1000 && !strings.ContainsAny(value, "\r\n")
	}
	validPublicHTTPSURL := func(value string) bool {
		parsed, err := url.Parse(value)
		return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil &&
			parsed.RawQuery == "" && parsed.Fragment == ""
	}
	_, dateErr := time.Parse("2006-01-02", h.config.PublicEffectiveDate)
	if !validPublicText(h.config.PublicLegalName) || !validPublicHTTPSURL(h.config.PublicCompanyWebsite) ||
		!validEmail(h.config.PublicSupportEmail) ||
		!validEmail(h.config.PublicPrivacyEmail) || dateErr != nil ||
		!validPublicText(h.config.PublicBusinessAddress) ||
		!validPublicText(h.config.PublicProcessingRegions) ||
		!validPublicText(h.config.PublicSubprocessors) ||
		!validPublicText(h.config.PublicTransferMechanism) ||
		!validPublicText(h.config.PublicOrderRetention) ||
		!validPublicText(h.config.PublicBackupRetention) ||
		!validPublicText(h.config.PublicDeletionProcess) ||
		!validPublicText(h.config.PublicPrivacyOfficer) {
		http.Error(w, "Public information is not configured", http.StatusServiceUnavailable)
		return false
	}
	return true
}

func writePublicPage(w http.ResponseWriter, content string, data publicPageData) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=300")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	t, err := template.New("page").Parse(publicPageShell + `{{define "content"}}` + content + `{{end}}`)
	if err != nil {
		http.Error(w, "Public information is temporarily unavailable", http.StatusInternalServerError)
		return
	}
	if err := t.Execute(w, data); err != nil {
		return
	}
}

func (h *Handler) handlePrivacyPolicy(w http.ResponseWriter, _ *http.Request) {
	if !h.publicPageReady(w) {
		return
	}
	writePublicPage(w, `<h1>Privacy Policy</h1><p class="meta">Effective {{.EffectiveDate}}</p><p>{{.LegalName}} operates Xinzhi ERP, an order, inventory, fulfillment and storefront support application for Shopify merchants. The <a href="/shopify/data-processing-terms">Merchant Data Processing Terms</a> describe the Provider's processing commitments to merchants.</p><h2>Data we process</h2><p>Through Shopify APIs and at a merchant's direction, we process store, product and variant, location, inventory, current order, customer, merchant-managed fulfillment order, return, refund and Shopify Payments dispute metadata, including status, amount, reason and processing deadlines. We do not access dispute evidence in the current release. Customer and order records can include line items, amounts, status, recipient or customer name, shipping address, broad location, phone and email. Directly from merchant users, we process ERP account identifiers, permissions, app-support communications, security events and audit records required to operate and secure the service.</p><p>If a merchant enables the Xinzhi Chat app embed, we process messages and attachments submitted by storefront visitors, a random browser identifier and conversation identifier used for chat continuity, the page and product context where the chat was opened, and any order number or email a visitor voluntarily enters for order-status help. A signed-in Shopify customer may also choose to share their customer session with the widget so the merchant can provide authenticated support. The widget defaults continuity data to session-only browser storage and uses persistent first-party storage only while Shopify's Customer Privacy API reports that preference processing is allowed. If that permission is withdrawn, the widget removes its persistent continuity data. It does not use this data for third-party advertising or unrelated behavior tracking.</p><h2>Purposes and limits</h2><p>We use customer and recipient data only to identify, import, fulfill and handle after-sales work for the merchant's own orders. We use storefront chat data only to maintain the visitor's conversation, provide requested self-service information and let the merchant's authorized support agents respond. We use other Shopify data only for merchant-authorized product matching, order operations, inventory publication, merchant-managed fulfillment, returns, refunds and dispute-metadata monitoring. We do not sell personal data or use Shopify customer or storefront chat data for unrelated advertising, profiling, lead generation or Xinzhi ERP marketing.</p><h2>Sharing, locations and transfers</h2><p>Subprocessors: {{.Subprocessors}}. Processing regions: {{.ProcessingRegions}}. International or other transfer safeguards: {{.TransferMechanism}}. Data is otherwise disclosed only to the merchant's authorized users or where law requires it. Access is tenant-scoped and role controlled. Shopify credentials are encrypted and kept in the connector service.</p><h2>Retention and deletion</h2><p>Operational customer, order, storefront conversation, attachment, return, refund and dispute-metadata retention: {{.OrderRetention}}. Backup retention and deletion: {{.BackupRetention}}. Deletion and verified-request process: {{.DeletionProcess}}. Uninstall revokes Shopify credentials and removes the theme app embed from the installed app; stored operational data follows the stated deletion process. Mandatory Shopify privacy webhooks record verified requests for the approved operational process; webhook receipt alone is not represented as completed deletion.</p><h2>Security and rights</h2><p>We use encryption in transit, encrypted credential storage, least-privilege access, audit controls and recovery procedures. Merchants and data subjects may request access, correction, deletion or restriction of processing, and exercise other applicable rights, by contacting <a href="mailto:{{.PrivacyEmail}}">{{.PrivacyEmail}}</a>.</p><h2>Contact</h2><p>{{.LegalName}} · {{.BusinessAddress}} · Privacy officer/contact: {{.PrivacyOfficer}} · <a href="mailto:{{.PrivacyEmail}}">{{.PrivacyEmail}}</a></p>`, h.publicPageData("Privacy Policy"))
}

func (h *Handler) handleTerms(w http.ResponseWriter, _ *http.Request) {
	if !h.publicPageReady(w) {
		return
	}
	writePublicPage(w, `<h1>Terms of Service</h1><p>Access requires an account provisioned and authorized by Xinzhi staff. This applies to every user and business, without exception. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access. Contact <a href="mailto:{{.SupportEmail}}">{{.SupportEmail}}</a> for account provisioning and access approval.</p><p class="meta">Effective {{.EffectiveDate}}</p><p>These terms govern use of Xinzhi ERP provided by {{.LegalName}}. Users must be authorized by the merchant, protect their credentials, grant only necessary Shopify permissions and use the service lawfully.</p><p>Merchants control their store data and are responsible for reviewing irreversible operations before confirmation. Availability can be affected by Shopify, network or maintenance events. The service may be suspended for security abuse or material breach.</p><p>The <a href="/shopify/data-processing-terms">Merchant Data Processing Terms</a> form part of these Terms. By installing, accessing or continuing to use Xinzhi ERP on or after their effective date, the merchant accepts the Data Terms.</p><p>Questions: <a href="mailto:{{.SupportEmail}}">{{.SupportEmail}}</a>.</p>`, h.publicPageData("Terms of Service"))
}

func (h *Handler) handleDataProcessingTerms(w http.ResponseWriter, _ *http.Request) {
	if !h.publicPageReady(w) {
		return
	}
	writePublicPage(w, dataProcessingTermsContent, h.publicPageData("Merchant Data Processing Terms"))
}

func (h *Handler) handleSupport(w http.ResponseWriter, _ *http.Request) {
	if !h.publicPageReady(w) {
		return
	}
	writePublicPage(w, `<h1>Xinzhi ERP Support</h1><p>Access requires an account provisioned and authorized by Xinzhi staff. This applies to every user and business, without exception. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access. Contact <a href="mailto:{{.SupportEmail}}">{{.SupportEmail}}</a> for account provisioning and access approval.</p><p>For installation, authorization, account, data or security assistance, email <a href="mailto:{{.SupportEmail}}">{{.SupportEmail}}</a>.</p><p>Include the merchant name, <code>myshopify.com</code> domain, the affected workflow and approximate time. Never send passwords, access tokens or full customer payment information.</p>`, h.publicPageData("Support"))
}

func (h *Handler) handleDataDeletion(w http.ResponseWriter, _ *http.Request) {
	if !h.publicPageReady(w) {
		return
	}
	writePublicPage(w, `<h1>Data Access and Deletion</h1><p>Shopify privacy requests are received automatically through the mandatory <code>customers/data_request</code>, <code>customers/redact</code> and <code>shop/redact</code> webhooks. Receipt records the request for verified operational handling; it does not by itself mean that export or deletion is complete.</p><p>Approved request and deletion process: {{.DeletionProcess}}</p><p>Merchants can also request export or deletion by emailing <a href="mailto:{{.PrivacyEmail}}">{{.PrivacyEmail}}</a> from an authorized business address. Include the store domain and request type; do not send customer data in the email. We verify authority before acting and retain only records required by law or security obligations.</p>`, h.publicPageData("Data Access and Deletion"))
}

func (h *Handler) handleReviewerGuide(w http.ResponseWriter, _ *http.Request) {
	if !h.publicPageReady(w) {
		return
	}
	writePublicPage(w, reviewerGuideContent, h.publicPageData("Installation Guide"))
}
