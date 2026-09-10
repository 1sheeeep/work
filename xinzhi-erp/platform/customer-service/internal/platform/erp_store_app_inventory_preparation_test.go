package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	"strings"
	"testing"
	"time"
)

type inventoryPreparationTestProvider struct {
	*preparationReadProvider
	writes     int
	ownerToken string
	failure    bool
}

func (p *inventoryPreparationTestProvider) SetInventoryAvailable(_ context.Context, domain, token string, r shopifyconnector.InventorySetRequest) (shopifyconnector.InventorySetResult, error) {
	p.writes++
	p.ownerToken = token
	if p.failure {
		return shopifyconnector.InventorySetResult{}, errors.New("synthetic-private-upstream-token")
	}
	return shopifyconnector.AppliedInventorySetResult(r, time.Now().UTC()), nil
}

// Unit fixture only. Durable claim is separately tested with the shared journal;
// this is intentionally not exported or available to a production entrypoint.
type inventoryPreparationTestAuthority struct {
	claimed bool
	reject  bool
	calls   int
}

func (a *inventoryPreparationTestAuthority) Claim(_ context.Context, r shopifyconnector.InventorySetRequest, version int64) error {
	a.calls++
	if a.claimed || a.reject || version != 3 {
		return errors.New("not claimable")
	}
	a.claimed = true
	return nil
}
func inventoryPreparationRequest(b StoreAppReadBinding) *http.Request {
	input := shopifyconnector.InventorySetRequest{Identity: b.Identity, Context: shopifyconnector.RequestContext{CorrelationID: "owned", RequestID: "owned"}, InventoryItemID: "gid://shopify/InventoryItem/1", LocationID: "gid://shopify/Location/2", ExpectedAvailable: 3, TargetAvailable: 4, IdempotencyKey: "owned-inventory-1", ReferenceDocumentURI: "xz-erp://inventory-publications/33333333-3333-4333-8333-333333333333"}
	body, _ := json.Marshal(input)
	r := httptest.NewRequest("POST", StoreAppInventoryPreparationPath, bytes.NewReader(body))
	r.Header.Set("X-XZ-ERP-Connector-Token", preparationTestToken)
	r.Header.Set(StoreAppReadVersionHeader, "7")
	r.Header.Set(InventoryPreparationRouteHeader, "3")
	return r
}
func TestStoreAppInventoryPreparationOwnerScopeClaimAndReplay(t *testing.T) {
	b := preparationBinding()
	p := &inventoryPreparationTestProvider{preparationReadProvider: preparationProvider(b)}
	p.facts.GrantedScopes = []string{"write_inventory", "read_locations"}
	a := &inventoryPreparationTestAuthority{}
	h, err := NewERPStoreAppInventoryPreparationHandler(preparationStore(b), p, preparationTestToken, []StoreAppReadBinding{b}, a)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, inventoryPreparationRequest(b))
	if w.Code != 200 || p.writes != 1 || p.ownerToken != "synthetic-owner-token-never-return" || strings.Contains(w.Body.String(), "owner-token") || w.Header().Get(StoreAppReadProviderHeader) != "CS_STORE_APP" {
		t.Fatal("source write contract failed")
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, inventoryPreparationRequest(b))
	if w.Code != 409 || p.writes != 1 {
		t.Fatal("claim replay reached Shopify")
	}
}
func TestStoreAppInventoryPreparationFailsClosed(t *testing.T) {
	for _, defect := range []string{"token", "binding", "route", "scope", "source", "claim", "upstream"} {
		t.Run(defect, func(t *testing.T) {
			b := preparationBinding()
			p := &inventoryPreparationTestProvider{preparationReadProvider: preparationProvider(b)}
			p.facts.GrantedScopes = []string{"write_inventory", "read_locations"}
			a := &inventoryPreparationTestAuthority{}
			r := inventoryPreparationRequest(b)
			switch defect {
			case "token":
				r.Header.Set("X-XZ-ERP-Connector-Token", "wrong")
			case "binding":
				r.Header.Set(StoreAppReadVersionHeader, "8")
			case "route":
				r.Header.Set(InventoryPreparationRouteHeader, "4")
			case "scope":
				p.facts.GrantedScopes = []string{"read_inventory"}
			case "source":
				p.facts.ShopID = "gid://shopify/Shop/999"
			case "claim":
				a.reject = true
			case "upstream":
				p.failure = true
			}
			h, err := NewERPStoreAppInventoryPreparationHandler(preparationStore(b), p, preparationTestToken, []StoreAppReadBinding{b}, a)
			if err != nil {
				t.Fatal(err)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code == 200 || strings.Contains(w.Body.String(), "private-upstream") {
				t.Fatal("negative gate failed")
			}
			if defect != "upstream" && p.writes != 0 {
				t.Fatal("rejected request wrote upstream")
			}
		})
	}
}
func TestStoreAppInventoryPreparationNeverAutoMounted(t *testing.T) {
	b := preparationBinding()
	p := &inventoryPreparationTestProvider{preparationReadProvider: preparationProvider(b)}
	if _, err := NewERPStoreAppInventoryPreparationHandler(preparationStore(b), p, preparationTestToken, []StoreAppReadBinding{b}, nil); err == nil {
		t.Fatal("missing authority accepted")
	}
	w := httptest.NewRecorder()
	NewServer(NewMemoryStore()).Routes().ServeHTTP(w, inventoryPreparationRequest(b))
	if w.Code != 404 && w.Code != 405 {
		t.Fatal("preparation write auto mounted")
	}
}
