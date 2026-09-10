package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const shopifyOrderCancellationQuery = `
query XZERPOrderCancellationState($id: ID!) {
  order(id: $id) {
    id cancelledAt cancelReason
    cancellation { staffNote }
  }
}`

const shopifyOrderCancelMutation = `
mutation XZERPOrderCancel(
  $orderId: ID!, $notifyCustomer: Boolean!,
  $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!,
  $reason: OrderCancelReason!, $staffNote: String!
) {
  orderCancel(
    orderId: $orderId, notifyCustomer: $notifyCustomer,
    refundMethod: $refundMethod, restock: $restock,
    reason: $reason, staffNote: $staffNote
  ) {
    job { id done }
    orderCancelUserErrors { field message code }
  }
}`

type shopifyOrderCancellationState struct {
	ID           string `json:"id"`
	CancelledAt  string `json:"cancelledAt"`
	CancelReason string `json:"cancelReason"`
	Cancellation *struct {
		StaffNote string `json:"staffNote"`
	} `json:"cancellation"`
}

func cancellationStaffNote(request shopifyconnector.OrderCancellationRequest) string {
	marker := "[XZ ERP:" + request.IdempotencyKey + "]"
	note := strings.TrimSpace(request.StaffNote)
	if note == "" {
		return marker
	}
	return note + " " + marker
}

func (c shopifyAdminClient) fetchOrderCancellationState(
	ctx context.Context, shopDomain string, accessToken string, orderID string,
) (shopifyOrderCancellationState, error) {
	var data struct {
		Order *shopifyOrderCancellationState `json:"order"`
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderCancellationQuery, map[string]any{"id": orderID}, &data); err != nil {
		return shopifyOrderCancellationState{}, err
	}
	if data.Order == nil || data.Order.ID != orderID {
		return shopifyOrderCancellationState{}, fmt.Errorf("%w: Shopify order was not found", ErrInvalid)
	}
	return *data.Order, nil
}

func exactCancellation(
	state shopifyOrderCancellationState,
	request shopifyconnector.OrderCancellationRequest,
) (time.Time, bool) {
	if state.CancelledAt == "" || state.Cancellation == nil ||
		state.CancelReason != string(request.Reason) ||
		state.Cancellation.StaffNote != cancellationStaffNote(request) {
		return time.Time{}, false
	}
	cancelledAt, err := time.Parse(time.RFC3339, state.CancelledAt)
	return cancelledAt, err == nil && !cancelledAt.IsZero()
}

func (c shopifyAdminClient) CancelOrder(
	ctx context.Context, shopDomain string, accessToken string,
	request shopifyconnector.OrderCancellationRequest,
) (shopifyconnector.OrderCancellationResult, error) {
	state, err := c.fetchOrderCancellationState(
		ctx, shopDomain, accessToken, request.OrderID)
	if err != nil {
		return shopifyconnector.OrderCancellationResult{}, err
	}
	if state.CancelledAt != "" {
		if cancelledAt, exact := exactCancellation(state, request); request.RecoverExisting && exact {
			return orderCancellationResult(request, cancelledAt, "", true), nil
		}
		return shopifyconnector.OrderCancellationResult{},
			fmt.Errorf("%w: Shopify order is already cancelled", ErrInvalid)
	}

	var data struct {
		OrderCancel struct {
			Job *struct {
				ID   string `json:"id"`
				Done bool   `json:"done"`
			} `json:"job"`
			UserErrors []shopifyMutationUserError `json:"orderCancelUserErrors"`
		} `json:"orderCancel"`
	}
	variables := map[string]any{
		"orderId":        request.OrderID,
		"notifyCustomer": request.NotifyCustomer,
		"refundMethod": map[string]any{
			"originalPaymentMethodsRefund": request.RefundOriginalPaymentMethods,
		},
		"restock":   request.Restock,
		"reason":    string(request.Reason),
		"staffNote": cancellationStaffNote(request),
	}
	if err := c.queryAdminGraphQL(ctx, shopDomain, accessToken,
		shopifyOrderCancelMutation, variables, &data); err != nil {
		return shopifyconnector.OrderCancellationResult{}, err
	}
	if err := shopifyMutationError("鍙栨秷璁㈠崟", data.OrderCancel.UserErrors); err != nil {
		return shopifyconnector.OrderCancellationResult{}, err
	}
	if data.OrderCancel.Job == nil ||
		!strings.HasPrefix(data.OrderCancel.Job.ID, "gid://shopify/Job/") {
		return shopifyconnector.OrderCancellationResult{},
			fmt.Errorf("%w: Shopify cancellation job is invalid", ErrInvalid)
	}
	jobID := data.OrderCancel.Job.ID
	for attempt := 0; attempt < 10; attempt++ {
		state, err = c.fetchOrderCancellationState(
			ctx, shopDomain, accessToken, request.OrderID)
		if err != nil {
			return shopifyconnector.OrderCancellationResult{}, err
		}
		if cancelledAt, exact := exactCancellation(state, request); exact {
			return orderCancellationResult(request, cancelledAt, jobID, false), nil
		}
		if state.CancelledAt != "" {
			return shopifyconnector.OrderCancellationResult{},
				fmt.Errorf("%w: Shopify cancellation identity changed", ErrInvalid)
		}
		select {
		case <-ctx.Done():
			return shopifyconnector.OrderCancellationResult{}, ctx.Err()
		case <-time.After(200 * time.Millisecond):
		}
	}
	return shopifyconnector.OrderCancellationResult{}, context.DeadlineExceeded
}

func orderCancellationResult(
	request shopifyconnector.OrderCancellationRequest,
	cancelledAt time.Time, jobID string, recovered bool,
) shopifyconnector.OrderCancellationResult {
	return shopifyconnector.OrderCancellationResult{
		ContractVersion: shopifyconnector.OrderCancellationContractVersion,
		TenantID:        request.Identity.TenantID, ShopID: request.Identity.ShopID,
		OrderID: request.OrderID, Reason: request.Reason,
		CancelledAt: cancelledAt.UTC(), JobID: jobID,
		RecoveredFromShopify: recovered, UpdatedAt: time.Now().UTC(),
	}
}

type shopifyOrderCancellationWriter func(
	context.Context, string, string, shopifyconnector.OrderCancellationRequest,
) (shopifyconnector.OrderCancellationResult, error)

type shopifyOrderCancellationAdapter struct {
	resolve shopifyConnectorBindingResolver
	store   Store
	token   shopifyOrderCatalogToken
	write   shopifyOrderCancellationWriter
}

func newShopifyOrderCancellationAdapter(
	server *Server, resolver shopifyConnectorBindingResolver,
) *shopifyOrderCancellationAdapter {
	if server == nil {
		return newShopifyOrderCancellationAdapterWithWriter(resolver, nil, nil, nil)
	}
	return newShopifyOrderCancellationAdapterWithWriter(
		resolver, server.store, server.shopifyAdminTokenForShop, nil)
}

func newShopifyOrderCancellationAdapterWithWriter(
	resolver shopifyConnectorBindingResolver, store Store,
	token shopifyOrderCatalogToken, write shopifyOrderCancellationWriter,
) *shopifyOrderCancellationAdapter {
	if write == nil {
		write = (shopifyAdminClient{
			HTTPClient: &http.Client{Timeout: 20 * time.Second},
		}).CancelOrder
	}
	return &shopifyOrderCancellationAdapter{
		resolve: resolver, store: store, token: token, write: write,
	}
}

func (a *shopifyOrderCancellationAdapter) CancelOrder(
	ctx context.Context, request shopifyconnector.OrderCancellationRequest,
) (shopifyconnector.OrderCancellationResult, error) {
	if err := shopifyconnector.ValidateOrderCancellationRequest(request); err != nil {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.InvalidOrderCancellationRequestError(request)
	}
	if err := ctx.Err(); err != nil || a.resolve == nil || a.store == nil ||
		a.token == nil || a.write == nil {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.SafeOrderCancellationErrorFor(request, err)
	}
	legacyShopID, err := a.resolve.ResolveLegacyShopID(ctx, request.Identity)
	if err != nil || strings.TrimSpace(legacyShopID) == "" {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.ForbiddenOrderCancellationError(request)
	}
	shop, err := a.store.GetShop(ctx, legacyShopID)
	if err != nil || shop.Status != ShopStatusActive {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.ForbiddenOrderCancellationError(request)
	}
	sources, err := a.store.ListShopSources(ctx, legacyShopID)
	if err != nil {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.SafeOrderCancellationErrorFor(request, err)
	}
	domain := shopifyDomainForShop(shop, sources)
	installation, err := a.store.GetShopifyInstallationByDomain(ctx, domain)
	if err != nil ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderReadScope) ||
		!shopifyScopeIncludes(installation.Scope, shopifyOrderWriteScope) {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.ForbiddenOrderCancellationError(request)
	}
	accessToken := a.token(ctx, legacyShopID, domain)
	if domain == "" || strings.TrimSpace(accessToken) == "" {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.ForbiddenOrderCancellationError(request)
	}
	result, err := a.write(ctx, domain, accessToken, request)
	if err != nil {
		if errors.Is(err, ErrInvalid) {
			return shopifyconnector.OrderCancellationResult{},
				shopifyconnector.InvalidOrderCancellationRequestError(request)
		}
		if isShopifyAuthorizationError(err) {
			return shopifyconnector.OrderCancellationResult{},
				shopifyconnector.ForbiddenOrderCancellationError(request)
		}
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.SafeOrderCancellationErrorFor(request, err)
	}
	if result.OrderID != request.OrderID || result.Reason != request.Reason ||
		result.CancelledAt.IsZero() || result.CancelledAt.After(time.Now().UTC().Add(time.Minute)) {
		return shopifyconnector.OrderCancellationResult{},
			shopifyconnector.SafeOrderCancellationErrorFor(
				request, errors.New("invalid provider result"))
	}
	result.ContractVersion = shopifyconnector.OrderCancellationContractVersion
	result.TenantID = request.Identity.TenantID
	result.ShopID = request.Identity.ShopID
	if result.UpdatedAt.IsZero() {
		result.UpdatedAt = time.Now().UTC()
	}
	return result, nil
}

var _ shopifyconnector.OrderCanceller = (*shopifyOrderCancellationAdapter)(nil)
