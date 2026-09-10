package inventory

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"shopify-support-platform/internal/platform"
	"strconv"
	"strings"
	"testing"
)

func TestOwnedInventoryFixtureStartsWithoutExternalConfiguration(t *testing.T) {
	if _, err := NewSyntheticHandler(18081); err != nil {
		t.Fatal("owned fixture setup", err)
	}
	for _, port := range []int{0, 80, 65536} {
		if _, err := NewSyntheticHandler(port); err == nil {
			t.Fatal("invalid loopback port accepted")
		}
	}
}

func TestRealSourceAdaptersUseCurrentCASContractAndBothOwnerCredentials(t *testing.T) {
	claims, budgets := 0, 0
	callback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Owned-Claim") != ClaimToken {
			t.Error("claim authentication missing")
		}
		if r.URL.Path == "/owned-claim" {
			claims++
		} else if r.URL.Path == "/owned-budget" {
			budgets++
		} else {
			t.Error("unexpected callback")
		}
		w.WriteHeader(204)
	}))
	defer callback.Close()
	address, _ := url.Parse(callback.URL)
	port, _ := strconv.Atoi(address.Port())
	h, err := NewSyntheticHandler(port)
	if err != nil {
		t.Fatal(err)
	}
	for i, path := range []string{platform.StoreAppInventoryPreparationPath, "/api/v1/erp-connector/shopify/inventory-set"} {
		payload := map[string]any{"identity": map[string]string{"tenantId": Tenant, "shopId": Shop}, "context": map[string]string{"correlationId": "owned", "requestId": "owned"}, "inventoryItemId": "gid://shopify/InventoryItem/1", "locationId": "gid://shopify/Location/2", "expectedAvailable": i + 1, "targetAvailable": i + 2, "idempotencyKey": "owned-wire-" + strconv.Itoa(i), "referenceDocumentUri": "xz-erp://inventory-publications/33333333-3333-4333-8333-333333333333"}
		raw, _ := json.Marshal(payload)
		r := httptest.NewRequest("POST", path, bytes.NewReader(raw))
		r.Header.Set("X-XZ-ERP-Connector-Token", ServiceToken)
		r.Header.Set(platform.StoreAppReadVersionHeader, "7")
		r.Header.Set(platform.InventoryPreparationRouteHeader, "3")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"outcome":"APPLIED"`) {
			t.Fatalf("owned source %d contract failed: status=%d", i, w.Code)
		}
	}
	if claims != 2 {
		t.Fatal("both sources did not pass common authority")
	}
	if budgets != 3 {
		t.Fatal("actual owner API requests bypassed shared budget")
	}
}
