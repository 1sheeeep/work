package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestLogisticsSettingsEncryptPersistAndResolve(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	t.Setenv("SEVENTEENTRACK_API_KEY", "")
	store := NewMemoryStore()
	server := NewServer(store)

	public, err := server.saveLogisticsSettings(context.Background(), logisticsSettingsRequest{
		Enabled:            true,
		APIKey:             "secret-tracking-key",
		AutoDraftEnabled:   true,
		ChatEnabled:        true,
		GmailEnabled:       true,
		OutlookEnabled:     true,
		ReplyCooldownHours: 24,
	})
	if err != nil {
		t.Fatalf("saveLogisticsSettings failed: %v", err)
	}
	if !public.HasAPIKey || public.EncryptedKey != "" {
		t.Fatalf("unexpected public settings: %#v", public)
	}
	if !public.AutoDraftEnabled || public.AutoSendEnabled || !public.ChatEnabled || !public.GmailEnabled || !public.OutlookEnabled || public.ReplyCooldownHours != 24 {
		t.Fatalf("unexpected automation defaults: %#v", public)
	}
	raw, err := store.GetLogisticsSettings(context.Background())
	if err != nil {
		t.Fatalf("GetLogisticsSettings failed: %v", err)
	}
	if raw.EncryptedKey == "" || strings.Contains(raw.EncryptedKey, "secret-tracking-key") {
		t.Fatalf("API key was not encrypted: %#v", raw)
	}
	config, err := server.resolveLogisticsConfig(context.Background())
	if err != nil {
		t.Fatalf("resolveLogisticsConfig failed: %v", err)
	}
	if !config.Enabled || config.APIKey != "secret-tracking-key" {
		t.Fatalf("unexpected resolved config: %#v", config)
	}
}

func TestLogisticsSettingsAPIAndConnectionTest(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	seventeenTrack := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/getquota" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if got := r.Header.Get("17token"); got != "api-test-key" {
			t.Fatalf("unexpected 17token: %q", got)
		}
		var body []any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{"code": 0, "data": map[string]any{"quota": 100}})
	}))
	defer seventeenTrack.Close()
	t.Setenv("SEVENTEENTRACK_BASE_URL", seventeenTrack.URL)

	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	token := bootstrapAdmin(t, server.URL)

	var saved LogisticsSettings
	raw := requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/logistics", token, logisticsSettingsRequest{
		Enabled:            true,
		APIKey:             "api-test-key",
		AutoDraftEnabled:   true,
		ChatEnabled:        true,
		GmailEnabled:       true,
		OutlookEnabled:     true,
		ReplyCooldownHours: 24,
	}, http.StatusOK, &saved)
	if !saved.HasAPIKey || strings.Contains(string(raw), "api-test-key") || strings.Contains(string(raw), "encryptedKey") {
		t.Fatalf("settings response leaked key or missed status: %s", raw)
	}
	var tested map[string]any
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/settings/logistics/test", token, logisticsSettingsRequest{Enabled: true}, http.StatusOK, &tested)
	if tested["ok"] != true {
		t.Fatalf("unexpected test result: %#v", tested)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/settings/logistics", "", nil, http.StatusUnauthorized, nil)
}
