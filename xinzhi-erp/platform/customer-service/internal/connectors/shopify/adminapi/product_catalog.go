package adminapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const responseLimit = 4 << 20

var errProductVariantsIncomplete = errors.New("Shopify product variant pagination is incomplete")

type Client struct {
	apiVersion string
	baseURL    string
	httpClient *http.Client
	now        func() time.Time
}

type providerGraphQLError struct {
	code      string
	typeName  string
	fieldName string
}

func (*providerGraphQLError) Error() string {
	return "Shopify Admin API response is invalid"
}

func (e *providerGraphQLError) SafeDiagnostic() string {
	parts := []string{"graphql"}
	for _, value := range []string{e.code, e.typeName, e.fieldName} {
		if token := safeDiagnosticToken(value); token != "" {
			parts = append(parts, token)
		}
	}
	return strings.Join(parts, "_")
}

const shopIdentityQuery = `query XZERPShopIdentity {
  shop {
    name
    myshopifyDomain
  }
}`

func (c *Client) FetchShopIdentity(
	ctx context.Context,
	shopDomain string,
	accessToken string,
) (shopifyconnector.ShopIdentity, error) {
	if c == nil || c.httpClient == nil {
		return shopifyconnector.ShopIdentity{}, errors.New("Shopify Admin API client is unavailable")
	}
	var data struct {
		Shop *shopifyconnector.ShopIdentity `json:"shop"`
	}
	if err := c.queryGraphQL(ctx, shopDomain, accessToken, shopIdentityQuery, map[string]any{}, &data); err != nil {
		return shopifyconnector.ShopIdentity{}, err
	}
	if data.Shop == nil {
		return shopifyconnector.ShopIdentity{}, errors.New("Shopify Admin API shop identity response is invalid")
	}
	identity := shopifyconnector.ShopIdentity{
		Name:            strings.TrimSpace(data.Shop.Name),
		MyshopifyDomain: strings.TrimSpace(strings.ToLower(data.Shop.MyshopifyDomain)),
	}
	if shopifyconnector.ValidateShopIdentity(identity) != nil {
		return shopifyconnector.ShopIdentity{}, errors.New("Shopify Admin API shop identity response is invalid")
	}
	return identity, nil
}

func NewClient(apiVersion string, httpClient *http.Client) (*Client, error) {
	return newClient(apiVersion, "", httpClient)
}

func newClient(apiVersion string, baseURL string, httpClient *http.Client) (*Client, error) {
	apiVersion = strings.TrimSpace(apiVersion)
	baseURL = strings.TrimSpace(baseURL)
	if !validAPIVersion(apiVersion) || httpClient == nil {
		return nil, errors.New("Shopify Admin API client configuration is invalid")
	}
	if baseURL != "" {
		parsed, err := url.Parse(baseURL)
		if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
			return nil, errors.New("Shopify Admin API client configuration is invalid")
		}
	}
	clientCopy := *httpClient
	if clientCopy.Timeout <= 0 || clientCopy.Timeout > 60*time.Second {
		clientCopy.Timeout = 20 * time.Second
	}
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &Client{apiVersion: apiVersion, baseURL: baseURL, httpClient: &clientCopy, now: time.Now}, nil
}

func (c *Client) FetchProductCatalogPage(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	request shopifyconnector.ProductCatalogPageRequest,
) (shopifyconnector.ProductCatalogPage, error) {
	if err := shopifyconnector.ValidateProductCatalogPageRequest(request); err != nil {
		return shopifyconnector.ProductCatalogPage{}, err
	}
	if c == nil || c.httpClient == nil || c.now == nil {
		return shopifyconnector.ProductCatalogPage{}, errors.New("Shopify Admin API client is unavailable")
	}
	var data productCatalogData
	variables := map[string]any{"first": request.Limit}
	if cursor := strings.TrimSpace(request.Cursor); cursor != "" {
		variables["after"] = cursor
	}
	if query := strings.TrimSpace(request.Query); query != "" {
		variables["query"] = query
	}
	if err := c.queryGraphQL(ctx, shopDomain, accessToken, productCatalogPageQuery, variables, &data); err != nil {
		return shopifyconnector.ProductCatalogPage{}, err
	}
	if data.Shop == nil || !validCurrencyCode(data.Shop.CurrencyCode) ||
		data.Products == nil || data.Products.PageInfo == nil || data.Products.Edges == nil {
		return shopifyconnector.ProductCatalogPage{}, errors.New("Shopify Admin API product response is invalid")
	}
	for index := range *data.Products.Edges {
		if (*data.Products.Edges)[index].Node.Variants == nil ||
			(*data.Products.Edges)[index].Node.Variants.PageInfo == nil ||
			(*data.Products.Edges)[index].Node.Variants.Edges == nil {
			return shopifyconnector.ProductCatalogPage{}, errors.New("Shopify Admin API product response is invalid")
		}
		if err := c.fetchRemainingProductVariants(ctx, shopDomain, accessToken, &(*data.Products.Edges)[index].Node); err != nil {
			return shopifyconnector.ProductCatalogPage{}, err
		}
	}
	products := make([]shopifyconnector.CatalogProduct, 0, len(*data.Products.Edges))
	for _, edge := range *data.Products.Edges {
		product := shopifyconnector.CatalogProduct{
			ID: edge.Node.ID, LegacyResourceID: numericLegacyID(edge.Node.LegacyResourceID, edge.Node.ID),
			Title: edge.Node.Title, Handle: edge.Node.Handle, Status: edge.Node.Status,
			Vendor: edge.Node.Vendor, ProductType: edge.Node.ProductType,
			PublishedAt: edge.Node.PublishedAt, UpdatedAt: edge.Node.UpdatedAt,
			Variants: make([]shopifyconnector.CatalogVariant, 0, len(*edge.Node.Variants.Edges)),
		}
		for _, variantEdge := range *edge.Node.Variants.Edges {
			node := variantEdge.Node
			variant := shopifyconnector.CatalogVariant{
				ID: node.ID, LegacyResourceID: numericLegacyID(node.LegacyResourceID, node.ID),
				Title: node.Title, SKU: node.SKU, Barcode: node.Barcode, Price: node.Price,
				CurrencyCode: data.Shop.CurrencyCode, AvailableForSale: node.AvailableForSale,
			}
			if node.InventoryItem != nil {
				variant.InventoryItemID = node.InventoryItem.ID
				variant.InventoryTracked = node.InventoryItem.Tracked
			}
			product.Variants = append(product.Variants, variant)
		}
		products = append(products, product)
	}
	page := shopifyconnector.ConnectedProductCatalogPage(request, products, shopifyconnector.CatalogPageInfo{
		HasNextPage: data.Products.PageInfo.HasNextPage,
		EndCursor:   data.Products.PageInfo.EndCursor,
	}, c.now().UTC())
	if err := shopifyconnector.ValidateProductCatalogPage(request, page); err != nil {
		return shopifyconnector.ProductCatalogPage{}, errors.New("Shopify Admin API product response is invalid")
	}
	return page, nil
}

func (c *Client) fetchRemainingProductVariants(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	product *productCatalogNode,
) error {
	seenCursors := make(map[string]struct{})
	for product.Variants.PageInfo.HasNextPage {
		cursor := strings.TrimSpace(product.Variants.PageInfo.EndCursor)
		if cursor == "" {
			return errProductVariantsIncomplete
		}
		if _, exists := seenCursors[cursor]; exists {
			return errProductVariantsIncomplete
		}
		seenCursors[cursor] = struct{}{}
		var data struct {
			Product *struct {
				Variants *productVariantConnection `json:"variants"`
			} `json:"product"`
		}
		if err := c.queryGraphQL(ctx, shopDomain, accessToken, productVariantPageQuery,
			map[string]any{"id": product.ID, "after": cursor}, &data); err != nil {
			return err
		}
		if data.Product == nil || data.Product.Variants == nil ||
			data.Product.Variants.PageInfo == nil || data.Product.Variants.Edges == nil {
			return errProductVariantsIncomplete
		}
		merged := append(*product.Variants.Edges, (*data.Product.Variants.Edges)...)
		product.Variants.Edges = &merged
		product.Variants.PageInfo = data.Product.Variants.PageInfo
	}
	return nil
}

func (c *Client) queryGraphQL(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	query string,
	variables map[string]any,
	out any,
) error {
	domain, ok := shopifyconnector.NormalizeShopDomain(shopDomain)
	accessToken = strings.TrimSpace(accessToken)
	if !ok || accessToken == "" {
		return errors.New("Shopify Admin API request configuration is invalid")
	}
	payload, err := json.Marshal(map[string]any{"query": query, "variables": variables})
	if err != nil {
		return err
	}
	endpoint := c.baseURL
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://%s/admin/api/%s/graphql.json", domain, c.apiVersion)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Shopify-Access-Token", accessToken)
	response, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(io.LimitReader(response.Body, responseLimit+1))
	if response.StatusCode == http.StatusUnauthorized {
		return errors.Join(shopifyconnector.ErrProviderAuthorization, shopifyconnector.ErrProviderTokenRejected)
	}
	if response.StatusCode == http.StatusForbidden {
		return shopifyconnector.ErrProviderAuthorization
	}
	if err != nil || len(body) > responseLimit || response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("Shopify Admin API request failed")
	}
	var envelope struct {
		Data   json.RawMessage   `json:"data"`
		Errors []json.RawMessage `json:"errors"`
	}
	if json.Unmarshal(body, &envelope) != nil {
		return errors.New("Shopify Admin API response is invalid")
	}
	if len(envelope.Errors) != 0 {
		if protectedCustomerDataDenied(envelope.Errors) {
			return shopifyconnector.ErrProtectedCustomerDataRequired
		}
		return safeProviderGraphQLError(envelope.Errors)
	}
	if len(envelope.Data) == 0 || bytes.Equal(envelope.Data, []byte("null")) {
		return errors.New("Shopify Admin API response is invalid")
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return errors.New("Shopify Admin API response is invalid")
	}
	return nil
}

func safeProviderGraphQLError(rawErrors []json.RawMessage) error {
	for _, raw := range rawErrors {
		var item struct {
			Extensions struct {
				Code      string `json:"code"`
				TypeName  string `json:"typeName"`
				FieldName string `json:"fieldName"`
			} `json:"extensions"`
		}
		if json.Unmarshal(raw, &item) == nil {
			return &providerGraphQLError{
				code:      item.Extensions.Code,
				typeName:  item.Extensions.TypeName,
				fieldName: item.Extensions.FieldName,
			}
		}
	}
	return &providerGraphQLError{}
}

func safeDiagnosticToken(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var result strings.Builder
	for _, char := range value {
		if result.Len() >= 64 {
			break
		}
		if char >= 'a' && char <= 'z' || char >= 'A' && char <= 'Z' ||
			char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.' {
			result.WriteRune(char)
		}
	}
	return result.String()
}

func protectedCustomerDataDenied(rawErrors []json.RawMessage) bool {
	if len(rawErrors) == 0 {
		return false
	}
	for _, raw := range rawErrors {
		var item struct {
			Path       []any `json:"path"`
			Extensions struct {
				Code          string `json:"code"`
				Documentation string `json:"documentation"`
			} `json:"extensions"`
		}
		if json.Unmarshal(raw, &item) != nil || item.Extensions.Code != "ACCESS_DENIED" ||
			(!protectedCustomerDataPath(item.Path) &&
				!protectedCustomerDataDocumentation(item.Extensions.Documentation)) {
			return false
		}
	}
	return true
}

func protectedCustomerDataDocumentation(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(normalized, "/protected-customer-data") ||
		strings.Contains(normalized, "/customer_data")
}

func protectedCustomerDataPath(path []any) bool {
	for _, segment := range path {
		name, ok := segment.(string)
		if ok && (name == "email" || name == "shippingAddress") {
			return true
		}
	}
	return false
}

func validAPIVersion(value string) bool {
	if len(value) != 7 || value[4] != '-' {
		return false
	}
	for index, character := range value {
		if index == 4 {
			continue
		}
		if character < '0' || character > '9' {
			return false
		}
	}
	switch value[5:] {
	case "01", "04", "07", "10":
		return true
	default:
		return false
	}
}

func numericLegacyID(value json.Number, gid string) string {
	if id := strings.TrimSpace(value.String()); id != "" {
		return id
	}
	if index := strings.LastIndex(strings.TrimSpace(gid), "/"); index >= 0 && index+1 < len(gid) {
		return gid[index+1:]
	}
	return ""
}

type productCatalogData struct {
	Shop *struct {
		CurrencyCode string `json:"currencyCode"`
	} `json:"shop"`
	Products *struct {
		PageInfo *pageInfo `json:"pageInfo"`
		Edges    *[]struct {
			Node productCatalogNode `json:"node"`
		} `json:"edges"`
	} `json:"products"`
}

type pageInfo struct {
	HasNextPage bool   `json:"hasNextPage"`
	EndCursor   string `json:"endCursor"`
}

type productCatalogNode struct {
	ID               string                    `json:"id"`
	LegacyResourceID json.Number               `json:"legacyResourceId"`
	Title            string                    `json:"title"`
	Handle           string                    `json:"handle"`
	Status           string                    `json:"status"`
	Vendor           string                    `json:"vendor"`
	ProductType      string                    `json:"productType"`
	PublishedAt      string                    `json:"publishedAt"`
	UpdatedAt        string                    `json:"updatedAt"`
	Variants         *productVariantConnection `json:"variants"`
}

type productVariantConnection struct {
	PageInfo *pageInfo `json:"pageInfo"`
	Edges    *[]struct {
		Node productVariantNode `json:"node"`
	} `json:"edges"`
}

func validCurrencyCode(value string) bool {
	if len(value) != 3 {
		return false
	}
	for _, character := range value {
		if character < 'A' || character > 'Z' {
			return false
		}
	}
	return true
}

type productVariantNode struct {
	ID               string      `json:"id"`
	LegacyResourceID json.Number `json:"legacyResourceId"`
	Title            string      `json:"title"`
	SKU              string      `json:"sku"`
	Barcode          string      `json:"barcode"`
	Price            string      `json:"price"`
	AvailableForSale bool        `json:"availableForSale"`
	InventoryItem    *struct {
		ID      string `json:"id"`
		Tracked bool   `json:"tracked"`
	} `json:"inventoryItem"`
}

const productCatalogPageQuery = `
query XZERPProductCatalogPage($first: Int!, $after: String, $query: String) {
  shop { currencyCode }
  products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        legacyResourceId
        title
        handle
        status
        vendor
        productType
        publishedAt
        updatedAt
        variants(first: 100) {
          pageInfo { hasNextPage endCursor }
          edges {
            node {
              id
              legacyResourceId
              title
              sku
              barcode
              price
              availableForSale
              inventoryItem { id tracked }
            }
          }
        }
      }
    }
  }
}`

const productVariantPageQuery = `
query XZERPProductVariantPage($id: ID!, $after: String!) {
  product(id: $id) {
    variants(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          legacyResourceId
          title
          sku
          barcode
          price
          availableForSale
          inventoryItem { id tracked }
        }
      }
    }
  }
}`

var _ interface {
	FetchProductCatalogPage(context.Context, string, string, shopifyconnector.ProductCatalogPageRequest) (shopifyconnector.ProductCatalogPage, error)
} = (*Client)(nil)
