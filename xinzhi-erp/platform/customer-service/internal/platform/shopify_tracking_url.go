package platform

import (
	"net/url"
	"strings"
)

const shopifyInternationalTrackingURL = "https://www.17track.net/en"

// normalizeShopifyTrackingURL keeps non-17TRACK links unchanged and maps
// 17TRACK's locale-specific public pages to its international English page.
func normalizeShopifyTrackingURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}

	parsed, err := url.Parse(raw)
	if err != nil {
		return raw
	}
	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "17track.net", "www.17track.net", "m.17track.net", "t.17track.net":
	default:
		return raw
	}
	parsed.Scheme = "https"
	parsed.Host = "www.17track.net"

	path := parsed.Path
	lowerPath := strings.ToLower(path)
	switch {
	case path == "" || path == "/":
		parsed.Path = "/en"
	case lowerPath == "/zh-cn" || lowerPath == "/zh-cn/":
		parsed.Path = "/en"
	case strings.HasPrefix(lowerPath, "/zh-cn/"):
		parsed.Path = "/en" + path[len("/zh-cn"):]
	}
	parsed.RawPath = ""
	return parsed.String()
}

func normalizeShopifyFulfillmentTrackingURLs(fulfillments []ShopifyFulfillment) []ShopifyFulfillment {
	for i := range fulfillments {
		fulfillments[i].TrackingInfo = normalizeShopifyTrackingInfoURLs(fulfillments[i].TrackingInfo)
	}
	return fulfillments
}

func normalizeShopifyTrackingInfoURLs(trackingInfo []ShopifyTrackingInfo) []ShopifyTrackingInfo {
	for i := range trackingInfo {
		trackingInfo[i].URL = normalizeShopifyTrackingURL(trackingInfo[i].URL)
	}
	return trackingInfo
}

func normalizeShopifyOrderTrackingURLs(order *ShopifyOrderSummary) {
	if order == nil {
		return
	}
	order.Fulfillments = normalizeShopifyFulfillmentTrackingURLs(order.Fulfillments)
	if order.Customer.LastOrder != nil {
		order.Customer.LastOrder.Fulfillments = normalizeShopifyFulfillmentTrackingURLs(order.Customer.LastOrder.Fulfillments)
	}
}

func normalizeShopifyOrderSearchResultTrackingURLs(result *ShopifyOrderSearchResult) {
	if result == nil {
		return
	}
	for i := range result.Orders {
		normalizeShopifyOrderTrackingURLs(&result.Orders[i])
	}
}
