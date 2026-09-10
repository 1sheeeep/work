package mailapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"shopify-support-platform/internal/appcore"
)

func TestOAuthDefaultScopesMatchRegisteredApps(t *testing.T) {
	if defaultScope != "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send" {
		t.Fatalf("unexpected Outlook default scopes: %q", defaultScope)
	}
	if gmailDefaultScope != "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send" {
		t.Fatalf("unexpected Gmail default scopes: %q", gmailDefaultScope)
	}
}

func TestImportProxyBindingsMatchesMallIDAndEmail(t *testing.T) {
	path := filepath.Join(t.TempDir(), "proxy.csv")
	if err := os.WriteFile(path, []byte("mall_id,email,proxy_url\n3381414,test@example.com,http://user:pass@proxy.example.com:8080\n"), 0644); err != nil {
		t.Fatal(err)
	}
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{}}}
	next, result, err := ImportProxyBindings(settings, path)
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 1 || result.Skipped != 0 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	shop := appcore.Shop{MallID: "3381414", Raw: map[string]any{"mall_account": "test@example.com", "ip_address": "1.2.3.4"}}
	annotated := AnnotateShop(next, shop)
	if !annotated.ProxyConfigured || annotated.MailAccount != "test@example.com" {
		t.Fatalf("expected proxy-configured annotated shop, got %+v", annotated)
	}
}

func TestImportProxyBindingsStoresCuiqiuDomainID(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cuiqiu.csv")
	if err := os.WriteFile(path, []byte("mall_id,email,provider,cuiqiu_token,cuiqiu_mail_id,cuiqiu_domain_id,cuiqiu_api_base\ncuiqiu-shop,oownx@fastmo.cn,outlook,token-1,mail-1,domain-1,https://domain-open-api.cuiqiu.com\n"), 0644); err != nil {
		t.Fatal(err)
	}
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{}}}
	next, result, err := ImportProxyBindings(settings, path)
	if err != nil {
		t.Fatal(err)
	}
	if result.Imported != 1 || result.Skipped != 0 {
		t.Fatalf("unexpected import result: %+v", result)
	}
	binding := findBinding(next, appcore.Shop{MallID: "cuiqiu-shop", Raw: map[string]any{"mall_account": "oownx@fastmo.cn"}})
	if binding == nil {
		t.Fatal("expected imported binding")
	}
	if got := stringFromMap(binding, "provider"); got != providerCuiqiu {
		t.Fatalf("expected fastmo binding to normalize to cuiqiu, got %q", got)
	}
	if got := stringFromMap(binding, "cuiqiu_domain_id"); got != "domain-1" {
		t.Fatalf("expected domain id to be imported, got %q", got)
	}
}

func TestCuiqiuLookupMailIDUsesV2MailListAndDomainID(t *testing.T) {
	var seenPath string
	var seenForm map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seenPath = r.URL.Path
		if r.Method != http.MethodPost {
			t.Fatalf("expected POST, got %s", r.Method)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		seenForm = map[string]string{}
		for key, values := range r.MultipartForm.Value {
			if len(values) > 0 {
				seenForm[key] = values[0]
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"msg":"ok","data":{"list":[{"id":"mail-123","mail":"oownx@fastmo.cn"}]}}`))
	}))
	defer server.Close()

	got, err := (CuiqiuProvider{}).lookupMailID(context.Background(), cuiqiuConfig{
		Token:    "token-1",
		DomainID: "domain-1",
		APIBase:  server.URL,
	}, "OOWNX@FASTMO.CN")
	if err != nil {
		t.Fatal(err)
	}
	if got != "mail-123" {
		t.Fatalf("expected mail id, got %q", got)
	}
	if seenPath != "/v2/mail/list" {
		t.Fatalf("expected v2 mail list endpoint, got %q", seenPath)
	}
	for key, want := range map[string]string{
		"token":      "token-1",
		"mail":       "oownx@fastmo.cn",
		"domain_id":  "domain-1",
		"offset":     "0",
		"limit":      "20",
		"sort_value": "created_at",
		"sort_type":  "desc",
	} {
		if got := seenForm[key]; got != want {
			t.Fatalf("expected form %s=%q, got %q in %+v", key, want, got, seenForm)
		}
	}
}

func TestCuiqiuListMessagesUsesOfficialPageLimitAndHonorsRequestedTotal(t *testing.T) {
	var limits []string
	var pages []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		limits = append(limits, r.FormValue("limit"))
		pages = append(pages, r.FormValue("page"))
		page, _ := strconv.Atoi(r.FormValue("page"))
		rows := make([]map[string]any, 0, 20)
		for index := 0; index < 20; index++ {
			rows = append(rows, map[string]any{"id": fmt.Sprintf("message-%d", (page-1)*20+index+1)})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"code": 200, "data": map[string]any{"list": rows, "total": 60}})
	}))
	defer server.Close()

	messages, err := (CuiqiuProvider{}).listMessages(context.Background(), cuiqiuConfig{
		Token: "token", MailID: "mail-1", APIBase: server.URL,
	}, "Inbox", "2026-08-01", "2026-08-15", 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(messages) != 50 {
		t.Fatalf("messages = %d, want 50", len(messages))
	}
	if strings.Join(limits, ",") != "20,20,20" || strings.Join(pages, ",") != "1,2,3" {
		t.Fatalf("unexpected paging: limits=%#v pages=%#v", limits, pages)
	}
}

func TestSaveCuiqiuAuthorizationFindsMailIDAndMarksAuthorized(t *testing.T) {
	var seenForm map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/mail/list" {
			t.Fatalf("expected v2 mail list endpoint, got %q", r.URL.Path)
		}
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		seenForm = map[string]string{}
		for key, values := range r.MultipartForm.Value {
			if len(values) > 0 {
				seenForm[key] = values[0]
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":200,"msg":"ok","data":{"list":[{"id":"mail-123","mail":"oownx@fastmo.cn"}]}}`))
	}))
	defer server.Close()

	settings := appcore.Settings{Mail: map[string]any{
		"cuiqiu_api_base": server.URL,
		"proxy_bindings":  []map[string]any{},
	}}
	shop := appcore.Shop{MallID: "cuiqiu-shop", Raw: map[string]any{"mall_account": "oownx@fastmo.cn"}}
	next, mailID, err := SaveCuiqiuAuthorization(context.Background(), settings, shop, "token-1", "", "domain-1")
	if err != nil {
		t.Fatal(err)
	}
	if mailID != "mail-123" {
		t.Fatalf("expected resolved mail id, got %q", mailID)
	}
	binding := findBinding(next, shop)
	if binding == nil {
		t.Fatal("expected saved binding")
	}
	for key, want := range map[string]string{
		"provider":         providerCuiqiu,
		"cuiqiu_token":     "token-1",
		"cuiqiu_mail_id":   "mail-123",
		"cuiqiu_domain_id": "domain-1",
	} {
		if got := stringFromMap(binding, key); got != want {
			t.Fatalf("expected binding %s=%q, got %q in %+v", key, want, got, binding)
		}
	}
	if got := seenForm["domain_id"]; got != "domain-1" {
		t.Fatalf("expected domain_id in v2 lookup, got %q", got)
	}
	annotated := AnnotateShop(next, shop)
	if !annotated.APIAuthorized {
		t.Fatalf("expected saved token to mark shop authorized, got %+v", annotated)
	}
}

func TestSaveCuiqiuAuthorizationRejectsEmptyToken(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{}}}
	shop := appcore.Shop{MallID: "cuiqiu-shop", Raw: map[string]any{"mall_account": "oownx@fastmo.cn"}}
	next, _, err := SaveCuiqiuAuthorization(context.Background(), settings, shop, "", "", "")
	if err == nil {
		t.Fatal("expected empty token error")
	}
	if binding := findBinding(next, shop); binding != nil {
		t.Fatalf("empty token must not create an authorized binding, got %+v", binding)
	}
}

func TestSaveShopServiceEmailOverridesAndClearsToAuto(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{}}}
	shop := appcore.Shop{MallID: "shop-1", Raw: map[string]any{"mall_account": "auto@outlook.com"}}

	next, err := SaveShopServiceEmail(settings, shop, "Support@Gmail.com")
	if err != nil {
		t.Fatal(err)
	}
	annotated := AnnotateShop(next, shop)
	if annotated.MailAccount != "support@gmail.com" || annotated.ServiceEmail != "support@gmail.com" || annotated.MailAccountSource != "manual" {
		t.Fatalf("expected manual service email to override auto account, got %+v", annotated)
	}
	if annotated.MailProvider != providerGmail {
		t.Fatalf("expected gmail provider for manual service email, got %q", annotated.MailProvider)
	}

	next, err = SaveShopServiceEmail(next, shop, "")
	if err != nil {
		t.Fatal(err)
	}
	annotated = AnnotateShop(next, shop)
	if annotated.MailAccount != "auto@outlook.com" || annotated.ServiceEmail != "" || annotated.MailAccountSource != "auto" {
		t.Fatalf("expected clear to restore automatic mailbox, got %+v", annotated)
	}
}

func TestSaveShopServiceEmailChangeClearsOldAuthorization(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{{
		"mall_id":       "shop-1",
		"email":         "old@outlook.com",
		"service_email": "old@outlook.com",
		"provider":      providerOutlook,
		"access_token":  "access",
		"refresh_token": "refresh",
		"authorized_at": "2026-07-02T00:00:00Z",
	}}}}
	shop := appcore.Shop{MallID: "shop-1", Raw: map[string]any{"mall_account": "auto@outlook.com"}}

	next, err := SaveShopServiceEmail(settings, shop, "new@gmail.com")
	if err != nil {
		t.Fatal(err)
	}
	binding := findBinding(next, shop)
	if binding == nil {
		t.Fatal("expected binding")
	}
	if got := stringFromMap(binding, "email"); got != "new@gmail.com" {
		t.Fatalf("expected binding email to change, got %q", got)
	}
	if got := stringFromMap(binding, "access_token"); got != "" {
		t.Fatalf("expected old access token to be cleared, got %q", got)
	}
	if got := stringFromMap(binding, "refresh_token"); got != "" {
		t.Fatalf("expected old refresh token to be cleared, got %q", got)
	}
	annotated := AnnotateShop(next, shop)
	if annotated.APIAuthorized {
		t.Fatalf("expected changed service email to require new authorization, got %+v", annotated)
	}
}

func TestSaveShopServiceEmailSameAsAuthorizedEmailKeepsAuthorization(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{{
		"mall_id":       "shop-1",
		"email":         "support@outlook.com",
		"provider":      providerOutlook,
		"access_token":  "access",
		"refresh_token": "refresh",
	}}}}
	shop := appcore.Shop{MallID: "shop-1", Raw: map[string]any{"mall_account": "support@outlook.com"}}

	next, err := SaveShopServiceEmail(settings, shop, "support@outlook.com")
	if err != nil {
		t.Fatal(err)
	}
	annotated := AnnotateShop(next, shop)
	if annotated.MailAccount != "support@outlook.com" || annotated.MailAccountSource != "manual" {
		t.Fatalf("expected configured mailbox to be effective, got %+v", annotated)
	}
	if !annotated.APIAuthorized {
		t.Fatalf("expected same configured mailbox to keep authorization, got %+v", annotated)
	}
}

func TestClearDifferentServiceEmailDoesNotReuseItsTokenForAutoMailbox(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{{
		"mall_id":       "shop-1",
		"email":         "manual@gmail.com",
		"service_email": "manual@gmail.com",
		"provider":      providerGmail,
		"refresh_token": "refresh",
	}}}}
	shop := appcore.Shop{MallID: "shop-1", Raw: map[string]any{"mall_account": "auto@outlook.com"}}

	next, err := SaveShopServiceEmail(settings, shop, "")
	if err != nil {
		t.Fatal(err)
	}
	annotated := AnnotateShop(next, shop)
	if annotated.MailAccount != "auto@outlook.com" || annotated.MailAccountSource != "auto" {
		t.Fatalf("expected clear to restore automatic mailbox, got %+v", annotated)
	}
	if annotated.APIAuthorized {
		t.Fatalf("expected manual mailbox token not to authorize automatic mailbox after clear, got %+v", annotated)
	}
}

func TestAnnotateShopKeepsExistingAuthorizationStatusWhenAutoDiffers(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{{
		"mall_id":       "shop-1",
		"email":         "authorized@outlook.com",
		"provider":      providerOutlook,
		"refresh_token": "refresh",
	}}}}
	shop := appcore.Shop{MallID: "shop-1", Raw: map[string]any{"mall_account": "auto@outlook.com"}}

	annotated := AnnotateShop(settings, shop)
	if annotated.MailAccount != "auto@outlook.com" {
		t.Fatalf("expected unconfigured shop to keep automatic mailbox display, got %+v", annotated)
	}
	if !annotated.APIAuthorized {
		t.Fatalf("expected existing token to remain authorized, got %+v", annotated)
	}
}

func TestAuthorizationURLAllowsZhanfuDirectWithoutProxy(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{
		"outlook_client_id": "client-id",
		"redirect_uri":      "http://localhost:8400/",
		"proxy_bindings":    []map[string]any{},
	}}
	shop := appcore.Shop{MallID: "3381414", AdapterName: "zhanfu", Raw: map[string]any{"mall_account": "test@example.com"}}
	next, started, err := (OutlookGraphProvider{}).AuthorizationURL(settings, shop)
	if err != nil {
		t.Fatal(err)
	}
	if started.AuthURL == "" {
		t.Fatal("expected auth URL for direct zhanfu authorization")
	}
	parsed, err := url.Parse(started.AuthURL)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.Query().Get("scope") == "" || parsed.Query().Get("redirect_uri") == "" || parsed.Query().Get("response_type") != "code" {
		t.Fatalf("expected complete authorization URL, got %s", started.AuthURL)
	}
	binding := findPendingBinding(next, started.State)
	if binding == nil || stringFromMap(binding, "network_mode") != "direct" {
		t.Fatalf("expected direct pending binding, got %+v", binding)
	}
}

func TestAuthorizationURLAllowsDisabledShopToReauthorize(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{
		"outlook_client_id":     "client-id",
		"redirect_uri":          "http://localhost:8400/",
		"disabled_api_shop_ids": []any{"3381414"},
		"api_read_enabled":      true,
		"proxy_bindings":        []map[string]any{},
	}}
	shop := appcore.Shop{MallID: "3381414", AdapterName: "zhanfu", Raw: map[string]any{"mall_account": "test@example.com"}}
	next, started, err := (OutlookGraphProvider{}).AuthorizationURL(settings, shop)
	if err != nil {
		t.Fatal(err)
	}
	if started.AuthURL == "" || started.State == "" {
		t.Fatalf("expected disabled shop to still allow reauthorization, got %+v", started)
	}
	if findPendingBinding(next, started.State) == nil {
		t.Fatal("expected pending binding to be saved for disabled shop")
	}
}

func TestSetShopAPIDisabledCanReenableShop(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"disabled_api_shop_ids": []any{"3381414", "other"}}}
	settings = SetShopAPIDisabled(settings, "3381414", false)
	shop := AnnotateShop(settings, appcore.Shop{MallID: "3381414"})
	if !shop.APIToggleable {
		t.Fatalf("expected manually disabled shop API to remain toggleable, got %+v", shop)
	}
	if shop.APIDisabled {
		t.Fatalf("expected shop API to be re-enabled, got %+v", shop)
	}
	cached := AnnotateShop(settings, appcore.Shop{
		MallID:            "3381414",
		APIDisabled:       true,
		APIDisabledReason: "mail API is disabled for this shop",
	})
	if cached.APIDisabled || cached.APIDisabledReason != "" {
		t.Fatalf("expected annotation to clear stale cached API disabled state, got %+v", cached)
	}
	other := AnnotateShop(settings, appcore.Shop{MallID: "other"})
	if !other.APIDisabled {
		t.Fatalf("expected unrelated disabled shop to stay disabled, got %+v", other)
	}
	if !other.APIToggleable {
		t.Fatalf("expected unrelated manually disabled shop API to remain toggleable, got %+v", other)
	}
}

func TestAdapterDisabledShopAPIIsNotToggleable(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{
		"adapter_modes": map[string]any{"bitbrowser": "web_only"},
	}}
	shop := AnnotateShop(settings, appcore.Shop{MallID: "3381414", AdapterName: "bitbrowser"})
	if shop.APIToggleable {
		t.Fatalf("expected adapter-disabled shop API to be non-toggleable, got %+v", shop)
	}
	if shop.APIAllowed || !shop.APIDisabled {
		t.Fatalf("expected adapter-disabled shop API to be disabled and disallowed, got %+v", shop)
	}
}

func TestAuthorizationURLStoresPendingState(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{
		"outlook_client_id": "client-id",
		"redirect_uri":      "http://localhost:8400/",
		"proxy_bindings": []map[string]any{{
			"mall_id":   "3381414",
			"email":     "test@example.com",
			"proxy_url": "http://user:pass@proxy.example.com:8080",
		}},
	}}
	shop := appcore.Shop{MallID: "3381414", Raw: map[string]any{"mall_account": "test@example.com"}}
	next, started, err := (OutlookGraphProvider{}).AuthorizationURL(settings, shop)
	if err != nil {
		t.Fatal(err)
	}
	if started.AuthURL == "" || started.State == "" {
		t.Fatalf("expected auth URL and state, got %+v", started)
	}
	if findPendingBinding(next, started.State) == nil {
		t.Fatal("expected pending binding to be persisted in settings")
	}
}

func TestFindPendingBindingDoesNotFallbackWhenStateIsProvided(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"proxy_bindings": []map[string]any{
		{"mall_id": "authorized", "pending_state": "", "refresh_token": "saved"},
		{"mall_id": "pending", "pending_state": "current-state"},
	}}}
	if binding := findPendingBinding(settings, "expired-state"); binding != nil {
		t.Fatalf("expected no binding for mismatched explicit state, got %+v", binding)
	}
	if binding := findPendingBinding(settings, "current-state"); binding == nil || stringFromMap(binding, "mall_id") != "pending" {
		t.Fatalf("expected exact pending state match, got %+v", binding)
	}
}

func TestAnnotateZhanfuDirectRiskAddsSoftHint(t *testing.T) {
	err := annotateZhanfuDirectRisk(
		appcore.Shop{AdapterName: "zhanfu"},
		networkConfig{Mode: "direct"},
		errors.New("Graph mail read failed: 429 Too Many Requests"),
	)
	if err == nil || !strings.Contains(err.Error(), "禁用API") {
		t.Fatalf("expected zhanfu direct risk hint, got %v", err)
	}
}

func TestAnnotateZhanfuDirectRiskDoesNotAffectProxyShops(t *testing.T) {
	original := errors.New("Graph mail read failed: 429 Too Many Requests")
	err := annotateZhanfuDirectRisk(
		appcore.Shop{AdapterName: "bitbrowser"},
		networkConfig{Mode: "proxy"},
		original,
	)
	if err != original {
		t.Fatalf("expected non-zhanfu proxy error to remain unchanged, got %v", err)
	}
}

func TestBindingHasScope(t *testing.T) {
	binding := map[string]any{"scopes": "offline_access User.Read Mail.ReadWrite Mail.Send"}
	if !bindingHasScope(binding, "Mail.Send") {
		t.Fatal("expected Mail.Send scope to be detected")
	}
	if !bindingHasScope(binding, "Mail.ReadWrite") {
		t.Fatal("expected Mail.ReadWrite scope to be detected")
	}
	if !bindingHasAnyScope(binding, "Mail.Read", "Mail.ReadWrite") {
		t.Fatal("expected Mail.ReadWrite to satisfy read scope check")
	}
	if bindingHasScope(binding, "Calendars.Read") {
		t.Fatal("did not expect unrelated scope")
	}
	if bindingHasScope(map[string]any{}, "Mail.Send") {
		t.Fatal("empty scope list must not pass Mail.Send check")
	}
}

func TestGraphMessageIDFromConversation(t *testing.T) {
	conversation := appcore.Conversation{EmailMessageID: "outlook:message-id"}
	if got := graphMessageIDFromConversation(conversation); got != "message-id" {
		t.Fatalf("expected prefixed email message id to be stripped, got %q", got)
	}
	conversation = appcore.Conversation{SourceURL: "https://outlook.live.com/mail/0/inbox/id/AQMk-test%2Fid"}
	if got := graphMessageIDFromConversation(conversation); got != "AQMk-test/id" {
		t.Fatalf("expected message id from Outlook URL, got %q", got)
	}
}

func TestFilterGraphMessagesLikeWebKeepsCustomerIntent(t *testing.T) {
	messages := []graphMessage{
		testGraphMessage("m1", "Customer", "customer@example.com", "Order not received", "I have not received my order, please refund me."),
		testGraphMessage("m2", "Shopify", "mailer@shopify.com", "Product import completed", "Your product CSV import is complete."),
		testGraphMessage("m3", "The Jobber Team", "hello@jobber.com", "Track time and reduce admin time", "Get 40% off before this offer ends."),
		{ID: "m4", Subject: "Already read", IsRead: true, From: graphFrom{EmailAddress: graphEmailAddress{Name: "Customer", Address: "read@example.com"}}, BodyPreview: "Where is my order?"},
	}
	kept, ignored, learned := filterGraphMessagesLikeWeb(map[string]any{}, messages)
	if len(kept) != 1 || kept[0].ID != "m1" {
		t.Fatalf("expected only customer intent message to remain, kept=%+v", kept)
	}
	if ignored != 3 {
		t.Fatalf("expected three ignored messages, got %d", ignored)
	}
	if len(learned) == 0 {
		t.Fatal("expected high-confidence ignored sender fingerprint to be learned")
	}
}

func TestFilterGraphMessagesLikeWebDropsShopifyPaymentSettingsNotice(t *testing.T) {
	messages := []graphMessage{
		testGraphMessage("shopify-payment", "Dilyhbu (Shopify)", "mailer@shopify.com", "已更改付款设置", "HeJingjing 最近更改了 Dilyhbu 的支付设置。\n\n- HeJingjing 停用了 Airwallex 作为支付服务提供商\n\n如果您未做出此更改，联系 Shopify 支持团队。"),
		testGraphMessage("customer", "Dean Balvitsch", "dbalvitsch3@gmail.com", "Re:", "Then contact my card and tell them you screwed up .make it right"),
	}
	kept, ignored, _ := filterGraphMessagesLikeWeb(map[string]any{}, messages)
	if len(kept) != 1 || kept[0].ID != "customer" {
		t.Fatalf("expected only customer message to remain, kept=%+v", kept)
	}
	if ignored != 1 {
		t.Fatalf("expected Shopify payment notice to be ignored, got %d ignored", ignored)
	}
}

func TestRemovedShopifySenderRulesNoLongerFilterByIdentity(t *testing.T) {
	for _, sender := range []string{
		"no-reply@mailer.shopify.com",
		"Shopify <mailer@shopify.com>",
		"wealbeauty(Shopify) <mailer@shopify.com>",
		"Shopify Support (shopify) <support@shopify.com>",
		"Benjamin E. (shopify) <support@shopify.com>",
		"Shopify Support - No reply <no-reply@shopify.com>",
		"Shopify <email@email.shopify.com>",
	} {
		row := emailFilterRow{
			Sender:  sender,
			Subject: "Account message",
			Snippet: "Please review this message.",
			Lines:   []string{sender},
		}
		if isDefiniteNonCustomerEmail(row) || isHighConfidencePreDetailIgnoredEmail(row) {
			t.Errorf("removed Shopify sender rule still filters %q", sender)
		}
	}
}

func TestShopifyStoreRelayFilterRequiresDisplayName(t *testing.T) {
	named := emailFilterRow{
		Sender:  "HearthFind <store+123@g.shopifyemail.com>",
		Subject: "Account message",
		Snippet: "Please review this message.",
	}
	if !isDefiniteNonCustomerEmail(named) || !isHighConfidencePreDetailIgnoredEmail(named) {
		t.Fatal("named Shopify store relay sender was not filtered")
	}

	unnamed := emailFilterRow{
		Sender:  "store+123@g.shopifyemail.com",
		Subject: "Account message",
		Snippet: "Please review this message.",
	}
	if isDefiniteNonCustomerEmail(unnamed) || isHighConfidencePreDetailIgnoredEmail(unnamed) {
		t.Fatal("unnamed Shopify store relay sender was filtered")
	}
}

func TestFilterGraphMessagesLikeWebRespectsCutoffAndIgnoredFingerprints(t *testing.T) {
	old := testGraphMessage("old", "Customer", "old@example.com", "Order", "Where is my order?")
	old.ReceivedDateTime = "2026-06-01T00:00:00Z"
	shopify := testGraphMessage("shopify", "Shopify", "mailer@shopify.com", "Your sales report", "Shopify report")
	row := graphMessageFilterRow(shopify)
	row.EmailFingerprint = emailRowFingerprint(providerOutlook, row)
	kept, ignored, _ := filterGraphMessagesLikeWeb(map[string]any{
		"cutoff":               "2026-06-20T00:00:00Z",
		"ignored_fingerprints": []string{row.EmailFingerprint},
	}, []graphMessage{old, shopify, testGraphMessage("new", "Customer", "new@example.com", "Refund", "I need a refund for my order.")})
	if len(kept) != 2 || kept[0].ID != "shopify" || kept[1].ID != "new" {
		t.Fatalf("expected removed Shopify sender rule and new customer message to remain, kept=%+v", kept)
	}
	if ignored != 1 {
		t.Fatalf("expected only old message to be skipped, got %d", ignored)
	}
}

func TestOutlookAPIMessageItemsSplitQuotedHistory(t *testing.T) {
	body := "I have not received my order.\n\nSent from the all new AOL app for iOS\n\nOn Thursday, May 21, 2026, 2:19 AM, Store <store@example.com> wrote:\nHi Pam,\nThank you for contacting us."
	items := outlookAPIMessageItems(body, "2026-07-01T10:00:00Z")
	if len(items) != 1 {
		t.Fatalf("expected only latest message, got %+v", items)
	}
	if items[0].Role != "customer" || strings.Contains(items[0].Text, "Sent from") || strings.Contains(items[0].Text, "Hi Pam") {
		t.Fatalf("expected clean latest customer message, got %+v", items[0])
	}
}

func TestOutlookAPIMessageItemsSplitSpanishQuotedMarketing(t *testing.T) {
	body := "Me comentaron que enviarian un arbol de guayaba para plantar en maceta y resulta que me envian semillas como esta eso\n\nEl mar, 23 de jun de 2026, 3:35 p.m., Amarnis requests+amarnis.com@judge.me > escribió:\nWe'd love your thoughts on your recent order #1405\n\nLIMITED 70% OFF 🌹 Red-fleshed Guava for Home and Garden Planting-CU"
	items := outlookAPIMessageItems(body, "2026-06-30T22:24:16Z")
	if len(items) != 1 {
		t.Fatalf("expected only latest Spanish customer message, got %+v", items)
	}
	text := items[0].Text
	if !strings.Contains(text, "Me comentaron") || strings.Contains(text, "We'd love") || strings.Contains(text, "LIMITED 70% OFF") || strings.Contains(text, "escribió") {
		t.Fatalf("expected quoted Judge.me marketing to be trimmed, got %q", text)
	}
}

func TestGraphMessagesToConversationsIncludesThreadHistory(t *testing.T) {
	shop := appcore.Shop{
		DisplayName: "store@example.com-shopify",
		Raw:         map[string]any{"mall_account": "store@example.com"},
	}
	first := testGraphMessage("m1", "Pam", "pam@example.com", "Order 1789", "Where is my order?")
	first.ConversationID = "thread-1"
	first.ReceivedDateTime = "2026-05-21T02:19:00Z"
	reply := testGraphMessage("m2", "Store", "store@example.com", "Re: Order 1789", "Hi Pam,\nYour order is on the way.")
	reply.ConversationID = "thread-1"
	reply.ReceivedDateTime = "2026-05-21T14:19:00Z"
	latest := testGraphMessage("m3", "Pam", "pam@example.com", "Re: Order 1789", "Thank you. Why does your ad say 3 yrs old?\n\nOn Thursday, Store wrote:\nHi Pam,\nYour order is on the way.")
	latest.ConversationID = "thread-1"
	latest.ReceivedDateTime = "2026-06-29T13:48:26Z"

	conversations := graphMessagesToConversations(shop, []graphMessage{latest}, map[string][]graphMessage{
		"thread-1": {first, reply, latest},
	}, nil, "2026-07-01T10:00:00Z", "store@example.com")
	if len(conversations) != 1 {
		t.Fatalf("expected one thread conversation, got %+v", conversations)
	}
	messages := conversations[0].Messages
	if len(messages) != 3 {
		t.Fatalf("expected three thread messages, got %+v", messages)
	}
	if messages[0].Role != "customer" || !strings.Contains(messages[0].Text, "Where is my order") {
		t.Fatalf("expected first customer message, got %+v", messages[0])
	}
	if messages[1].Role != "store" || !strings.Contains(messages[1].Text, "Your order is on the way") {
		t.Fatalf("expected store reply, got %+v", messages[1])
	}
	if messages[1].SenderEmail != "store@example.com" {
		t.Fatalf("expected sender email on store reply, got %+v", messages[1])
	}
	if messages[2].Role != "customer" || strings.Contains(messages[2].Text, "On Thursday") || strings.Contains(messages[2].Text, "Your order is on the way") {
		t.Fatalf("expected latest customer message without quoted history, got %+v", messages[2])
	}
}

func TestGraphMessagesToConversationsMarksIncompleteThreadForReview(t *testing.T) {
	shop := appcore.Shop{
		DisplayName: "store@example.com-shopify",
		Raw:         map[string]any{"mall_account": "store@example.com"},
	}
	latest := testGraphMessage("m3", "Pam", "pam@example.com", "Re: Order 1789", "Where is my order now?")
	latest.ConversationID = "thread-1"
	conversations := graphMessagesToConversations(shop, []graphMessage{latest}, map[string][]graphMessage{
		"thread-1": {latest},
	}, map[string]bool{"thread-1": true}, "2026-07-01T10:00:00Z", "store@example.com")
	if len(conversations) != 1 || !conversations[0].NeedsReview {
		t.Fatalf("expected incomplete API thread to need review, got %+v", conversations)
	}
	if !containsString(conversations[0].DataSources, "outlook_api_partial") {
		t.Fatalf("expected partial API data source, got %+v", conversations[0].DataSources)
	}
}

func containsString(items []string, want string) bool {
	for _, item := range items {
		if item == want {
			return true
		}
	}
	return false
}

func TestGraphMessageRoleMatchesPrefixedShopMailAccount(t *testing.T) {
	shop := appcore.Shop{
		DisplayName: "dilyhbu.com-yang09200416@outlook.com-shopify",
		Raw:         map[string]any{"mall_account": "AdsPower-yang09200416@outlook.com"},
	}
	message := testGraphMessage("m1", "舒阳", "yang09200416@outlook.com", "Re: Order 1789", "We would like to arrange a free replacement for you.")
	if got := graphMessageRole(shop, "AdsPower-yang09200416@outlook.com", message); got != "store" {
		t.Fatalf("expected prefixed own mailbox to be store, got %q", got)
	}
	other := testGraphMessage("m2", "Other", "other09200416@outlook.com", "Re: Order 1789", "Customer text")
	if got := graphMessageRole(shop, "AdsPower-yang09200416@outlook.com", other); got != "customer" {
		t.Fatalf("expected different same-domain mailbox to remain customer, got %q", got)
	}
}

func TestGraphMessageRoleKeepsSentItemsAsStoreAfterDedupe(t *testing.T) {
	shop := appcore.Shop{DisplayName: "store@gmail.com-shopify", Raw: map[string]any{"mall_account": "store@gmail.com"}}
	message := testGraphMessage("sent-1", "Store", "unknown-outlook@example.com", "Re: Order", "We have processed your refund.")
	duplicateFromSentItems := message
	duplicateFromSentItems.FolderRole = "store"
	deduped := dedupeGraphMessages([]graphMessage{message, duplicateFromSentItems})
	if len(deduped) != 1 {
		t.Fatalf("expected one deduped message, got %+v", deduped)
	}
	if got := graphMessageRole(shop, "", deduped[0]); got != "store" {
		t.Fatalf("expected sent items message to remain store after dedupe, got %q %+v", got, deduped[0])
	}
}

func TestGmailAccountSelectsGmailProvider(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"provider": "outlook"}}
	shop := appcore.Shop{
		MallID:      "gmail-shop",
		DisplayName: "example-store",
		Raw:         map[string]any{"mall_account": "support@gmail.com"},
	}
	if got := MailProviderForShop(settings, shop); got != providerGmail {
		t.Fatalf("expected gmail provider, got %q", got)
	}
	if _, ok := NewProviderForShop(settings, shop).(GmailProvider); !ok {
		t.Fatal("expected GmailProvider for gmail account")
	}
}

func TestFastmoAccountUsesCuiqiuAPIProvider(t *testing.T) {
	settings := appcore.Settings{Mail: map[string]any{"provider": "outlook", "proxy_bindings": []map[string]any{{
		"mall_id":      "cuiqiu-shop",
		"email":        "oownx@fastmo.cn",
		"provider":     "cuiqiu",
		"cuiqiu_token": "token-1",
	}}}}
	shop := appcore.Shop{
		MallID:      "cuiqiu-shop",
		DisplayName: "solaryra-oownx@fastmo.cn-shopify",
		Raw:         map[string]any{"mall_account": "oownx@fastmo.cn"},
	}
	annotated := AnnotateShop(settings, shop)
	if got := MailProviderForShop(settings, shop); got != providerCuiqiu {
		t.Fatalf("expected cuiqiu provider for fastmo account, got %q", got)
	}
	if annotated.APIDisabled || !annotated.APIAllowed {
		t.Fatalf("expected fastmo/cuiqiu mailbox to use API when configured, got %+v", annotated)
	}
	if _, ok := NewProviderForShop(settings, shop).(CuiqiuProvider); !ok {
		t.Fatal("expected CuiqiuProvider for fastmo account")
	}
	if !annotated.APIAuthorized {
		t.Fatalf("expected Cuiqiu token to mark API as configured, got %+v", annotated)
	}
}

func TestGmailMessagesToConversationsIncludesThreadHistory(t *testing.T) {
	shop := appcore.Shop{
		MallID:      "gmail-shop",
		DisplayName: "Gmail Store",
		Raw:         map[string]any{"mall_account": "store@gmail.com"},
	}
	first := graphMessage{
		ID:               "g1",
		ConversationID:   "t1",
		Subject:          "Order 123",
		ReceivedDateTime: "2026-07-01T01:00:00Z",
		BodyPreview:      "Where is my order?",
		WebLink:          gmailWebLink("t1"),
		From:             graphFrom{EmailAddress: graphEmailAddress{Name: "Ada", Address: "ada@example.com"}},
		Body:             graphMessageBody{Content: "Where is my order?"},
	}
	reply := graphMessage{
		ID:               "g2",
		ConversationID:   "t1",
		Subject:          "Re: Order 123",
		ReceivedDateTime: "2026-07-01T02:00:00Z",
		WebLink:          gmailWebLink("t1"),
		From:             graphFrom{EmailAddress: graphEmailAddress{Name: "Store", Address: "store@gmail.com"}},
		Body:             graphMessageBody{Content: "It is on the way."},
	}
	latest := graphMessage{
		ID:               "g3",
		ConversationID:   "t1",
		Subject:          "Re: Order 123",
		ReceivedDateTime: "2026-07-01T03:00:00Z",
		BodyPreview:      "Thanks, but tracking is not moving.",
		WebLink:          gmailWebLink("t1"),
		From:             graphFrom{EmailAddress: graphEmailAddress{Name: "Ada", Address: "ada@example.com"}},
		Body:             graphMessageBody{Content: "Thanks, but tracking is not moving.\n\nOn Wed, Store wrote:\nIt is on the way."},
	}
	conversations := gmailMessagesToConversations(shop, []graphMessage{latest}, map[string][]graphMessage{"t1": []graphMessage{first, reply, latest}}, "2026-07-01T04:00:00Z")
	if len(conversations) != 1 {
		t.Fatalf("expected one conversation, got %d", len(conversations))
	}
	conversation := conversations[0]
	if conversation.Source != providerGmail || conversation.EmailProvider != providerGmail {
		t.Fatalf("expected gmail source, got source=%q provider=%q", conversation.Source, conversation.EmailProvider)
	}
	if len(conversation.Messages) != 3 {
		t.Fatalf("expected three message bubbles, got %d: %#v", len(conversation.Messages), conversation.Messages)
	}
	if conversation.Messages[1].Role != "store" {
		t.Fatalf("expected store reply in the middle, got %#v", conversation.Messages[1])
	}
	if strings.Contains(conversation.Messages[2].Text, "On Wed") {
		t.Fatalf("expected quoted history to be trimmed, got %q", conversation.Messages[2].Text)
	}
}

func TestEmailReadableTextKeepsParagraphBreaks(t *testing.T) {
	text := emailReadableText("<div>Hello Pam,</div><div>Where is my order?</div><br><div>Thanks</div>")
	if !strings.Contains(text, "Hello Pam,\nWhere is my order?") {
		t.Fatalf("expected paragraph breaks to be preserved, got %q", text)
	}
}

func testGraphMessage(id string, name string, address string, subject string, body string) graphMessage {
	return graphMessage{
		ID:               id,
		Subject:          subject,
		ReceivedDateTime: "2026-06-25T10:00:00Z",
		BodyPreview:      body,
		From:             graphFrom{EmailAddress: graphEmailAddress{Name: name, Address: address}},
		Body:             graphMessageBody{ContentType: "text", Content: body},
	}
}

func TestMicrosoftTokenInvalidGrantIsChinese(t *testing.T) {
	err := microsoftTokenRequestError("400 Bad Request", []byte(`{"error":"invalid_grant","error_description":"AADSTS70000: The provided value for the code has expired."}`), "authorization_code")
	if err == nil || !strings.Contains(err.Error(), "授权码已过期") || strings.Contains(err.Error(), "Outlook token request failed") {
		t.Fatalf("expected Chinese invalid_grant message, got %v", err)
	}
}

func TestMicrosoftGraph429IsChinese(t *testing.T) {
	err := microsoftGraphRequestError("429 Too Many Requests", []byte(`{"error":"TooManyRequests","error_description":"Rate limit"}`))
	if err == nil || !strings.Contains(err.Error(), "限流") || strings.Contains(err.Error(), "Graph mail read failed") {
		t.Fatalf("expected Chinese graph throttle message, got %v", err)
	}
}

func TestParseCallbackCodeErrorIsChinese(t *testing.T) {
	_, _, err := parseCallbackCode("http://localhost:8400/?error=server_error&state=abc")
	if err == nil || !strings.Contains(err.Error(), "Microsoft 服务暂时异常") {
		t.Fatalf("expected Chinese callback error, got %v", err)
	}
}

func TestParseCallbackCodeMissingCodeIsChinese(t *testing.T) {
	_, _, err := parseCallbackCode("http://localhost:8400/?state=abc")
	if err == nil || !strings.Contains(err.Error(), "未返回授权码") {
		t.Fatalf("expected Chinese missing-code error, got %v", err)
	}
}
