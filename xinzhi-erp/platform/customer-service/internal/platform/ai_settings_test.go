package platform

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestAISettingsEncryptPersistAndResolve(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	t.Setenv("AI_API_KEY", "")
	path := filepath.Join(t.TempDir(), "platform.json")
	store, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("OpenFileStore failed: %v", err)
	}
	server := NewServer(store)
	public, err := server.saveAISettings(context.Background(), aiSettingsRequest{
		Enabled:  true,
		BaseURL:  "https://api.example.test/chat/completions",
		Model:    "deepseek-v4-flash",
		APIKey:   "secret-api-key",
		Thinking: true,
	})
	if err != nil {
		t.Fatalf("saveAISettings failed: %v", err)
	}
	if !public.HasAPIKey || public.EncryptedKey != "" || public.KeySource != "saved" || !public.Thinking {
		t.Fatalf("unexpected public settings: %#v", public)
	}
	raw, err := store.GetAISettings(context.Background())
	if err != nil {
		t.Fatalf("GetAISettings failed: %v", err)
	}
	if raw.EncryptedKey == "" || strings.Contains(raw.EncryptedKey, "secret-api-key") {
		t.Fatalf("API key was not encrypted: %#v", raw)
	}

	reopened, err := OpenFileStore(path)
	if err != nil {
		t.Fatalf("reopen file store failed: %v", err)
	}
	config, err := NewServer(reopened).resolveAIConfig(context.Background())
	if err != nil {
		t.Fatalf("resolveAIConfig failed: %v", err)
	}
	if config.APIKey != "secret-api-key" || config.Model != "deepseek-v4-flash" || !config.Thinking {
		t.Fatalf("unexpected resolved config: %#v", config)
	}
}

func TestAISettingsAdminAPIAndConnectionTest(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer api-test-key" {
			t.Fatalf("unexpected authorization: %q", got)
		}
		if r.URL.Path == "/models" {
			writeJSONResponse(w, http.StatusOK, map[string]any{"object": "list", "data": []any{
				map[string]string{"id": "deepseek-v4-flash"},
				map[string]string{"id": "deepseek-v4-pro"},
				map[string]string{"id": "deepseek-v5-new"},
			}})
			return
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatalf("decode AI request failed: %v", err)
		}
		thinking, ok := body["thinking"].(map[string]any)
		if !ok || thinking["type"] != "enabled" {
			t.Fatalf("thinking mode was not enabled in AI request: %#v", body["thinking"])
		}
		if _, ok := body["temperature"]; ok {
			t.Fatalf("temperature must be omitted while thinking is enabled: %#v", body)
		}
		writeJSONResponse(w, http.StatusOK, map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "OK"}}}})
	}))
	defer aiServer.Close()

	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	token := bootstrapAdmin(t, server.URL)
	input := aiSettingsRequest{Enabled: true, BaseURL: aiServer.URL, Model: "deepseek-v4-flash", APIKey: "api-test-key", Thinking: true}
	var saved AISettings
	raw := requestJSON(t, http.MethodPut, server.URL+"/api/v1/settings/ai", token, input, http.StatusOK, &saved)
	if !saved.HasAPIKey || strings.Contains(string(raw), "api-test-key") || strings.Contains(string(raw), "encryptedKey") {
		t.Fatalf("settings response leaked key or missed status: %s", raw)
	}
	var tested map[string]any
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/settings/ai/test", token, aiSettingsRequest{Enabled: true, BaseURL: aiServer.URL, Model: "deepseek-v4-flash", Thinking: true}, http.StatusOK, &tested)
	if tested["ok"] != true {
		t.Fatalf("unexpected test result: %#v", tested)
	}
	var synced struct {
		Models []string `json:"models"`
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/settings/ai/models/sync", token, aiSettingsRequest{Enabled: true, BaseURL: aiServer.URL + "/chat/completions", Model: "deepseek-v4-flash"}, http.StatusOK, &synced)
	if len(synced.Models) != 3 || synced.Models[2] != "deepseek-v5-new" {
		t.Fatalf("unexpected synced models: %#v", synced.Models)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/settings/ai", "", nil, http.StatusUnauthorized, nil)
}

func TestAIModelsURL(t *testing.T) {
	tests := map[string]string{
		"https://api.deepseek.com/chat/completions": "https://api.deepseek.com/models",
		"https://example.com/v1/chat/completions":   "https://example.com/v1/models",
		"https://example.com/v1":                    "https://example.com/v1/models",
	}
	for input, want := range tests {
		if got := aiModelsURL(input); got != want {
			t.Fatalf("aiModelsURL(%q)=%q want=%q", input, got, want)
		}
	}
}
