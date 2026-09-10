package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
)

const shopifyAdminAPIVersion = "2026-01"
const shopifyOrderCacheNamespace = "shopify_orders_v7"
const shopifyOrderCacheTTL = 24 * time.Hour

type ShopifyOrderSearchResult struct {
	Orders []ShopifyOrderSummary `json:"orders"`
}

type ShopifyConnectionStatus struct {
	State             string    `json:"state"`
	ShopifyStoreID    string    `json:"shopifyStoreId,omitempty"`
	ShopDomain        string    `json:"shopDomain,omitempty"`
	ShopName          string    `json:"shopName,omitempty"`
	Message           string    `json:"message,omitempty"`
	Scope             string    `json:"scope,omitempty"`
	CheckedAt         time.Time `json:"checkedAt,omitempty"`
	ThemeEmbedState   string    `json:"themeEmbedState,omitempty"`
	ThemeEmbedMessage string    `json:"themeEmbedMessage,omitempty"`
	AppDeployStatus   string    `json:"appDeployStatus,omitempty"`
	AppDeployVersion  string    `json:"appDeployVersion,omitempty"`
}

const (
	shopifyConnectionStateKey     = "connectionState"
	shopifyConnectionMessageKey   = "connectionMessage"
	shopifyConnectionCheckedAtKey = "connectionCheckedAt"
	shopifyConnectionShopNameKey  = "connectionShopName"
	shopifyThemeEmbedStateKey     = "themeEmbedState"
	shopifyThemeEmbedMessageKey   = "themeEmbedMessage"
	shopifyAppDeployStatusKey     = "appDeployStatus"
	shopifyAppDeployVersionKey    = "appDeployVersion"
	shopifyThemeReadScope         = "read_themes"
	shopifyThemeSettingsFilename  = "config/settings_data.json"
	shopifyThemeEmbedEnabled      = "enabled"
	shopifyThemeEmbedDisabled     = "disabled"
	shopifyThemeEmbedNotAdded     = "not_added"
	shopifyThemeEmbedPermission   = "permission_required"
	shopifyThemeEmbedUnavailable  = "unavailable"
)

type shopifyAdminHTTPError struct {
	StatusCode int
	Body       string
}

func (e *shopifyAdminHTTPError) Error() string {
	return fmt.Sprintf("Shopify Admin API returned %d: %s", e.StatusCode, e.Body)
}

func isShopifyAuthorizationError(err error) bool {
	var apiErr *shopifyAdminHTTPError
	return errors.As(err, &apiErr) && (apiErr.StatusCode == http.StatusUnauthorized || apiErr.StatusCode == http.StatusForbidden)
}

type ShopifyOrderSummary struct {
	ShopID            string                `json:"shopId,omitempty"`
	ShopName          string                `json:"shopName,omitempty"`
	ID                string                `json:"id"`
	LegacyResourceID  string                `json:"legacyResourceId,omitempty"`
	Name              string                `json:"name"`
	AdminURL          string                `json:"adminUrl,omitempty"`
	Email             string                `json:"email,omitempty"`
	SourceName        string                `json:"sourceName,omitempty"`
	CreatedAt         string                `json:"createdAt"`
	UpdatedAt         string                `json:"updatedAt,omitempty"`
	FinancialStatus   string                `json:"financialStatus,omitempty"`
	FulfillmentStatus string                `json:"fulfillmentStatus,omitempty"`
	PaymentGateways   []string              `json:"paymentGatewayNames,omitempty"`
	Total             ShopifyMoney          `json:"total"`
	Subtotal          ShopifyMoney          `json:"subtotal,omitempty"`
	ProductSubtotal   ShopifyMoney          `json:"productSubtotal,omitempty"`
	Shipping          ShopifyMoney          `json:"shipping,omitempty"`
	AdditionalFees    ShopifyMoney          `json:"additionalServiceFees,omitempty"`
	ShippingAddress   ShopifyMailingAddress `json:"shippingAddress,omitempty"`
	Customer          ShopifyCustomer       `json:"customer,omitempty"`
	LineItems         []ShopifyLineItem     `json:"lineItems"`
	Fulfillments      []ShopifyFulfillment  `json:"fulfillments"`
}

type ShopifyMoney struct {
	Amount       string `json:"amount"`
	CurrencyCode string `json:"currencyCode"`
}

type ShopifyMailingAddress struct {
	Name         string   `json:"name,omitempty"`
	FirstName    string   `json:"firstName,omitempty"`
	LastName     string   `json:"lastName,omitempty"`
	Company      string   `json:"company,omitempty"`
	Address1     string   `json:"address1,omitempty"`
	Address2     string   `json:"address2,omitempty"`
	City         string   `json:"city,omitempty"`
	Province     string   `json:"province,omitempty"`
	ProvinceCode string   `json:"provinceCode,omitempty"`
	Country      string   `json:"country,omitempty"`
	CountryCode  string   `json:"countryCode,omitempty"`
	Zip          string   `json:"zip,omitempty"`
	Phone        string   `json:"phone,omitempty"`
	Formatted    []string `json:"formatted,omitempty"`
}

type ShopifyCustomer struct {
	ID             string            `json:"id,omitempty"`
	DisplayName    string            `json:"displayName,omitempty"`
	Email          string            `json:"email,omitempty"`
	Phone          string            `json:"phone,omitempty"`
	CreatedAt      string            `json:"createdAt,omitempty"`
	TotalSpent     ShopifyMoney      `json:"totalSpent,omitempty"`
	DefaultAddress string            `json:"defaultAddress,omitempty"`
	LastOrder      *ShopifyLastOrder `json:"lastOrder,omitempty"`
}

type ShopifyLastOrder struct {
	ID                string                `json:"id,omitempty"`
	LegacyResourceID  string                `json:"legacyResourceId,omitempty"`
	Name              string                `json:"name,omitempty"`
	AdminURL          string                `json:"adminUrl,omitempty"`
	Email             string                `json:"email,omitempty"`
	SourceName        string                `json:"sourceName,omitempty"`
	CreatedAt         string                `json:"createdAt,omitempty"`
	FinancialStatus   string                `json:"financialStatus,omitempty"`
	FulfillmentStatus string                `json:"fulfillmentStatus,omitempty"`
	PaymentGateways   []string              `json:"paymentGatewayNames,omitempty"`
	Total             ShopifyMoney          `json:"total,omitempty"`
	Subtotal          ShopifyMoney          `json:"subtotal,omitempty"`
	ProductSubtotal   ShopifyMoney          `json:"productSubtotal,omitempty"`
	Shipping          ShopifyMoney          `json:"shipping,omitempty"`
	AdditionalFees    ShopifyMoney          `json:"additionalServiceFees,omitempty"`
	ShippingAddress   ShopifyMailingAddress `json:"shippingAddress,omitempty"`
	LineItems         []ShopifyLineItem     `json:"lineItems,omitempty"`
	Fulfillments      []ShopifyFulfillment  `json:"fulfillments,omitempty"`
}

type ShopifyLineItem struct {
	Name             string       `json:"name"`
	Quantity         int          `json:"quantity"`
	SKU              string       `json:"sku,omitempty"`
	VariantTitle     string       `json:"variantTitle,omitempty"`
	RequiresShipping bool         `json:"requiresShipping"`
	DiscountedTotal  ShopifyMoney `json:"discountedTotal,omitempty"`
}

type ShopifyFulfillment struct {
	ID            string                `json:"id,omitempty"`
	Status        string                `json:"status,omitempty"`
	DisplayStatus string                `json:"displayStatus,omitempty"`
	CreatedAt     string                `json:"createdAt,omitempty"`
	UpdatedAt     string                `json:"updatedAt,omitempty"`
	DeliveredAt   string                `json:"deliveredAt,omitempty"`
	TrackingInfo  []ShopifyTrackingInfo `json:"trackingInfo,omitempty"`
}

type ShopifyTrackingInfo struct {
	Company string `json:"company,omitempty"`
	Number  string `json:"number,omitempty"`
	URL     string `json:"url,omitempty"`
}

type shopifyGraphQLResponse struct {
	Data   shopifyOrdersData `json:"data"`
	Errors []struct {
		Message string `json:"message"`
	} `json:"errors"`
}

type shopifyOrdersData struct {
	Orders struct {
		Edges []struct {
			Cursor string           `json:"cursor"`
			Node   shopifyOrderNode `json:"node"`
		} `json:"edges"`
		PageInfo struct {
			HasNextPage bool   `json:"hasNextPage"`
			EndCursor   string `json:"endCursor"`
		} `json:"pageInfo"`
	} `json:"orders"`
}

type shopifyOrderNode struct {
	ID                       string      `json:"id"`
	LegacyResourceID         json.Number `json:"legacyResourceId"`
	Name                     string      `json:"name"`
	Email                    string      `json:"email"`
	SourceName               string      `json:"sourceName"`
	CreatedAt                string      `json:"createdAt"`
	UpdatedAt                string      `json:"updatedAt"`
	CancelledAt              string      `json:"cancelledAt"`
	DisplayFinancialStatus   string      `json:"displayFinancialStatus"`
	DisplayFulfillmentStatus string      `json:"displayFulfillmentStatus"`
	PaymentGatewayNames      []string    `json:"paymentGatewayNames"`
	CurrentTotalPriceSet     struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentTotalPriceSet"`
	CurrentSubtotalPriceSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentSubtotalPriceSet"`
	CurrentShippingPriceSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentShippingPriceSet"`
	CurrentTotalAdditionalFeesSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentTotalAdditionalFeesSet"`
	ShippingAddress *ShopifyMailingAddress         `json:"shippingAddress"`
	Customer        *shopifyCustomerNode           `json:"customer"`
	LineItems       shopifyOrderLineItemConnection `json:"lineItems"`
	Fulfillments    []ShopifyFulfillment           `json:"fulfillments"`
}

type shopifyOrderLineItemConnection struct {
	PageInfo struct {
		HasNextPage bool   `json:"hasNextPage"`
		EndCursor   string `json:"endCursor"`
	} `json:"pageInfo"`
	Edges []struct {
		Node shopifyLineItemNode `json:"node"`
	} `json:"edges"`
}

type shopifyCustomerNode struct {
	ID                  string `json:"id"`
	DisplayName         string `json:"displayName"`
	CreatedAt           string `json:"createdAt"`
	DefaultEmailAddress *struct {
		EmailAddress string `json:"emailAddress"`
	} `json:"defaultEmailAddress"`
	DefaultPhoneNumber *struct {
		PhoneNumber string `json:"phoneNumber"`
	} `json:"defaultPhoneNumber"`
	AmountSpent    ShopifyMoney `json:"amountSpent"`
	DefaultAddress *struct {
		FormattedArea string `json:"formattedArea"`
	} `json:"defaultAddress"`
	LastOrder *shopifyLastOrderNode `json:"lastOrder"`
}

type shopifyLastOrderNode struct {
	ID                       string      `json:"id"`
	LegacyResourceID         json.Number `json:"legacyResourceId"`
	Name                     string      `json:"name"`
	Email                    string      `json:"email"`
	SourceName               string      `json:"sourceName"`
	CreatedAt                string      `json:"createdAt"`
	DisplayFinancialStatus   string      `json:"displayFinancialStatus"`
	DisplayFulfillmentStatus string      `json:"displayFulfillmentStatus"`
	PaymentGatewayNames      []string    `json:"paymentGatewayNames"`
	CurrentTotalPriceSet     struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentTotalPriceSet"`
	CurrentSubtotalPriceSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentSubtotalPriceSet"`
	CurrentShippingPriceSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentShippingPriceSet"`
	CurrentTotalAdditionalFeesSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"currentTotalAdditionalFeesSet"`
	ShippingAddress *ShopifyMailingAddress         `json:"shippingAddress"`
	LineItems       shopifyOrderLineItemConnection `json:"lineItems"`
	Fulfillments    []ShopifyFulfillment           `json:"fulfillments"`
}

type shopifyLineItemNode struct {
	Name               string `json:"name"`
	ID                 string `json:"id"`
	Title              string `json:"title"`
	Quantity           int    `json:"quantity"`
	SKU                string `json:"sku"`
	VariantTitle       string `json:"variantTitle"`
	RequiresShipping   bool   `json:"requiresShipping"`
	DiscountedTotalSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"discountedTotalSet"`
	OriginalUnitPriceSet struct {
		PresentmentMoney ShopifyMoney `json:"presentmentMoney"`
	} `json:"originalUnitPriceSet"`
	Product *struct {
		ID string `json:"id"`
	} `json:"product"`
	Variant *struct {
		ID            string `json:"id"`
		InventoryItem *struct {
			ID string `json:"id"`
		} `json:"inventoryItem"`
	} `json:"variant"`
}

func (s *Server) handleShopifyOrderSearch(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !userHasAnyPermission(user, PermissionWorkbenchAccess, PermissionOrdersView, PermissionOrdersRefund, PermissionOrdersDisputes) {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "order view permission is required"})
		return
	}
	if !s.requireWorkbenchOrModuleShopAccess(w, r, user, DataScopeOrders, shopID) {
		return
	}
	shop, err := s.store.GetShop(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return
	}
	if shop.Status != ShopStatusActive {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{
			"error": "Shopify API is disabled because this shop is disabled",
		})
		return
	}
	sources, err := s.store.ListShopSources(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return
	}
	domain := shopifyDomainForShop(shop, sources)
	token := ""
	if !s.localDemo {
		token = s.shopifyAdminToken(r.Context(), domain)
	}
	if domain == "" || (!s.localDemo && token == "") {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{
			"error": "Shopify API is not configured for this shop",
		})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	if query == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "query is required"})
		return
	}
	result, err := s.searchShopifyOrdersCached(r.Context(), shopID, domain, token, query, 5)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) searchShopifyOrdersCached(ctx context.Context, shopID string, domain string, token string, query string, limit int) (ShopifyOrderSearchResult, error) {
	query = strings.TrimSpace(query)
	cacheIdentity := fmt.Sprintf("%d|%s", limit, query)
	cacheKey := externalCacheKey(shopifyOrderCacheNamespace, shopID, cacheIdentity)
	var cached ShopifyOrderSearchResult
	if s.loadExternalCache(ctx, cacheKey, &cached) {
		normalizeShopifyOrderSearchResultTrackingURLs(&cached)
		return cached, nil
	}
	search := s.publicShopifyOrderSearch
	if search == nil {
		search = (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).SearchOrders
	}
	result, err := search(ctx, domain, token, query, limit)
	if err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	normalizeShopifyOrderSearchResultTrackingURLs(&result)
	s.saveExternalCache(ctx, shopifyOrderCacheNamespace, shopID, cacheKey, result, shopifyOrderCacheTTL)
	return result, nil
}

func (s *Server) handleShopifyConnectionStatus(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !s.requireWorkbenchOrModuleShopAccess(w, r, user, DataScopeShops, shopID) {
		return
	}
	status, err := s.refreshShopifyConnectionStatus(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, status)
}

func (s *Server) refreshShopifyConnectionStatus(ctx context.Context, shopID string) (ShopifyConnectionStatus, error) {
	shop, err := s.store.GetShop(ctx, shopID)
	if err != nil {
		return ShopifyConnectionStatus{}, err
	}
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return ShopifyConnectionStatus{}, err
	}
	domain := shopifyDomainForShop(shop, sources)
	if isERPManagedShopifySource(sources) {
		return s.refreshERPManagedShopifyConnectionStatus(ctx, shop, domain)
	}
	status := ShopifyConnectionStatus{ShopDomain: domain}
	token := ""
	switch {
	case domain == "":
		status.State = "not_configured"
		status.Message = "Shopify domain is not configured"
	default:
		token = s.shopifyAdminToken(ctx, domain)
		if token == "" {
			status.State = "not_installed"
			status.Message = "No Shopify app authorization is stored"
		} else {
			status = s.checkShopifyConnection(ctx, domain, token)
			if status.ShopDomain == "" {
				status.ShopDomain = domain
			}
		}
	}
	status, _, err = s.finalizeShopifyConnectionStatus(ctx, shop, domain, token, status)
	return status, err
}

func (s *Server) finalizeShopifyConnectionStatus(ctx context.Context, shop Shop, domain string, token string, status ShopifyConnectionStatus) (ShopifyConnectionStatus, ShopSource, error) {
	status.CheckedAt = time.Now().UTC()
	profile, profileErr := s.store.GetShopifyAppProfile(ctx, shop.ID)
	if profileErr == nil {
		status.AppDeployStatus = profile.DeployStatus
		status.AppDeployVersion = profile.DeployVersion
	}
	if status.State == "installed" {
		installation, _ := s.store.GetShopifyInstallationByDomain(ctx, domain)
		status.Scope = installation.Scope
		if updatedShop, updated, err := s.syncShopifyDisplayName(ctx, shop, domain, status.ShopName); err != nil {
			status.Message = "Shopify connection verified, but the store name could not be saved"
		} else if updated {
			shop = updatedShop
			s.broadcast(Event{Type: "shop.updated", ShopID: shop.ID, EntityID: shop.ID, Payload: shop, CreatedAt: time.Now().UTC()})
		}
		if profileErr != nil {
			status.ThemeEmbedState = shopifyThemeEmbedUnavailable
			status.ThemeEmbedMessage = "Shopify App internal version is not configured"
		} else if profile.DeployStatus != ShopifyAppDeployReady {
			status.ThemeEmbedState = shopifyThemeEmbedUnavailable
			status.ThemeEmbedMessage = "Shopify App internal version is not published"
		} else {
			status.ThemeEmbedState, status.ThemeEmbedMessage = s.checkShopifyThemeEmbed(
				ctx, domain, token, installation.Scope, profile.ExtensionHandle,
			)
		}
	}
	source, err := s.persistShopifyConnectionStatus(ctx, shop.ID, status)
	return status, source, err
}

func (s *Server) persistShopifyConnectionStatus(ctx context.Context, shopID string, status ShopifyConnectionStatus) (ShopSource, error) {
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return ShopSource{}, err
	}
	for _, source := range sources {
		if source.Type != SourceTypeShopifyAPI {
			continue
		}
		updated, err := s.store.MutateShopSourceMetadata(ctx, shopID, source.ID, func(metadata map[string]string) map[string]string {
			metadata[shopifyConnectionStateKey] = status.State
			metadata[shopifyConnectionCheckedAtKey] = status.CheckedAt.UTC().Format(time.RFC3339)
			setOrDeleteMetadata(metadata, shopifyConnectionMessageKey, status.Message)
			setOrDeleteMetadata(metadata, shopifyConnectionShopNameKey, status.ShopName)
			setOrDeleteMetadata(metadata, shopifyThemeEmbedStateKey, status.ThemeEmbedState)
			setOrDeleteMetadata(metadata, shopifyThemeEmbedMessageKey, status.ThemeEmbedMessage)
			setOrDeleteMetadata(metadata, shopifyAppDeployStatusKey, status.AppDeployStatus)
			setOrDeleteMetadata(metadata, shopifyAppDeployVersionKey, status.AppDeployVersion)
			switch status.State {
			case "installed":
				metadata["apiStatus"] = "connected"
			case "not_installed":
				metadata["apiStatus"] = "invalid_token"
			case "not_configured":
				metadata["apiStatus"] = "not_configured"
			default:
				metadata["apiStatus"] = "verification_failed"
			}
			return metadata
		})
		if err != nil {
			return ShopSource{}, err
		}
		s.broadcast(Event{Type: "source.updated", ShopID: shopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
		return updated, nil
	}
	return ShopSource{}, nil
}

func setOrDeleteMetadata(metadata map[string]string, key string, value string) {
	if value = strings.TrimSpace(value); value != "" {
		metadata[key] = value
		return
	}
	delete(metadata, key)
}

func (s *Server) recordShopifyAPIError(ctx context.Context, shopID string, err error) {
	if !isShopifyAuthorizationError(err) {
		return
	}
	sources, listErr := s.store.ListShopSources(ctx, shopID)
	if listErr != nil {
		return
	}
	for _, source := range sources {
		if source.Type == SourceTypeShopifyAPI && source.Metadata["apiStatus"] == "invalid_token" {
			return
		}
	}
	_, _ = s.persistShopifyConnectionStatus(ctx, shopID, ShopifyConnectionStatus{
		State: "not_installed", Message: "Shopify rejected the stored authorization", CheckedAt: time.Now().UTC(),
	})
}

func (s *Server) checkShopifyConnection(ctx context.Context, shopDomain string, accessToken string) ShopifyConnectionStatus {
	if s.shopifyConnectionChecker != nil {
		return s.shopifyConnectionChecker(ctx, shopDomain, accessToken)
	}
	return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).CheckConnection(ctx, shopDomain, accessToken)
}

func (s *Server) checkShopifyThemeEmbed(ctx context.Context, shopDomain string, accessToken string, grantedScopes string, extensionHandle string) (string, string) {
	if strings.TrimSpace(grantedScopes) != "" && !shopifyScopeIncludes(grantedScopes, shopifyThemeReadScope) {
		return shopifyThemeEmbedPermission, "Reauthorize the Shopify app to grant read_themes"
	}
	return (shopifyAdminClient{HTTPClient: &http.Client{Timeout: 15 * time.Second}}).CheckThemeEmbed(
		ctx, shopDomain, accessToken, extensionHandle,
	)
}

func shopifyScopeIncludes(scopes string, expected string) bool {
	expected = strings.ToLower(strings.TrimSpace(expected))
	granted := make(map[string]struct{})
	for _, scope := range strings.FieldsFunc(strings.ToLower(scopes), func(r rune) bool {
		return r == ',' || r == ' ' || r == '\t' || r == '\n'
	}) {
		granted[strings.TrimSpace(scope)] = struct{}{}
	}
	if _, ok := granted[expected]; ok {
		return true
	}
	if strings.HasPrefix(expected, "read_") {
		_, ok := granted["write_"+strings.TrimPrefix(expected, "read_")]
		return ok
	}
	return false
}

func (s *Server) syncShopifyDisplayName(ctx context.Context, shop Shop, shopDomain string, shopName string) (Shop, bool, error) {
	shopName = strings.TrimSpace(shopName)
	if shopName == "" || !shopDisplayNameIsShopifyAddress(shop.DisplayName, shopDomain) {
		return shop, false, nil
	}
	updated, err := s.store.UpdateShop(ctx, shop.ID, Shop{
		DisplayName: shopName,
		Platform:    shop.Platform,
		ExternalID:  shop.ExternalID,
		Status:      shop.Status,
		Metadata:    shop.Metadata,
	})
	if err != nil {
		return shop, false, err
	}
	return updated, true, nil
}

func shopDisplayNameIsShopifyAddress(displayName string, shopDomain string) bool {
	displayName = strings.TrimSpace(strings.ToLower(displayName))
	displayName = strings.TrimPrefix(displayName, "https://")
	displayName = strings.TrimPrefix(displayName, "http://")
	displayName = strings.TrimSuffix(displayName, "/")
	normalizedDomain := normalizeShopifyDomain(shopDomain)
	shopHandle := strings.TrimSuffix(normalizedDomain, ".myshopify.com")
	return displayName != "" && (displayName == normalizedDomain || displayName == shopHandle)
}

type shopifyAdminClient struct {
	HTTPClient        *http.Client
	BaseURL           string
	StorefrontBaseURL string
}

func (c shopifyAdminClient) CheckConnection(ctx context.Context, shopDomain string, accessToken string) ShopifyConnectionStatus {
	shopDomain = normalizeShopifyDomain(shopDomain)
	status := ShopifyConnectionStatus{ShopDomain: shopDomain}
	if shopDomain == "" || strings.TrimSpace(accessToken) == "" {
		status.State = "not_installed"
		status.Message = "Shopify app authorization is missing"
		return status
	}
	endpoint := c.BaseURL
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s/admin/api/%s/graphql.json", shopDomain, shopifyAPIVersion())
	}
	raw, err := json.Marshal(map[string]string{"query": `query XzdeskConnection { shop { id name myshopifyDomain } currentAppInstallation { id } }`})
	if err != nil {
		status.State = "unknown"
		status.Message = "Could not prepare Shopify verification"
		return status
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		status.State = "unknown"
		status.Message = "Could not create Shopify verification request"
		return status
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		status.State = "unknown"
		status.Message = "Could not reach Shopify"
		return status
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		status.State = "unknown"
		status.Message = "Could not read Shopify verification response"
		return status
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		status.State = "not_installed"
		status.Message = "Shopify no longer accepts this app authorization"
		return status
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		status.State = "unknown"
		status.Message = fmt.Sprintf("Shopify verification returned %d", resp.StatusCode)
		return status
	}
	var parsed struct {
		Data struct {
			Shop struct {
				ID              string `json:"id"`
				Name            string `json:"name"`
				MyshopifyDomain string `json:"myshopifyDomain"`
			} `json:"shop"`
			CurrentAppInstallation *struct {
				ID string `json:"id"`
			} `json:"currentAppInstallation"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		status.State = "unknown"
		status.Message = "Shopify verification response was invalid"
		return status
	}
	if len(parsed.Errors) > 0 {
		status.State = "unknown"
		status.Message = parsed.Errors[0].Message
		return status
	}
	status.ShopName = parsed.Data.Shop.Name
	status.ShopifyStoreID = strings.TrimSpace(parsed.Data.Shop.ID)
	if domain := normalizeShopifyDomain(parsed.Data.Shop.MyshopifyDomain); domain != "" {
		status.ShopDomain = domain
	}
	if parsed.Data.CurrentAppInstallation == nil || strings.TrimSpace(parsed.Data.CurrentAppInstallation.ID) == "" {
		status.State = "not_installed"
		status.Message = "Shopify did not report an active app installation"
		return status
	}
	status.State = "installed"
	return status
}

const shopifyThemeEmbedQuery = `
query XzdeskThemeEmbed {
  themes(first: 1, roles: [MAIN]) {
    nodes {
      files(first: 1, filenames: ["config/settings_data.json"]) {
        nodes {
          body {
            ... on OnlineStoreThemeFileBodyText { content }
          }
        }
      }
    }
  }
}`

func (c shopifyAdminClient) CheckThemeEmbed(ctx context.Context, shopDomain string, accessToken string, extensionHandle string) (string, string) {
	var result struct {
		Themes struct {
			Nodes []struct {
				Files struct {
					Nodes []struct {
						Body struct {
							Content string `json:"content"`
						} `json:"body"`
					} `json:"nodes"`
				} `json:"files"`
			} `json:"nodes"`
		} `json:"themes"`
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyThemeEmbedQuery, nil, &result); err != nil {
		message := strings.ToLower(err.Error())
		if strings.Contains(message, "read_themes") || strings.Contains(message, "access denied") || strings.Contains(message, "merchant approval") {
			return shopifyThemeEmbedPermission, "Reauthorize the Shopify app to grant read_themes"
		}
		return shopifyThemeEmbedUnavailable, "Could not inspect the published Shopify theme"
	}
	if len(result.Themes.Nodes) == 0 || len(result.Themes.Nodes[0].Files.Nodes) == 0 {
		return shopifyThemeEmbedUnavailable, "The published theme settings could not be read"
	}
	return parseShopifyThemeEmbedState(result.Themes.Nodes[0].Files.Nodes[0].Body.Content, extensionHandle)
}

func parseShopifyThemeEmbedState(settingsJSON string, extensionHandle string) (string, string) {
	var settings struct {
		Current struct {
			Blocks map[string]struct {
				Type     string `json:"type"`
				Disabled bool   `json:"disabled"`
			} `json:"blocks"`
		} `json:"current"`
	}
	if err := json.Unmarshal([]byte(stripShopifyThemeFileHeader(settingsJSON)), &settings); err != nil {
		return shopifyThemeEmbedUnavailable, "The published theme settings were invalid"
	}
	extensionHandle = strings.ToLower(strings.TrimSpace(extensionHandle))
	if extensionHandle == "" {
		extensionHandle = defaultShopifyExtensionHandle
	}
	blockPath := "/blocks/" + extensionHandle + "/"
	foundDisabled := false
	for _, block := range settings.Current.Blocks {
		blockType := strings.ToLower(strings.TrimSpace(block.Type))
		if !strings.HasPrefix(blockType, "shopify://apps/") || !strings.Contains(blockType, blockPath) {
			continue
		}
		if !block.Disabled {
			return shopifyThemeEmbedEnabled, ""
		}
		foundDisabled = true
	}
	if foundDisabled {
		return shopifyThemeEmbedDisabled, "The Xzdesk Chat app embed is disabled in the published theme"
	}
	return shopifyThemeEmbedNotAdded, "The Xzdesk Chat app embed has not been enabled in the published theme"
}

func stripShopifyThemeFileHeader(content string) string {
	content = strings.TrimSpace(strings.TrimPrefix(content, "\ufeff"))
	for strings.HasPrefix(content, "/*") {
		end := strings.Index(content[2:], "*/")
		if end < 0 {
			return content
		}
		content = strings.TrimSpace(content[end+4:])
	}
	return content
}

func (c shopifyAdminClient) SearchOrders(ctx context.Context, shopDomain string, accessToken string, searchQuery string, limit int) (ShopifyOrderSearchResult, error) {
	shopDomain = normalizeShopifyDomain(shopDomain)
	accessToken = strings.TrimSpace(accessToken)
	searchQuery = strings.TrimSpace(searchQuery)
	if shopDomain == "" {
		return ShopifyOrderSearchResult{}, fmt.Errorf("%w: shopify shop domain is required", ErrInvalid)
	}
	if accessToken == "" {
		return ShopifyOrderSearchResult{}, fmt.Errorf("%w: shopify access token is required", ErrInvalid)
	}
	if searchQuery == "" {
		return ShopifyOrderSearchResult{}, fmt.Errorf("%w: search query is required", ErrInvalid)
	}
	if limit <= 0 || limit > 20 {
		limit = 5
	}
	endpoint := c.BaseURL
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s/admin/api/%s/graphql.json", shopDomain, shopifyAPIVersion())
	}
	payload := map[string]any{
		"query": shopifyOrderSearchQuery,
		"variables": map[string]any{
			"query": searchQuery,
			"first": limit,
			"after": nil,
		},
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
	if err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ShopifyOrderSearchResult{}, &shopifyAdminHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	var parsed shopifyGraphQLResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	if len(parsed.Errors) > 0 {
		return ShopifyOrderSearchResult{}, fmt.Errorf("Shopify Admin API error: %s", parsed.Errors[0].Message)
	}
	if err := c.completeOrderSearchDetails(
		ctx,
		shopDomain,
		accessToken,
		&parsed.Data,
	); err != nil {
		return ShopifyOrderSearchResult{}, err
	}
	orders := make([]ShopifyOrderSummary, 0, len(parsed.Data.Orders.Edges))
	for _, edge := range parsed.Data.Orders.Edges {
		node := edge.Node
		legacyID := shopifyLegacyResourceID(node.LegacyResourceID, node.ID)
		order := ShopifyOrderSummary{
			ID:                node.ID,
			LegacyResourceID:  legacyID,
			Name:              node.Name,
			AdminURL:          shopifyAdminOrderURL(shopDomain, legacyID),
			Email:             node.Email,
			SourceName:        node.SourceName,
			CreatedAt:         node.CreatedAt,
			UpdatedAt:         node.UpdatedAt,
			FinancialStatus:   node.DisplayFinancialStatus,
			FulfillmentStatus: node.DisplayFulfillmentStatus,
			PaymentGateways:   append([]string(nil), node.PaymentGatewayNames...),
			Total:             node.CurrentTotalPriceSet.PresentmentMoney,
			Subtotal:          node.CurrentSubtotalPriceSet.PresentmentMoney,
			Shipping:          node.CurrentShippingPriceSet.PresentmentMoney,
			Fulfillments:      normalizeShopifyFulfillmentTrackingURLs(node.Fulfillments),
		}
		if order.Subtotal.Amount == "" {
			order.Subtotal = order.Total
		}
		if node.ShippingAddress != nil {
			order.ShippingAddress = *node.ShippingAddress
		}
		if node.Customer != nil {
			order.Customer = shopifyCustomerSummary(*node.Customer, shopDomain)
		}
		for _, item := range node.LineItems.Edges {
			order.LineItems = append(order.LineItems, shopifyLineItemSummary(item.Node))
		}
		order.ProductSubtotal, order.AdditionalFees = shopifyOrderAmountBreakdown(
			order.Subtotal,
			node.CurrentTotalAdditionalFeesSet.PresentmentMoney,
			order.LineItems,
		)
		orders = append(orders, order)
	}
	return ShopifyOrderSearchResult{Orders: orders}, nil
}

func (c shopifyAdminClient) completeOrderSearchDetails(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	data *shopifyOrdersData,
) error {
	for index := range data.Orders.Edges {
		order := &data.Orders.Edges[index].Node
		if len(order.Fulfillments) > shopifyOrderCatalogFulfillmentLimit {
			return errShopifyOrderCatalogFulfillmentsTruncated
		}
		if order.Customer != nil && order.Customer.LastOrder != nil &&
			len(order.Customer.LastOrder.Fulfillments) > shopifyOrderCatalogFulfillmentLimit {
			return errShopifyOrderCatalogFulfillmentsTruncated
		}
	}

	completed := make(map[string]shopifyOrderLineItemConnection)
	for index := range data.Orders.Edges {
		order := &data.Orders.Edges[index].Node
		if err := c.completeOrderSearchLineItems(
			ctx,
			shopDomain,
			accessToken,
			order.ID,
			&order.LineItems,
			completed,
		); err != nil {
			return err
		}
		if order.Customer == nil || order.Customer.LastOrder == nil {
			continue
		}
		lastOrder := order.Customer.LastOrder
		if err := c.completeOrderSearchLineItems(
			ctx,
			shopDomain,
			accessToken,
			lastOrder.ID,
			&lastOrder.LineItems,
			completed,
		); err != nil {
			return err
		}
	}
	return nil
}

func (c shopifyAdminClient) completeOrderSearchLineItems(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	orderID string,
	lineItems *shopifyOrderLineItemConnection,
	completed map[string]shopifyOrderLineItemConnection,
) error {
	if cached, ok := completed[orderID]; ok {
		*lineItems = cached
		return nil
	}
	order := shopifyOrderNode{ID: orderID, LineItems: *lineItems}
	if err := c.fetchRemainingOrderLineItems(ctx, shopDomain, accessToken, &order); err != nil {
		return err
	}
	*lineItems = order.LineItems
	completed[orderID] = order.LineItems
	return nil
}

func shopifyAPIVersion() string {
	if value := firstNonEmptyEnv("SHOPIFY_APP_API_VERSION", "SHOPIFY_API_VERSION"); value != "" {
		return value
	}
	return shopifyAdminAPIVersion
}

func shopifyCustomerSummary(node shopifyCustomerNode, shopDomain string) ShopifyCustomer {
	customer := ShopifyCustomer{
		ID:          node.ID,
		DisplayName: node.DisplayName,
		CreatedAt:   node.CreatedAt,
		TotalSpent:  node.AmountSpent,
	}
	if node.DefaultEmailAddress != nil {
		customer.Email = node.DefaultEmailAddress.EmailAddress
	}
	if node.DefaultPhoneNumber != nil {
		customer.Phone = node.DefaultPhoneNumber.PhoneNumber
	}
	if node.DefaultAddress != nil {
		customer.DefaultAddress = node.DefaultAddress.FormattedArea
	}
	if node.LastOrder != nil {
		customer.LastOrder = shopifyLastOrderSummary(*node.LastOrder, shopDomain)
	}
	return customer
}

func shopifyLastOrderSummary(node shopifyLastOrderNode, shopDomain string) *ShopifyLastOrder {
	legacyID := shopifyLegacyResourceID(node.LegacyResourceID, node.ID)
	order := &ShopifyLastOrder{
		ID:                node.ID,
		LegacyResourceID:  legacyID,
		Name:              node.Name,
		AdminURL:          shopifyAdminOrderURL(shopDomain, legacyID),
		Email:             node.Email,
		SourceName:        node.SourceName,
		CreatedAt:         node.CreatedAt,
		FinancialStatus:   node.DisplayFinancialStatus,
		FulfillmentStatus: node.DisplayFulfillmentStatus,
		PaymentGateways:   append([]string(nil), node.PaymentGatewayNames...),
		Total:             node.CurrentTotalPriceSet.PresentmentMoney,
		Subtotal:          node.CurrentSubtotalPriceSet.PresentmentMoney,
		Shipping:          node.CurrentShippingPriceSet.PresentmentMoney,
		Fulfillments:      normalizeShopifyFulfillmentTrackingURLs(node.Fulfillments),
	}
	if order.Subtotal.Amount == "" {
		order.Subtotal = order.Total
	}
	if node.ShippingAddress != nil {
		order.ShippingAddress = *node.ShippingAddress
	}
	for _, item := range node.LineItems.Edges {
		order.LineItems = append(order.LineItems, shopifyLineItemSummary(item.Node))
	}
	order.ProductSubtotal, order.AdditionalFees = shopifyOrderAmountBreakdown(
		order.Subtotal,
		node.CurrentTotalAdditionalFeesSet.PresentmentMoney,
		order.LineItems,
	)
	return order
}

func shopifyLineItemSummary(node shopifyLineItemNode) ShopifyLineItem {
	return ShopifyLineItem{
		Name:             node.Name,
		Quantity:         node.Quantity,
		SKU:              node.SKU,
		VariantTitle:     node.VariantTitle,
		RequiresShipping: node.RequiresShipping,
		DiscountedTotal:  node.DiscountedTotalSet.PresentmentMoney,
	}
}

var shopifyAdditionalServiceLineItemPattern = regexp.MustCompile(`(?i)(shipping|package|parcel|delivery|order)[\s_-]*(protection|insurance)|(?:protection|insurance)[\s_-]*(shipping|package|parcel|delivery|order)|运输保障|运输保险|包裹保障|包裹保险|运费险`)

func shopifyOrderAmountBreakdown(subtotal ShopifyMoney, officialFees ShopifyMoney, lineItems []ShopifyLineItem) (ShopifyMoney, ShopifyMoney) {
	additionalFees := officialFees
	if additionalFees.CurrencyCode == "" {
		additionalFees.CurrencyCode = subtotal.CurrencyCode
	}
	if additionalFees.Amount == "" {
		additionalFees.Amount = "0.00"
	}

	productSubtotal := subtotal
	serviceLineTotal := "0.00"
	for _, item := range lineItems {
		if !shopifyAdditionalServiceLineItemPattern.MatchString(strings.TrimSpace(item.Name)) {
			continue
		}
		itemCurrency := strings.TrimSpace(item.DiscountedTotal.CurrencyCode)
		if itemCurrency != "" && subtotal.CurrencyCode != "" && !strings.EqualFold(itemCurrency, subtotal.CurrencyCode) {
			continue
		}
		var ok bool
		serviceLineTotal, ok = shopifyDecimalAdd(serviceLineTotal, item.DiscountedTotal.Amount)
		if !ok {
			serviceLineTotal = "0.00"
			break
		}
	}
	if serviceLineTotal == "0.00" {
		return productSubtotal, additionalFees
	}

	productAmount, productOK := shopifyDecimalSubtractNonNegative(subtotal.Amount, serviceLineTotal)
	additionalAmount, additionalOK := shopifyDecimalAdd(additionalFees.Amount, serviceLineTotal)
	if !productOK || !additionalOK {
		return productSubtotal, additionalFees
	}
	productSubtotal.Amount = productAmount
	additionalFees.Amount = additionalAmount
	return productSubtotal, additionalFees
}

func shopifyDecimalAdd(left string, right string) (string, bool) {
	leftAmount, leftOK := new(big.Rat).SetString(strings.TrimSpace(left))
	rightAmount, rightOK := new(big.Rat).SetString(strings.TrimSpace(right))
	if !leftOK || !rightOK {
		return "", false
	}
	scale := max(shopifyDecimalScale(left), shopifyDecimalScale(right))
	return new(big.Rat).Add(leftAmount, rightAmount).FloatString(scale), true
}

func shopifyDecimalSubtractNonNegative(left string, right string) (string, bool) {
	leftAmount, leftOK := new(big.Rat).SetString(strings.TrimSpace(left))
	rightAmount, rightOK := new(big.Rat).SetString(strings.TrimSpace(right))
	if !leftOK || !rightOK || leftAmount.Cmp(rightAmount) < 0 {
		return "", false
	}
	scale := max(shopifyDecimalScale(left), shopifyDecimalScale(right))
	return new(big.Rat).Sub(leftAmount, rightAmount).FloatString(scale), true
}

func shopifyDecimalScale(value string) int {
	value = strings.TrimSpace(value)
	if dot := strings.IndexByte(value, '.'); dot >= 0 {
		return len(value) - dot - 1
	}
	return 0
}

func shopifyLegacyResourceID(value json.Number, gid string) string {
	if id := strings.TrimSpace(value.String()); id != "" {
		return id
	}
	matches := regexp.MustCompile(`(?:Order/|^)(\d{4,})$`).FindStringSubmatch(strings.TrimSpace(gid))
	if len(matches) == 2 {
		return matches[1]
	}
	return ""
}

func shopifyAdminOrderURL(shopDomain string, legacyID string) string {
	legacyID = strings.TrimSpace(legacyID)
	if legacyID == "" {
		return ""
	}
	handle := shopifyStoreHandle(shopDomain)
	if handle == "" {
		return ""
	}
	return fmt.Sprintf("https://admin.shopify.com/store/%s/orders/%s", handle, legacyID)
}

func shopifyStoreHandle(domain string) string {
	domain = normalizeShopifyDomain(domain)
	if domain == "" {
		return ""
	}
	if strings.HasSuffix(domain, ".myshopify.com") {
		return strings.TrimSuffix(domain, ".myshopify.com")
	}
	return strings.Split(domain, ".")[0]
}

func shopifyDomainForShop(shop Shop, sources []ShopSource) string {
	for _, value := range []string{
		shop.Metadata["shopifyDomain"],
		shop.ExternalID,
	} {
		if domain := normalizeShopifyDomain(value); domain != "" {
			return domain
		}
	}
	for _, source := range sources {
		if source.Type != SourceTypeShopifyAPI && source.Provider != "shopify_admin" {
			continue
		}
		for _, value := range []string{source.Metadata["shopifyDomain"], source.Address} {
			if domain := normalizeShopifyDomain(value); domain != "" {
				return domain
			}
		}
	}
	return ""
}

func (s *Server) shopifyAdminTokenForShop(ctx context.Context, shopID string, domain string) string {
	domain = normalizeShopifyDomain(domain)
	shopID = strings.TrimSpace(shopID)
	if domain == "" || shopID == "" {
		return ""
	}
	installation, err := s.store.GetShopifyInstallationByDomain(ctx, domain)
	if err != nil || strings.TrimSpace(installation.ShopID) != shopID ||
		normalizeShopifyDomain(installation.ShopDomain) != domain {
		return ""
	}
	token := strings.TrimSpace(installation.AccessToken)
	if !strings.HasPrefix(token, encryptedShopifyTokenPrefix) {
		return token
	}
	plain, decryptErr := decryptShopifyCredential(strings.TrimPrefix(token, encryptedShopifyTokenPrefix))
	if decryptErr != nil {
		return ""
	}
	return strings.TrimSpace(plain)
}

func (s *Server) shopifyAdminToken(ctx context.Context, domain string) string {
	domain = normalizeShopifyDomain(domain)
	if domain == "" {
		return ""
	}
	if installation, err := s.store.GetShopifyInstallationByDomain(ctx, domain); err == nil {
		token := strings.TrimSpace(installation.AccessToken)
		if !strings.HasPrefix(token, encryptedShopifyTokenPrefix) {
			return token
		}
		plain, decryptErr := decryptShopifyCredential(strings.TrimPrefix(token, encryptedShopifyTokenPrefix))
		if decryptErr != nil {
			return ""
		}
		return strings.TrimSpace(plain)
	}
	return shopifyAdminTokenForDomain(domain)
}

func shopifyAdminTokenForDomain(domain string) string {
	domain = normalizeShopifyDomain(domain)
	if domain == "" {
		return ""
	}
	key := "SHOPIFY_ADMIN_ACCESS_TOKEN_" + shopifyEnvKey(domain)
	if token := strings.TrimSpace(os.Getenv(key)); token != "" {
		return token
	}
	return strings.TrimSpace(os.Getenv("SHOPIFY_ADMIN_ACCESS_TOKEN"))
}

func normalizeShopifyDomain(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	value = strings.TrimPrefix(value, "https://")
	value = strings.TrimPrefix(value, "http://")
	value = strings.Trim(value, "/")
	if value == "" {
		return ""
	}
	if parsed, err := url.Parse("https://" + value); err == nil && parsed.Host == "admin.shopify.com" {
		segments := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		for index := 0; index+1 < len(segments); index++ {
			if segments[index] == "store" && strings.TrimSpace(segments[index+1]) != "" {
				return strings.TrimSpace(segments[index+1]) + ".myshopify.com"
			}
		}
		return ""
	}
	if parsed, err := url.Parse("https://" + value); err == nil {
		value = parsed.Host
	}
	if !strings.Contains(value, ".") {
		value += ".myshopify.com"
	}
	return value
}

func shopifyEnvKey(domain string) string {
	domain = normalizeShopifyDomain(domain)
	re := regexp.MustCompile(`[^A-Z0-9]+`)
	return strings.Trim(re.ReplaceAllString(strings.ToUpper(domain), "_"), "_")
}

const shopifyOrderSearchQuery = `
query SupportOrderSearch($query: String!, $first: Int!, $after: String) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    edges {
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
		currentTotalAdditionalFeesSet { presentmentMoney { amount currencyCode } }
        shippingAddress {
          name
          firstName
          lastName
          company
          address1
          address2
          city
          province
          provinceCode
          country
          countryCode: countryCodeV2
          zip
          phone
          formatted(withName: false)
        }
        customer {
          id
          displayName
          createdAt
          defaultEmailAddress { emailAddress }
          defaultPhoneNumber { phoneNumber }
          amountSpent { amount currencyCode }
          defaultAddress {
            formattedArea
          }
          lastOrder {
            id
            legacyResourceId
            name
            email
            sourceName
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            paymentGatewayNames
			currentTotalPriceSet { presentmentMoney { amount currencyCode } }
			currentSubtotalPriceSet { presentmentMoney { amount currencyCode } }
			currentShippingPriceSet { presentmentMoney { amount currencyCode } }
			currentTotalAdditionalFeesSet { presentmentMoney { amount currencyCode } }
            shippingAddress {
              name
              firstName
              lastName
              company
              address1
              address2
              city
              province
              provinceCode
              country
              countryCode: countryCodeV2
              zip
              phone
              formatted(withName: false)
            }
            lineItems(first: 10) {
              pageInfo { hasNextPage endCursor }
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
            fulfillments(first: 11) {
              id
              status
              displayStatus
              createdAt
              updatedAt
              deliveredAt
              trackingInfo {
                company
                number
                url
              }
            }
          }
        }
        lineItems(first: 10) {
          pageInfo { hasNextPage endCursor }
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
        fulfillments(first: 11) {
          id
          status
          displayStatus
          createdAt
          updatedAt
          deliveredAt
          trackingInfo {
            company
            number
            url
          }
        }
      }
    }
  }
}`
