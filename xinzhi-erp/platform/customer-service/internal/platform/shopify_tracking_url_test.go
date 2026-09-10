package platform

import "testing"

func TestNormalizeShopifyTrackingURLUsesInternational17TrackPage(t *testing.T) {
	tests := []struct {
		name string
		got  string
		want string
	}{
		{name: "chinese locale", got: "https://www.17track.net/zh-cn", want: shopifyInternationalTrackingURL},
		{name: "chinese locale with query", got: "https://www.17track.net/zh-cn?nums=1Z123", want: "https://www.17track.net/en?nums=1Z123"},
		{name: "chinese locale subpath", got: "https://www.17track.net/zh-cn/track", want: "https://www.17track.net/en/track"},
		{name: "http legacy host", got: "http://17track.net/zh-cn?nums=1Z123", want: "https://www.17track.net/en?nums=1Z123"},
		{name: "international page unchanged", got: "https://www.17track.net/en?nums=1Z123", want: "https://www.17track.net/en?nums=1Z123"},
		{name: "api endpoint unchanged", got: "https://api.17track.net/track/v2.4", want: "https://api.17track.net/track/v2.4"},
		{name: "other carrier unchanged", got: "https://www.ups.com/zh-cn", want: "https://www.ups.com/zh-cn"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := normalizeShopifyTrackingURL(test.got); got != test.want {
				t.Fatalf("normalizeShopifyTrackingURL(%q) = %q, want %q", test.got, got, test.want)
			}
		})
	}
}

func TestNormalizeShopifyOrderTrackingURLsIncludesCustomerLastOrder(t *testing.T) {
	order := ShopifyOrderSummary{
		Fulfillments: []ShopifyFulfillment{{TrackingInfo: []ShopifyTrackingInfo{{URL: "https://www.17track.net/zh-cn"}}}},
		Customer: ShopifyCustomer{LastOrder: &ShopifyLastOrder{
			Fulfillments: []ShopifyFulfillment{{TrackingInfo: []ShopifyTrackingInfo{{URL: "https://www.17track.net/zh-cn?nums=ABC"}}}},
		}},
	}
	normalizeShopifyOrderTrackingURLs(&order)
	if got := order.Fulfillments[0].TrackingInfo[0].URL; got != shopifyInternationalTrackingURL {
		t.Fatalf("order tracking URL = %q, want %q", got, shopifyInternationalTrackingURL)
	}
	if got := order.Customer.LastOrder.Fulfillments[0].TrackingInfo[0].URL; got != "https://www.17track.net/en?nums=ABC" {
		t.Fatalf("customer last order tracking URL = %q, want %q", got, "https://www.17track.net/en?nums=ABC")
	}
}
