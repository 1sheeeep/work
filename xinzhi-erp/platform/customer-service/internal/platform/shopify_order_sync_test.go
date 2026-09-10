package platform

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestShopifyOrderPageUsesIncrementalQueryAndCursor(t *testing.T) {
	var variables map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("X-Shopify-Access-Token"); got != "test-token" {
			t.Fatalf("unexpected access token header %q", got)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Variables map[string]any `json:"variables"`
			Query     string         `json:"query"`
		}
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(payload.Query, "presentmentMoney") || strings.Contains(payload.Query, "shopMoney") {
			t.Fatalf("order sync query must request only Shopify presentment currency amounts: %s", payload.Query)
		}
		variables = payload.Variables
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":{"orders":{"edges":[{"cursor":"cursor-1","node":{"id":"gid://shopify/Order/1","legacyResourceId":1,"name":"#1001","email":"buyer@example.com","createdAt":"2026-08-01T00:00:00Z","updatedAt":"2026-08-02T00:00:00Z","displayFinancialStatus":"PAID","displayFulfillmentStatus":"UNFULFILLED","currentTotalPriceSet":{"shopMoney":{"amount":"12.00","currencyCode":"USD"},"presentmentMoney":{"amount":"16.50","currencyCode":"CAD"}},"lineItems":{"edges":[{"node":{"name":"Demo shirt","quantity":2,"sku":"SKU-1","requiresShipping":true,"discountedTotalSet":{"shopMoney":{"amount":"12.00","currencyCode":"USD"},"presentmentMoney":{"amount":"16.50","currencyCode":"CAD"}}}}]},"customer":{"id":"gid://shopify/Customer/1","displayName":"Buyer","defaultEmailAddress":{"emailAddress":"buyer@example.com"}}}}],"pageInfo":{"hasNextPage":true,"endCursor":"cursor-1"}}}}`)
	}))
	defer server.Close()

	client := shopifyAdminClient{BaseURL: server.URL, HTTPClient: server.Client()}
	page, err := client.SearchOrdersPage(t.Context(), "demo.myshopify.com", "test-token", "updated_at:>2026-08-01", 100, "cursor-0")
	if err != nil {
		t.Fatal(err)
	}
	if variables["query"] != "updated_at:>2026-08-01" || variables["after"] != "cursor-0" || variables["first"].(float64) != 100 {
		t.Fatalf("unexpected variables: %#v", variables)
	}
	if !page.HasNextPage || page.EndCursor != "cursor-1" || len(page.Orders) != 1 {
		t.Fatalf("unexpected page: %#v", page)
	}
	order := page.Orders[0]
	if order.Name != "#1001" || order.UpdatedAt != "2026-08-02T00:00:00Z" || order.Total.Amount != "16.50" || order.Total.CurrencyCode != "CAD" || order.Customer.DisplayName != "Buyer" || len(order.LineItems) != 1 || order.LineItems[0].SKU != "SKU-1" || order.LineItems[0].DiscountedTotal.CurrencyCode != "CAD" {
		t.Fatalf("unexpected order: %#v", order)
	}
}

func TestShopifyOrderQueueReservesReconciliationCapacityAndMergesReruns(t *testing.T) {
	store := NewMemoryStore()
	reconcileShop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Reconcile", Status: ShopStatusActive})
	manualShop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Manual", Status: ShopStatusActive})
	now := time.Now().UTC()
	if _, err := store.EnqueueShopifyOrderSyncJob(t.Context(), ShopifyOrderSyncJob{
		ShopID: reconcileShop.ID, Priority: shopifyOrderSyncPriorityReconcile, Reason: "daily reconciliation", AvailableAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.EnqueueShopifyOrderSyncJob(t.Context(), ShopifyOrderSyncJob{
		ShopID: manualShop.ID, Priority: shopifyOrderSyncPriorityManual, Reason: "manual sync", TargetOrderID: "100", AvailableAt: now,
	}); err != nil {
		t.Fatal(err)
	}
	manual, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), false)
	if err != nil || manual.ShopID != manualShop.ID {
		t.Fatalf("high-priority worker claimed %#v err=%v", manual, err)
	}
	merged, err := store.EnqueueShopifyOrderSyncJob(t.Context(), ShopifyOrderSyncJob{
		ShopID: manualShop.ID, Priority: shopifyOrderSyncPriorityWebhook, Reason: "Shopify webhook", TargetOrderID: "200", AvailableAt: now,
	})
	if err != nil || !merged.RerunRequested || merged.TargetOrderID != "" {
		t.Fatalf("running shop did not preserve a full rerun for a different order: %#v err=%v", merged, err)
	}
	if err := store.FinishShopifyOrderSyncJob(t.Context(), manualShop.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}
	rerun, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), false)
	if err != nil || rerun.ShopID != manualShop.ID || rerun.TargetOrderID != "" {
		t.Fatalf("rerun was not claimable as a full sync: %#v err=%v", rerun, err)
	}
	if err := store.FinishShopifyOrderSyncJob(t.Context(), manualShop.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("high-priority-only worker claimed reconciliation: %v", err)
	}
	reconcile, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), true)
	if err != nil || reconcile.ShopID != reconcileShop.ID {
		t.Fatalf("reconciliation worker did not claim low-priority work: %#v err=%v", reconcile, err)
	}
}

func TestTargetedShopifyOrderSyncDoesNotAdvanceFullReconciliationCheckpoint(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Targeted", ExternalID: "targeted.myshopify.com", Status: ShopStatusActive})
	_, _ = store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: shop.ID, ShopDomain: shop.ExternalID, AccessToken: "token"})
	server := NewServer(store)
	lastSuccess := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
	server.storeShopifyOrderSnapshot(shop.ID, shopifyOrderSyncSnapshot{State: ShopifyOrderSyncState{
		ShopID: shop.ID, ShopName: shop.DisplayName, State: "ok", LastSuccessAt: lastSuccess, HistoryWindowDays: 60,
	}})
	var query string
	server.shopifyOrderPageSearch = func(_ context.Context, _, _, gotQuery string, _ int, _ string) (shopifyOrderPage, error) {
		query = gotQuery
		return shopifyOrderPage{Orders: []ShopifyOrderSummary{{ID: "gid://shopify/Order/456", LegacyResourceID: "456", Name: "#456", CreatedAt: time.Now().UTC().Format(time.RFC3339)}}}, nil
	}
	if err := server.syncShopifyOrdersForJob(t.Context(), shop, "456"); err != nil {
		t.Fatal(err)
	}
	snapshot := server.loadShopifyOrderSnapshot(t.Context(), shop)
	if query != "id:456" || snapshot.State.LastSuccessAt != lastSuccess || snapshot.State.HistoryWindowDays != 60 || len(snapshot.Orders) != 1 {
		t.Fatalf("targeted sync changed the full checkpoint: query=%q snapshot=%#v", query, snapshot)
	}
}

func TestWebhookPreemptsScheduledReconciliationWithoutLosingDailyCheck(t *testing.T) {
	store := NewMemoryStore()
	shop, _ := store.CreateShop(t.Context(), Shop{DisplayName: "Scheduled", Status: ShopStatusActive})
	now := time.Now().UTC()
	_, _ = store.EnqueueShopifyOrderSyncJob(t.Context(), ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: shopifyOrderSyncPriorityReconcile, Reason: "daily reconciliation", AvailableAt: now.Add(time.Hour),
	})
	queued, err := store.EnqueueShopifyOrderSyncJob(t.Context(), ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: shopifyOrderSyncPriorityWebhook, Reason: "webhook", TargetOrderID: "789", AvailableAt: now,
	})
	if err != nil || queued.TargetOrderID != "789" || !queued.ReconciliationRequested || queued.Priority != shopifyOrderSyncPriorityWebhook {
		t.Fatalf("webhook did not preempt scheduled reconciliation: %#v err=%v", queued, err)
	}
	claimed, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), false)
	if err != nil || claimed.TargetOrderID != "789" {
		t.Fatalf("targeted webhook was not claimable immediately: %#v err=%v", claimed, err)
	}
	if err := store.FinishShopifyOrderSyncJob(t.Context(), shop.ID, false, time.Time{}, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), false); !errors.Is(err, ErrNotFound) {
		t.Fatalf("daily reconciliation leaked into high-priority workers: %v", err)
	}
	reconciliation, err := store.ClaimShopifyOrderSyncJob(t.Context(), now.Add(time.Second), true)
	if err != nil || reconciliation.TargetOrderID != "" || reconciliation.Priority != shopifyOrderSyncPriorityReconcile {
		t.Fatalf("daily reconciliation was lost after targeted sync: %#v err=%v", reconciliation, err)
	}
}

func TestShopifyOrderSyncMergesPagesAndAdvancesFromSuccessfulStart(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{DisplayName: "Demo", ExternalID: "demo.myshopify.com", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: shop.ID, ShopDomain: shop.ExternalID, AccessToken: "test-token"}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	server.storeShopifyOrderSnapshot(shop.ID, shopifyOrderSyncSnapshot{
		Orders: []ShopifyOrderSummary{{ID: "old", Name: "#999", CreatedAt: "2026-07-01T00:00:00Z"}},
		State:  ShopifyOrderSyncState{ShopID: shop.ID, ShopName: shop.DisplayName, State: "idle"},
	})
	var queries []string
	server.shopifyOrderPageSearch = func(_ context.Context, _, _, query string, _ int, after string) (shopifyOrderPage, error) {
		queries = append(queries, query)
		if after == "" {
			return shopifyOrderPage{Orders: []ShopifyOrderSummary{{ID: "new-1", Name: "#1001", CreatedAt: "2026-08-01T00:00:00Z"}}, HasNextPage: true, EndCursor: "next"}, nil
		}
		return shopifyOrderPage{Orders: []ShopifyOrderSummary{{ID: "new-2", Name: "#1002", CreatedAt: "2026-08-02T00:00:00Z"}}}, nil
	}

	server.syncShopifyOrdersForShop(t.Context(), shop)
	snapshot := server.loadShopifyOrderSnapshot(t.Context(), shop)
	if snapshot.State.State != "ok" || snapshot.State.SyncedCount != 2 || snapshot.State.OrderCount != 3 || snapshot.State.LastSuccessAt == "" || snapshot.State.HistoryWindowDays != 60 {
		t.Fatalf("unexpected sync state: %#v", snapshot.State)
	}
	if len(snapshot.Orders) != 3 || snapshot.Orders[0].Name != "#1002" || snapshot.Orders[0].ShopID != shop.ID {
		t.Fatalf("unexpected merged orders: %#v", snapshot.Orders)
	}
	if len(queries) != 2 || !strings.HasPrefix(queries[0], "updated_at:>=") {
		t.Fatalf("unexpected first sync queries: %#v", queries)
	}
	initialSince, err := time.Parse(time.RFC3339, strings.TrimSuffix(strings.TrimPrefix(queries[0], "updated_at:>='"), "'"))
	if err != nil {
		t.Fatalf("parse initial sync window: %v (%q)", err, queries[0])
	}
	window := time.Since(initialSince)
	if window < 59*24*time.Hour || window > 61*24*time.Hour {
		t.Fatalf("initial sync window = %s, want about 60 days", window)
	}

	previousSuccess, err := time.Parse(time.RFC3339Nano, snapshot.State.LastSuccessAt)
	if err != nil {
		t.Fatal(err)
	}
	queries = nil
	server.shopifyOrderPageSearch = func(_ context.Context, _, _, query string, _ int, _ string) (shopifyOrderPage, error) {
		queries = append(queries, query)
		return shopifyOrderPage{}, nil
	}
	server.syncShopifyOrdersForShop(t.Context(), shop)
	wantSince := previousSuccess.Add(-shopifyOrderSyncOverlap).UTC().Format(time.RFC3339)
	if len(queries) != 1 || !strings.Contains(queries[0], wantSince) {
		t.Fatalf("incremental sync did not overlap from last success: got %#v want %s", queries, wantSince)
	}
}

func TestShopifyOrderSyncBackfillsLegacyThirtyDaySnapshotOnce(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(t.Context(), Shop{DisplayName: "Legacy", ExternalID: "legacy.myshopify.com", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: shop.ID, ShopDomain: shop.ExternalID, AccessToken: "test-token"}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	legacySuccess := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
	server.storeShopifyOrderSnapshot(shop.ID, shopifyOrderSyncSnapshot{
		State: ShopifyOrderSyncState{ShopID: shop.ID, ShopName: shop.DisplayName, State: "ok", LastSuccessAt: legacySuccess},
	})
	var query string
	server.shopifyOrderPageSearch = func(_ context.Context, _, _, gotQuery string, _ int, _ string) (shopifyOrderPage, error) {
		query = gotQuery
		return shopifyOrderPage{}, nil
	}

	server.syncShopifyOrdersForShop(t.Context(), shop)

	since, err := time.Parse(time.RFC3339, strings.TrimSuffix(strings.TrimPrefix(query, "updated_at:>='"), "'"))
	if err != nil {
		t.Fatalf("parse legacy backfill query: %v (%q)", err, query)
	}
	window := time.Since(since)
	if window < 59*24*time.Hour || window > 61*24*time.Hour {
		t.Fatalf("legacy backfill window = %s, want about 60 days", window)
	}
	snapshot := server.loadShopifyOrderSnapshot(t.Context(), shop)
	if snapshot.State.HistoryWindowDays != 60 || snapshot.State.State != "ok" {
		t.Fatalf("legacy backfill marker not advanced: %#v", snapshot.State)
	}
}

func TestConfiguredShopifyOrderSyncShopsExcludesUninstalledAndInactiveShops(t *testing.T) {
	store := NewMemoryStore()
	configured, err := store.CreateShop(t.Context(), Shop{DisplayName: "Configured", ExternalID: "configured.myshopify.com", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	uninstalled, err := store.CreateShop(t.Context(), Shop{DisplayName: "Uninstalled", ExternalID: "uninstalled.myshopify.com", Status: ShopStatusActive})
	if err != nil {
		t.Fatal(err)
	}
	inactive, err := store.CreateShop(t.Context(), Shop{DisplayName: "Inactive", ExternalID: "inactive.myshopify.com", Status: ShopStatusDisabled})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: configured.ID, ShopDomain: configured.ExternalID, AccessToken: "configured-token"}); err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: inactive.ID, ShopDomain: inactive.ExternalID, AccessToken: "inactive-token"}); err != nil {
		t.Fatal(err)
	}

	server := NewServer(store)
	got := server.configuredShopifyOrderSyncShops(t.Context(), []Shop{configured, uninstalled, inactive})
	if len(got) != 1 || got[0].ID != configured.ID {
		t.Fatalf("configured sync shops = %#v, want only %s", got, configured.ID)
	}
}

func TestShopifyOrderSyncStatusListsOnlyAuthorizedShops(t *testing.T) {
	store := NewMemoryStore()
	server := httptest.NewServer(NewServer(store).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var configured Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Configured", ExternalID: "configured.myshopify.com"}, http.StatusCreated, &configured)
	if _, err := store.SaveShopifyInstallation(t.Context(), ShopifyInstallation{ShopID: configured.ID, ShopDomain: configured.ExternalID, AccessToken: "configured-token"}); err != nil {
		t.Fatal(err)
	}
	var pending Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Pending", ExternalID: "pending.myshopify.com"}, http.StatusCreated, &pending)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Email only"}, http.StatusCreated, nil)

	var result struct {
		Sync []ShopifyOrderSyncState `json:"sync"`
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shopify/orders/sync", adminToken, nil, http.StatusOK, &result)
	if len(result.Sync) != 1 || result.Sync[0].ShopID != configured.ID {
		t.Fatalf("unexpected global sync states: %#v", result.Sync)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/shopify/orders/sync?shopId="+pending.ID, adminToken, nil, http.StatusBadRequest, nil)
}

func TestSyncedShopifyOrdersFiltersAcrossShops(t *testing.T) {
	server := NewServer(NewMemoryStore())
	shops := []Shop{{ID: "shop-a", DisplayName: "Alpha"}, {ID: "shop-b", DisplayName: "Beta"}}
	server.storeShopifyOrderSnapshot("shop-a", shopifyOrderSyncSnapshot{Orders: []ShopifyOrderSummary{{ShopID: "shop-a", ShopName: "Alpha", ID: "1", Name: "#1001", Email: "one@example.com", CreatedAt: "2026-08-01T00:00:00Z", FinancialStatus: "PAID"}}})
	server.storeShopifyOrderSnapshot("shop-b", shopifyOrderSyncSnapshot{Orders: []ShopifyOrderSummary{{ShopID: "shop-b", ShopName: "Beta", ID: "2", Name: "#1002", Email: "two@example.com", CreatedAt: "2026-08-02T00:00:00Z", FinancialStatus: "REFUNDED", LineItems: []ShopifyLineItem{{Name: "Widget", SKU: "SKU-TWO", Quantity: 1}}}}})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/shopify/orders?query=sku-two&refundStatus=refunded", nil)
	result, err := server.syncedShopifyOrders(t.Context(), shops, req)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 1 || len(result.Orders) != 1 || result.Orders[0].ShopID != "shop-b" {
		t.Fatalf("unexpected filtered result: %#v", result)
	}
}

func TestSyncedShopifyOrdersPaginatesNewestFirst(t *testing.T) {
	server := NewServer(NewMemoryStore())
	shops := []Shop{{ID: "shop-a", DisplayName: "Alpha"}}
	server.storeShopifyOrderSnapshot("shop-a", shopifyOrderSyncSnapshot{Orders: []ShopifyOrderSummary{
		{ShopID: "shop-a", ID: "1", Name: "#1001", CreatedAt: "2026-08-01T00:00:00Z"},
		{ShopID: "shop-a", ID: "2", Name: "#1002", CreatedAt: "2026-08-03T00:00:00Z"},
		{ShopID: "shop-a", ID: "3", Name: "#1003", CreatedAt: "2026-08-02T00:00:00Z"},
	}})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/shopify/orders?page=2&pageSize=1", nil)
	result, err := server.syncedShopifyOrders(t.Context(), shops, req)
	if err != nil {
		t.Fatal(err)
	}
	if result.Total != 3 || result.Page != 2 || result.PageSize != 1 || len(result.Orders) != 1 || result.Orders[0].Name != "#1003" {
		t.Fatalf("unexpected paged result: %#v", result)
	}
}
