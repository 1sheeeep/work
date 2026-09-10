package adminapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type requiredFulfillmentField[T any] struct {
	Value T
	Set   bool
	Null  bool
}

func (field *requiredFulfillmentField[T]) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Null = true
		return nil
	}
	return json.Unmarshal(data, &field.Value)
}

type fulfillmentContextWire struct {
	Order requiredFulfillmentField[fulfillmentOrderContextWire] `json:"order"`
}

type fulfillmentOrderContextWire struct {
	ID                requiredFulfillmentField[string]                         `json:"id"`
	FulfillmentOrders requiredFulfillmentField[fulfillmentOrderConnectionWire] `json:"fulfillmentOrders"`
	Fulfillments      requiredFulfillmentField[[]publishedFulfillmentWire]     `json:"fulfillments"`
}

type fulfillmentOrderConnectionWire struct {
	Nodes    requiredFulfillmentField[[]fulfillmentOrderNodeWire] `json:"nodes"`
	PageInfo requiredFulfillmentField[fulfillmentPageInfoWire]    `json:"pageInfo"`
}

type fulfillmentOrderNodeWire struct {
	ID               requiredFulfillmentField[string]                             `json:"id"`
	Status           requiredFulfillmentField[string]                             `json:"status"`
	SupportedActions requiredFulfillmentField[[]string]                           `json:"supportedActions"`
	AssignedLocation requiredFulfillmentField[fulfillmentAssignedLocationWire]    `json:"assignedLocation"`
	LineItems        requiredFulfillmentField[fulfillmentOrderLineConnectionWire] `json:"lineItems"`
}

type fulfillmentAssignedLocationWire struct {
	Location requiredFulfillmentField[fulfillmentLocationWire] `json:"location"`
}

type fulfillmentLocationWire struct {
	ID requiredFulfillmentField[string] `json:"id"`
}

type fulfillmentOrderLineConnectionWire struct {
	Nodes    requiredFulfillmentField[[]fulfillmentOrderLineWire] `json:"nodes"`
	PageInfo requiredFulfillmentField[fulfillmentPageInfoWire]    `json:"pageInfo"`
}

type fulfillmentOrderLineWire struct {
	ID                requiredFulfillmentField[string]              `json:"id"`
	RemainingQuantity requiredFulfillmentField[int]                 `json:"remainingQuantity"`
	LineItem          requiredFulfillmentField[fulfillmentLineWire] `json:"lineItem"`
}

type fulfillmentLineWire struct {
	ID requiredFulfillmentField[string] `json:"id"`
}

type publishedFulfillmentWire struct {
	ID                   requiredFulfillmentField[string]                                 `json:"id"`
	Status               requiredFulfillmentField[string]                                 `json:"status"`
	UpdatedAt            requiredFulfillmentField[string]                                 `json:"updatedAt"`
	TrackingInfo         requiredFulfillmentField[[]fulfillmentTrackingInfoWire]          `json:"trackingInfo"`
	FulfillmentLineItems requiredFulfillmentField[publishedFulfillmentLineConnectionWire] `json:"fulfillmentLineItems"`
}

type publishedFulfillmentLineConnectionWire struct {
	Nodes    requiredFulfillmentField[[]publishedFulfillmentLineWire] `json:"nodes"`
	PageInfo requiredFulfillmentField[fulfillmentPageInfoWire]        `json:"pageInfo"`
}

type publishedFulfillmentLineWire struct {
	Quantity requiredFulfillmentField[int]                 `json:"quantity"`
	LineItem requiredFulfillmentField[fulfillmentLineWire] `json:"lineItem"`
}

type fulfillmentTrackingInfoWire struct {
	Company requiredFulfillmentField[string] `json:"company"`
	Number  requiredFulfillmentField[string] `json:"number"`
	URL     requiredFulfillmentField[string] `json:"url"`
}

type fulfillmentPageInfoWire struct {
	HasNextPage requiredFulfillmentField[bool]   `json:"hasNextPage"`
	EndCursor   requiredFulfillmentField[string] `json:"endCursor"`
}

type fulfillmentMutationWire struct {
	FulfillmentCreate requiredFulfillmentField[fulfillmentMutationPayloadWire] `json:"fulfillmentCreate"`
}

type fulfillmentMutationPayloadWire struct {
	Fulfillment requiredFulfillmentField[createdFulfillmentWire]     `json:"fulfillment"`
	UserErrors  requiredFulfillmentField[[]fulfillmentUserErrorWire] `json:"userErrors"`
}

type createdFulfillmentWire struct {
	ID           requiredFulfillmentField[string]                        `json:"id"`
	Status       requiredFulfillmentField[string]                        `json:"status"`
	CreatedAt    requiredFulfillmentField[string]                        `json:"createdAt"`
	UpdatedAt    requiredFulfillmentField[string]                        `json:"updatedAt"`
	TrackingInfo requiredFulfillmentField[[]fulfillmentTrackingInfoWire] `json:"trackingInfo"`
}

type fulfillmentUserErrorWire struct {
	Field   requiredFulfillmentField[[]string] `json:"field"`
	Message requiredFulfillmentField[string]   `json:"message"`
}

func normalizeFulfillmentContext(
	wire fulfillmentContextWire,
	orderID string,
) (*shopifyFulfillmentOrderContext, error) {
	if !wire.Order.Set {
		return nil, incompleteShopifyFulfillmentContext("order shape")
	}
	if wire.Order.Null {
		return nil, fmt.Errorf("%w: order is unavailable", shopifyconnector.ErrInvalidFulfillment)
	}
	order := wire.Order.Value
	if !requiredString(order.ID) || order.ID.Value != orderID {
		return nil, incompleteShopifyFulfillmentContext("order identity")
	}
	orders, err := normalizeFulfillmentOrderConnection(order.FulfillmentOrders)
	if err != nil {
		return nil, err
	}
	if !order.Fulfillments.Set || order.Fulfillments.Null {
		return nil, incompleteShopifyFulfillmentContext("published fulfillments")
	}
	if len(order.Fulfillments.Value) > shopifyFulfillmentContextLimit {
		return nil, fmt.Errorf("%w: fulfillment limit exceeded", shopifyconnector.ErrInvalidFulfillment)
	}
	fulfillments, err := normalizePublishedFulfillments(order.Fulfillments)
	if err != nil {
		return nil, err
	}
	return &shopifyFulfillmentOrderContext{
		ID:                order.ID.Value,
		FulfillmentOrders: orders,
		Fulfillments:      fulfillments,
	}, nil
}

func normalizeFulfillmentOrderConnection(
	field requiredFulfillmentField[fulfillmentOrderConnectionWire],
) (shopifyFulfillmentOrderConnection, error) {
	if !field.Set || field.Null || !field.Value.Nodes.Set || field.Value.Nodes.Null {
		return shopifyFulfillmentOrderConnection{}, incompleteShopifyFulfillmentContext("fulfillment order nodes")
	}
	pageInfo, err := normalizeFulfillmentPageInfo(field.Value.PageInfo)
	if err != nil {
		return shopifyFulfillmentOrderConnection{}, err
	}
	nodes := make([]shopifyFulfillmentOrderNode, 0, len(field.Value.Nodes.Value))
	seen := make(map[string]struct{}, len(field.Value.Nodes.Value))
	for _, wireNode := range field.Value.Nodes.Value {
		node, err := normalizeFulfillmentOrder(wireNode)
		if err != nil {
			return shopifyFulfillmentOrderConnection{}, err
		}
		if _, duplicate := seen[node.ID]; duplicate {
			return shopifyFulfillmentOrderConnection{}, incompleteShopifyFulfillmentContext("duplicate fulfillment order")
		}
		seen[node.ID] = struct{}{}
		nodes = append(nodes, node)
	}
	return shopifyFulfillmentOrderConnection{Nodes: nodes, PageInfo: pageInfo}, nil
}

func normalizeFulfillmentOrder(
	wire fulfillmentOrderNodeWire,
) (shopifyFulfillmentOrderNode, error) {
	if !requiredGID(wire.ID, "gid://shopify/FulfillmentOrder/") ||
		!requiredEnum(wire.Status) || !wire.SupportedActions.Set || wire.SupportedActions.Null ||
		!wire.AssignedLocation.Set || wire.AssignedLocation.Null ||
		!wire.AssignedLocation.Value.Location.Set || wire.AssignedLocation.Value.Location.Null ||
		!requiredGID(wire.AssignedLocation.Value.Location.Value.ID, "gid://shopify/Location/") {
		return shopifyFulfillmentOrderNode{}, incompleteShopifyFulfillmentContext("fulfillment order shape")
	}
	actions := append([]string(nil), wire.SupportedActions.Value...)
	seenActions := make(map[string]struct{}, len(actions))
	for _, action := range actions {
		if !validEnum(action) {
			return shopifyFulfillmentOrderNode{}, incompleteShopifyFulfillmentContext("fulfillment order actions")
		}
		if _, duplicate := seenActions[action]; duplicate {
			return shopifyFulfillmentOrderNode{}, incompleteShopifyFulfillmentContext("duplicate fulfillment order action")
		}
		seenActions[action] = struct{}{}
	}
	lines, err := normalizeFulfillmentOrderLines(wire.LineItems)
	if err != nil {
		return shopifyFulfillmentOrderNode{}, err
	}
	node := shopifyFulfillmentOrderNode{
		ID:               wire.ID.Value,
		Status:           wire.Status.Value,
		SupportedActions: actions,
		LineItems:        lines,
	}
	node.AssignedLocation.Location = &struct {
		ID string `json:"id"`
	}{
		ID: wire.AssignedLocation.Value.Location.Value.ID.Value,
	}
	return node, nil
}

func normalizeFulfillmentOrderLines(
	field requiredFulfillmentField[fulfillmentOrderLineConnectionWire],
) (shopifyFulfillmentOrderLineItemConnection, error) {
	if !field.Set || field.Null || !field.Value.Nodes.Set || field.Value.Nodes.Null {
		return shopifyFulfillmentOrderLineItemConnection{}, incompleteShopifyFulfillmentContext("fulfillment order line nodes")
	}
	pageInfo, err := normalizeFulfillmentPageInfo(field.Value.PageInfo)
	if err != nil {
		return shopifyFulfillmentOrderLineItemConnection{}, err
	}
	nodes := make([]shopifyFulfillmentOrderLineItemNode, 0, len(field.Value.Nodes.Value))
	seen := make(map[string]struct{}, len(field.Value.Nodes.Value))
	for _, wireLine := range field.Value.Nodes.Value {
		if !requiredGID(wireLine.ID, "gid://shopify/FulfillmentOrderLineItem/") ||
			!wireLine.RemainingQuantity.Set || wireLine.RemainingQuantity.Null ||
			wireLine.RemainingQuantity.Value < 0 || !wireLine.LineItem.Set || wireLine.LineItem.Null ||
			!requiredGID(wireLine.LineItem.Value.ID, "gid://shopify/LineItem/") {
			return shopifyFulfillmentOrderLineItemConnection{}, incompleteShopifyFulfillmentContext("fulfillment order line shape")
		}
		if _, duplicate := seen[wireLine.ID.Value]; duplicate {
			return shopifyFulfillmentOrderLineItemConnection{}, incompleteShopifyFulfillmentContext("duplicate fulfillment order line")
		}
		seen[wireLine.ID.Value] = struct{}{}
		line := shopifyFulfillmentOrderLineItemNode{
			ID:                wireLine.ID.Value,
			RemainingQuantity: wireLine.RemainingQuantity.Value,
			LineItem: &struct {
				ID string `json:"id"`
			}{ID: wireLine.LineItem.Value.ID.Value},
		}
		nodes = append(nodes, line)
	}
	return shopifyFulfillmentOrderLineItemConnection{Nodes: nodes, PageInfo: pageInfo}, nil
}

func normalizePublishedFulfillments(
	field requiredFulfillmentField[[]publishedFulfillmentWire],
) ([]shopifyPublishedFulfillment, error) {
	if !field.Set || field.Null {
		return nil, incompleteShopifyFulfillmentContext("published fulfillments")
	}
	result := make([]shopifyPublishedFulfillment, 0, len(field.Value))
	seen := make(map[string]struct{}, len(field.Value))
	for _, wire := range field.Value {
		item, err := normalizePublishedFulfillment(wire)
		if err != nil {
			return nil, err
		}
		if _, duplicate := seen[item.ID]; duplicate {
			return nil, incompleteShopifyFulfillmentContext("duplicate published fulfillment")
		}
		seen[item.ID] = struct{}{}
		result = append(result, item)
	}
	return result, nil
}

func normalizePublishedFulfillment(
	wire publishedFulfillmentWire,
) (shopifyPublishedFulfillment, error) {
	if !requiredGID(wire.ID, "gid://shopify/Fulfillment/") || !requiredEnum(wire.Status) {
		return shopifyPublishedFulfillment{}, incompleteShopifyFulfillmentContext("published fulfillment shape")
	}
	updatedAt, err := requiredTimestamp(wire.UpdatedAt)
	if err != nil {
		return shopifyPublishedFulfillment{}, incompleteShopifyFulfillmentContext("published fulfillment timestamp")
	}
	tracking, err := normalizeTrackingInfo(wire.TrackingInfo)
	if err != nil {
		return shopifyPublishedFulfillment{}, err
	}
	lines, err := normalizePublishedFulfillmentLines(wire.FulfillmentLineItems)
	if err != nil {
		return shopifyPublishedFulfillment{}, err
	}
	return shopifyPublishedFulfillment{
		ID: wire.ID.Value, Status: wire.Status.Value, UpdatedAt: updatedAt,
		TrackingInfo: tracking, FulfillmentLineItems: lines,
	}, nil
}

func normalizePublishedFulfillmentLines(
	field requiredFulfillmentField[publishedFulfillmentLineConnectionWire],
) (shopifyPublishedFulfillmentLineItemConnection, error) {
	if !field.Set || field.Null || !field.Value.Nodes.Set || field.Value.Nodes.Null {
		return shopifyPublishedFulfillmentLineItemConnection{}, incompleteShopifyFulfillmentContext("published fulfillment line nodes")
	}
	pageInfo, err := normalizeFulfillmentPageInfo(field.Value.PageInfo)
	if err != nil {
		return shopifyPublishedFulfillmentLineItemConnection{}, err
	}
	nodes := make([]shopifyPublishedFulfillmentLineItemNode, 0, len(field.Value.Nodes.Value))
	for _, wireLine := range field.Value.Nodes.Value {
		if !wireLine.Quantity.Set || wireLine.Quantity.Null || wireLine.Quantity.Value < 1 ||
			!wireLine.LineItem.Set || wireLine.LineItem.Null ||
			!requiredGID(wireLine.LineItem.Value.ID, "gid://shopify/LineItem/") {
			return shopifyPublishedFulfillmentLineItemConnection{}, incompleteShopifyFulfillmentContext("published fulfillment line shape")
		}
		nodes = append(nodes, shopifyPublishedFulfillmentLineItemNode{
			Quantity: wireLine.Quantity.Value,
			LineItem: &struct {
				ID string `json:"id"`
			}{ID: wireLine.LineItem.Value.ID.Value},
		})
	}
	return shopifyPublishedFulfillmentLineItemConnection{Nodes: nodes, PageInfo: pageInfo}, nil
}

func normalizeTrackingInfo(
	field requiredFulfillmentField[[]fulfillmentTrackingInfoWire],
) ([]fulfillmentTrackingInfo, error) {
	if !field.Set || field.Null {
		return nil, incompleteShopifyFulfillmentContext("tracking info")
	}
	result := make([]fulfillmentTrackingInfo, 0, len(field.Value))
	for _, wire := range field.Value {
		if !nullableBoundedText(wire.Company, 120) ||
			!nullableBoundedText(wire.Number, 160) ||
			!nullableTrackingURL(wire.URL) {
			return nil, incompleteShopifyFulfillmentContext("tracking info shape")
		}
		result = append(result, fulfillmentTrackingInfo{
			Company: wire.Company.Value,
			Number:  wire.Number.Value,
			URL:     wire.URL.Value,
		})
	}
	return result, nil
}

func normalizeFulfillmentPageInfo(
	field requiredFulfillmentField[fulfillmentPageInfoWire],
) (shopifyFulfillmentPageInfo, error) {
	if !field.Set || field.Null || !field.Value.HasNextPage.Set || field.Value.HasNextPage.Null ||
		!field.Value.EndCursor.Set || !nullableOpaqueCursor(field.Value.EndCursor) {
		return shopifyFulfillmentPageInfo{}, incompleteShopifyFulfillmentContext("page info")
	}
	if field.Value.HasNextPage.Value &&
		(field.Value.EndCursor.Null || strings.TrimSpace(field.Value.EndCursor.Value) == "") {
		return shopifyFulfillmentPageInfo{}, incompleteShopifyFulfillmentContext("page cursor")
	}
	return shopifyFulfillmentPageInfo{
		HasNextPage: field.Value.HasNextPage.Value,
		EndCursor:   field.Value.EndCursor.Value,
	}, nil
}

func normalizeCreatedFulfillment(
	wire fulfillmentMutationWire,
) (shopifyPublishedFulfillment, []fulfillmentUserErrorWire, bool, error) {
	if !wire.FulfillmentCreate.Set || wire.FulfillmentCreate.Null {
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("fulfillment mutation payload")
	}
	payload := wire.FulfillmentCreate.Value
	if !payload.UserErrors.Set || payload.UserErrors.Null || !payload.Fulfillment.Set {
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("fulfillment mutation result")
	}
	for _, userError := range payload.UserErrors.Value {
		if !userError.Field.Set || !nullableBoundedStringList(userError.Field, 64, 160) ||
			!requiredBoundedText(userError.Message, 1024) {
			return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("fulfillment user error shape")
		}
	}
	if len(payload.UserErrors.Value) != 0 {
		if payload.Fulfillment.Null {
			return shopifyPublishedFulfillment{}, payload.UserErrors.Value, true, nil
		}
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("contradictory fulfillment mutation result")
	}
	if payload.Fulfillment.Null {
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("missing created fulfillment")
	}
	created := payload.Fulfillment.Value
	if !requiredGID(created.ID, "gid://shopify/Fulfillment/") ||
		!requiredEnum(created.Status) || created.Status.Value != "SUCCESS" {
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("created fulfillment shape")
	}
	if _, err := requiredTimestamp(created.CreatedAt); err != nil {
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("created fulfillment timestamp")
	}
	updatedAt, err := requiredTimestamp(created.UpdatedAt)
	if err != nil {
		return shopifyPublishedFulfillment{}, nil, false, incompleteShopifyFulfillmentContext("created fulfillment timestamp")
	}
	tracking, err := normalizeTrackingInfo(created.TrackingInfo)
	if err != nil {
		return shopifyPublishedFulfillment{}, nil, false, err
	}
	return shopifyPublishedFulfillment{
		ID: created.ID.Value, Status: created.Status.Value,
		UpdatedAt: updatedAt, TrackingInfo: tracking,
	}, nil, false, nil
}

func requiredString(field requiredFulfillmentField[string]) bool {
	return field.Set && !field.Null && field.Value != "" && field.Value == strings.TrimSpace(field.Value)
}

func requiredGID(field requiredFulfillmentField[string], prefix string) bool {
	if !requiredString(field) || !strings.HasPrefix(field.Value, prefix) {
		return false
	}
	suffix := strings.TrimPrefix(field.Value, prefix)
	if suffix == "" {
		return false
	}
	for _, character := range suffix {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func requiredEnum(field requiredFulfillmentField[string]) bool {
	return requiredString(field) && validEnum(field.Value)
}

func validEnum(value string) bool {
	if len(value) < 1 || len(value) > 64 {
		return false
	}
	for _, character := range value {
		if character != '_' && (character < 'A' || character > 'Z') {
			return false
		}
	}
	return true
}

func requiredTimestamp(field requiredFulfillmentField[string]) (time.Time, error) {
	if !requiredString(field) {
		return time.Time{}, fmt.Errorf("timestamp is missing")
	}
	parsed, err := time.Parse(time.RFC3339Nano, field.Value)
	if err != nil || parsed.IsZero() {
		return time.Time{}, fmt.Errorf("timestamp is invalid")
	}
	return parsed.UTC(), nil
}

func requiredBoundedText(field requiredFulfillmentField[string], limit int) bool {
	return field.Set && !field.Null && field.Value != "" && boundedText(field.Value, limit)
}

func nullableBoundedText(field requiredFulfillmentField[string], limit int) bool {
	return field.Set && (field.Null || boundedText(field.Value, limit))
}

func boundedText(value string, limit int) bool {
	if len(value) > limit || value != strings.TrimSpace(value) {
		return false
	}
	for _, character := range value {
		if unicode.IsControl(character) {
			return false
		}
	}
	return true
}

func nullableTrackingURL(field requiredFulfillmentField[string]) bool {
	if !field.Set || field.Null || field.Value == "" {
		return field.Set
	}
	if !boundedText(field.Value, 2048) {
		return false
	}
	parsed, err := url.Parse(field.Value)
	return err == nil && parsed.Host != "" && parsed.User == nil &&
		(parsed.Scheme == "http" || parsed.Scheme == "https")
}

func nullableOpaqueCursor(field requiredFulfillmentField[string]) bool {
	if field.Null {
		return true
	}
	if len(field.Value) > 4096 || field.Value != strings.TrimSpace(field.Value) {
		return false
	}
	for _, character := range field.Value {
		if character < 0x20 || character > unicode.MaxASCII {
			return false
		}
	}
	return true
}

func nullableBoundedStringList(
	field requiredFulfillmentField[[]string],
	itemLimit int,
	textLimit int,
) bool {
	if field.Null {
		return true
	}
	if len(field.Value) > itemLimit {
		return false
	}
	for _, value := range field.Value {
		if !boundedText(value, textLimit) {
			return false
		}
	}
	return true
}
