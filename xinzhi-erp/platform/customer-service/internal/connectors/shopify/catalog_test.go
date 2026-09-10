package shopify

import (
	"errors"
	"testing"
	"time"
)

func TestProductCatalogRequestValidation(t *testing.T) {
	valid := productCatalogRequest(testTenantOne, testShopOne, "corr-catalog")
	if err := ValidateProductCatalogPageRequest(valid); err != nil {
		t.Fatalf("valid catalog request failed validation: %v", err)
	}

	tests := []ProductCatalogPageRequest{
		{Identity: valid.Identity, Context: valid.Context, Limit: 0},
		{Identity: valid.Identity, Context: valid.Context, Limit: 101},
		{Identity: CanonicalShopIdentity{TenantID: testTenantOne, ShopID: "not-a-uuid"}, Context: valid.Context, Limit: 50},
		{Identity: valid.Identity, Context: RequestContext{CorrelationID: "bad space", RequestID: "request-1"}, Limit: 50},
		{Identity: valid.Identity, Context: valid.Context, Limit: 50, Cursor: "cursor\nbreak"},
	}
	for _, request := range tests {
		if err := ValidateProductCatalogPageRequest(request); err == nil {
			t.Fatalf("expected invalid catalog request: %#v", request)
		}
	}
}

func TestProductCatalogPageRedactsProviderFields(t *testing.T) {
	fetchedAt := time.Date(2026, time.July, 31, 8, 9, 10, 0, time.FixedZone("fixture", 8*60*60))
	request := productCatalogRequest(testTenantOne, testShopOne, "corr-catalog")

	page := ConnectedProductCatalogPage(request, []CatalogProduct{{
		ID:        "gid://shopify/Product/1",
		Title:     "Test Product",
		Handle:    "test-product",
		UpdatedAt: "2026-07-30T01:02:03Z",
		Variants: []CatalogVariant{{
			ID:              "gid://shopify/ProductVariant/2",
			InventoryItemID: "gid://shopify/InventoryItem/3",
			SKU:             "SKU-1",
			Price:           "19.90",
			CurrencyCode:    "USD",
		}},
	}}, CatalogPageInfo{HasNextPage: true, EndCursor: "opaque=="}, fetchedAt)

	if page.ContractVersion != ProductCatalogContractVersion ||
		page.State != ProductCatalogStateConnected ||
		page.FetchedAt == nil ||
		!page.FetchedAt.Equal(fetchedAt.UTC()) ||
		page.FetchedAt.Location() != time.UTC {
		t.Fatalf("unexpected catalog page metadata: %#v", page)
	}
	for _, product := range page.Products {
		if product.Title == "" || len(product.Variants) != 1 {
			t.Fatalf("catalog page lost allowed product fields: %#v", page)
		}
	}
}

func TestProductCatalogResponseValidationRejectsMalformedContractAndShape(t *testing.T) {
	request := productCatalogRequest(testTenantOne, testShopOne, "corr-catalog-response")
	fetchedAt := time.Date(2026, time.August, 1, 20, 0, 0, 0, time.UTC)
	valid := ConnectedProductCatalogPage(request, []CatalogProduct{{
		ID: "gid://shopify/Product/1", Title: "Product", Status: "UNLISTED",
		Variants: []CatalogVariant{{ID: "gid://shopify/ProductVariant/2", Title: "Default"}},
	}}, CatalogPageInfo{HasNextPage: true, EndCursor: "next=="}, fetchedAt)
	if err := ValidateProductCatalogPage(request, valid); err != nil {
		t.Fatalf("valid product response failed: %v", err)
	}
	tests := map[string]func(*ProductCatalogPage){
		"contract":         func(page *ProductCatalogPage) { page.ContractVersion = "shopify.connector.product_catalog.v2" },
		"tenant":           func(page *ProductCatalogPage) { page.TenantID = testTenantTwo },
		"state":            func(page *ProductCatalogPage) { page.State = ProductCatalogState("UNKNOWN") },
		"missing time":     func(page *ProductCatalogPage) { page.FetchedAt = nil },
		"missing cursor":   func(page *ProductCatalogPage) { page.PageInfo.EndCursor = "" },
		"missing products": func(page *ProductCatalogPage) { page.Products = nil },
		"missing product":  func(page *ProductCatalogPage) { page.Products[0].ID = "" },
		"missing variants": func(page *ProductCatalogPage) { page.Products[0].Variants = nil },
		"duplicate variant": func(page *ProductCatalogPage) {
			page.Products[0].Variants = append(page.Products[0].Variants, page.Products[0].Variants[0])
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			page := valid
			page.Products = append([]CatalogProduct(nil), valid.Products...)
			page.Products[0].Variants = append([]CatalogVariant(nil), valid.Products[0].Variants...)
			mutate(&page)
			if err := ValidateProductCatalogPage(request, page); err == nil {
				t.Fatalf("malformed product response was accepted: %#v", page)
			}
		})
	}

	notConfigured := NotConfiguredProductCatalogPage(request)
	if err := ValidateProductCatalogPage(request, notConfigured); err != nil {
		t.Fatalf("valid not-configured response failed: %v", err)
	}
	notConfigured.Products = []CatalogProduct{{ID: "gid://shopify/Product/1"}}
	if err := ValidateProductCatalogPage(request, notConfigured); err == nil {
		t.Fatal("not-configured response with product data was accepted")
	}
}

func TestCatalogSafeErrorsReuseCorrelation(t *testing.T) {
	request := productCatalogRequest(testTenantOne, testShopOne, "corr-catalog-error")
	err := SafeCatalogErrorFor(request, errors.New("provider payload with token fixture-secret"))
	if err.Code != ErrorCodeUnavailable ||
		err.CorrelationID != "corr-catalog-error" ||
		err.Message != "Shopify connection status is temporarily unavailable" {
		t.Fatalf("unexpected safe catalog error: %#v", err)
	}
}

func TestOrderCatalogResponseValidationRejectsMalformedContractAndShape(t *testing.T) {
	request := OrderCatalogPageRequest{
		Identity: CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		Context:  RequestContext{CorrelationID: "corr-order-response", RequestID: "request-order-response"},
		Limit:    50,
	}
	fetchedAt := time.Date(2026, time.August, 1, 22, 0, 0, 0, time.UTC)
	valid := ConnectedOrderCatalogPage(request, []CatalogOrder{{
		ID: "gid://shopify/Order/1", Name: "#1001", CreatedAt: "2026-08-01T20:00:00Z",
		PaymentGatewayNames: []string{"shopify_payments"},
		Total:               CatalogMoney{Amount: "10.00", CurrencyCode: "USD"},
		LineItems: []CatalogOrderLine{{
			ID: "gid://shopify/LineItem/2", Name: "Product", Quantity: 1,
		}},
		Fulfillments: []CatalogFulfillment{{
			ID: "gid://shopify/Fulfillment/3", TrackingInfo: []CatalogTrackingInfo{},
		}},
	}}, CatalogPageInfo{HasNextPage: true, EndCursor: "next=="}, fetchedAt)
	if err := ValidateOrderCatalogPage(request, valid); err != nil {
		t.Fatalf("valid order response failed: %v", err)
	}
	tests := map[string]func(*OrderCatalogPage){
		"contract":         func(page *OrderCatalogPage) { page.ContractVersion = "shopify.connector.order_catalog.v2" },
		"tenant":           func(page *OrderCatalogPage) { page.TenantID = testTenantTwo },
		"state":            func(page *OrderCatalogPage) { page.State = OrderCatalogState("UNKNOWN") },
		"missing time":     func(page *OrderCatalogPage) { page.FetchedAt = nil },
		"missing cursor":   func(page *OrderCatalogPage) { page.PageInfo.EndCursor = "" },
		"missing orders":   func(page *OrderCatalogPage) { page.Orders = nil },
		"missing order id": func(page *OrderCatalogPage) { page.Orders[0].ID = "" },
		"missing lines":    func(page *OrderCatalogPage) { page.Orders[0].LineItems = nil },
		"missing fulfills": func(page *OrderCatalogPage) { page.Orders[0].Fulfillments = nil },
		"duplicate line": func(page *OrderCatalogPage) {
			page.Orders[0].LineItems = append(page.Orders[0].LineItems, page.Orders[0].LineItems[0])
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			page := valid
			page.Orders = append([]CatalogOrder(nil), valid.Orders...)
			page.Orders[0].LineItems = append([]CatalogOrderLine(nil), valid.Orders[0].LineItems...)
			page.Orders[0].Fulfillments = append([]CatalogFulfillment(nil), valid.Orders[0].Fulfillments...)
			mutate(&page)
			if err := ValidateOrderCatalogPage(request, page); err == nil {
				t.Fatalf("malformed order response was accepted: %#v", page)
			}
		})
	}

	notConfigured := NotConfiguredOrderCatalogPage(request)
	if err := ValidateOrderCatalogPage(request, notConfigured); err != nil {
		t.Fatalf("valid not-configured order response failed: %v", err)
	}
	notConfigured.Orders = []CatalogOrder{{ID: "gid://shopify/Order/1"}}
	if err := ValidateOrderCatalogPage(request, notConfigured); err == nil {
		t.Fatal("not-configured response with order data was accepted")
	}
}

func TestLocationCatalogRequestAndPageContract(t *testing.T) {
	request := LocationCatalogPageRequest{
		Identity: CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		Context:  RequestContext{CorrelationID: "corr-location", RequestID: "request-1"},
		Limit:    100,
	}
	if err := ValidateLocationCatalogPageRequest(request); err != nil {
		t.Fatalf("valid location request failed: %v", err)
	}
	page := ConnectedLocationCatalogPage(
		request,
		[]CatalogLocation{{ID: "gid://shopify/Location/1", Name: "Main"}},
		CatalogPageInfo{},
		time.Date(2026, time.July, 31, 8, 9, 10, 0, time.FixedZone("fixture", 8*60*60)),
	)
	if page.ContractVersion != LocationCatalogContractVersion ||
		page.State != LocationCatalogStateConnected ||
		page.FetchedAt == nil || page.FetchedAt.Location() != time.UTC ||
		len(page.Locations) != 1 {
		t.Fatalf("unexpected location page: %#v", page)
	}
	request.Limit = 101
	if err := ValidateLocationCatalogPageRequest(request); err == nil {
		t.Fatal("location request above safe page size must fail")
	}
}

func TestReturnCatalogRequestAndPageContract(t *testing.T) {
	request := ReturnCatalogPageRequest{
		Identity: CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		Context:  RequestContext{CorrelationID: "corr-return", RequestID: "request-1"},
		Limit:    50,
		Query:    "name:1001",
	}
	if err := ValidateReturnCatalogPageRequest(request); err != nil {
		t.Fatalf("valid return request failed: %v", err)
	}
	fetchedAt := time.Date(2026, time.August, 1, 8, 9, 10, 0, time.FixedZone("fixture", 8*60*60))
	page := ConnectedReturnCatalogPage(
		request,
		[]CatalogReturn{{
			ID: "gid://shopify/Return/1", Name: "#1001-R1",
			OrderID: "gid://shopify/Order/2", OrderName: "#1001",
			Status: "OPEN", CreatedAt: "2026-08-01T00:00:00Z", TotalQuantity: 1,
			LineItems: []CatalogReturnLine{{
				ID: "gid://shopify/ReturnLineItem/3", Quantity: 1,
			}},
		}},
		CatalogPageInfo{HasNextPage: true, EndCursor: "next=="},
		fetchedAt,
	)
	if page.ContractVersion != ReturnCatalogContractVersion ||
		page.State != OrderCatalogStateConnected ||
		page.FetchedAt == nil || page.FetchedAt.Location() != time.UTC ||
		len(page.Returns) != 1 || page.Returns[0].Name != "#1001-R1" {
		t.Fatalf("unexpected return page: %#v", page)
	}
	request.Limit = 101
	if err := ValidateReturnCatalogPageRequest(request); err == nil {
		t.Fatal("return request above safe page size must fail")
	}
}

func TestOrderShippingAddressRequestValidation(t *testing.T) {
	valid := OrderShippingAddressUpdateRequest{
		Identity:       CanonicalShopIdentity{TenantID: testTenantOne, ShopID: testShopOne},
		Context:        RequestContext{CorrelationID: "corr-address", RequestID: "request-1"},
		OrderID:        "gid://shopify/Order/123",
		IdempotencyKey: "address-command-1",
		Address: CatalogMailingAddress{
			Address1:    "1 Main Street",
			City:        "Toronto",
			CountryCode: "CA",
		},
	}
	if err := ValidateOrderShippingAddressUpdateRequest(valid); err != nil {
		t.Fatalf("valid address update failed validation: %v", err)
	}
	invalid := []OrderShippingAddressUpdateRequest{
		{Identity: valid.Identity, Context: valid.Context, OrderID: "123", IdempotencyKey: valid.IdempotencyKey, Address: valid.Address},
		{Identity: valid.Identity, Context: valid.Context, OrderID: valid.OrderID, IdempotencyKey: "bad key", Address: valid.Address},
		{Identity: valid.Identity, Context: valid.Context, OrderID: valid.OrderID, IdempotencyKey: valid.IdempotencyKey, Address: CatalogMailingAddress{City: "Toronto", CountryCode: "CA"}},
		{Identity: valid.Identity, Context: valid.Context, OrderID: valid.OrderID, IdempotencyKey: valid.IdempotencyKey, Address: CatalogMailingAddress{Address1: "1 Main", City: "Toronto", CountryCode: "ca"}},
	}
	for _, request := range invalid {
		if err := ValidateOrderShippingAddressUpdateRequest(request); err == nil {
			t.Fatalf("expected invalid address update: %#v", request)
		}
	}
}

func TestOrderShippingAddressResultValidation(t *testing.T) {
	request := OrderShippingAddressUpdateRequest{
		Identity: CanonicalShopIdentity{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222"},
		Context: RequestContext{CorrelationID: "corr-address", RequestID: "request-address"},
		OrderID: "gid://shopify/Order/123", IdempotencyKey: "address-1",
		Address: CatalogMailingAddress{FirstName: "Ada", LastName: "Lovelace", Address1: "1 Main", City: "Toronto", ProvinceCode: "ON", CountryCode: "CA", Zip: "A1A1A1"},
	}
	valid := OrderShippingAddressUpdateResult{
		ContractVersion: OrderShippingAddressContractVersion,
		TenantID: request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, Address: request.Address, UpdatedAt: time.Now().UTC(),
	}
	if err := ValidateOrderShippingAddressUpdateResult(request, valid); err != nil {
		t.Fatalf("valid result rejected: %v", err)
	}
	invalid := valid
	invalid.Address.City = "Ottawa"
	if ValidateOrderShippingAddressUpdateResult(request, invalid) == nil {
		t.Fatal("mismatched returned address must be rejected")
	}
}

func productCatalogRequest(tenantID string, shopID string, correlationID string) ProductCatalogPageRequest {
	return ProductCatalogPageRequest{
		Identity: CanonicalShopIdentity{TenantID: tenantID, ShopID: shopID},
		Context: RequestContext{
			CorrelationID: correlationID,
			RequestID:     "request-1",
		},
		Limit: 50,
	}
}
