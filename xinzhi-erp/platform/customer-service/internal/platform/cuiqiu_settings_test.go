package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestCuiqiuDomainSettingsAPIEncryptsTokenAndTestsConnection(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	var paths []string
	api := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		if r.FormValue("token") != "domain-token" {
			t.Fatalf("unexpected Cuiqiu form: %#v", r.Form)
		}
		switch r.URL.Path {
		case "/v2/mail/list":
			if r.FormValue("domain_id") != "domain-1" {
				t.Fatalf("domain_id was not sent to mailbox list: %#v", r.Form)
			}
			writeJSONResponse(w, http.StatusOK, map[string]any{"code": 200, "data": map[string]any{"list": []any{map[string]any{"id": "mail-1", "mail": "support@fastmo.cn"}}}})
		case "/v1/message/list":
			writeJSONResponse(w, http.StatusOK, map[string]any{
				"code": 200,
				"data": map[string]any{
					"list": []any{map[string]any{
						"id":   "message-1",
						"from": []any{map[string]any{"name": "Buyer", "address": "buyer@example.com"}},
						"to":   []any{"support@fastmo.cn"},
					}},
					"total": 1,
				},
			})
		case "/v1/message/detail":
			writeJSONResponse(w, http.StatusOK, map[string]any{
				"code": 200,
				"data": map[string]any{"content": map[string]any{
					"id": "message-1", "from": []any{"buyer@example.com"}, "to": []any{"support@fastmo.cn"}, "body": "Hello",
				}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()
	originalClient := cuiqiuHTTPClient
	cuiqiuHTTPClient = api.Client()
	t.Cleanup(func() { cuiqiuHTTPClient = originalClient })

	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	token := bootstrapAdmin(t, server.URL)

	var saved CuiqiuDomainSettings
	raw := requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/email-providers/cuiqiu", token, cuiqiuDomainSettingsRequest{
		Domain: "@FASTMO.CN", APIBase: api.URL, Token: "domain-token", DomainID: "domain-1",
		SMTPHost: "smtp.fastmo.cn", SMTPPort: 465, SMTPMode: "tls",
	}, http.StatusOK, &saved)
	if saved.Domain != "fastmo.cn" || !saved.HasToken || saved.EncryptedToken != "" || strings.Contains(string(raw), "domain-token") {
		t.Fatalf("public settings leaked or normalized incorrectly: %s", raw)
	}
	stored, err := store.GetCuiqiuDomainSettings(context.Background(), "fastmo.cn")
	if err != nil || stored.EncryptedToken == "" || strings.Contains(stored.EncryptedToken, "domain-token") {
		t.Fatalf("token was not encrypted at rest: %#v err=%v", stored, err)
	}
	var tested map[string]any
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/settings/email-providers/cuiqiu/test", token, cuiqiuDomainTestRequest{Domain: "fastmo.cn"}, http.StatusOK, &tested)
	if tested["ok"] != true {
		t.Fatalf("unexpected test result: %#v", tested)
	}
	if strings.Join(paths, ",") != "/v2/mail/list,/v1/message/list,/v1/message/detail" {
		t.Fatalf("domain receive test paths = %#v", paths)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/settings/email-providers/cuiqiu", "", nil, http.StatusUnauthorized, nil)
}

func TestSavingCuiqiuDomainSettingsUpdatesExistingDomainChannels(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Existing"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: cuiqiuProvider, Address: "support@fastmo.cn",
		Status: SourceStatusActive, Metadata: map[string]string{cuiqiuMailIDKey: "mail-1", cuiqiuAPIBaseKey: "https://old.example.com"},
	})
	if err != nil {
		t.Fatal(err)
	}
	_, err = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: cuiqiuProvider, AccessToken: "old-token", RefreshToken: "mailbox-password"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	_, err = server.saveCuiqiuDomainSettings(context.Background(), cuiqiuDomainSettingsRequest{
		Domain: "fastmo.cn", APIBase: "https://domain-open-api.cuiqiu.com", Token: "new-token",
		SMTPHost: "smtp.cuiqiu.com", SMTPPort: 587, SMTPMode: "starttls",
	}, "https://kf.xzkj.ai")
	if err != nil {
		t.Fatal(err)
	}
	updated, err := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, source.Address)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[cuiqiuSMTPPortKey] != "587" || updated.Metadata[cuiqiuProfileDomainKey] != "fastmo.cn" || installation.AccessToken != "new-token" || installation.RefreshToken != "mailbox-password" {
		t.Fatalf("existing channel was not updated safely: source=%#v install=%#v", updated, installation)
	}
}

func TestChangingCuiqiuDomainTokenResetsWebhookVerification(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	store := NewMemoryStore()
	encryptedToken, err := encryptAIKey("old-token")
	if err != nil {
		t.Fatal(err)
	}
	verifiedAt := time.Now().UTC().Add(-time.Hour)
	if _, err := store.SaveCuiqiuDomainSettings(context.Background(), CuiqiuDomainSettings{
		Domain: "fastmo.cn", APIBase: "https://domain-open-api.cuiqiu.com", EncryptedToken: encryptedToken,
		SMTPHost: "domain-smtp.cuiqiu.com", SMTPPort: 587, SMTPMode: "starttls", WebhookVerifiedAt: verifiedAt,
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	if _, err := server.saveCuiqiuDomainSettings(context.Background(), cuiqiuDomainSettingsRequest{
		Domain: "fastmo.cn", APIBase: "https://domain-open-api.cuiqiu.com", Token: "old-token",
		SMTPHost: "domain-smtp.cuiqiu.com", SMTPPort: 587, SMTPMode: "starttls",
	}, "https://kf.xzkj.ai"); err != nil {
		t.Fatal(err)
	}
	preserved, _ := store.GetCuiqiuDomainSettings(context.Background(), "fastmo.cn")
	if preserved.WebhookVerifiedAt.IsZero() {
		t.Fatal("unchanged token cleared webhook verification")
	}
	if _, err := server.saveCuiqiuDomainSettings(context.Background(), cuiqiuDomainSettingsRequest{
		Domain: "fastmo.cn", APIBase: "https://domain-open-api.cuiqiu.com", Token: "new-token",
		SMTPHost: "domain-smtp.cuiqiu.com", SMTPPort: 587, SMTPMode: "starttls",
	}, "https://kf.xzkj.ai"); err != nil {
		t.Fatal(err)
	}
	reset, _ := store.GetCuiqiuDomainSettings(context.Background(), "fastmo.cn")
	if !reset.WebhookVerifiedAt.IsZero() {
		t.Fatalf("changed token retained webhook verification: %v", reset.WebhookVerifiedAt)
	}
}
