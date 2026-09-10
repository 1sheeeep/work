package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	shopifyOrderSyncNamespace            = "shopify_order_sync_v2"
	shopifyOrderSyncTTL                  = 365 * 24 * time.Hour
	shopifyOrderInitialWindow            = 60 * 24 * time.Hour
	shopifyOrderSyncOverlap              = 10 * time.Minute
	shopifyOrderSyncPageSize             = 100
	shopifyOrderSyncMaxPages             = 100
	shopifyOrderSnapshotLimit            = 20000
	shopifyOrderStartupDelay             = time.Minute
	shopifyOrderScheduleEvery            = 24 * time.Hour
	shopifyOrderSyncWorkerCount          = 8
	shopifyOrderReconcileWorkerCount     = 2
	shopifyOrderSyncJobTimeout           = 15 * time.Minute
	shopifyOrderSyncQueueErrorRetryDelay = 30 * time.Second
	shopifyOrderRetryInterval            = 6 * time.Hour
	shopifyOrderStaleRunning             = 20 * time.Minute
	shopifyWebhookReceiptTTL             = 7 * 24 * time.Hour
	shopifyOrderSyncPriorityReconcile    = 20
	shopifyOrderSyncPriorityManual       = 90
	shopifyOrderSyncPriorityWebhook      = 100
)

type authorizedShopifyShopStore interface {
	ListAuthorizedShopifyShops(context.Context) ([]Shop, error)
}

type shopifyOrderPage struct {
	Orders      []ShopifyOrderSummary
	HasNextPage bool
	EndCursor   string
}

type ShopifyOrderSyncState struct {
	ShopID            string `json:"shopId"`
	ShopName          string `json:"shopName"`
	State             string `json:"state"`
	LastAttemptAt     string `json:"lastAttemptAt,omitempty"`
	LastSuccessAt     string `json:"lastSuccessAt,omitempty"`
	Error             string `json:"error,omitempty"`
	SyncedCount       int    `json:"syncedCount"`
	OrderCount        int    `json:"orderCount"`
	HistoryWindowDays int    `json:"historyWindowDays,omitempty"`
}

type shopifyOrderSyncSnapshot struct {
	Orders []ShopifyOrderSummary `json:"orders"`
	State  ShopifyOrderSyncState `json:"state"`
}

type ShopifySyncedOrderList struct {
	Orders   []ShopifyOrderSummary   `json:"orders"`
	Total    int                     `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"pageSize"`
	Sync     []ShopifyOrderSyncState `json:"sync"`
}

type shopifyOrderSyncRequest struct {
	ShopID string `json:"shopId"`
}

func (c shopifyAdminClient) SearchOrdersPage(ctx context.Context, shopDomain string, accessToken string, searchQuery string, limit int, after string) (shopifyOrderPage, error) {
	shopDomain = normalizeShopifyDomain(shopDomain)
	accessToken = strings.TrimSpace(accessToken)
	searchQuery = strings.TrimSpace(searchQuery)
	if shopDomain == "" || accessToken == "" || searchQuery == "" {
		return shopifyOrderPage{}, fmt.Errorf("%w: Shopify order sync configuration is incomplete", ErrInvalid)
	}
	if limit <= 0 || limit > 250 {
		limit = shopifyOrderSyncPageSize
	}
	endpoint := c.BaseURL
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s/admin/api/%s/graphql.json", shopDomain, shopifyAPIVersion())
	}
	payload, err := json.Marshal(map[string]any{
		"query":     shopifyOrderSyncQuery,
		"variables": map[string]any{"query": searchQuery, "first": limit, "after": emptyStringAsNil(after)},
	})
	if err != nil {
		return shopifyOrderPage{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return shopifyOrderPage{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 25 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return shopifyOrderPage{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return shopifyOrderPage{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return shopifyOrderPage{}, &shopifyAdminHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	var parsed shopifyGraphQLResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return shopifyOrderPage{}, err
	}
	if len(parsed.Errors) > 0 {
		return shopifyOrderPage{}, fmt.Errorf("Shopify Admin API error: %s", parsed.Errors[0].Message)
	}
	page := shopifyOrderPage{
		HasNextPage: parsed.Data.Orders.PageInfo.HasNextPage,
		EndCursor:   parsed.Data.Orders.PageInfo.EndCursor,
		Orders:      make([]ShopifyOrderSummary, 0, len(parsed.Data.Orders.Edges)),
	}
	for _, edge := range parsed.Data.Orders.Edges {
		node := edge.Node
		legacyID := shopifyLegacyResourceID(node.LegacyResourceID, node.ID)
		order := ShopifyOrderSummary{
			ID: node.ID, LegacyResourceID: legacyID, Name: node.Name,
			AdminURL: shopifyAdminOrderURL(shopDomain, legacyID), Email: node.Email,
			SourceName: node.SourceName, CreatedAt: node.CreatedAt, UpdatedAt: node.UpdatedAt,
			FinancialStatus: node.DisplayFinancialStatus, FulfillmentStatus: node.DisplayFulfillmentStatus,
			PaymentGateways: append([]string(nil), node.PaymentGatewayNames...), Total: node.CurrentTotalPriceSet.PresentmentMoney,
			Subtotal: node.CurrentSubtotalPriceSet.PresentmentMoney, Shipping: node.CurrentShippingPriceSet.PresentmentMoney,
			Fulfillments: normalizeShopifyFulfillmentTrackingURLs(node.Fulfillments),
		}
		if node.Customer != nil {
			order.Customer = shopifyCustomerSummary(*node.Customer, shopDomain)
		}
		for _, item := range node.LineItems.Edges {
			order.LineItems = append(order.LineItems, shopifyLineItemSummary(item.Node))
		}
		page.Orders = append(page.Orders, order)
	}
	return page, nil
}

func emptyStringAsNil(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func (s *Server) StartShopifyOrderSync(ctx context.Context) {
	queue, ok := s.store.(shopifyOrderSyncJobStore)
	if !ok {
		log.Printf("Shopify order sync: durable queue storage is unavailable")
		return
	}
	if recovered, err := queue.RecoverShopifyOrderSyncJobs(ctx, time.Now().UTC().Add(-shopifyOrderStaleRunning)); err != nil {
		if ctx.Err() == nil {
			log.Printf("Shopify order sync: recover interrupted jobs failed: %v", err)
		}
	} else if recovered > 0 {
		log.Printf("Shopify order sync: recovered %d interrupted job(s)", recovered)
	}
	if _, err := queue.CleanupShopifyWebhookReceipts(ctx, time.Now().UTC().Add(-shopifyWebhookReceiptTTL)); err != nil && ctx.Err() == nil {
		log.Printf("Shopify webhook receipts: cleanup failed: %v", err)
	}
	for worker := 0; worker < shopifyOrderSyncWorkerCount; worker++ {
		go s.runShopifyOrderSyncWorker(ctx, queue, worker < shopifyOrderReconcileWorkerCount)
	}
	go func() {
		startupDelay := time.NewTimer(shopifyOrderStartupDelay)
		select {
		case <-ctx.Done():
			if !startupDelay.Stop() {
				select {
				case <-startupDelay.C:
				default:
				}
			}
			return
		case <-startupDelay.C:
		}
		s.queueDueShopifyOrderSyncs(ctx, 0)
		ticker := time.NewTicker(shopifyOrderScheduleEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if _, err := queue.CleanupShopifyWebhookReceipts(ctx, time.Now().UTC().Add(-shopifyWebhookReceiptTTL)); err != nil && ctx.Err() == nil {
					log.Printf("Shopify webhook receipts: cleanup failed: %v", err)
				}
				s.queueDueShopifyOrderSyncs(ctx, 0)
			}
		}
	}()
}

func (s *Server) queueDueShopifyOrderSyncs(ctx context.Context, limit int) {
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		log.Printf("Shopify order sync: list shops failed: %v", err)
		return
	}
	configured := s.configuredShopifyOrderSyncShops(ctx, shops)
	now := time.Now().UTC()
	type dueShop struct {
		shop      Shop
		stateTime time.Time
	}
	due := make([]dueShop, 0, len(configured))
	for _, shop := range configured {
		state := s.loadShopifyOrderSnapshot(ctx, shop).State
		if shopifyOrderSyncDue(state, now) {
			due = append(due, dueShop{shop: shop, stateTime: shopifyOrderSyncStateTime(state)})
		}
	}
	sort.SliceStable(due, func(i, j int) bool {
		return due[i].stateTime.Before(due[j].stateTime)
	})
	if limit > 0 && len(due) > limit {
		due = due[:limit]
	}
	if len(due) == 0 {
		return
	}
	now = time.Now().UTC()
	spread := shopifyOrderScheduleEvery / time.Duration(len(due))
	for index, item := range due {
		availableAt := now.Add(time.Duration(index) * spread)
		if err := s.enqueueShopifyOrderSync(ctx, item.shop, "daily reconciliation", "", shopifyOrderSyncPriorityReconcile, availableAt); err != nil && ctx.Err() == nil {
			log.Printf("Shopify order sync: enqueue reconciliation for %s failed: %v", item.shop.ID, err)
		}
	}
}

func shopifyOrderSyncDue(state ShopifyOrderSyncState, now time.Time) bool {
	lastAttempt, hasAttempt := parseEmailSyncTime(state.LastAttemptAt)
	lastSuccess, hasSuccess := parseEmailSyncTime(state.LastSuccessAt)
	switch strings.ToLower(strings.TrimSpace(state.State)) {
	case "blocked":
		return false
	case "queued", "syncing":
		return !hasAttempt || now.Sub(lastAttempt) >= shopifyOrderStaleRunning
	case "error":
		return !hasAttempt || now.Sub(lastAttempt) >= shopifyOrderRetryInterval
	}
	return !hasSuccess || now.Sub(lastSuccess) >= 24*time.Hour
}

func shopifyOrderSyncStateTime(state ShopifyOrderSyncState) time.Time {
	if value, ok := parseEmailSyncTime(state.LastSuccessAt); ok {
		return value
	}
	if value, ok := parseEmailSyncTime(state.LastAttemptAt); ok {
		return value
	}
	return time.Time{}
}

func (s *Server) configuredShopifyOrderSyncShops(ctx context.Context, shops []Shop) []Shop {
	if store, ok := s.store.(authorizedShopifyShopStore); ok {
		authorized, err := store.ListAuthorizedShopifyShops(ctx)
		if err != nil {
			log.Printf("Shopify order sync: list authorized shops failed: %v", err)
			return nil
		}
		authorizedIDs := make(map[string]bool, len(authorized))
		for _, shop := range authorized {
			authorizedIDs[shop.ID] = true
		}
		configured := make([]Shop, 0, len(shops))
		for _, shop := range shops {
			if shop.Status == ShopStatusActive && authorizedIDs[shop.ID] {
				configured = append(configured, shop)
			}
		}
		return configured
	}
	configured := make([]Shop, 0, len(shops))
	for _, shop := range shops {
		if shop.Status != ShopStatusActive {
			continue
		}
		sources, sourceErr := s.store.ListShopSources(ctx, shop.ID)
		if sourceErr != nil {
			log.Printf("Shopify order sync: list sources for %s failed: %v", shop.ID, sourceErr)
			continue
		}
		domain := shopifyDomainForShop(shop, sources)
		if domain == "" {
			continue
		}
		installation, installErr := s.store.GetShopifyInstallationByDomain(ctx, domain)
		if installErr == nil && strings.TrimSpace(installation.AccessToken) != "" {
			configured = append(configured, shop)
		}
	}
	return configured
}

func activeShops(shops []Shop) []Shop {
	out := make([]Shop, 0, len(shops))
	for _, shop := range shops {
		if shop.Status == ShopStatusActive {
			out = append(out, shop)
		}
	}
	return out
}

func (s *Server) handleSyncedShopifyOrders(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	shops, ok := s.requireOrderSyncShops(w, r, user, strings.TrimSpace(r.URL.Query().Get("shopId")))
	if !ok {
		return
	}
	result, err := s.syncedShopifyOrders(r.Context(), shops, r)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) handleShopifyOrderSync(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasAnyPermission(user, PermissionOrdersView, PermissionOrdersRefund) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "order view permission is required"})
		return
	}
	requestedShopID := strings.TrimSpace(r.URL.Query().Get("shopId"))
	if r.Method == http.MethodPost {
		var input shopifyOrderSyncRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		requestedShopID = strings.TrimSpace(input.ShopID)
	}
	shops, allowed := s.requireOrderSyncShops(w, r, user, requestedShopID)
	if !allowed {
		return
	}
	if r.Method == http.MethodPost {
		s.queueShopifyOrderSyncs(context.Background(), shops)
	}
	status := http.StatusOK
	if r.Method == http.MethodPost {
		status = http.StatusAccepted
	}
	writeJSONResponse(w, status, map[string]any{
		"sync": s.orderSyncStates(r.Context(), shops),
	})
}

func (s *Server) requireOrderSyncShops(w http.ResponseWriter, r *http.Request, user User, requestedShopID string) ([]Shop, bool) {
	if !userHasAnyPermission(user, PermissionOrdersView, PermissionOrdersRefund) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "order view permission is required"})
		return nil, false
	}
	shops, err := s.store.ListShops(r.Context())
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	shopIDs, restricted, err := s.moduleScopeShopIDs(r.Context(), user, DataScopeOrders)
	if err != nil {
		writeError(w, err)
		return nil, false
	}
	allowedIDs := stringSet(shopIDs)
	out := make([]Shop, 0, len(shops))
	for _, shop := range shops {
		if shop.Status != ShopStatusActive {
			continue
		}
		if restricted && !allowedIDs[shop.ID] {
			continue
		}
		if requestedShopID != "" && shop.ID != requestedShopID {
			continue
		}
		out = append(out, shop)
	}
	if requestedShopID != "" && len(out) == 0 {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "shop is outside the order data scope"})
		return nil, false
	}
	configured := s.configuredShopifyOrderSyncShops(r.Context(), out)
	if requestedShopID != "" && len(configured) == 0 {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "shop has not completed Shopify authorization"})
		return nil, false
	}
	return configured, true
}

func (s *Server) queueShopifyOrderSyncs(parent context.Context, shops []Shop) {
	for _, shop := range shops {
		if err := s.enqueueShopifyOrderSync(parent, shop, "manual sync", "", shopifyOrderSyncPriorityManual, time.Now().UTC()); err != nil && parent.Err() == nil {
			log.Printf("Shopify order sync: enqueue manual sync for %s failed: %v", shop.ID, err)
		}
	}
}

func (s *Server) enqueueShopifyOrderSync(ctx context.Context, shop Shop, reason string, targetOrderID string, priority int, availableAt time.Time) error {
	queue, ok := s.store.(shopifyOrderSyncJobStore)
	if !ok {
		return errors.New("Shopify order sync queue storage is unavailable")
	}
	job, err := queue.EnqueueShopifyOrderSyncJob(ctx, ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: priority, Reason: reason,
		TargetOrderID: strings.TrimSpace(targetOrderID), AvailableAt: availableAt,
	})
	if err != nil {
		return err
	}
	if priority > shopifyOrderSyncPriorityReconcile || !availableAt.After(time.Now().UTC().Add(time.Second)) {
		s.publishShopifyOrderSyncQueued(ctx, shop, job)
	}
	s.notifyShopifyOrderSyncWorkers()
	return nil
}

func (s *Server) publishShopifyOrderSyncQueued(ctx context.Context, shop Shop, job ShopifyOrderSyncJob) {
	if job.Status == "queued" {
		snapshot := s.loadShopifyOrderSnapshot(context.WithoutCancel(ctx), shop)
		snapshot.State.State = "queued"
		snapshot.State.Error = ""
		s.storeShopifyOrderSnapshot(shop.ID, snapshot)
		_ = s.persistShopifyOrderSnapshot(context.WithoutCancel(ctx), shop.ID, snapshot)
		s.broadcast(Event{Type: "shopify_order_sync.updated", ShopID: shop.ID, EntityID: shop.ID, Payload: snapshot.State, CreatedAt: time.Now().UTC()})
	}
}

func (s *Server) notifyShopifyOrderSyncWorkers() {
	for worker := 0; worker < shopifyOrderSyncWorkerCount-shopifyOrderReconcileWorkerCount; worker++ {
		select {
		case s.orderSyncHighWake <- struct{}{}:
		default:
			break
		}
	}
	for worker := 0; worker < shopifyOrderReconcileWorkerCount; worker++ {
		select {
		case s.orderSyncAllWake <- struct{}{}:
		default:
			break
		}
	}
}

func (s *Server) runShopifyOrderSyncWorker(ctx context.Context, queue shopifyOrderSyncJobStore, allowReconciliation bool) {
	wake := s.orderSyncHighWake
	if allowReconciliation {
		wake = s.orderSyncAllWake
	}
	for {
		job, err := queue.ClaimShopifyOrderSyncJob(ctx, time.Now().UTC(), allowReconciliation)
		if err == nil {
			s.processShopifyOrderSyncJob(ctx, queue, job)
			continue
		}
		if !errors.Is(err, ErrNotFound) && ctx.Err() == nil {
			log.Printf("Shopify order sync: claim job failed: %v", err)
		}
		var due <-chan time.Time
		var timer *time.Timer
		if err != nil && !errors.Is(err, ErrNotFound) {
			timer = time.NewTimer(shopifyOrderSyncQueueErrorRetryDelay)
			due = timer.C
		} else if availableAt, nextErr := queue.NextShopifyOrderSyncJobAvailableAt(ctx, allowReconciliation); nextErr == nil {
			delay := time.Until(availableAt)
			if delay < 0 {
				delay = 0
			}
			timer = time.NewTimer(delay)
			due = timer.C
		} else if !errors.Is(nextErr, ErrNotFound) {
			if ctx.Err() == nil {
				log.Printf("Shopify order sync: read next job failed: %v", nextErr)
			}
			timer = time.NewTimer(shopifyOrderSyncQueueErrorRetryDelay)
			due = timer.C
		}
		select {
		case <-ctx.Done():
			if timer != nil && !timer.Stop() {
				select {
				case <-due:
				default:
				}
			}
			return
		case <-wake:
			if timer != nil && !timer.Stop() {
				select {
				case <-due:
				default:
				}
			}
		case <-due:
		}
	}
}

func (s *Server) processShopifyOrderSyncJob(parent context.Context, queue shopifyOrderSyncJobStore, job ShopifyOrderSyncJob) {
	shop, err := s.store.GetShop(parent, job.ShopID)
	if err != nil || shop.Status != ShopStatusActive {
		_ = queue.FinishShopifyOrderSyncJob(context.WithoutCancel(parent), job.ShopID, false, time.Time{}, "")
		return
	}
	ctx, cancel := context.WithTimeout(parent, shopifyOrderSyncJobTimeout)
	err = s.syncShopifyOrdersForJob(ctx, shop, job.TargetOrderID)
	cancel()
	retry := err != nil && !shopifyOrderSyncBlocked(err)
	availableAt := time.Time{}
	lastError := ""
	if retry {
		availableAt = time.Now().UTC().Add(shopifyOrderRetryInterval)
		lastError = truncateOrderSyncError(err.Error())
	}
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
	finishErr := queue.FinishShopifyOrderSyncJob(finishCtx, job.ShopID, retry, availableAt, lastError)
	finishCancel()
	if finishErr != nil && !errors.Is(finishErr, ErrNotFound) {
		log.Printf("Shopify order sync: finish job for %s failed: %v", job.ShopID, finishErr)
	}
	s.notifyShopifyOrderSyncWorkers()
}

func (s *Server) syncShopifyOrdersForShop(ctx context.Context, shop Shop) error {
	return s.syncShopifyOrdersForJob(ctx, shop, "")
}

func (s *Server) syncShopifyOrdersForJob(ctx context.Context, shop Shop, targetOrderID string) error {
	snapshot := s.loadShopifyOrderSnapshot(ctx, shop)
	snapshot.State.State = "syncing"
	snapshot.State.LastAttemptAt = time.Now().UTC().Format(time.RFC3339Nano)
	snapshot.State.Error = ""
	s.storeShopifyOrderSnapshot(shop.ID, snapshot)
	_ = s.persistShopifyOrderSnapshot(ctx, shop.ID, snapshot)
	s.broadcast(Event{Type: "shopify_order_sync.updated", ShopID: shop.ID, EntityID: shop.ID, Payload: snapshot.State, CreatedAt: time.Now().UTC()})

	syncStartedAt := time.Now().UTC()
	since := syncStartedAt.Add(-shopifyOrderInitialWindow)
	if lastSuccess, err := time.Parse(time.RFC3339Nano, snapshot.State.LastSuccessAt); err == nil && snapshot.State.HistoryWindowDays >= int(shopifyOrderInitialWindow/(24*time.Hour)) {
		since = lastSuccess.Add(-shopifyOrderSyncOverlap)
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		s.finishShopifyOrderSync(ctx, shop, snapshot, 0, syncStartedAt, err)
		return err
	}
	domain := shopifyDomainForShop(shop, sources)
	token := s.shopifyAdminToken(ctx, domain)
	if domain == "" || token == "" {
		err = fmt.Errorf("Shopify API is not configured for this shop")
		s.finishShopifyOrderSync(ctx, shop, snapshot, 0, syncStartedAt, err)
		return err
	}
	search := s.shopifyOrderPageSearch
	if search == nil {
		search = (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 25 * time.Second}}).SearchOrdersPage
	}
	targetOrderID = strings.TrimSpace(targetOrderID)
	query := "updated_at:>='" + since.UTC().Format(time.RFC3339) + "'"
	if targetOrderID != "" {
		query = "id:" + targetOrderID
	}
	orders := make([]ShopifyOrderSummary, 0, shopifyOrderSyncPageSize)
	after := ""
	for pageNumber := 0; pageNumber < shopifyOrderSyncMaxPages; pageNumber++ {
		page, pageErr := search(ctx, domain, token, query, shopifyOrderSyncPageSize, after)
		if pageErr != nil {
			s.recordShopifyAPIError(ctx, shop.ID, pageErr)
			s.finishShopifyOrderSync(ctx, shop, snapshot, len(orders), syncStartedAt, pageErr)
			return pageErr
		}
		orders = append(orders, page.Orders...)
		if !page.HasNextPage {
			break
		}
		if strings.TrimSpace(page.EndCursor) == "" || pageNumber == shopifyOrderSyncMaxPages-1 {
			err = fmt.Errorf("Shopify order sync exceeded the safe page limit")
			s.finishShopifyOrderSync(ctx, shop, snapshot, len(orders), syncStartedAt, err)
			return err
		}
		after = page.EndCursor
	}
	merged := make(map[string]ShopifyOrderSummary, len(snapshot.Orders)+len(orders))
	for _, order := range snapshot.Orders {
		merged[order.ID] = order
	}
	for _, order := range orders {
		order.ShopID = shop.ID
		order.ShopName = shop.DisplayName
		merged[order.ID] = order
	}
	snapshot.Orders = snapshot.Orders[:0]
	for _, order := range merged {
		snapshot.Orders = append(snapshot.Orders, order)
	}
	sort.Slice(snapshot.Orders, func(i, j int) bool {
		return orderCreatedAt(snapshot.Orders[i]).After(orderCreatedAt(snapshot.Orders[j]))
	})
	if len(snapshot.Orders) > shopifyOrderSnapshotLimit {
		snapshot.Orders = snapshot.Orders[:shopifyOrderSnapshotLimit]
	}
	s.finishShopifyOrderSyncWithCheckpoint(ctx, shop, snapshot, len(orders), syncStartedAt, nil, targetOrderID == "")
	return nil
}

func (s *Server) finishShopifyOrderSync(ctx context.Context, shop Shop, snapshot shopifyOrderSyncSnapshot, count int, successAt time.Time, syncErr error) {
	s.finishShopifyOrderSyncWithCheckpoint(ctx, shop, snapshot, count, successAt, syncErr, true)
}

func (s *Server) finishShopifyOrderSyncWithCheckpoint(ctx context.Context, shop Shop, snapshot shopifyOrderSyncSnapshot, count int, successAt time.Time, syncErr error, advanceCheckpoint bool) {
	snapshot.State.ShopID = shop.ID
	snapshot.State.ShopName = shop.DisplayName
	snapshot.State.SyncedCount = count
	snapshot.State.OrderCount = len(snapshot.Orders)
	if syncErr == nil {
		snapshot.State.State = "ok"
		if advanceCheckpoint {
			snapshot.State.LastSuccessAt = successAt.UTC().Format(time.RFC3339Nano)
			snapshot.State.HistoryWindowDays = int(shopifyOrderInitialWindow / (24 * time.Hour))
		}
		snapshot.State.Error = ""
	} else {
		if shopifyOrderSyncBlocked(syncErr) {
			snapshot.State.State = "blocked"
		} else {
			snapshot.State.State = "error"
		}
		snapshot.State.Error = truncateOrderSyncError(syncErr.Error())
	}
	s.storeShopifyOrderSnapshot(shop.ID, snapshot)
	if err := s.persistShopifyOrderSnapshot(ctx, shop.ID, snapshot); err != nil {
		log.Printf("Shopify order sync: persist %s failed: %v", shop.ID, err)
	}
	s.broadcast(Event{Type: "shopify_order_sync.updated", ShopID: shop.ID, EntityID: shop.ID, Payload: snapshot.State, CreatedAt: time.Now().UTC()})
}

func shopifyOrderSyncBlocked(syncErr error) bool {
	if syncErr == nil {
		return false
	}
	if isShopifyAuthorizationError(syncErr) {
		return true
	}
	var apiErr *shopifyAdminHTTPError
	if errors.As(syncErr, &apiErr) && (apiErr.StatusCode == http.StatusNotFound || apiErr.StatusCode == http.StatusGone || apiErr.StatusCode == http.StatusPaymentRequired) {
		return true
	}
	message := strings.ToLower(syncErr.Error())
	for _, marker := range []string{
		"not configured for this shop",
		"access denied for orders field",
		"shop is under review",
		"unavailable shop",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func truncateOrderSyncError(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 500 {
		return value[:500]
	}
	return value
}

func (s *Server) loadShopifyOrderSnapshot(ctx context.Context, shop Shop) shopifyOrderSyncSnapshot {
	s.orderSyncMu.Lock()
	if snapshot, ok := s.orderSyncSnapshots[shop.ID]; ok {
		s.orderSyncMu.Unlock()
		return snapshot
	}
	s.orderSyncMu.Unlock()
	snapshot := shopifyOrderSyncSnapshot{State: ShopifyOrderSyncState{ShopID: shop.ID, ShopName: shop.DisplayName, State: "idle"}}
	key := externalCacheKey(shopifyOrderSyncNamespace, shop.ID, "snapshot")
	if store, ok := s.store.(externalCacheStore); ok {
		if entry, err := store.GetExternalCache(ctx, key); err == nil && time.Now().UTC().Before(entry.ExpiresAt) {
			_ = json.Unmarshal(entry.Payload, &snapshot)
		}
	}
	snapshot.State.ShopID = shop.ID
	snapshot.State.ShopName = shop.DisplayName
	s.storeShopifyOrderSnapshot(shop.ID, snapshot)
	return snapshot
}

func (s *Server) storeShopifyOrderSnapshot(shopID string, snapshot shopifyOrderSyncSnapshot) {
	s.orderSyncMu.Lock()
	s.orderSyncSnapshots[shopID] = snapshot
	s.orderSyncMu.Unlock()
}

func (s *Server) persistShopifyOrderSnapshot(ctx context.Context, shopID string, snapshot shopifyOrderSyncSnapshot) error {
	store, ok := s.store.(externalCacheStore)
	if !ok {
		return nil
	}
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	return store.SaveExternalCache(ctx, externalCacheKey(shopifyOrderSyncNamespace, shopID, "snapshot"), shopifyOrderSyncNamespace, shopID, payload, now, now.Add(shopifyOrderSyncTTL))
}

func (s *Server) orderSyncStates(ctx context.Context, shops []Shop) []ShopifyOrderSyncState {
	states := make([]ShopifyOrderSyncState, 0, len(shops))
	for _, shop := range shops {
		snapshot := s.loadShopifyOrderSnapshot(ctx, shop)
		states = append(states, snapshot.State)
	}
	return states
}

func (s *Server) syncedShopifyOrders(ctx context.Context, shops []Shop, r *http.Request) (ShopifySyncedOrderList, error) {
	query := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("query")))
	financial := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("financialStatus")))
	fulfillment := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("fulfillmentStatus")))
	refund := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("refundStatus")))
	days, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("days")))
	page, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("page")))
	pageSize, _ := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get("pageSize")))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 200 {
		pageSize = 100
	}
	cutoff := time.Time{}
	if days > 0 && days <= 3650 {
		cutoff = time.Now().UTC().AddDate(0, 0, -days)
	}
	orders := make([]ShopifyOrderSummary, 0)
	for _, shop := range shops {
		for _, order := range s.loadShopifyOrderSnapshot(ctx, shop).Orders {
			normalizeShopifyOrderTrackingURLs(&order)
			if !cutoff.IsZero() && orderCreatedAt(order).Before(cutoff) {
				continue
			}
			if financial != "" && strings.ToUpper(order.FinancialStatus) != financial {
				continue
			}
			if fulfillment != "" && strings.ToUpper(order.FulfillmentStatus) != fulfillment {
				continue
			}
			if refund != "" && shopifyOrderRefundStatus(order) != refund {
				continue
			}
			searchValues := []string{order.Name, order.Email, order.Customer.DisplayName, order.Customer.Email, order.ShopName}
			for _, item := range order.LineItems {
				searchValues = append(searchValues, item.Name, item.SKU, item.VariantTitle)
			}
			if query != "" && !strings.Contains(strings.ToLower(strings.Join(searchValues, " ")), query) {
				continue
			}
			orders = append(orders, order)
		}
	}
	sort.Slice(orders, func(i, j int) bool { return orderCreatedAt(orders[i]).After(orderCreatedAt(orders[j])) })
	total := len(orders)
	start := (page - 1) * pageSize
	if start > total {
		start = total
	}
	end := start + pageSize
	if end > total {
		end = total
	}
	return ShopifySyncedOrderList{Orders: nonNilSlice(orders[start:end]), Total: total, Page: page, PageSize: pageSize, Sync: s.orderSyncStates(ctx, shops)}, nil
}

func shopifyOrderRefundStatus(order ShopifyOrderSummary) string {
	switch strings.ToUpper(strings.TrimSpace(order.FinancialStatus)) {
	case "REFUNDED":
		return "refunded"
	case "PARTIALLY_REFUNDED":
		return "partial"
	default:
		return "none"
	}
}

func orderCreatedAt(order ShopifyOrderSummary) time.Time {
	createdAt, _ := time.Parse(time.RFC3339, order.CreatedAt)
	return createdAt
}

const shopifyOrderSyncQuery = `
query SupportOrderSync($query: String!, $first: Int!, $after: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    edges {
      cursor
      node {
        id
        legacyResourceId
        name
        email
        sourceName
        createdAt
        updatedAt
        displayFinancialStatus
        displayFulfillmentStatus
        paymentGatewayNames
		currentTotalPriceSet { presentmentMoney { amount currencyCode } }
		currentSubtotalPriceSet { presentmentMoney { amount currencyCode } }
		currentShippingPriceSet { presentmentMoney { amount currencyCode } }
        lineItems(first: 10) {
          edges {
            node {
              name
              quantity
              sku
              variantTitle
              requiresShipping
			  discountedTotalSet { presentmentMoney { amount currencyCode } }
            }
          }
        }
        customer {
          id
          displayName
          createdAt
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
          amountSpent { amount currencyCode }
          defaultAddress { formattedArea }
        }
        fulfillments(first: 5) {
          id
          status
          displayStatus
          createdAt
          updatedAt
          deliveredAt
          trackingInfo { company number url }
        }
      }
    }
  }
}`
