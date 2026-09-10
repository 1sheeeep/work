package installations

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func readyPublicPageConfig() RuntimeConfig {
	return RuntimeConfig{
		PublicLegalName:         "Example Legal LLC",
		PublicCompanyWebsite:    "https://company.example/",
		PublicSupportEmail:      "support@example.com",
		PublicPrivacyEmail:      "privacy@example.com",
		PublicEffectiveDate:     "2026-08-06",
		PublicBusinessAddress:   "123 Example Street, Example City",
		PublicProcessingRegions: "United States",
		PublicSubprocessors:     "Example Infrastructure Provider",
		PublicTransferMechanism: "Approved contractual safeguards",
		PublicOrderRetention:    "Approved operational retention schedule",
		PublicBackupRetention:   "Approved backup aging and deletion schedule",
		PublicDeletionProcess:   "Approved verified request and irreversible deletion process",
		PublicPrivacyOfficer:    "Privacy Team",
	}
}

func TestPrivacyPageDisclosesRequiredDataPractices(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	config := readyPublicPageConfig()
	config.PublicSubprocessors = "Example <Infrastructure> Provider"
	handler.config.PublicLegalName = config.PublicLegalName
	handler.config.PublicCompanyWebsite = config.PublicCompanyWebsite
	handler.config.PublicSupportEmail = config.PublicSupportEmail
	handler.config.PublicPrivacyEmail = config.PublicPrivacyEmail
	handler.config.PublicEffectiveDate = config.PublicEffectiveDate
	handler.config.PublicBusinessAddress = config.PublicBusinessAddress
	handler.config.PublicProcessingRegions = config.PublicProcessingRegions
	handler.config.PublicSubprocessors = config.PublicSubprocessors
	handler.config.PublicTransferMechanism = config.PublicTransferMechanism
	handler.config.PublicOrderRetention = config.PublicOrderRetention
	handler.config.PublicBackupRetention = config.PublicBackupRetention
	handler.config.PublicDeletionProcess = config.PublicDeletionProcess
	handler.config.PublicPrivacyOfficer = config.PublicPrivacyOfficer

	request := httptest.NewRequest(http.MethodGet, PrivacyPolicyPath, nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	body := response.Body.String()
	if response.Code != http.StatusOK {
		t.Fatalf("privacy page status=%d body=%s", response.Code, body)
	}
	for _, required := range []string{
		"Through Shopify APIs",
		"customer, merchant-managed fulfillment order, return, refund",
		"Shopify Payments dispute metadata",
		"We do not access dispute evidence in the current release",
		"Directly from merchant users",
		"messages and attachments submitted by storefront visitors",
		"random browser identifier and conversation identifier used for chat continuity",
		"order number or email a visitor voluntarily enters",
		"defaults continuity data to session-only browser storage",
		"uses persistent first-party storage only while Shopify's Customer Privacy API reports that preference processing is allowed",
		"removes its persistent continuity data",
		"does not use this data for third-party advertising or unrelated behavior tracking",
		"storefront chat data only to maintain the visitor's conversation",
		"storefront conversation, attachment, return, refund",
		"Example &lt;Infrastructure&gt; Provider",
		"United States",
		"Approved contractual safeguards",
		"Approved operational retention schedule",
		"Approved backup aging and deletion schedule",
		"Approved verified request and irreversible deletion process",
		"webhook receipt alone is not represented as completed deletion",
		"restriction of processing",
		"123 Example Street, Example City",
		"Privacy Team",
		"Company website",
		"https://company.example/",
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("privacy page is missing %q: %s", required, body)
		}
	}
	for _, prohibited := range []string{"installs no storefront code", "ticket routing", "dispute-evidence preparation"} {
		if strings.Contains(body, prohibited) {
			t.Fatalf("ERP privacy page contains excluded customer-service or marketing purpose %q: %s", prohibited, body)
		}
	}
	if strings.Contains(body, "{{.") || strings.Contains(body, "<Infrastructure>") {
		t.Fatalf("privacy page exposed an unrendered or unescaped value: %s", body)
	}
}

func TestPublicPagesFailClosedWhenLegalDisclosureIsIncomplete(t *testing.T) {
	fields := []struct {
		name  string
		clear func(*RuntimeConfig)
	}{
		{"legal name", func(config *RuntimeConfig) { config.PublicLegalName = "" }},
		{"company website", func(config *RuntimeConfig) { config.PublicCompanyWebsite = "" }},
		{"support email", func(config *RuntimeConfig) { config.PublicSupportEmail = "" }},
		{"privacy email", func(config *RuntimeConfig) { config.PublicPrivacyEmail = "" }},
		{"effective date", func(config *RuntimeConfig) { config.PublicEffectiveDate = "" }},
		{"business address", func(config *RuntimeConfig) { config.PublicBusinessAddress = "" }},
		{"processing regions", func(config *RuntimeConfig) { config.PublicProcessingRegions = "" }},
		{"subprocessors", func(config *RuntimeConfig) { config.PublicSubprocessors = "" }},
		{"transfer mechanism", func(config *RuntimeConfig) { config.PublicTransferMechanism = "" }},
		{"order retention", func(config *RuntimeConfig) { config.PublicOrderRetention = "" }},
		{"backup retention", func(config *RuntimeConfig) { config.PublicBackupRetention = "" }},
		{"deletion process", func(config *RuntimeConfig) { config.PublicDeletionProcess = "" }},
		{"privacy officer", func(config *RuntimeConfig) { config.PublicPrivacyOfficer = "" }},
	}
	for _, field := range fields {
		t.Run(field.name, func(t *testing.T) {
			handler := newTestHandler(t, &recordingExchanger{})
			config := readyPublicPageConfig()
			field.clear(&config)
			handler.config = config
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, PrivacyPolicyPath, nil))
			if response.Code != http.StatusServiceUnavailable ||
				!strings.Contains(response.Body.String(), "Public information is not configured") {
				t.Fatalf("expected fail-closed 503, got status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
	for _, website := range []string{"http://xzkj.ai/", "javascript:alert(1)", "https://user:secret@xzkj.ai/", "https://xzkj.ai/?preview=1"} {
		t.Run("invalid company website "+website, func(t *testing.T) {
			handler := newTestHandler(t, &recordingExchanger{})
			config := readyPublicPageConfig()
			config.PublicCompanyWebsite = website
			handler.config = config
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, PrivacyPolicyPath, nil))
			if response.Code != http.StatusServiceUnavailable {
				t.Fatalf("invalid company website %q returned status=%d", website, response.Code)
			}
		})
	}
}

func TestDataProcessingTermsDiscloseApprovedMerchantAgreement(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.config = readyPublicPageConfig()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, DataProcessingTermsPath, nil))
	body := response.Body.String()
	if response.Code != http.StatusOK {
		t.Fatalf("data processing terms status=%d body=%s", response.Code, body)
	}
	for _, required := range []string{
		"Merchant Data Processing Terms",
		"By installing, accessing or continuing to use Xinzhi ERP",
		"controller, business or equivalent role",
		"processor, service provider or equivalent role",
		"does not sell personal data",
		"Amazon Web Services",
		"primary processing region is Singapore",
		"only when the merchant enables the relevant integration",
		"applicable provider contractual safeguards",
		"completed within 30 days after receipt",
		"Encrypted rolling backups are retained for no more than 30 days",
		"Webhook receipt alone is not represented as completed deletion",
		"privacy@example.com",
		"123 Example Street, Example City",
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("data processing terms are missing %q: %s", required, body)
		}
	}
	for _, prohibited := range []string{"fixed number of hours", "standard contractual clauses are in place", "daily review", "automated email alert"} {
		if strings.Contains(body, prohibited) {
			t.Fatalf("data processing terms contain unsupported commitment %q: %s", prohibited, body)
		}
	}
}

func TestPrivacyAndTermsLinkMerchantDataProcessingTerms(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.config = readyPublicPageConfig()
	for _, path := range []string{PrivacyPolicyPath, TermsPath} {
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `href="/shopify/data-processing-terms"`) {
			t.Fatalf("public page %s does not link data processing terms: status=%d body=%s", path, response.Code, response.Body.String())
		}
	}
}

func TestReviewerGuideKeepsStorefrontChatSetupInCustomerService(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.config = readyPublicPageConfig()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, ReviewerGuidePath, nil))
	body := response.Body.String()
	if response.Code != http.StatusOK {
		t.Fatalf("reviewer guide status=%d body=%s", response.Code, body)
	}
	for _, required := range []string{
		"independent customer service workbench",
		"Copy plugin enable link",
		"never opens, switches, or controls a browser",
		"Support Chat under Xinzhi ERP",
		"customer service workbench",
		"does not request a second Shopify authorization",
		"Disable the app embed",
		"claim the conversation",
		"Create or update the related ticket",
		"Transfer the conversation",
		"close and reopen the conversation",
		"Select Customer service in ERP to enter without another password",
		"An ERP-only account does not receive customer-service access automatically",
		"ERP-only account",
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("reviewer guide is missing %q: %s", required, body)
		}
	}
}

func TestReviewerGuideCoversEverySubmittedScopeAndSafeRecovery(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.config = readyPublicPageConfig()
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, ReviewerGuidePath, nil))
	body := response.Body.String()
	for _, required := range []string{
		"<code>read_all_orders</code>", "<code>read_customers</code>",
		"<code>read_locations</code>", "<code>read_products</code>",
		"<code>read_shopify_payments_disputes</code>", "<code>write_inventory</code>",
		"<code>write_merchant_managed_fulfillment_orders</code>", "<code>write_order_edits</code>",
		"<code>write_orders</code>", "<code>write_returns</code>",
		"Complete Shopify authorization before linking a Xinzhi account",
		"ERP native login", "one verified ERP reviewer account",
		"ERP and customer service share the existing ERP account",
		"ERP session tokens are rejected as customer-service sessions",
		"enter the same ERP enterprise code, account and password to sign in without leaving the page",
		"not stored as customer-service credentials",
		"Access requires an account provisioned and authorized by Xinzhi staff",
		"Self-service registration is not available",
		"Installing or authorizing the Shopify app does not grant system access",
		"No enterprise or account is created by installation, login attempts or linking",
		"same permission checks as other users",
		"Check plugin setup",
		"A mismatch or unavailable result leaves setup links locked",
		"a detected embed is not proof that its toggle was saved or that messaging works",
		"A connection-status page alone is not the complete embedded business experience",
		"do not change local dates", "Do not submit a second refund",
		"Never run a whole-store redaction test on a shared review store",
		"Uninstall revokes access; it is not proof", "without a duplicate store record",
	} {
		if !strings.Contains(body, required) {
			t.Errorf("guide missing review boundary %q", required)
		}
	}
	for _, prohibited := range []string{"Sign in with Xinzhi account", "shared-identity sign-in", "same Xinzhi identity", "One enterprise ID", "ERP one-time entry", "read_shopify_payments_dispute_evidences", "write_shopify_payments_dispute_evidences", "kf.xzkj.ai", "kf-uat.xzkj.ai"} {
		if strings.Contains(body, prohibited) {
			t.Errorf("guide restores obsolete or environment-specific content %q", prohibited)
		}
	}
}

func TestReviewerGuideHasAccessibleSectionsAndEscapesPublicValues(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	handler.config = readyPublicPageConfig()
	handler.config.PublicLegalName = "Preview <script>Company</script>"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, ReviewerGuidePath, nil))
	body := response.Body.String()
	if response.Code != http.StatusOK || strings.Count(body, "<h1>") != 1 || strings.Contains(body, "<script>") || !strings.Contains(body, "Preview &lt;script&gt;Company&lt;/script&gt;") {
		t.Fatal("guide failed rendering/escaping checks")
	}
	for _, id := range []string{"install", "erp-workflows", "support-chat", "conversation-lifecycle", "uninstall", "recovery"} {
		if strings.Count(body, `id="`+id+`"`) != 1 || !strings.Contains(body, `href="#`+id+`"`) {
			t.Errorf("guide section %s has no unique anchor and contents link", id)
		}
	}
	if !strings.Contains(body, "overflow-wrap:anywhere") || !strings.Contains(body, "min-height:44px") {
		t.Fatal("guide is missing small-screen scope wrapping or touch targets")
	}
}
