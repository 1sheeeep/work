package adminapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestClientPublishesFulfillmentAfterCompleteContextRead(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		if json.NewDecoder(r.Body).Decode(&payload) != nil {
			t.Fatal("request was not JSON")
		}
		w.Header().Set("Content-Type", "application/json")
		switch calls {
		case 1:
			if !strings.Contains(payload.Query, "query XZERPFulfillmentContext") || payload.Variables["orderId"] != "gid://shopify/Order/1" {
				t.Fatalf("unexpected context query: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"orders-100"}},"fulfillments":[]}}}`))
		case 2:
			if !strings.Contains(payload.Query, "query XZERPFulfillmentOrderPage") || payload.Variables["after"] != "orders-100" {
				t.Fatalf("unexpected order continuation: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"gid://shopify/FulfillmentOrder/10","status":"OPEN","supportedActions":["CREATE_FULFILLMENT"],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"lines-100"}}}],"pageInfo":{"hasNextPage":false,"endCursor":"orders-101"}}}}}`))
		case 3:
			if !strings.Contains(payload.Query, "query XZERPFulfillmentOrderLineItemPage") || payload.Variables["after"] != "lines-100" {
				t.Fatalf("unexpected line continuation: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"fulfillmentOrder":{"id":"gid://shopify/FulfillmentOrder/10","lineItems":{"nodes":[{"id":"gid://shopify/FulfillmentOrderLineItem/30","remainingQuantity":2,"lineItem":{"id":"gid://shopify/LineItem/40"}}],"pageInfo":{"hasNextPage":false,"endCursor":"lines-101"}}}}}`))
		case 4:
			if !strings.Contains(payload.Query, "mutation XZERPFulfillmentCreate") {
				t.Fatalf("unexpected final query: %s", payload.Query)
			}
			fulfillment, _ := payload.Variables["fulfillment"].(map[string]any)
			if fulfillment["notifyCustomer"] != true || !strings.Contains(fmt.Sprint(payload.Variables), "gid://shopify/FulfillmentOrderLineItem/30") {
				t.Fatalf("unexpected mutation input: %#v", payload.Variables)
			}
			_, _ = w.Write([]byte(`{"data":{"fulfillmentCreate":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","createdAt":"2026-08-02T01:02:02Z","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[{"company":"UPS","number":"1Z123","url":"https://track.example/1Z123"}]},"userErrors":[]}}}`))
		default:
			t.Fatalf("unexpected provider call %d", calls)
		}
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())
	client.now = func() time.Time { return time.Date(2026, 8, 2, 9, 9, 9, 0, time.UTC) }

	result, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
	if err != nil || calls != 4 || result.RecoveredFromShopify || len(result.FulfillmentIDs) != 1 || result.FulfillmentIDs[0] != "gid://shopify/Fulfillment/50" || !result.UpdatedAt.Equal(time.Date(2026, 8, 2, 1, 2, 3, 0, time.UTC)) {
		t.Fatalf("publish mismatch calls=%d result=%#v error=%v", calls, result, err)
	}
}

func TestClientPaginatesPublishedFulfillmentLinesBeforeExactRecovery(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var payload struct {
			Query     string         `json:"query"`
			Variables map[string]any `json:"variables"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		w.Header().Set("Content-Type", "application/json")
		switch calls {
		case 1:
			_, _ = w.Write([]byte(`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[{"company":null,"number":"1Z123","url":null}],"fulfillmentLineItems":{"nodes":[{"quantity":1,"lineItem":{"id":"gid://shopify/LineItem/40"}}],"pageInfo":{"hasNextPage":true,"endCursor":"fulfilled-100"}}}]}}}`))
		case 2:
			if !strings.Contains(payload.Query, "query XZERPFulfillmentLineItemPage") || payload.Variables["after"] != "fulfilled-100" {
				t.Fatalf("unexpected fulfillment continuation: %#v", payload)
			}
			_, _ = w.Write([]byte(`{"data":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","fulfillmentLineItems":{"nodes":[{"quantity":1,"lineItem":{"id":"gid://shopify/LineItem/40"}}],"pageInfo":{"hasNextPage":false,"endCursor":"fulfilled-101"}}}}}`))
		default:
			t.Fatal("recovery issued a mutation")
		}
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())

	result, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
	if err != nil || calls != 2 || !result.RecoveredFromShopify || len(result.FulfillmentIDs) != 1 || !result.UpdatedAt.Equal(time.Date(2026, 8, 2, 1, 2, 3, 0, time.UTC)) {
		t.Fatalf("recovery mismatch calls=%d result=%#v error=%v", calls, result, err)
	}
}

func TestClientFailsClosedOnIncompleteFulfillmentPagination(t *testing.T) {
	tests := []struct {
		name      string
		responses []string
	}{
		{"missing cursor", []string{`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":""}},"fulfillments":[]}}}`}},
		{"repeated cursor", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}},"fulfillments":[]}}}`,
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}}`,
		}},
		{"order disappeared", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"next"}},"fulfillments":[]}}}`,
			`{"data":{"order":null}}`,
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if calls >= len(test.responses) {
					t.Fatal("incomplete pagination reached a mutation")
				}
				_, _ = w.Write([]byte(test.responses[calls]))
				calls++
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			_, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
			if err == nil || errors.Is(err, shopifyconnector.ErrInvalidFulfillment) || calls != len(test.responses) {
				t.Fatalf("pagination did not fail retryably calls=%d error=%v", calls, err)
			}
		})
	}
}

func TestClientRejectsUnpageableFulfillmentOverflowBeforeMutation(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		fulfillments := make([]map[string]any, shopifyFulfillmentContextLimit+1)
		for index := range fulfillments {
			fulfillments[index] = map[string]any{"id": fmt.Sprintf("gid://shopify/Fulfillment/%d", index+1), "status": "CANCELLED", "updatedAt": "2026-08-02T01:02:03Z", "trackingInfo": []any{}, "fulfillmentLineItems": map[string]any{"nodes": []any{}, "pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil}}}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"data": map[string]any{"order": map[string]any{"id": "gid://shopify/Order/1", "fulfillmentOrders": map[string]any{"nodes": []any{}, "pageInfo": map[string]any{"hasNextPage": false, "endCursor": nil}}, "fulfillments": fulfillments}}})
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())

	_, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
	if !errors.Is(err, shopifyconnector.ErrInvalidFulfillment) || calls != 1 {
		t.Fatalf("overflow did not fail before mutation calls=%d error=%v", calls, err)
	}
}

func TestClientMapsFulfillmentUserErrorsToInvalidWithoutDetails(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		if calls == 1 {
			_, _ = w.Write([]byte(`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"gid://shopify/FulfillmentOrder/10","status":"OPEN","supportedActions":["CREATE_FULFILLMENT"],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"nodes":[{"id":"gid://shopify/FulfillmentOrderLineItem/30","remainingQuantity":2,"lineItem":{"id":"gid://shopify/LineItem/40"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`))
			return
		}
		_, _ = w.Write([]byte(`{"data":{"fulfillmentCreate":{"fulfillment":null,"userErrors":[{"field":["fulfillment"],"message":"provider secret shpat_forbidden"}]}}}`))
	}))
	defer server.Close()
	client, _ := newClient("2026-07", server.URL, server.Client())

	_, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
	if !errors.Is(err, shopifyconnector.ErrInvalidFulfillment) || strings.Contains(err.Error(), "provider secret") || calls != 2 {
		t.Fatalf("user error was not minimized calls=%d error=%v", calls, err)
	}
}

func TestClientFailsClosedOnMalformedInitialFulfillmentShape(t *testing.T) {
	tests := []struct {
		name     string
		response string
	}{
		{"missing fulfillments", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}`},
		{"missing fulfillment order nodes", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`},
		{"missing fulfillment order page info", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[]},"fulfillments":[]}}}`},
		{"invalid fulfillment order gid", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"not-a-gid","status":"OPEN","supportedActions":[],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`},
		{"missing line nodes", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"gid://shopify/FulfillmentOrder/10","status":"OPEN","supportedActions":[],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"pageInfo":{"hasNextPage":false,"endCursor":null}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`},
		{"missing published tracking", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}]}}}`},
		{"duplicate published fulfillment", `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[],"fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}},{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[],"fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}]}}}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				_, _ = w.Write([]byte(test.response))
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			_, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
			if err == nil || errors.Is(err, shopifyconnector.ErrInvalidFulfillment) || calls != 1 {
				t.Fatalf("malformed shape did not fail retryably before mutation calls=%d error=%v", calls, err)
			}
		})
	}
}

func TestClientFailsClosedOnEveryNestedContinuationBoundary(t *testing.T) {
	tests := []struct {
		name      string
		responses []string
	}{
		{"fulfillment order parent changed", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"fo-next"}},"fulfillments":[]}}}`,
			`{"data":{"order":{"id":"gid://shopify/Order/2","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}`,
		}},
		{"fulfillment order line missing nodes", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"gid://shopify/FulfillmentOrder/10","status":"OPEN","supportedActions":["CREATE_FULFILLMENT"],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"line-next"}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`,
			`{"data":{"fulfillmentOrder":{"id":"gid://shopify/FulfillmentOrder/10","lineItems":{"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}`,
		}},
		{"fulfillment order line missing cursor", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"gid://shopify/FulfillmentOrder/10","status":"OPEN","supportedActions":["CREATE_FULFILLMENT"],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"line-next"}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`,
			`{"data":{"fulfillmentOrder":{"id":"gid://shopify/FulfillmentOrder/10","lineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":null}}}}}`,
		}},
		{"published fulfillment line parent changed", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[],"fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"published-next"}}}]}}}`,
			`{"data":{"fulfillment":{"id":"gid://shopify/Fulfillment/51","fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}}}}}`,
		}},
		{"published fulfillment line repeated cursor", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[],"fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}]}}}`,
			`{"data":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"same"}}}}}`,
		}},
		{"published fulfillment line missing cursor", []string{
			`{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[],"fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":"published-next"}}}]}}}`,
			`{"data":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","fulfillmentLineItems":{"nodes":[],"pageInfo":{"hasNextPage":true,"endCursor":null}}}}}`,
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				if calls >= len(test.responses) {
					t.Fatal("continuation failure reached mutation")
				}
				_, _ = w.Write([]byte(test.responses[calls]))
				calls++
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			_, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
			if err == nil || errors.Is(err, shopifyconnector.ErrInvalidFulfillment) || calls != len(test.responses) {
				t.Fatalf("continuation did not fail retryably calls=%d error=%v", calls, err)
			}
		})
	}
}

func TestClientClassifiesFulfillmentMutationPayloadsSafely(t *testing.T) {
	tests := []struct {
		name        string
		mutation    string
		wantInvalid bool
	}{
		{"definite user error", `{"data":{"fulfillmentCreate":{"fulfillment":null,"userErrors":[{"field":null,"message":"provider rejection"}]}}}`, true},
		{"contradictory success and user error", `{"data":{"fulfillmentCreate":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","createdAt":"2026-08-02T01:02:02Z","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[{"company":"UPS","number":"1Z123","url":null}]},"userErrors":[{"field":["fulfillment"],"message":"contradiction"}]}}}`, false},
		{"missing user errors", `{"data":{"fulfillmentCreate":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","createdAt":"2026-08-02T01:02:02Z","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[{"company":"UPS","number":"1Z123","url":null}]}}}}`, false},
		{"missing updated timestamp", `{"data":{"fulfillmentCreate":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","createdAt":"2026-08-02T01:02:02Z","trackingInfo":[{"company":"UPS","number":"1Z123","url":null}]},"userErrors":[]}}}`, false},
		{"mismatched tracking", `{"data":{"fulfillmentCreate":{"fulfillment":{"id":"gid://shopify/Fulfillment/50","status":"SUCCESS","createdAt":"2026-08-02T01:02:02Z","updatedAt":"2026-08-02T01:02:03Z","trackingInfo":[{"company":"UPS","number":"OTHER","url":null}]},"userErrors":[]}}}`, false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			calls := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				calls++
				if calls == 1 {
					_, _ = w.Write([]byte(validFulfillmentCreateContext))
					return
				}
				_, _ = w.Write([]byte(test.mutation))
			}))
			defer server.Close()
			client, _ := newClient("2026-07", server.URL, server.Client())
			_, err := client.PublishFulfillment(t.Context(), "orders.myshopify.com", "token", fulfillmentRequest())
			if err == nil || errors.Is(err, shopifyconnector.ErrInvalidFulfillment) != test.wantInvalid || calls != 2 {
				t.Fatalf("mutation classification mismatch calls=%d error=%v", calls, err)
			}
		})
	}
}

func TestFulfillmentRecoveryAndGroupingRejectContradictions(t *testing.T) {
	now := time.Date(2026, 8, 2, 1, 2, 3, 0, time.UTC)
	tracking := []fulfillmentTrackingInfo{{Number: "1Z123"}}
	matchingLines := shopifyPublishedFulfillmentLineItemConnection{Nodes: []shopifyPublishedFulfillmentLineItemNode{{Quantity: 2, LineItem: &struct {
		ID string `json:"id"`
	}{ID: "gid://shopify/LineItem/40"}}}}
	for _, test := range []struct {
		name         string
		fulfillments []shopifyPublishedFulfillment
	}{
		{"non-success tracking collision", []shopifyPublishedFulfillment{{ID: "gid://shopify/Fulfillment/50", Status: "CANCELLED", UpdatedAt: now, TrackingInfo: tracking, FulfillmentLineItems: matchingLines}}},
		{"multiple exact fulfillments", []shopifyPublishedFulfillment{{ID: "gid://shopify/Fulfillment/50", Status: "SUCCESS", UpdatedAt: now, TrackingInfo: tracking, FulfillmentLineItems: matchingLines}, {ID: "gid://shopify/Fulfillment/51", Status: "SUCCESS", UpdatedAt: now, TrackingInfo: tracking, FulfillmentLineItems: matchingLines}}},
		{"same tracking different lines", []shopifyPublishedFulfillment{{ID: "gid://shopify/Fulfillment/50", Status: "SUCCESS", UpdatedAt: now, TrackingInfo: tracking, FulfillmentLineItems: shopifyPublishedFulfillmentLineItemConnection{Nodes: []shopifyPublishedFulfillmentLineItemNode{{Quantity: 1, LineItem: &struct {
			ID string `json:"id"`
		}{ID: "gid://shopify/LineItem/99"}}}}}}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, _, err := recoverPublishedFulfillment(test.fulfillments, "1Z123", map[string]int{"gid://shopify/LineItem/40": 2})
			if !errors.Is(err, shopifyconnector.ErrInvalidFulfillment) {
				t.Fatalf("recovery contradiction was accepted: %v", err)
			}
		})
	}
}

func TestFulfillmentGroupingRequiresSupportedSameLocationExactQuantity(t *testing.T) {
	line := func(id, orderLine string, remaining int) shopifyFulfillmentOrderLineItemNode {
		return shopifyFulfillmentOrderLineItemNode{
			ID: id, RemainingQuantity: remaining,
			LineItem: &struct {
				ID string `json:"id"`
			}{ID: orderLine},
		}
	}
	order := func(id, location string, actions []string, lines ...shopifyFulfillmentOrderLineItemNode) shopifyFulfillmentOrderNode {
		result := shopifyFulfillmentOrderNode{ID: id, SupportedActions: actions}
		result.AssignedLocation.Location = &struct {
			ID string `json:"id"`
		}{ID: location}
		result.LineItems.Nodes = lines
		return result
	}
	requested := map[string]int{"gid://shopify/LineItem/40": 2}
	for _, test := range []struct {
		name   string
		orders []shopifyFulfillmentOrderNode
	}{
		{"unsupported action", []shopifyFulfillmentOrderNode{order("gid://shopify/FulfillmentOrder/10", "gid://shopify/Location/20", []string{"HOLD"}, line("gid://shopify/FulfillmentOrderLineItem/30", "gid://shopify/LineItem/40", 2))}},
		{"insufficient quantity", []shopifyFulfillmentOrderNode{order("gid://shopify/FulfillmentOrder/10", "gid://shopify/Location/20", []string{"CREATE_FULFILLMENT"}, line("gid://shopify/FulfillmentOrderLineItem/30", "gid://shopify/LineItem/40", 1))}},
		{"multiple locations", []shopifyFulfillmentOrderNode{
			order("gid://shopify/FulfillmentOrder/10", "gid://shopify/Location/20", []string{"CREATE_FULFILLMENT"}, line("gid://shopify/FulfillmentOrderLineItem/30", "gid://shopify/LineItem/40", 1)),
			order("gid://shopify/FulfillmentOrder/11", "gid://shopify/Location/21", []string{"CREATE_FULFILLMENT"}, line("gid://shopify/FulfillmentOrderLineItem/31", "gid://shopify/LineItem/40", 1)),
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, err := fulfillmentOrderGroups(test.orders, requested)
			if !errors.Is(err, shopifyconnector.ErrInvalidFulfillment) {
				t.Fatalf("invalid grouping was accepted: %v", err)
			}
		})
	}
}

const validFulfillmentCreateContext = `{"data":{"order":{"id":"gid://shopify/Order/1","fulfillmentOrders":{"nodes":[{"id":"gid://shopify/FulfillmentOrder/10","status":"OPEN","supportedActions":["CREATE_FULFILLMENT"],"assignedLocation":{"location":{"id":"gid://shopify/Location/20"}},"lineItems":{"nodes":[{"id":"gid://shopify/FulfillmentOrderLineItem/30","remainingQuantity":2,"lineItem":{"id":"gid://shopify/LineItem/40"}}],"pageInfo":{"hasNextPage":false,"endCursor":null}}}],"pageInfo":{"hasNextPage":false,"endCursor":null}},"fulfillments":[]}}}`

func fulfillmentRequest() shopifyconnector.FulfillmentPublishRequest {
	return shopifyconnector.FulfillmentPublishRequest{
		Identity: shopifyconnector.CanonicalShopIdentity{TenantID: "11111111-1111-4111-8111-111111111111", ShopID: "22222222-2222-4222-8222-222222222222"},
		Context:  shopifyconnector.RequestContext{CorrelationID: "corr-fulfillment", RequestID: "request-fulfillment"},
		OrderID:  "gid://shopify/Order/1", IdempotencyKey: "fulfillment-command-1", NotifyCustomer: true,
		Tracking: shopifyconnector.CatalogTrackingInfo{Company: "UPS", Number: "1Z123", URL: "https://track.example/1Z123"},
		Lines:    []shopifyconnector.FulfillmentLineInput{{OrderLineID: "gid://shopify/LineItem/40", Quantity: 2}},
	}
}
