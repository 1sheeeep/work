// Package inventory is exclusively a local fixture. The Shopify transport below
// has NO socket implementation. Only the owned loopback claim callback uses HTTP.
package inventory

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	shopify "shopify-support-platform/internal/connectors/shopify"
	"shopify-support-platform/internal/connectors/shopify/adminapi"
	"shopify-support-platform/internal/connectors/shopify/installations"
	"shopify-support-platform/internal/platform"
	"strconv"
	"strings"
	"sync"
	"time"
)

const ServiceToken = "synthetic-inventory-service-only-0001"
const ClaimToken = "synthetic-inventory-claim-only-00001"
const Tenant = "11111111-1111-4111-8111-111111111111"
const Shop = "22222222-2222-4222-8222-222222222222"
const domain = "synthetic-inventory.myshopify.com"

type authority struct {
	port   int
	source string
}

type ownedCommandContextKey struct{}

func (a authority) Reserve(ctx context.Context, cost int) error {
	command, ok := ctx.Value(ownedCommandContextKey{}).(string)
	if !ok || command == "" || cost != 1000 {
		return errors.New("owned budget context required")
	}
	raw, _ := json.Marshal(map[string]any{"commandRef": command, "requestedCost": cost})
	call, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("http://127.0.0.1:%d/owned-budget", a.port), bytes.NewReader(raw))
	if err != nil {
		return errors.New("budget unavailable")
	}
	call.Header.Set("X-Owned-Claim", ClaimToken)
	call.Header.Set("X-Owned-Source", a.source)
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(call)
	if err != nil {
		return errors.New("budget unavailable")
	}
	defer response.Body.Close()
	defer client.CloseIdleConnections()
	if response.StatusCode != 204 {
		return errors.New("budget refused")
	}
	return nil
}

func (a authority) Claim(ctx context.Context, r shopify.InventorySetRequest, version int64) error {
	raw, _ := json.Marshal(r)
	call, err := http.NewRequestWithContext(ctx, "POST", fmt.Sprintf("http://127.0.0.1:%d/owned-claim", a.port), bytes.NewReader(raw))
	if err != nil {
		return errors.New("claim unavailable")
	}
	call.Header.Set("X-Owned-Claim", ClaimToken)
	call.Header.Set("X-Owned-Source", a.source)
	call.Header.Set(platform.InventoryPreparationRouteHeader, strconv.FormatInt(version, 10))
	client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{Proxy: nil}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(call)
	if err != nil {
		return errors.New("claim unavailable")
	}
	defer response.Body.Close()
	client.CloseIdleConnections()
	if response.StatusCode != 204 {
		return errors.New("claim refused")
	}
	return nil
}

func NewSyntheticHandler(claimPort int) (http.Handler, error) {
	if claimPort < 1024 || claimPort > 65535 {
		return nil, errors.New("owned loopback port required")
	}
	ctx := context.Background()
	store := platform.NewMemoryStore()
	identity := shopify.CanonicalShopIdentity{TenantID: Tenant, ShopID: Shop}
	ownerShop, err := store.CreateShop(ctx, platform.Shop{ID: "owned-cs-shop", DisplayName: "Owned", Platform: "shopify", Status: platform.ShopStatusActive})
	if err != nil {
		return nil, err
	}
	_, err = store.SaveShopifyAppProfile(ctx, platform.ShopifyAppProfile{ShopID: ownerShop.ID, ShopDomain: domain, ClientID: "owned-cs-app", EncryptedClientSecret: "synthetic-only", EncryptedAutomationToken: "synthetic-automation-only"})
	if err != nil {
		return nil, err
	}
	_, err = store.SaveShopifyInstallation(ctx, platform.ShopifyInstallation{ShopID: ownerShop.ID, ShopDomain: domain, AccessToken: "synthetic-cs-owner-only", Scope: "write_inventory,read_locations"})
	if err != nil {
		return nil, err
	}
	transport := &syntheticShopify{quantity: 1, effects: map[string]int{}}
	csHTTP, err := adminapi.NewPreparationBudgetedHTTPClient(transport, authority{claimPort, "CS_STORE_APP"})
	if err != nil {
		return nil, err
	}
	provider, err := adminapi.NewClient("2026-07", csHTTP)
	if err != nil {
		return nil, err
	}
	binding := platform.StoreAppReadBinding{Identity: identity, CustomerServiceShopID: ownerShop.ID, ShopifyShopID: "gid://shopify/Shop/123", ShopDomain: domain, InstallationID: "gid://shopify/AppInstallation/456", AppClientID: "owned-cs-app", Version: 7}
	cs, err := platform.NewERPStoreAppInventoryPreparationHandler(store, provider, ServiceToken, []platform.StoreAppReadBinding{binding}, authority{claimPort, "CS_STORE_APP"})
	if err != nil {
		return nil, err
	}
	repo := installations.NewMemoryRepository()
	saasBinding := installations.Binding{Identity: identity, LegacyShopID: "owned-saas-shop", ShopDomain: domain}
	err = repo.CompleteInstallation(ctx, saasBinding, installations.InstallationRecord{AccessToken: "synthetic-saas-owner-only", ShopName: "Owned", Scopes: []string{"write_inventory", "read_locations"}, State: shopify.InstallationStateInstalled, InstalledAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()})
	if err != nil {
		return nil, err
	}
	saasHTTP, err := adminapi.NewPreparationBudgetedHTTPClient(transport, authority{claimPort, "ERP_SAAS_APP"})
	if err != nil {
		return nil, err
	}
	saasProvider, err := adminapi.NewClient("2026-07", saasHTTP)
	if err != nil {
		return nil, err
	}
	saas := installations.NewServiceWithProviders(repo, nil, nil, nil, nil, nil, nil, nil, nil, nil, saasProvider, nil, nil)
	mux := http.NewServeMux()
	mux.Handle(platform.StoreAppInventoryPreparationPath, cs)
	mux.HandleFunc("POST /api/v1/erp-connector/shopify/inventory-set", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.Header.Get("X-XZ-ERP-Connector-Token") != ServiceToken {
			w.WriteHeader(403)
			return
		}
		var input shopify.InventorySetRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16384))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF || shopify.ValidateInventorySetRequest(input) != nil {
			w.WriteHeader(400)
			return
		}
		version, err := strconv.ParseInt(r.Header.Get(platform.InventoryPreparationRouteHeader), 10, 64)
		if err != nil || (authority{claimPort, "ERP_SAAS_APP"}).Claim(r.Context(), input, version) != nil {
			w.WriteHeader(409)
			return
		}
		result, err := saas.SetInventoryAvailable(r.Context(), input)
		if err != nil {
			w.WriteHeader(502)
			return
		}
		w.Header().Set(platform.StoreAppReadProviderHeader, "ERP_SAAS_APP")
		w.Header().Set(platform.InventoryPreparationRouteHeader, strconv.FormatInt(version, 10))
		_ = json.NewEncoder(w).Encode(result)
	})
	mux.HandleFunc("GET /rehearsal/evidence", func(w http.ResponseWriter, r *http.Request) {
		transport.mu.Lock()
		defer transport.mu.Unlock()
		_ = json.NewEncoder(w).Encode(map[string]any{"synthetic": true, "productionReady": false, "quantity": transport.quantity, "effects": transport.effects, "socketToShopify": false})
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost && (r.URL.Path == platform.StoreAppInventoryPreparationPath || r.URL.Path == "/api/v1/erp-connector/shopify/inventory-set") {
			raw, err := io.ReadAll(io.LimitReader(r.Body, 16385))
			r.Body.Close()
			if err != nil || len(raw) > 16384 {
				w.WriteHeader(400)
				return
			}
			var contextOnly struct {
				ReferenceDocumentURI string `json:"referenceDocumentUri"`
			}
			if json.Unmarshal(raw, &contextOnly) != nil {
				w.WriteHeader(400)
				return
			}
			// This reference is NOT authority. Both claim and budget RPCs check
			// the shared journal before any Shopify Transport can be reached.
			r = r.WithContext(context.WithValue(r.Context(), ownedCommandContextKey{}, contextOnly.ReferenceDocumentURI))
			r.Body = io.NopCloser(bytes.NewReader(raw))
		}
		mux.ServeHTTP(w, r)
	}), nil
}

type syntheticShopify struct {
	mu       sync.Mutex
	quantity int
	effects  map[string]int
}

func (s *syntheticShopify) RoundTrip(r *http.Request) (*http.Response, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	fail := func() (*http.Response, error) { return nil, errors.New("synthetic Shopify operation rejected") }
	token := r.Header.Get("X-Shopify-Access-Token")
	if r.Method != "POST" || r.URL.Scheme != "https" || r.URL.Host != domain || r.URL.Path != "/admin/api/2026-07/graphql.json" || (token != "synthetic-cs-owner-only" && token != "synthetic-saas-owner-only") {
		return fail()
	}
	var request struct {
		Query     string
		Variables map[string]json.RawMessage
	}
	if json.NewDecoder(r.Body).Decode(&request) != nil {
		return fail()
	}
	var raw string
	if strings.HasPrefix(request.Query, "query XZERPReadBinding {") {
		if token != "synthetic-cs-owner-only" {
			return fail()
		}
		raw = `{"data":{"shop":{"id":"gid://shopify/Shop/123","name":"Owned","myshopifyDomain":"synthetic-inventory.myshopify.com"},"currentAppInstallation":{"id":"gid://shopify/AppInstallation/456","app":{"apiKey":"owned-cs-app"},"accessScopes":[{"handle":"write_inventory"},{"handle":"read_locations"}]}}}`
	} else if strings.Contains(request.Query, "mutation XZERPInventorySet(") {
		var key string
		var input struct {
			Name, Reason, ReferenceDocumentURI string
			Quantities                         []struct {
				InventoryItemID, LocationID string
				Quantity                    int
				ChangeFromQuantity          *int
			}
		}
		decoder := json.NewDecoder(bytes.NewReader(request.Variables["input"]))
		decoder.DisallowUnknownFields()
		if json.Unmarshal(request.Variables["idempotencyKey"], &key) != nil || decoder.Decode(&input) != nil || key == "" || len(input.Quantities) != 1 || input.Name != "available" || input.Reason != "correction" {
			return fail()
		}
		q := input.Quantities[0]
		if q.InventoryItemID != "gid://shopify/InventoryItem/1" || q.LocationID != "gid://shopify/Location/2" || q.ChangeFromQuantity == nil {
			return fail()
		}
		if s.effects[key] != 0 {
			return fail()
		}
		if *q.ChangeFromQuantity != s.quantity {
			raw = `{"data":{"inventorySetQuantities":{"userErrors":[{"code":"CHANGE_FROM_QUANTITY_STALE","field":[],"message":"synthetic stale"}]}}}`
		} else {
			delta := q.Quantity - s.quantity
			s.quantity = q.Quantity
			s.effects[key]++
			if strings.HasPrefix(key, "lost-") {
				return fail()
			}
			raw = fmt.Sprintf(`{"data":{"inventorySetQuantities":{"inventoryAdjustmentGroup":{"createdAt":"2026-09-07T00:00:00Z","changes":[{"name":"available","delta":%d,"quantityAfterChange":%d}]},"userErrors":[]}}}`, delta, q.Quantity)
		}
	} else {
		return fail()
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(raw)), Request: r}, nil
}
