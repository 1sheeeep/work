package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	"shopify-support-platform/internal/connectors/shopify/adminapi"
)

const preparationTestToken = "synthetic-service-credential-not-real-0001"

func TestStoreAppReadPreparationIsAbsentFromExistingCustomerServiceRoutes(t *testing.T) {
	h := NewServer(NewMemoryStore()).Routes()
	for _, path := range []string{"connection", "order-catalog"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, preparationRequest(path, preparationBinding()))
		// The existing GET / fallback makes an unregistered POST return 405.
		// A future router without that fallback may correctly return 404.
		if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("existing customer service did not reject preparation POST: %d", w.Code)
		}
	}
}

type heldPreparationProvider struct {
	*preparationReadProvider
	entered chan struct{}
	release chan struct{}
}

func (p *heldPreparationProvider) FetchReadBindingFacts(ctx context.Context, domain, token string) (adminapi.ReadBindingFacts, error) {
	select {
	case p.entered <- struct{}{}:
	default:
	}
	select {
	case <-p.release:
		return p.preparationReadProvider.FetchReadBindingFacts(ctx, domain, token)
	case <-ctx.Done():
		return adminapi.ReadBindingFacts{}, ctx.Err()
	}
}

func TestStoreAppReadPreparationBoundsConcurrencyAndRecoversAfterCancellation(t *testing.T) {
	b := preparationBinding()
	p := &heldPreparationProvider{preparationReadProvider: preparationProvider(b), entered: make(chan struct{}, 1), release: make(chan struct{})}
	h, err := NewERPStoreAppReadHandler(preparationStore(b), p, preparationTestToken, []StoreAppReadBinding{b})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, preparationRequest("connection", b).WithContext(ctx))
		finished <- w.Code
	}()
	select {
	case <-p.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("first read did not enter provider")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, preparationRequest("connection", b))
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("parallel preparation read was not bounded: %d", w.Code)
	}
	cancel()
	select {
	case status := <-finished:
		if status != http.StatusBadGateway {
			t.Fatalf("cancelled preparation read reported success: %d", status)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancelled preparation read did not finish")
	}
	close(p.release)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, preparationRequest("order-catalog", b))
	if w.Code != http.StatusOK || p.reads != 1 {
		t.Fatal("preparation slot was not released after cancellation")
	}
}

func preparationBinding() StoreAppReadBinding {
	return StoreAppReadBinding{
		Identity:              shopifyconnector.CanonicalShopIdentity{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222"},
		CustomerServiceShopID: "cs-synthetic-1", ShopifyShopID: "gid://shopify/Shop/123", ShopDomain: "synthetic-preparation.myshopify.com",
		InstallationID: "gid://shopify/AppInstallation/456", AppClientID: "synthetic-app-1", Version: 7,
	}
}

// This store cannot mutate accounts, sessions, shops, tokens, or history.
type preparationReadStore struct {
	shop         Shop
	profile      ShopifyAppProfile
	installation ShopifyInstallation
	calls        int
}

func (s *preparationReadStore) GetShop(context.Context, string) (Shop, error) {
	s.calls++
	return s.shop, nil
}
func (s *preparationReadStore) GetShopifyAppProfile(context.Context, string) (ShopifyAppProfile, error) {
	s.calls++
	return s.profile, nil
}
func (s *preparationReadStore) GetShopifyInstallationByDomain(context.Context, string) (ShopifyInstallation, error) {
	s.calls++
	return s.installation, nil
}
func preparationStore(b StoreAppReadBinding) *preparationReadStore {
	return &preparationReadStore{
		shop:         Shop{ID: b.CustomerServiceShopID, Platform: "shopify", Status: "active"},
		profile:      ShopifyAppProfile{ShopID: b.CustomerServiceShopID, ShopDomain: b.ShopDomain, ClientID: b.AppClientID},
		installation: ShopifyInstallation{ShopID: b.CustomerServiceShopID, ShopDomain: b.ShopDomain, AccessToken: "synthetic-owner-token-never-return", Scope: "write_orders"},
	}
}

type preparationReadProvider struct {
	facts        adminapi.ReadBindingFacts
	calls, reads int
	err          error
	wrongPage    bool
}

func (p *preparationReadProvider) FetchReadBindingFacts(context.Context, string, string) (adminapi.ReadBindingFacts, error) {
	p.calls++
	return p.facts, p.err
}
func (p *preparationReadProvider) FetchOrderCatalogPage(_ context.Context, _ string, _ string, r shopifyconnector.OrderCatalogPageRequest) (shopifyconnector.OrderCatalogPage, error) {
	p.reads++
	if p.wrongPage {
		r.Identity.ShopID = "wrong-shop"
	}
	return shopifyconnector.ConnectedOrderCatalogPage(r, nil, shopifyconnector.CatalogPageInfo{}, time.Now().UTC()), p.err
}
func preparationProvider(b StoreAppReadBinding) *preparationReadProvider {
	return &preparationReadProvider{facts: adminapi.ReadBindingFacts{ShopID: b.ShopifyShopID, ShopDomain: b.ShopDomain, ShopName: "Synthetic preparation shop", InstallationID: b.InstallationID, AppClientID: b.AppClientID, GrantedScopes: []string{"read_orders"}}}
}
func preparationRequest(path string, b StoreAppReadBinding) *http.Request {
	var payload any = shopifyconnector.ConnectionProbeRequest{Identity: b.Identity, Context: shopifyconnector.RequestContext{CorrelationID: "preparation-correlation", RequestID: "preparation-request"}}
	if path == "order-catalog" {
		payload = shopifyconnector.OrderCatalogPageRequest{Identity: b.Identity, Context: shopifyconnector.RequestContext{CorrelationID: "preparation-correlation", RequestID: "preparation-request"}, Limit: 25}
	}
	body, _ := json.Marshal(payload)
	r := httptest.NewRequest(http.MethodPost, StoreAppReadPrefix+path, bytes.NewReader(body))
	r.Header.Set("X-XZ-ERP-Connector-Token", preparationTestToken)
	r.Header.Set(StoreAppReadVersionHeader, "7")
	return r
}

func TestStoreAppReadPreparationChecksLiveIdentityScopesAndDoesNotMutate(t *testing.T) {
	b := preparationBinding()
	s := preparationStore(b)
	p := preparationProvider(b)
	h, err := NewERPStoreAppReadHandler(s, p, preparationTestToken, []StoreAppReadBinding{b})
	if err != nil {
		t.Fatal(err)
	}
	beforeShop, beforeProfile, beforeInstallation := s.shop, s.profile, s.installation
	for _, path := range []string{"connection", "order-catalog"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, preparationRequest(path, b))
		if w.Code != 200 || w.Header().Get(StoreAppReadVersionHeader) != "7" || w.Header().Get(StoreAppReadProviderHeader) != "CUSTOMER_SERVICE_STORE_APP_READ_ONLY" || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("invalid preparation response: %d", w.Code)
		}
		if strings.Contains(w.Body.String(), "synthetic-owner-token") || strings.Contains(w.Body.String(), "write_orders") {
			t.Fatal("credential or configured scopes leaked")
		}
	}
	if !reflect.DeepEqual(beforeShop, s.shop) || !reflect.DeepEqual(beforeProfile, s.profile) ||
		!reflect.DeepEqual(beforeInstallation, s.installation) || p.calls != 2 || p.reads != 1 {
		t.Fatal("read preparation changed state or skipped live checks")
	}
}

func TestStoreAppReadPreparationRejectsBeforeStoreOrUpstream(t *testing.T) {
	for name, mutate := range map[string]func(*http.Request){
		"missing token":       func(r *http.Request) { r.Header.Del("X-XZ-ERP-Connector-Token") },
		"wrong token":         func(r *http.Request) { r.Header.Set("X-XZ-ERP-Connector-Token", "wrong") },
		"duplicate token":     func(r *http.Request) { r.Header.Add("X-XZ-ERP-Connector-Token", preparationTestToken) },
		"missing version":     func(r *http.Request) { r.Header.Del(StoreAppReadVersionHeader) },
		"old version":         func(r *http.Request) { r.Header.Set(StoreAppReadVersionHeader, "6") },
		"duplicate version":   func(r *http.Request) { r.Header.Add(StoreAppReadVersionHeader, "7") },
		"write":               func(r *http.Request) { r.URL.Path = StoreAppReadPrefix + "inventory-set" },
		"oauth":               func(r *http.Request) { r.URL.Path = "/shopify/oauth/authorize" },
		"get":                 func(r *http.Request) { r.Method = "GET" },
		"untrusted URL query": func(r *http.Request) { r.URL.RawQuery = "token=do-not-return" },
		"cross tenant": func(r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(strings.NewReader(strings.ReplaceAll(string(body), "11111111", "99999999")))
		},
		"cross shop": func(r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(strings.NewReader(strings.ReplaceAll(string(body), "22222222", "99999999")))
		},
		"unknown fields": func(r *http.Request) { r.Body = io.NopCloser(strings.NewReader(`{"password":"do-not-return"}`)) },
		"trailing JSON": func(r *http.Request) {
			body, _ := io.ReadAll(r.Body)
			r.Body = io.NopCloser(strings.NewReader(string(body) + `{}`))
		},
	} {
		t.Run(name, func(t *testing.T) {
			b := preparationBinding()
			s := preparationStore(b)
			p := preparationProvider(b)
			h, _ := NewERPStoreAppReadHandler(s, p, preparationTestToken, []StoreAppReadBinding{b})
			r := preparationRequest("connection", b)
			mutate(r)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code < 400 || s.calls != 0 || p.calls != 0 || strings.Contains(w.Body.String(), "do-not-return") {
				t.Fatalf("unsafe preflight: %d", w.Code)
			}
		})
	}
}

func TestStoreAppReadPreparationRejectsWrongOwnerAndUnverifiedUpstream(t *testing.T) {
	for name, mutate := range map[string]func(*preparationReadStore, *preparationReadProvider){
		"disabled shop":  func(s *preparationReadStore, _ *preparationReadProvider) { s.shop.Status = "disabled" },
		"other CS shop":  func(s *preparationReadStore, _ *preparationReadProvider) { s.shop.ID = "other" },
		"other platform": func(s *preparationReadStore, _ *preparationReadProvider) { s.shop.Platform = "email" },
		"profile owner":  func(s *preparationReadStore, _ *preparationReadProvider) { s.profile.ShopID = "other" },
		"profile domain": func(s *preparationReadStore, _ *preparationReadProvider) {
			s.profile.ShopDomain = "other.myshopify.com"
		},
		"profile app":        func(s *preparationReadStore, _ *preparationReadProvider) { s.profile.ClientID = "other" },
		"installation owner": func(s *preparationReadStore, _ *preparationReadProvider) { s.installation.ShopID = "other" },
		"missing token":      func(s *preparationReadStore, _ *preparationReadProvider) { s.installation.AccessToken = "" },
		"live shop ID":       func(_ *preparationReadStore, p *preparationReadProvider) { p.facts.ShopID = "gid://shopify/Shop/999" },
		"live domain":        func(_ *preparationReadStore, p *preparationReadProvider) { p.facts.ShopDomain = "other.myshopify.com" },
		"live installation": func(_ *preparationReadStore, p *preparationReadProvider) {
			p.facts.InstallationID = "gid://shopify/AppInstallation/999"
		},
		"live app":           func(_ *preparationReadStore, p *preparationReadProvider) { p.facts.AppClientID = "other" },
		"unknown scopes":     func(_ *preparationReadStore, p *preparationReadProvider) { p.facts.GrantedScopes = nil },
		"removed read scope": func(_ *preparationReadStore, p *preparationReadProvider) { p.facts.GrantedScopes = []string{} },
		"upstream timeout":   func(_ *preparationReadStore, p *preparationReadProvider) { p.err = context.DeadlineExceeded },
		"unsafe error": func(_ *preparationReadStore, p *preparationReadProvider) {
			p.err = errors.New("synthetic-owner-token-never-return")
		},
	} {
		t.Run(name, func(t *testing.T) {
			b := preparationBinding()
			s := preparationStore(b)
			p := preparationProvider(b)
			mutate(s, p)
			h, _ := NewERPStoreAppReadHandler(s, p, preparationTestToken, []StoreAppReadBinding{b})
			w := httptest.NewRecorder()
			h.ServeHTTP(w, preparationRequest("order-catalog", b))
			if w.Code < 400 || p.reads != 0 || strings.Contains(w.Body.String(), "synthetic-owner-token") {
				t.Fatalf("unverified binding read: %d", w.Code)
			}
		})
	}
}

func TestStoreAppReadPreparationRejectsDuplicateOrInvalidConfiguration(t *testing.T) {
	b := preparationBinding()
	for name, mutate := range map[string]func(*StoreAppReadBinding){
		"invalid enterprise":   func(b *StoreAppReadBinding) { b.Identity.TenantID = "anything" },
		"invalid domain":       func(b *StoreAppReadBinding) { b.ShopDomain = "127.0.0.1" },
		"invalid shop ID":      func(b *StoreAppReadBinding) { b.ShopifyShopID = "gid://shopify/Shop/0" },
		"invalid installation": func(b *StoreAppReadBinding) { b.InstallationID = "gid://shopify/AppInstallation/-1" },
		"invalid version":      func(b *StoreAppReadBinding) { b.Version = 0 },
		"unsafe JSON version":  func(b *StoreAppReadBinding) { b.Version = 9007199254740992 },
		"unsafe app ref":       func(b *StoreAppReadBinding) { b.AppClientID = "do not echo\n" },
	} {
		t.Run(name, func(t *testing.T) {
			bad := b
			mutate(&bad)
			if _, err := NewERPStoreAppReadHandler(preparationStore(b), preparationProvider(b), preparationTestToken, []StoreAppReadBinding{bad}); err == nil {
				t.Fatal("invalid config accepted")
			}
		})
	}
	for _, bindings := range [][]StoreAppReadBinding{nil, {b, b}} {
		if _, err := NewERPStoreAppReadHandler(preparationStore(b), preparationProvider(b), preparationTestToken, bindings); err == nil {
			t.Fatal("empty or duplicate config accepted")
		}
	}
	other := b
	other.Identity.TenantID = "99999999-9999-4999-8999-999999999999"
	other.Identity.ShopID = "88888888-8888-4888-8888-888888888888"
	other.CustomerServiceShopID, other.ShopifyShopID = "other-cs-shop", "gid://shopify/Shop/999"
	other.ShopDomain = "other.myshopify.com"
	if _, err := NewERPStoreAppReadHandler(preparationStore(b), preparationProvider(b), preparationTestToken, []StoreAppReadBinding{b, other}); err == nil {
		t.Fatal("mixed enterprises accepted for a single enterprise preparation credential")
	}
}

func TestStoreAppReadPreparationRejectsWrongPageAndLimits(t *testing.T) {
	b := preparationBinding()
	s := preparationStore(b)
	p := preparationProvider(b)
	p.wrongPage = true
	h, _ := NewERPStoreAppReadHandler(s, p, preparationTestToken, []StoreAppReadBinding{b})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, preparationRequest("order-catalog", b))
	if w.Code != 502 {
		t.Fatal("wrong page identity accepted")
	}
	r := preparationRequest("order-catalog", b)
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(strings.NewReader(strings.ReplaceAll(string(body), `"limit":25`, `"limit":26`)))
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 || p.reads != 1 {
		t.Fatal("unbounded preparation read accepted")
	}
}
