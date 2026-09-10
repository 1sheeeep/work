package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const shopifyProductRecommendationTTL = 24 * time.Hour
const shopifyProductRecommendationCacheLimit = 500
const shopifyProductSearchCacheNamespace = "shopify_products_v1"
const shopifyProductSearchCacheTTL = 24 * time.Hour
const shopifyCustomerCacheNamespace = "shopify_customer_v4"
const shopifyCustomerCacheTTL = 24 * time.Hour

type ShopifyProductSearchResult struct {
	Products    []ShopifyProductSummary `json:"products"`
	SeedProduct *ShopifyProductSummary  `json:"seedProduct,omitempty"`
}

type ShopifyProductSummary struct {
	ID             string                  `json:"id"`
	Title          string                  `json:"title"`
	Handle         string                  `json:"handle"`
	OnlineStoreURL string                  `json:"onlineStoreUrl,omitempty"`
	ImageURL       string                  `json:"imageUrl,omitempty"`
	ImageAlt       string                  `json:"imageAlt,omitempty"`
	Variants       []ShopifyProductVariant `json:"variants"`
}

type ShopifyProductVariant struct {
	ID               string       `json:"id"`
	Title            string       `json:"title"`
	SKU              string       `json:"sku,omitempty"`
	AvailableForSale bool         `json:"availableForSale"`
	Price            ShopifyMoney `json:"price"`
}

type cachedShopifyProducts struct {
	Result    ShopifyProductSearchResult
	ExpiresAt time.Time
}

type ShopifyCustomerSearchResult struct {
	Customer *ShopifyCustomerProfile `json:"customer,omitempty"`
}

type ShopifyCustomerProfile struct {
	ID             string            `json:"id"`
	DisplayName    string            `json:"displayName,omitempty"`
	Email          string            `json:"email,omitempty"`
	Phone          string            `json:"phone,omitempty"`
	CreatedAt      string            `json:"createdAt,omitempty"`
	VerifiedEmail  bool              `json:"verifiedEmail"`
	Tags           []string          `json:"tags"`
	TotalSpent     ShopifyMoney      `json:"totalSpent,omitempty"`
	DefaultAddress string            `json:"defaultAddress,omitempty"`
	LastOrder      *ShopifyLastOrder `json:"lastOrder,omitempty"`
}

type shopifyProductsData struct {
	Shop struct {
		CurrencyCode string `json:"currencyCode"`
	} `json:"shop"`
	Products struct {
		Edges []struct {
			Node struct {
				ID             string `json:"id"`
				Title          string `json:"title"`
				Handle         string `json:"handle"`
				OnlineStoreURL string `json:"onlineStoreUrl"`
				FeaturedMedia  *struct {
					Preview *struct {
						Image *struct {
							URL     string `json:"url"`
							AltText string `json:"altText"`
						} `json:"image"`
					} `json:"preview"`
				} `json:"featuredMedia"`
				Variants struct {
					Edges []struct {
						Node struct {
							ID               string `json:"id"`
							Title            string `json:"title"`
							SKU              string `json:"sku"`
							AvailableForSale bool   `json:"availableForSale"`
							Price            string `json:"price"`
						} `json:"node"`
					} `json:"edges"`
				} `json:"variants"`
			} `json:"node"`
		} `json:"edges"`
	} `json:"products"`
}

type shopifyAjaxRecommendations struct {
	Products []struct {
		ID            int64           `json:"id"`
		Title         string          `json:"title"`
		Handle        string          `json:"handle"`
		URL           string          `json:"url"`
		FeaturedImage json.RawMessage `json:"featured_image"`
		Images        []string        `json:"images"`
		Variants      []struct {
			ID        int64  `json:"id"`
			Title     string `json:"title"`
			SKU       string `json:"sku"`
			Available bool   `json:"available"`
			Price     int64  `json:"price"`
		} `json:"variants"`
	} `json:"products"`
}

type shopifyCustomersData struct {
	Customers struct {
		Edges []struct {
			Node struct {
				ID                  string   `json:"id"`
				DisplayName         string   `json:"displayName"`
				CreatedAt           string   `json:"createdAt"`
				VerifiedEmail       bool     `json:"verifiedEmail"`
				Tags                []string `json:"tags"`
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
			} `json:"node"`
		} `json:"edges"`
	} `json:"customers"`
}

type shopifyCustomerData struct {
	Customer *struct {
		ID                  string `json:"id"`
		DisplayName         string `json:"displayName"`
		CreatedAt           string `json:"createdAt"`
		VerifiedEmail       bool   `json:"verifiedEmail"`
		DefaultEmailAddress *struct {
			EmailAddress string `json:"emailAddress"`
		} `json:"defaultEmailAddress"`
		DefaultPhoneNumber *struct {
			PhoneNumber string `json:"phoneNumber"`
		} `json:"defaultPhoneNumber"`
		DefaultAddress *struct {
			FormattedArea string `json:"formattedArea"`
		} `json:"defaultAddress"`
	} `json:"customer"`
}

func (s *Server) handleShopifyProductSearch(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	domain, token, ok := s.shopifyCatalogAccess(w, r, user, shopID)
	if !ok {
		return
	}
	if s.localDemo {
		writeJSONResponse(w, http.StatusOK, ShopifyProductSearchResult{
			Products: []ShopifyProductSummary{{
				ID:     "gid://shopify/Product/1001",
				Title:  "本地测试商品",
				Handle: "local-demo-product",
				Variants: []ShopifyProductVariant{{
					ID: "gid://shopify/ProductVariant/1001", Title: "默认规格",
					SKU: "DEMO-SKU-001", AvailableForSale: true,
					Price: ShopifyMoney{Amount: "60.00", CurrencyCode: "USD"},
				}},
			}},
		})
		return
	}
	query := strings.TrimSpace(r.URL.Query().Get("query"))
	client := shopifyAdminClient{HTTPClient: http.DefaultClient}
	var result ShopifyProductSearchResult
	var err error
	if query == "" {
		result, err = s.cachedNativeProductRecommendations(r.Context(), client, domain, token, r.URL.Query().Get("recommendForHandle"))
	} else {
		cacheKey := externalCacheKey(shopifyProductSearchCacheNamespace, shopID, query)
		if s.loadExternalCache(r.Context(), cacheKey, &result) {
			writeJSONResponse(w, http.StatusOK, result)
			return
		}
		result, err = client.SearchProducts(r.Context(), domain, token, query, 20)
		if err == nil {
			s.saveExternalCache(r.Context(), shopifyProductSearchCacheNamespace, shopID, cacheKey, result, shopifyProductSearchCacheTTL)
		}
	}
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeJSONResponse(w, http.StatusBadGateway, map[string]string{"error": "product search failed: " + err.Error()})
		return
	}
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) cachedNativeProductRecommendations(ctx context.Context, client shopifyAdminClient, domain string, token string, seedHandle string) (ShopifyProductSearchResult, error) {
	seedHandle = strings.TrimSpace(seedHandle)
	key := normalizeShopifyDomain(domain) + "|" + seedHandle
	if result, ok := s.cachedProductRecommendations(key); ok {
		return result, nil
	}

	value, err, _ := s.productRecommendationRun.Do(key, func() (any, error) {
		if result, ok := s.cachedProductRecommendations(key); ok {
			return result, nil
		}
		seed, err := client.RecommendationSeedProduct(ctx, domain, token, seedHandle)
		if err != nil {
			return ShopifyProductSearchResult{}, err
		}
		result := ShopifyProductSearchResult{SeedProduct: seed}
		if seed != nil {
			currencyCode := ""
			if len(seed.Variants) > 0 {
				currencyCode = seed.Variants[0].Price.CurrencyCode
			}
			recommendations, recommendationErr := client.RecommendedProducts(ctx, domain, seed.ID, currencyCode, 10)
			if recommendationErr != nil {
				return ShopifyProductSearchResult{}, recommendationErr
			}
			result.Products = recommendations.Products
		}
		s.cacheProductRecommendations(key, result)
		return result, nil
	})
	if err != nil {
		return ShopifyProductSearchResult{}, err
	}
	return value.(ShopifyProductSearchResult), nil
}

func (s *Server) cachedProductRecommendations(key string) (ShopifyProductSearchResult, bool) {
	s.productRecommendationsMu.Lock()
	defer s.productRecommendationsMu.Unlock()
	entry, ok := s.productRecommendations[key]
	if !ok || time.Now().After(entry.ExpiresAt) {
		delete(s.productRecommendations, key)
		return ShopifyProductSearchResult{}, false
	}
	return entry.Result, true
}

func (s *Server) cacheProductRecommendations(key string, result ShopifyProductSearchResult) {
	s.productRecommendationsMu.Lock()
	defer s.productRecommendationsMu.Unlock()
	now := time.Now()
	for cacheKey, entry := range s.productRecommendations {
		if now.After(entry.ExpiresAt) {
			delete(s.productRecommendations, cacheKey)
		}
	}
	for len(s.productRecommendations) >= shopifyProductRecommendationCacheLimit {
		var oldestKey string
		var oldestExpiry time.Time
		for cacheKey, entry := range s.productRecommendations {
			if oldestKey == "" || entry.ExpiresAt.Before(oldestExpiry) {
				oldestKey, oldestExpiry = cacheKey, entry.ExpiresAt
			}
		}
		delete(s.productRecommendations, oldestKey)
	}
	s.productRecommendations[key] = cachedShopifyProducts{Result: result, ExpiresAt: now.Add(shopifyProductRecommendationTTL)}
}

func (s *Server) handleShopifyCustomerSearch(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	domain, token, ok := s.shopifyCatalogAccess(w, r, user, shopID)
	if !ok {
		return
	}
	email := strings.TrimSpace(r.URL.Query().Get("email"))
	if email == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "customer lookup failed: email is required"})
		return
	}
	cacheKey := externalCacheKey(shopifyCustomerCacheNamespace, shopID, email)
	if cached, ok := s.loadShopifyCustomerCache(r.Context(), cacheKey); ok {
		writeJSONResponse(w, http.StatusOK, cached)
		return
	}
	lookup := s.shopifyCustomerSearch
	if lookup == nil {
		lookup = func(ctx context.Context, domain string, token string, email string) (ShopifyCustomerSearchResult, error) {
			return (shopifyAdminClient{HTTPClient: http.DefaultClient}).SearchCustomer(ctx, domain, token, email)
		}
	}
	result, err := lookup(r.Context(), domain, token, email)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeJSONResponse(w, http.StatusBadGateway, map[string]string{"error": "customer lookup failed: " + err.Error()})
		return
	}
	s.saveExternalCache(r.Context(), shopifyCustomerCacheNamespace, shopID, cacheKey, result, shopifyCustomerCacheTTL)
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) loadShopifyCustomerCache(ctx context.Context, cacheKey string) (ShopifyCustomerSearchResult, bool) {
	var cached ShopifyCustomerSearchResult
	if !s.loadExternalCache(ctx, cacheKey, &cached) {
		return ShopifyCustomerSearchResult{}, false
	}
	return cached, true
}

func (s *Server) shopifyCatalogAccess(w http.ResponseWriter, r *http.Request, user User, shopID string) (string, string, bool) {
	if !s.requireWorkbenchOrModuleShopAccess(w, r, user, DataScopeOrders, shopID) {
		return "", "", false
	}
	shop, err := s.store.GetShop(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return "", "", false
	}
	if shop.Status != ShopStatusActive {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "Shopify lookup failed: this shop is disabled"})
		return "", "", false
	}
	sources, err := s.store.ListShopSources(r.Context(), shopID)
	if err != nil {
		writeError(w, err)
		return "", "", false
	}
	domain := shopifyDomainForShop(shop, sources)
	if s.localDemo && domain != "" {
		return domain, "", true
	}
	token := s.shopifyAdminToken(r.Context(), domain)
	if domain == "" || token == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "Shopify lookup failed: API is not configured for this shop"})
		return "", "", false
	}
	return domain, token, true
}

func (c shopifyAdminClient) SearchProducts(ctx context.Context, shopDomain string, accessToken string, searchQuery string, limit int) (ShopifyProductSearchResult, error) {
	if limit <= 0 || limit > 50 {
		limit = 20
	}
	var data shopifyProductsData
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyProductSearchQuery, map[string]any{"query": strings.TrimSpace(searchQuery), "first": limit}, &data); err != nil {
		return ShopifyProductSearchResult{}, err
	}
	return ShopifyProductSearchResult{Products: shopifyProductsFromData(data)}, nil
}

func (c shopifyAdminClient) RecommendationSeedProduct(ctx context.Context, shopDomain string, accessToken string, handle string) (*ShopifyProductSummary, error) {
	query := "status:active"
	if handle = strings.TrimSpace(handle); handle != "" {
		query += " handle:" + handle
	}
	var data shopifyProductsData
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyRecommendationSeedQuery, map[string]any{"query": query}, &data); err != nil {
		return nil, err
	}
	products := shopifyProductsFromData(data)
	for index := range products {
		if products[index].OnlineStoreURL == "" || len(products[index].Variants) == 0 {
			continue
		}
		if handle == "" || products[index].Handle == handle {
			return &products[index], nil
		}
	}
	return nil, nil
}

func shopifyProductsFromData(data shopifyProductsData) []ShopifyProductSummary {
	products := make([]ShopifyProductSummary, 0, len(data.Products.Edges))
	for _, edge := range data.Products.Edges {
		node := edge.Node
		product := ShopifyProductSummary{ID: node.ID, Title: node.Title, Handle: node.Handle, OnlineStoreURL: node.OnlineStoreURL}
		if node.FeaturedMedia != nil && node.FeaturedMedia.Preview != nil && node.FeaturedMedia.Preview.Image != nil {
			product.ImageURL = node.FeaturedMedia.Preview.Image.URL
			product.ImageAlt = node.FeaturedMedia.Preview.Image.AltText
		}
		for _, variant := range node.Variants.Edges {
			product.Variants = append(product.Variants, ShopifyProductVariant{
				ID: variant.Node.ID, Title: variant.Node.Title, SKU: variant.Node.SKU,
				AvailableForSale: variant.Node.AvailableForSale,
				Price:            ShopifyMoney{Amount: variant.Node.Price, CurrencyCode: data.Shop.CurrencyCode},
			})
		}
		products = append(products, product)
	}
	return products
}

func (c shopifyAdminClient) RecommendedProducts(ctx context.Context, shopDomain string, productGID string, currencyCode string, limit int) (ShopifyProductSearchResult, error) {
	if limit <= 0 || limit > 10 {
		limit = 10
	}
	productID := strings.TrimPrefix(strings.TrimSpace(productGID), "gid://shopify/Product/")
	if parsedID, parseErr := strconv.ParseInt(productID, 10, 64); parseErr != nil || parsedID <= 0 {
		return ShopifyProductSearchResult{}, fmt.Errorf("%w: Shopify recommendation product ID is invalid", ErrInvalid)
	}
	baseURL := strings.TrimRight(c.StorefrontBaseURL, "/")
	if baseURL == "" {
		baseURL = "https://" + normalizeShopifyDomain(shopDomain)
	}
	endpoint, err := url.Parse(baseURL + "/recommendations/products.json")
	if err != nil {
		return ShopifyProductSearchResult{}, err
	}
	values := endpoint.Query()
	values.Set("product_id", productID)
	values.Set("limit", strconv.Itoa(limit))
	values.Set("intent", "related")
	endpoint.RawQuery = values.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return ShopifyProductSearchResult{}, err
	}
	req.Header.Set("Accept", "application/json")
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return ShopifyProductSearchResult{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return ShopifyProductSearchResult{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ShopifyProductSearchResult{}, fmt.Errorf("Shopify Product Recommendations API returned %d", resp.StatusCode)
	}
	var response shopifyAjaxRecommendations
	if err := json.Unmarshal(body, &response); err != nil {
		return ShopifyProductSearchResult{}, err
	}
	products := make([]ShopifyProductSummary, 0, len(response.Products))
	for _, item := range response.Products {
		product := ShopifyProductSummary{
			ID: "gid://shopify/Product/" + strconv.FormatInt(item.ID, 10), Title: item.Title, Handle: item.Handle,
			OnlineStoreURL: absoluteShopifyStorefrontURL(shopDomain, item.URL),
			ImageURL:       shopifyAjaxImageURL(item.FeaturedImage, item.Images),
			ImageAlt:       item.Title,
		}
		for _, variant := range item.Variants {
			product.Variants = append(product.Variants, ShopifyProductVariant{
				ID: "gid://shopify/ProductVariant/" + strconv.FormatInt(variant.ID, 10), Title: variant.Title, SKU: variant.SKU,
				AvailableForSale: variant.Available, Price: ShopifyMoney{Amount: shopifyAjaxMoneyAmount(variant.Price), CurrencyCode: currencyCode},
			})
		}
		if len(product.Variants) > 0 {
			products = append(products, product)
		}
	}
	return ShopifyProductSearchResult{Products: products}, nil
}

func absoluteShopifyStorefrontURL(shopDomain string, value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	if value == "" {
		return ""
	}
	return "https://" + normalizeShopifyDomain(shopDomain) + "/" + strings.TrimLeft(value, "/")
}

func shopifyAjaxImageURL(raw json.RawMessage, images []string) string {
	var value string
	if len(raw) > 0 && json.Unmarshal(raw, &value) == nil && value != "" {
		return normalizeShopifyImageURL(value)
	}
	var image struct {
		Src string `json:"src"`
	}
	if len(raw) > 0 && json.Unmarshal(raw, &image) == nil && image.Src != "" {
		return normalizeShopifyImageURL(image.Src)
	}
	if len(images) > 0 {
		return normalizeShopifyImageURL(images[0])
	}
	return ""
}

func normalizeShopifyImageURL(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "//") {
		return "https:" + value
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	return ""
}

func shopifyAjaxMoneyAmount(cents int64) string {
	sign := ""
	if cents < 0 {
		sign = "-"
		cents = -cents
	}
	return fmt.Sprintf("%s%d.%02d", sign, cents/100, cents%100)
}

func (c shopifyAdminClient) SearchCustomer(ctx context.Context, shopDomain string, accessToken string, email string) (ShopifyCustomerSearchResult, error) {
	email = strings.TrimSpace(email)
	var data shopifyCustomersData
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyCustomerSearchQuery, map[string]any{"query": shopifyExactEmailQuery(email)}, &data); err != nil {
		return ShopifyCustomerSearchResult{}, err
	}
	if len(data.Customers.Edges) == 0 {
		return ShopifyCustomerSearchResult{}, nil
	}
	node := data.Customers.Edges[0].Node
	customer := &ShopifyCustomerProfile{
		ID: node.ID, DisplayName: node.DisplayName,
		CreatedAt: node.CreatedAt, VerifiedEmail: node.VerifiedEmail, Tags: append([]string(nil), node.Tags...),
		TotalSpent: node.AmountSpent,
	}
	if node.DefaultEmailAddress != nil {
		customer.Email = node.DefaultEmailAddress.EmailAddress
	}
	if !strings.EqualFold(strings.TrimSpace(customer.Email), email) {
		return ShopifyCustomerSearchResult{}, nil
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
	return ShopifyCustomerSearchResult{Customer: customer}, nil
}

func (c shopifyAdminClient) GetCustomer(ctx context.Context, shopDomain string, accessToken string, customerID string) (ShopifyCustomerSearchResult, error) {
	customerID = strings.TrimSpace(customerID)
	if customerID == "" {
		return ShopifyCustomerSearchResult{}, fmt.Errorf("%w: Shopify customer ID is required", ErrInvalid)
	}
	if !strings.HasPrefix(customerID, "gid://") {
		customerID = "gid://shopify/Customer/" + customerID
	}
	var data shopifyCustomerData
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyCustomerByIDQuery, map[string]any{"id": customerID}, &data); err != nil {
		return ShopifyCustomerSearchResult{}, err
	}
	if data.Customer == nil {
		return ShopifyCustomerSearchResult{}, nil
	}
	node := data.Customer
	profile := &ShopifyCustomerProfile{ID: node.ID, DisplayName: node.DisplayName, CreatedAt: node.CreatedAt, VerifiedEmail: node.VerifiedEmail}
	if node.DefaultEmailAddress != nil {
		profile.Email = node.DefaultEmailAddress.EmailAddress
	}
	if node.DefaultPhoneNumber != nil {
		profile.Phone = node.DefaultPhoneNumber.PhoneNumber
	}
	if node.DefaultAddress != nil {
		profile.DefaultAddress = node.DefaultAddress.FormattedArea
	}
	return ShopifyCustomerSearchResult{Customer: profile}, nil
}

func shopifyExactEmailQuery(email string) string {
	escaped := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(strings.TrimSpace(email))
	return `email:"` + escaped + `"`
}

func (c shopifyAdminClient) queryAdminGraphQL(ctx context.Context, shopDomain string, accessToken string, query string, variables map[string]any, out any) error {
	shopDomain = normalizeShopifyDomain(shopDomain)
	accessToken = strings.TrimSpace(accessToken)
	if shopDomain == "" || accessToken == "" {
		return fmt.Errorf("%w: Shopify shop domain and access token are required", ErrInvalid)
	}
	payload, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return err
	}
	endpoint := c.BaseURL
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s/admin/api/%s/graphql.json", shopDomain, shopifyAPIVersion())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Second}
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &shopifyAdminHTTPError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}
	var envelope struct {
		Data   json.RawMessage `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return err
	}
	if len(envelope.Errors) > 0 {
		return fmt.Errorf("Shopify Admin API error: %s", envelope.Errors[0].Message)
	}
	return json.Unmarshal(envelope.Data, out)
}

const shopifyProductSearchQuery = `
query SupportProductSearch($query: String!, $first: Int!) {
  shop { currencyCode }
  products(first: $first, query: $query, sortKey: TITLE) {
    edges {
      node {
        id
        title
        handle
        onlineStoreUrl
        featuredMedia { preview { image { url altText } } }
        variants(first: 20) {
          edges { node { id title sku availableForSale price } }
        }
      }
    }
  }
}`

const shopifyRecommendationSeedQuery = `
query SupportRecommendationSeed($query: String!) {
  shop { currencyCode }
  products(first: 10, query: $query, sortKey: UPDATED_AT, reverse: true) {
    edges {
      node {
      id
      title
      handle
      onlineStoreUrl
      featuredMedia { preview { image { url altText } } }
      variants(first: 20) {
        edges { node { id title sku availableForSale price } }
      }
      }
    }
  }
}`

const shopifyCustomerSearchQuery = `
query SupportCustomerSearch($query: String!) {
  customers(first: 1, query: $query) {
    edges {
      node {
        id
        displayName
        createdAt
        verifiedEmail
        tags
        defaultEmailAddress { emailAddress }
        defaultPhoneNumber { phoneNumber }
        amountSpent { amount currencyCode }
        defaultAddress { formattedArea }
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
  }
}`

const shopifyCustomerByIDQuery = `
query SupportCustomerByID($id: ID!) {
  customer(id: $id) {
    id
    displayName
    createdAt
    verifiedEmail
    defaultEmailAddress { emailAddress }
    defaultPhoneNumber { phoneNumber }
    defaultAddress { formattedArea }
  }
}`
