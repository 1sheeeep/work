package storeappread

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSyntheticReadRehearsalUsesRealHandlerStoreAndAdminDTOAdapter(t *testing.T) {
	h, err := NewSyntheticHandler()
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(h)
	defer s.Close()
	for _, operation := range []string{"connection", "order-catalog"} {
		body := `{"identity":{"tenantId":"` + TenantID + `","shopId":"` + ShopID + `"},"context":{"correlationId":"synthetic-rehearsal","requestId":"synthetic-request"}`
		if operation == "order-catalog" {
			body += `,"limit":10`
		}
		body += `}`
		r, _ := http.NewRequest("POST", s.URL+"/internal/v1/erp-store-app/shopify/"+operation, strings.NewReader(body))
		r.Header.Set("X-XZ-ERP-Connector-Token", ServiceToken)
		r.Header.Set("X-XZ-Store-App-Binding-Version", "7")
		response, err := s.Client().Do(r)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := io.ReadAll(response.Body)
		response.Body.Close()
		if response.StatusCode != 200 || strings.Contains(string(raw), ownerToken) {
			t.Fatalf("synthetic read failed: %d %s", response.StatusCode, raw)
		}
		if operation == "order-catalog" && !strings.Contains(string(raw), "#SYNTHETIC-123") {
			t.Fatal("order adapter dropped sample")
		}
	}
	response, err := s.Client().Get(s.URL + "/rehearsal/evidence")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var evidence map[string]any
	if json.NewDecoder(response.Body).Decode(&evidence) != nil {
		t.Fatal("invalid evidence")
	}
	if evidence["ownerStateUnchanged"] != true || evidence["identityReads"] != float64(2) || evidence["orderReads"] != float64(1) || evidence["blockedUpstreamRequests"] != float64(0) || evidence["productionReady"] != false {
		t.Fatalf("unexpected rehearsal evidence: %v", evidence)
	}
}
