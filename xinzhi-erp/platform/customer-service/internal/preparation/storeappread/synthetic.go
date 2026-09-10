// Package storeappread is an isolated rehearsal fixture, never a production
// entrypoint. Its Shopify transport has no network implementation.
package storeappread

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"reflect"
	"strings"
	"sync/atomic"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	"shopify-support-platform/internal/connectors/shopify/adminapi"
	"shopify-support-platform/internal/platform"
)

const TenantID = "11111111-1111-4111-8111-111111111111"
const ShopID = "22222222-2222-4222-8222-222222222222"
const Domain = "synthetic-preparation.myshopify.com"
const ServiceToken = "synthetic-service-credential-not-real-0001"
const ownerToken = "synthetic-owner-token-never-return"

func NewSyntheticHandler() (http.Handler, error) {
	ctx := context.Background()
	store := platform.NewMemoryStore()
	shop, err := store.CreateShop(ctx, platform.Shop{ID: "cs-synthetic-1", DisplayName: "Synthetic preparation shop", Platform: "shopify", Status: platform.ShopStatusActive})
	if err != nil {
		return nil, err
	}
	profile, err := store.SaveShopifyAppProfile(ctx, platform.ShopifyAppProfile{ShopID: shop.ID, ShopDomain: Domain, ClientID: "synthetic-app-1",
		EncryptedClientSecret: "synthetic-encrypted-secret-not-real", EncryptedAutomationToken: "synthetic-encrypted-automation-not-real"})
	if err != nil {
		return nil, err
	}
	installation, err := store.SaveShopifyInstallation(ctx, platform.ShopifyInstallation{ShopID: shop.ID, ShopDomain: Domain, AccessToken: ownerToken, Scope: "read_orders"})
	if err != nil {
		return nil, err
	}
	transport := &syntheticTransport{}
	provider, err := adminapi.NewClient("2026-07", &http.Client{Transport: transport})
	if err != nil {
		return nil, err
	}
	readHandler, err := platform.NewERPStoreAppReadHandler(store, provider, ServiceToken, []platform.StoreAppReadBinding{{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: TenantID, ShopID: ShopID}, CustomerServiceShopID: shop.ID,
		ShopifyShopID: "gid://shopify/Shop/123", ShopDomain: Domain, InstallationID: "gid://shopify/AppInstallation/456", AppClientID: profile.ClientID, Version: 7,
	}})
	if err != nil {
		return nil, err
	}
	mux := http.NewServeMux()
	mux.Handle(platform.StoreAppReadPrefix, readHandler)
	mux.HandleFunc("GET /rehearsal/evidence", func(w http.ResponseWriter, r *http.Request) {
		a, e1 := store.GetShop(r.Context(), shop.ID)
		b, e2 := store.GetShopifyAppProfile(r.Context(), shop.ID)
		c, e3 := store.GetShopifyInstallationByDomain(r.Context(), Domain)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{"synthetic": true, "productionReady": false,
			"ownerStateUnchanged": e1 == nil && e2 == nil && e3 == nil && reflect.DeepEqual(a, shop) && reflect.DeepEqual(b, profile) && reflect.DeepEqual(c, installation),
			"identityReads":       transport.identities.Load(), "orderReads": transport.orders.Load(), "blockedUpstreamRequests": transport.blocked.Load()})
	})
	return mux, nil
}

type syntheticTransport struct{ identities, orders, blocked atomic.Int64 }

func (t *syntheticTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	reject := func() (*http.Response, error) {
		t.blocked.Add(1)
		return nil, errors.New("synthetic upstream request rejected")
	}
	if r.Context().Err() != nil {
		return nil, r.Context().Err()
	}
	if r.Method != "POST" || r.URL.Scheme != "https" || r.URL.Host != Domain || r.URL.Path != "/admin/api/2026-07/graphql.json" || r.Header.Get("X-Shopify-Access-Token") != ownerToken {
		return reject()
	}
	var body struct {
		Query     string         `json:"query"`
		Variables map[string]any `json:"variables"`
	}
	if json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&body) != nil || strings.Contains(strings.ToLower(body.Query), "mutation") {
		return reject()
	}
	var raw string
	switch {
	case strings.HasPrefix(body.Query, "query XZERPReadBinding {"):
		t.identities.Add(1)
		raw = `{"data":{"shop":{"id":"gid://shopify/Shop/123","name":"Synthetic preparation shop","myshopifyDomain":"synthetic-preparation.myshopify.com"},"currentAppInstallation":{"id":"gid://shopify/AppInstallation/456","app":{"apiKey":"synthetic-app-1"},"accessScopes":[{"handle":"read_orders"}]}}}`
	case strings.Contains(body.Query, "query XZERPOrderCatalogPage("):
		limit, ok := body.Variables["first"].(float64)
		if !ok || limit < 1 || limit > 25 {
			return reject()
		}
		t.orders.Add(1)
		raw = syntheticOrderPage
	default:
		return reject()
	}
	return &http.Response{StatusCode: 200, Header: http.Header{"Content-Type": []string{"application/json"}}, Body: io.NopCloser(strings.NewReader(raw)), Request: r}, nil
}

const syntheticOrderPage = `{"data":{"orders":{"pageInfo":{"hasNextPage":false,"endCursor":"synthetic-done"},"edges":[{"node":{
"id":"gid://shopify/Order/123","legacyResourceId":123,"name":"#SYNTHETIC-123","createdAt":"2026-09-05T01:02:03Z","paymentGatewayNames":[],
"currentTotalPriceSet":{"shopMoney":{"amount":"10.00","currencyCode":"USD"}},
"currentSubtotalPriceSet":{"shopMoney":{"amount":"10.00","currencyCode":"USD"}},
"currentShippingPriceSet":{"shopMoney":{"amount":"0.00","currencyCode":"USD"}},
"lineItems":{"pageInfo":{"hasNextPage":false,"endCursor":"synthetic-line-done"},"edges":[{"node":{
"id":"gid://shopify/LineItem/321","name":"Synthetic product","title":"Synthetic product","quantity":1,
"discountedTotalSet":{"shopMoney":{"amount":"10.00","currencyCode":"USD"}},"originalUnitPriceSet":{"shopMoney":{"amount":"10.00","currencyCode":"USD"}}
}}]},"fulfillments":[]}}]}}}`
