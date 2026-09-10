package platform

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	shopifyOrderWriteScope               = "write_orders"
	shopifyMerchantFulfillmentWriteScope = "write_merchant_managed_fulfillment_orders"
)

var shopifyCountryCodePattern = regexp.MustCompile(`^[A-Za-z]{2}$`)

func numericShopifyGID(value string, prefix string) bool {
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	suffix := strings.TrimPrefix(value, prefix)
	if suffix == "" {
		return false
	}
	for _, r := range suffix {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

type ShopifyOrderShippingAddressUpdate struct {
	OrderID string                      `json:"orderId"`
	Address ShopifyShippingAddressInput `json:"address"`
}

type ShopifyShippingAddressInput struct {
	FirstName    string `json:"firstName"`
	LastName     string `json:"lastName"`
	Company      string `json:"company"`
	Address1     string `json:"address1"`
	Address2     string `json:"address2"`
	City         string `json:"city"`
	ProvinceCode string `json:"provinceCode"`
	CountryCode  string `json:"countryCode"`
	Zip          string `json:"zip"`
	Phone        string `json:"phone"`
}

type ShopifyFulfillmentTrackingUpdate struct {
	FulfillmentID  string `json:"fulfillmentId"`
	Company        string `json:"company"`
	Number         string `json:"number"`
	URL            string `json:"url"`
	NotifyCustomer bool   `json:"notifyCustomer"`
}

type shopifyMutationUserError struct {
	Field   []string `json:"field"`
	Message string   `json:"message"`
}

func (c shopifyAdminClient) UpdateOrderShippingAddress(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	input ShopifyOrderShippingAddressUpdate,
) (ShopifyMailingAddress, error) {
	input, err := normalizeShopifyOrderShippingAddressUpdate(input)
	if err != nil {
		return ShopifyMailingAddress{}, err
	}
	var data struct {
		OrderUpdate struct {
			Order *struct {
				ShippingAddress *ShopifyMailingAddress `json:"shippingAddress"`
			} `json:"order"`
			UserErrors []shopifyMutationUserError `json:"userErrors"`
		} `json:"orderUpdate"`
	}
	address := map[string]any{
		"firstName":    input.Address.FirstName,
		"lastName":     input.Address.LastName,
		"company":      input.Address.Company,
		"address1":     input.Address.Address1,
		"address2":     input.Address.Address2,
		"city":         input.Address.City,
		"provinceCode": input.Address.ProvinceCode,
		"countryCode":  input.Address.CountryCode,
		"zip":          input.Address.Zip,
		"phone":        input.Address.Phone,
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyOrderShippingAddressUpdateMutation, map[string]any{
		"input": map[string]any{"id": input.OrderID, "shippingAddress": address},
	}, &data); err != nil {
		return ShopifyMailingAddress{}, err
	}
	if err := shopifyMutationError("修改收货地址", data.OrderUpdate.UserErrors); err != nil {
		return ShopifyMailingAddress{}, err
	}
	if data.OrderUpdate.Order == nil || data.OrderUpdate.Order.ShippingAddress == nil {
		return ShopifyMailingAddress{}, fmt.Errorf("Shopify 修改收货地址后未返回地址数据")
	}
	return *data.OrderUpdate.Order.ShippingAddress, nil
}

func (c shopifyAdminClient) UpdateFulfillmentTracking(
	ctx context.Context,
	shopDomain string,
	accessToken string,
	input ShopifyFulfillmentTrackingUpdate,
) (ShopifyFulfillment, error) {
	input, err := normalizeShopifyFulfillmentTrackingUpdate(input)
	if err != nil {
		return ShopifyFulfillment{}, err
	}
	tracking := map[string]any{
		"company": input.Company,
		"number":  input.Number,
	}
	if input.URL != "" {
		tracking["url"] = input.URL
	}
	var data struct {
		FulfillmentTrackingInfoUpdate struct {
			Fulfillment *ShopifyFulfillment        `json:"fulfillment"`
			UserErrors  []shopifyMutationUserError `json:"userErrors"`
		} `json:"fulfillmentTrackingInfoUpdate"`
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken, shopifyFulfillmentTrackingUpdateMutation, map[string]any{
		"fulfillmentId":     input.FulfillmentID,
		"trackingInfoInput": tracking,
		"notifyCustomer":    input.NotifyCustomer,
	}, &data); err != nil {
		return ShopifyFulfillment{}, err
	}
	payload := data.FulfillmentTrackingInfoUpdate
	if err := shopifyMutationError("修改物流单号", payload.UserErrors); err != nil {
		return ShopifyFulfillment{}, err
	}
	if payload.Fulfillment == nil {
		return ShopifyFulfillment{}, fmt.Errorf("Shopify 修改物流单号后未返回履约数据")
	}
	fulfillment := *payload.Fulfillment
	fulfillment.TrackingInfo = normalizeShopifyTrackingInfoURLs(fulfillment.TrackingInfo)
	return fulfillment, nil
}

func normalizeShopifyOrderShippingAddressUpdate(input ShopifyOrderShippingAddressUpdate) (ShopifyOrderShippingAddressUpdate, error) {
	input.OrderID = strings.TrimSpace(input.OrderID)
	input.Address.FirstName = strings.TrimSpace(input.Address.FirstName)
	input.Address.LastName = strings.TrimSpace(input.Address.LastName)
	input.Address.Company = strings.TrimSpace(input.Address.Company)
	input.Address.Address1 = strings.TrimSpace(input.Address.Address1)
	input.Address.Address2 = strings.TrimSpace(input.Address.Address2)
	input.Address.City = strings.TrimSpace(input.Address.City)
	input.Address.ProvinceCode = strings.ToUpper(strings.TrimSpace(input.Address.ProvinceCode))
	input.Address.CountryCode = strings.ToUpper(strings.TrimSpace(input.Address.CountryCode))
	input.Address.Zip = strings.TrimSpace(input.Address.Zip)
	input.Address.Phone = strings.TrimSpace(input.Address.Phone)
	switch {
	case !strings.HasPrefix(input.OrderID, "gid://shopify/Order/"):
		return input, fmt.Errorf("%w: Shopify 订单 ID 无效", ErrInvalid)
	case input.Address.Address1 == "":
		return input, fmt.Errorf("%w: 地址第一行不能为空", ErrInvalid)
	case input.Address.City == "":
		return input, fmt.Errorf("%w: 城市不能为空", ErrInvalid)
	case !shopifyCountryCodePattern.MatchString(input.Address.CountryCode):
		return input, fmt.Errorf("%w: 国家/地区代码必须是两个英文字母", ErrInvalid)
	}
	return input, nil
}

func normalizeShopifyFulfillmentTrackingUpdate(input ShopifyFulfillmentTrackingUpdate) (ShopifyFulfillmentTrackingUpdate, error) {
	input.FulfillmentID = strings.TrimSpace(input.FulfillmentID)
	input.Company = strings.TrimSpace(input.Company)
	input.Number = strings.TrimSpace(input.Number)
	input.URL = normalizeShopifyTrackingURL(input.URL)
	switch {
	case !strings.HasPrefix(input.FulfillmentID, "gid://shopify/Fulfillment/"):
		return input, fmt.Errorf("%w: Shopify 履约 ID 无效", ErrInvalid)
	case input.Number == "":
		return input, fmt.Errorf("%w: 物流单号不能为空", ErrInvalid)
	case input.URL != "":
		parsed, err := url.Parse(input.URL)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
			return input, fmt.Errorf("%w: 物流查询链接必须是有效的 HTTP 或 HTTPS 地址", ErrInvalid)
		}
	}
	return input, nil
}

func shopifyMutationError(action string, userErrors []shopifyMutationUserError) error {
	if len(userErrors) == 0 {
		return nil
	}
	message := strings.TrimSpace(userErrors[0].Message)
	if message == "" {
		message = "Shopify 拒绝了本次修改"
	}
	return fmt.Errorf("%w: %s失败：%s", ErrInvalid, action, message)
}

func (s *Server) handleShopifyOrderShippingAddressUpdate(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireShopifyOrderMutationAccess(w, r, user, shopID) {
		return
	}
	var input ShopifyOrderShippingAddressUpdate
	if !decodeJSON(w, r, &input) {
		return
	}
	domain, token, err := s.shopifyWriteCredentials(r.Context(), shopID, []string{shopifyOrderWriteScope})
	if err != nil {
		writeError(w, err)
		return
	}
	address, err := s.shopifyOrderAddressUpdate(r.Context(), domain, token, input)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	s.invalidateShopifyOrderCaches(r.Context(), shopID)
	s.auditAccountChange(r.Context(), user.ID, user.ID, "shopify.order.shipping_address.updated", map[string]any{
		"shopId": shopID, "orderId": strings.TrimSpace(input.OrderID),
	})
	s.broadcast(Event{Type: "shopify.order.updated", ShopID: shopID, EntityID: input.OrderID, Payload: map[string]any{
		"orderId": input.OrderID, "shippingAddress": address,
	}, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, map[string]any{"shippingAddress": address})
}

func (s *Server) handleShopifyFulfillmentTrackingUpdate(w http.ResponseWriter, r *http.Request, user User, shopID string) {
	if !s.requireShopifyOrderMutationAccess(w, r, user, shopID) {
		return
	}
	var input ShopifyFulfillmentTrackingUpdate
	if !decodeJSON(w, r, &input) {
		return
	}
	domain, token, err := s.shopifyWriteCredentials(r.Context(), shopID, []string{
		shopifyMerchantFulfillmentWriteScope,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	fulfillment, err := s.shopifyTrackingInfoUpdate(r.Context(), domain, token, input)
	if err != nil {
		s.recordShopifyAPIError(r.Context(), shopID, err)
		writeError(w, err)
		return
	}
	s.invalidateShopifyOrderCaches(r.Context(), shopID)
	s.auditAccountChange(r.Context(), user.ID, user.ID, "shopify.fulfillment.tracking.updated", map[string]any{
		"shopId": shopID, "fulfillmentId": strings.TrimSpace(input.FulfillmentID), "notifyCustomer": input.NotifyCustomer,
	})
	s.broadcast(Event{Type: "shopify.order.updated", ShopID: shopID, EntityID: input.FulfillmentID, Payload: map[string]any{
		"fulfillment": fulfillment,
	}, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, map[string]any{"fulfillment": fulfillment})
}

func (s *Server) requireShopifyOrderMutationAccess(w http.ResponseWriter, r *http.Request, user User, shopID string) bool {
	return s.requireWorkbenchOrModuleShopAccess(w, r, user, DataScopeOrders, shopID)
}

func (s *Server) shopifyWriteCredentials(ctx context.Context, shopID string, anyRequiredScope []string) (string, string, error) {
	if s.localDemo {
		return "", "", fmt.Errorf("%w: 本地演示未连接真实 Shopify，不会执行订单写入", ErrForbidden)
	}
	shop, err := s.store.GetShop(ctx, shopID)
	if err != nil {
		return "", "", err
	}
	if shop.Status != ShopStatusActive {
		return "", "", fmt.Errorf("%w: 当前店铺已停用，不能修改 Shopify 订单", ErrInvalid)
	}
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return "", "", err
	}
	domain := shopifyDomainForShop(shop, sources)
	token := s.shopifyAdminToken(ctx, domain)
	if domain == "" || token == "" {
		return "", "", fmt.Errorf("%w: 该店铺尚未完成 Shopify 授权", ErrInvalid)
	}
	if installation, installErr := s.store.GetShopifyInstallationByDomain(ctx, domain); installErr == nil && strings.TrimSpace(installation.Scope) != "" {
		allowed := false
		for _, scope := range anyRequiredScope {
			if shopifyScopeIncludes(installation.Scope, scope) {
				allowed = true
				break
			}
		}
		if !allowed {
			return "", "", fmt.Errorf("%w: 当前 Shopify 授权缺少写入权限，请在店铺配置中重新发布 App 并重新授权", ErrForbidden)
		}
	}
	return domain, token, nil
}

func (s *Server) invalidateShopifyOrderCaches(ctx context.Context, shopID string) {
	s.invalidateExternalCacheNamespace(ctx, shopifyOrderCacheNamespace, shopID)
	s.invalidateExternalCacheNamespace(ctx, shopifyCustomerCacheNamespace, shopID)
}

const shopifyOrderShippingAddressUpdateMutation = `
mutation XzdeskOrderShippingAddressUpdate($input: OrderInput!) {
  orderUpdate(input: $input) {
    order {
      id
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
    }
    userErrors { field message }
  }
}`

const shopifyFulfillmentTrackingUpdateMutation = `
mutation XzdeskFulfillmentTrackingUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
  fulfillmentTrackingInfoUpdate(
    fulfillmentId: $fulfillmentId,
    trackingInfoInput: $trackingInfoInput,
    notifyCustomer: $notifyCustomer
  ) {
    fulfillment {
      id
      status
      createdAt
      updatedAt
      trackingInfo { company number url }
    }
    userErrors { field message }
  }
}`
