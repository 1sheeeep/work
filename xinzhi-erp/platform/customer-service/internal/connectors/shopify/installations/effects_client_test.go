package installations

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHTTPRevocationEffectsUsesExistingServiceTokenAndRequiresCompleteResult(t *testing.T) {
	var gotToken string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = r.Header.Get(ServiceTokenHeader)
		var record RevocationRecord
		if err := json.NewDecoder(r.Body).Decode(&record); err != nil || record.Identity != identity() {
			t.Fatalf("unexpected revocation record: %#v err=%v", record, err)
		}
		writeRuntimeJSON(w, http.StatusOK, RevocationEffectsResult{
			ContractVersion: "shopify.connector.installation.v1", TenantID: testTenantID, ShopID: testShopID,
			SourceDisabled: true, CachesInvalidated: true,
		})
	}))
	defer server.Close()
	effects, err := NewHTTPRevocationEffects(server.URL, "service-token", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPRevocationEffects failed: %v", err)
	}
	if err := effects.ApplyRevocation(t.Context(), RevocationRecord{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com", Context: requestContext("effects")}); err != nil {
		t.Fatalf("ApplyRevocation failed: %v", err)
	}
	if gotToken != "service-token" {
		t.Fatalf("service token mismatch: %q", gotToken)
	}
}

func TestHTTPRevocationEffectsSanitizesRemoteFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "database shpat_secret detail", http.StatusInternalServerError)
	}))
	defer server.Close()
	effects, err := NewHTTPRevocationEffects(server.URL, "service-token", server.Client())
	if err != nil {
		t.Fatalf("NewHTTPRevocationEffects failed: %v", err)
	}
	err = effects.ApplyRevocation(t.Context(), RevocationRecord{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com", Context: requestContext("effects")})
	if err == nil || strings.Contains(err.Error(), "shpat_") || strings.Contains(err.Error(), "database") {
		t.Fatalf("remote failure was not sanitized: %v", err)
	}
}
