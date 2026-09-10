package connectorclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const (
	serviceTokenHeader = "X-XZ-ERP-Connector-Token"
	maximumResponse    = 2 << 20
	defaultTimeout     = 15 * time.Second
)

var (
	canonicalUUID             = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	contextID                 = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$`)
	scopeName                 = regexp.MustCompile(`^[a-z][a-z0-9_]{0,127}$`)
	shopifyReturnGID          = regexp.MustCompile(`^gid://shopify/Return/[0-9]+$`)
	shopifyReturnLineGID      = regexp.MustCompile(`^gid://shopify/ReturnLineItem/[0-9]+$`)
	shopifyFulfillmentLineGID = regexp.MustCompile(`^gid://shopify/FulfillmentLineItem/[0-9]+$`)
	shopifyOrderLineGID       = regexp.MustCompile(`^gid://shopify/LineItem/[0-9]+$`)
	shopifyOrderGID           = regexp.MustCompile(`^gid://shopify/Order/[0-9]+$`)
	shopifyDutyGID            = regexp.MustCompile(`^gid://shopify/Duty/[0-9]+$`)
	shopifyTransactionGID     = regexp.MustCompile(`^gid://shopify/OrderTransaction/[0-9]+$`)
	moneyAmount               = regexp.MustCompile(`^(0|[1-9][0-9]*)(\.[0-9]+)?$`)
	currencyCode              = regexp.MustCompile(`^[A-Z]{3}$`)
	shopifyDisputeGID         = regexp.MustCompile(`^gid://shopify/ShopifyPaymentsDispute/[0-9]+$`)
)

type Config struct {
	BaseURL      string
	ServiceToken string
	HTTPClient   *http.Client
}

type Client struct {
	baseURL      *url.URL
	serviceToken string
	httpClient   *http.Client
}

func New(config Config) (*Client, error) {
	baseURL, err := url.Parse(strings.TrimSpace(config.BaseURL))
	if err != nil || baseURL == nil || !baseURL.IsAbs() || baseURL.Host == "" {
		return nil, errors.New("connector base URL must be absolute")
	}
	if baseURL.User != nil || baseURL.RawQuery != "" || baseURL.Fragment != "" {
		return nil, errors.New("connector base URL must not contain credentials, query or fragment")
	}
	if baseURL.Scheme != "https" && !(baseURL.Scheme == "http" && isLoopbackHost(baseURL.Hostname())) {
		return nil, errors.New("connector base URL must use HTTPS outside loopback development")
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/")
	serviceToken := strings.TrimSpace(config.ServiceToken)
	if serviceToken == "" || len(serviceToken) > 4096 {
		return nil, errors.New("connector service token is required")
	}

	configured := http.Client{Timeout: defaultTimeout}
	if config.HTTPClient != nil {
		configured = *config.HTTPClient
		if configured.Timeout <= 0 {
			configured.Timeout = defaultTimeout
		}
	}
	configured.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &Client{
		baseURL:      baseURL,
		serviceToken: serviceToken,
		httpClient:   &configured,
	}, nil
}

func (c *Client) ProbeConnection(ctx context.Context, request ScopedRequest) (ConnectionSummary, error) {
	if err := validateScopedRequest(request); err != nil {
		return ConnectionSummary{}, err
	}
	var response ConnectionSummary
	if err := c.postJSON(ctx, ConnectionProbePath, request, &response); err != nil {
		return ConnectionSummary{}, err
	}
	if err := validateConnectionSummary(request, response); err != nil {
		return ConnectionSummary{}, fmt.Errorf("invalid connector response: %w", err)
	}
	return response, nil
}

func (c *Client) DecideReturn(ctx context.Context, request ReturnDecisionRequest) (ReturnDecisionResult, error) {
	if err := validateReturnDecisionRequest(request); err != nil {
		return ReturnDecisionResult{}, err
	}
	var response ReturnDecisionResult
	if err := c.postJSON(ctx, ReturnDecisionPath, request, &response); err != nil {
		return ReturnDecisionResult{}, err
	}
	if err := validateReturnDecisionResult(request, response); err != nil {
		return ReturnDecisionResult{}, fmt.Errorf("invalid connector response: %w", err)
	}
	return response, nil
}

func (c *Client) FetchReturns(ctx context.Context, request ReturnCatalogRequest) (ReturnCatalogPage, error) {
	if err := validateReturnCatalogRequest(request); err != nil {
		return ReturnCatalogPage{}, err
	}
	var response ReturnCatalogPage
	if err := c.postJSON(ctx, ReturnCatalogPath, request, &response); err != nil {
		return ReturnCatalogPage{}, err
	}
	if err := validateReturnCatalogPage(request, response); err != nil {
		return ReturnCatalogPage{}, fmt.Errorf("invalid connector response: %w", err)
	}
	return response, nil
}

func (c *Client) PreviewReturnRefund(ctx context.Context, request ReturnRefundPreviewRequest) (ReturnRefundPreview, error) {
	if err := validateReturnRefundPreviewRequest(request); err != nil {
		return ReturnRefundPreview{}, err
	}
	var response ReturnRefundPreview
	if err := c.postJSON(ctx, ReturnRefundPreviewPath, request, &response); err != nil {
		return ReturnRefundPreview{}, err
	}
	if err := validateReturnRefundPreview(request, response); err != nil {
		return ReturnRefundPreview{}, fmt.Errorf("invalid connector response: %w", err)
	}
	return response, nil
}

func (c *Client) ProcessReturnRefund(ctx context.Context, request ReturnRefundProcessRequest) (ReturnRefundProcessResult, error) {
	if err := validateReturnRefundProcessRequest(request); err != nil {
		return ReturnRefundProcessResult{}, err
	}
	var response ReturnRefundProcessResult
	if err := c.postJSON(ctx, ReturnRefundProcessPath, request, &response); err != nil {
		return ReturnRefundProcessResult{}, err
	}
	if err := validateReturnRefundProcessResult(request, response); err != nil {
		return ReturnRefundProcessResult{}, fmt.Errorf("invalid connector response: %w", err)
	}
	return response, nil
}

func (c *Client) FetchDisputes(ctx context.Context, request DisputeCatalogRequest) (DisputeCatalogPage, error) {
	if err := validateDisputeCatalogRequest(request); err != nil {
		return DisputeCatalogPage{}, err
	}
	var response DisputeCatalogPage
	if err := c.postJSON(ctx, DisputeCatalogPath, request, &response); err != nil {
		return DisputeCatalogPage{}, err
	}
	if err := validateDisputeCatalogPage(request, response); err != nil {
		return DisputeCatalogPage{}, fmt.Errorf("invalid connector response: %w", err)
	}
	return response, nil
}

func (c *Client) postJSON(ctx context.Context, path string, request any, response any) error {
	body, err := json.Marshal(request)
	if err != nil {
		return fmt.Errorf("encode connector request: %w", err)
	}
	endpoint := *c.baseURL
	endpoint.Path = strings.TrimRight(c.baseURL.Path, "/") + path
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create connector request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set(serviceTokenHeader, c.serviceToken)

	result, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("connector request unavailable: %w", err)
	}
	defer result.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(result.Body, maximumResponse+1))
	if err != nil {
		return errors.New("connector response could not be read")
	}
	if len(raw) > maximumResponse {
		return errors.New("connector response exceeded the size limit")
	}
	if result.StatusCode < 200 || result.StatusCode >= 300 {
		remote := &RemoteError{StatusCode: result.StatusCode}
		_ = json.Unmarshal(raw, remote)
		return remote
	}
	if len(raw) == 0 || json.Unmarshal(raw, response) != nil {
		return errors.New("connector returned an invalid JSON response")
	}
	return nil
}

func validateScopedRequest(request ScopedRequest) error {
	if !canonicalUUID.MatchString(request.Identity.TenantID) {
		return errors.New("tenantId must be a canonical UUID")
	}
	if !canonicalUUID.MatchString(request.Identity.ShopID) {
		return errors.New("shopId must be a canonical UUID")
	}
	if !contextID.MatchString(request.Context.CorrelationID) {
		return errors.New("correlationId is invalid")
	}
	if !contextID.MatchString(request.Context.RequestID) {
		return errors.New("requestId is invalid")
	}
	return nil
}

func validateConnectionSummary(request ScopedRequest, response ConnectionSummary) error {
	if response.ContractVersion != ConnectionContractVersion {
		return errors.New("connection contract version mismatch")
	}
	if response.TenantID != request.Identity.TenantID || response.ShopID != request.Identity.ShopID {
		return errors.New("connector identity mismatch")
	}
	switch response.State {
	case ConnectionStateNotConfigured, ConnectionStateDisconnected, ConnectionStateConnected:
	default:
		return errors.New("connection state is invalid")
	}
	if response.CheckedAt.IsZero() {
		return errors.New("checkedAt is required")
	}
	seen := make(map[string]struct{}, len(response.GrantedScopes))
	for _, scope := range response.GrantedScopes {
		if !scopeName.MatchString(scope) {
			return errors.New("granted scope is invalid")
		}
		if _, duplicate := seen[scope]; duplicate {
			return errors.New("granted scopes contain duplicates")
		}
		seen[scope] = struct{}{}
	}
	return nil
}

func validateReturnDecisionRequest(request ReturnDecisionRequest) error {
	if err := validateScopedRequest(ScopedRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !shopifyReturnGID.MatchString(request.ReturnID) {
		return errors.New("returnId must be a Shopify Return GID")
	}
	if !contextID.MatchString(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("idempotencyKey is invalid")
	}
	switch request.Decision {
	case ReturnDecisionApprove:
		if request.DeclineReason != "" || request.DeclineNote != "" {
			return errors.New("approve decision must not include decline details")
		}
	case ReturnDecisionDecline:
		switch request.DeclineReason {
		case ReturnDeclineReasonFinalSale, ReturnDeclineReasonOther, ReturnDeclineReasonReturnPeriodEnded:
		default:
			return errors.New("declineReason is invalid")
		}
		if len(request.DeclineNote) > 500 || strings.ContainsRune(request.DeclineNote, '\x00') {
			return errors.New("declineNote is invalid")
		}
	default:
		return errors.New("return decision is invalid")
	}
	return nil
}

func validateReturnCatalogRequest(request ReturnCatalogRequest) error {
	if err := validateScopedRequest(ScopedRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 || len(request.Cursor) > 4096 || len(request.Query) > 500 ||
		strings.ContainsAny(request.Cursor, "\x00\r\n") || strings.ContainsRune(request.Query, '\x00') {
		return errors.New("return catalog paging is invalid")
	}
	return nil
}

func validateReturnCatalogPage(request ReturnCatalogRequest, response ReturnCatalogPage) error {
	if response.ContractVersion != ReturnCatalogContractVersion || response.TenantID != request.Identity.TenantID ||
		response.ShopID != request.Identity.ShopID || response.Returns == nil || len(response.Returns) > request.Limit ||
		len(response.PageInfo.EndCursor) > 4096 || strings.ContainsAny(response.PageInfo.EndCursor, "\x00\r\n") ||
		(response.PageInfo.HasNextPage && response.PageInfo.EndCursor == "") {
		return errors.New("return catalog contract mismatch")
	}
	if response.State == CatalogStateNotConfigured {
		if len(response.Returns) != 0 || response.PageInfo.HasNextPage || response.PageInfo.EndCursor != "" || response.FetchedAt != nil {
			return errors.New("not-configured return catalog must be empty")
		}
		return nil
	}
	if response.State != CatalogStateConnected || response.FetchedAt == nil || response.FetchedAt.IsZero() {
		return errors.New("return catalog state is invalid")
	}
	seenReturns := make(map[string]struct{}, len(response.Returns))
	for _, item := range response.Returns {
		if !shopifyReturnGID.MatchString(item.ID) || !shopifyOrderGID.MatchString(item.OrderID) || item.Name == "" || item.OrderName == "" ||
			item.TotalQuantity < 1 || len(item.LineItems) == 0 || len(item.LineItems) > 100 {
			return errors.New("return catalog item is invalid")
		}
		if _, duplicate := seenReturns[item.ID]; duplicate {
			return errors.New("return catalog contains duplicates")
		}
		seenReturns[item.ID] = struct{}{}
		seenLines := make(map[string]struct{}, len(item.LineItems))
		total := 0
		for _, line := range item.LineItems {
			if !shopifyReturnLineGID.MatchString(line.ID) || !shopifyFulfillmentLineGID.MatchString(line.FulfillmentLineID) ||
				!shopifyOrderLineGID.MatchString(line.OrderLineID) || line.Name == "" || line.Quantity < 1 ||
				line.ProcessableQuantity < 0 || line.ProcessableQuantity > line.Quantity || line.RefundableQuantity < 0 || line.RefundableQuantity > line.Quantity {
				return errors.New("return catalog line is invalid")
			}
			if _, duplicate := seenLines[line.ID]; duplicate {
				return errors.New("return catalog lines contain duplicates")
			}
			seenLines[line.ID] = struct{}{}
			total += line.Quantity
			seenDuties := make(map[string]struct{}, len(line.Duties))
			for _, duty := range line.Duties {
				if !shopifyDutyGID.MatchString(duty.ID) || !validMoneyBag(duty.Price, false) {
					return errors.New("return catalog duty is invalid")
				}
				if _, duplicate := seenDuties[duty.ID]; duplicate {
					return errors.New("return catalog duties contain duplicates")
				}
				seenDuties[duty.ID] = struct{}{}
			}
		}
		if total != item.TotalQuantity {
			return errors.New("return catalog quantity mismatch")
		}
	}
	return nil
}

func validateReturnDecisionResult(request ReturnDecisionRequest, response ReturnDecisionResult) error {
	if response.ContractVersion != ReturnDecisionContractVersion ||
		response.TenantID != request.Identity.TenantID || response.ShopID != request.Identity.ShopID ||
		response.ReturnID != request.ReturnID || response.UpdatedAt.IsZero() {
		return errors.New("return decision contract mismatch")
	}
	expected := "OPEN"
	if request.Decision == ReturnDecisionDecline {
		expected = "DECLINED"
	}
	if response.Status != expected {
		return errors.New("return decision status mismatch")
	}
	return nil
}

func validateReturnRefundPreviewRequest(request ReturnRefundPreviewRequest) error {
	if err := validateScopedRequest(ScopedRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !shopifyReturnGID.MatchString(request.ReturnID) || len(request.LineItems) == 0 || len(request.LineItems) > 100 {
		return errors.New("return refund selection is invalid")
	}
	seen := make(map[string]struct{}, len(request.LineItems))
	for _, line := range request.LineItems {
		if !shopifyReturnLineGID.MatchString(line.ReturnLineID) || line.Quantity < 1 || line.Quantity > 100_000 {
			return errors.New("return refund line is invalid")
		}
		if _, duplicate := seen[line.ReturnLineID]; duplicate {
			return errors.New("return refund lines contain duplicates")
		}
		seen[line.ReturnLineID] = struct{}{}
	}
	duties := make(map[string]struct{}, len(request.RefundDuties))
	if len(request.RefundDuties) > 100 {
		return errors.New("return refund duty selection is invalid")
	}
	for _, duty := range request.RefundDuties {
		if !shopifyDutyGID.MatchString(duty.DutyID) || (duty.RefundType != ReturnRefundDutyFull && duty.RefundType != ReturnRefundDutyProportional) {
			return errors.New("return refund duty selection is invalid")
		}
		if _, duplicate := duties[duty.DutyID]; duplicate {
			return errors.New("return refund duty selection contains duplicates")
		}
		duties[duty.DutyID] = struct{}{}
	}
	return nil
}

func validateReturnRefundPreview(request ReturnRefundPreviewRequest, response ReturnRefundPreview) error {
	if response.ContractVersion != ReturnRefundPreviewContractVersion || response.TenantID != request.Identity.TenantID ||
		response.ShopID != request.Identity.ShopID || response.ReturnID != request.ReturnID || response.FetchedAt.IsZero() ||
		!sameRefundLines(request.LineItems, response.LineItems) || request.RefundShipping != response.RefundShipping ||
		!sameRefundDuties(request.RefundDuties, response.RefundDuties) || !validMoneyBag(response.RefundAmount, true) || !validMoneyBag(response.MaximumRefundable, true) {
		return errors.New("return refund preview contract mismatch")
	}
	if request.RefundShipping != (response.ShippingAmount != nil) || (response.ShippingAmount != nil && !validMoneyBag(*response.ShippingAmount, true)) ||
		(len(request.RefundDuties) > 0) != (response.DutyAmount != nil) || (response.DutyAmount != nil && !validMoneyBag(*response.DutyAmount, true)) {
		return errors.New("return refund preview component amounts are invalid")
	}
	switch response.State {
	case ReturnRefundPreviewRefundable:
		if len(response.Transactions) == 0 || response.ExpiresAt == nil || !response.ExpiresAt.After(response.FetchedAt) ||
			len(response.PreviewToken) < 32 || len(response.PreviewToken) > 4096 || strings.ContainsAny(response.PreviewToken, "\x00\r\n") {
			return errors.New("return refund preview is invalid")
		}
		for _, transaction := range response.Transactions {
			if !shopifyTransactionGID.MatchString(transaction.ParentTransactionID) || !validMoneyBag(transaction.Amount, false) {
				return errors.New("return refund transaction is invalid")
			}
		}
	case ReturnRefundPreviewNotRefundable:
		if len(response.Transactions) != 0 || response.PreviewToken != "" || response.ExpiresAt != nil {
			return errors.New("non-refundable preview is invalid")
		}
	default:
		return errors.New("return refund preview state is invalid")
	}
	return nil
}

func sameRefundLines(expected, actual []ReturnRefundLineSelection) bool {
	if len(expected) != len(actual) {
		return false
	}
	quantities := make(map[string]int, len(expected))
	for _, line := range expected {
		quantities[line.ReturnLineID] = line.Quantity
	}
	for _, line := range actual {
		if quantities[line.ReturnLineID] != line.Quantity {
			return false
		}
		delete(quantities, line.ReturnLineID)
	}
	return len(quantities) == 0
}

func sameRefundDuties(expected, actual []ReturnRefundDutySelection) bool {
	if len(expected) != len(actual) {
		return false
	}
	types := make(map[string]ReturnRefundDutyType, len(expected))
	for _, duty := range expected {
		types[duty.DutyID] = duty.RefundType
	}
	for _, duty := range actual {
		if types[duty.DutyID] != duty.RefundType {
			return false
		}
		delete(types, duty.DutyID)
	}
	return len(types) == 0
}

func validMoneyBag(value ReturnRefundMoneyBag, allowZero bool) bool {
	for _, money := range []Money{value.ShopMoney, value.PresentmentMoney} {
		if !moneyAmount.MatchString(money.Amount) || !currencyCode.MatchString(money.CurrencyCode) {
			return false
		}
		if !allowZero && (money.Amount == "0" || strings.Trim(money.Amount, "0.") == "") {
			return false
		}
	}
	return true
}

func validateReturnRefundProcessRequest(request ReturnRefundProcessRequest) error {
	if err := validateReturnRefundPreviewRequest(ReturnRefundPreviewRequest{Identity: request.Identity, Context: request.Context, ReturnID: request.ReturnID, LineItems: request.LineItems, RefundShipping: request.RefundShipping, RefundDuties: request.RefundDuties}); err != nil {
		return err
	}
	if len(request.PreviewToken) < 32 || len(request.PreviewToken) > 4096 || strings.ContainsAny(request.PreviewToken, "\x00\r\n") ||
		!contextID.MatchString(request.IdempotencyKey) || len(request.IdempotencyKey) > 100 {
		return errors.New("return refund confirmation is invalid")
	}
	return nil
}

func validateReturnRefundProcessResult(request ReturnRefundProcessRequest, response ReturnRefundProcessResult) error {
	if response.ContractVersion != ReturnRefundProcessContractVersion || response.TenantID != request.Identity.TenantID ||
		response.ShopID != request.Identity.ShopID || response.ReturnID != request.ReturnID || response.ReturnStatus == "" ||
		response.UpdatedAt.IsZero() || !validMoneyBag(response.RefundAmount, false) {
		return errors.New("return refund process contract mismatch")
	}
	allSuccess := len(response.Transactions) > 0
	anyPending := false
	anyFailure := false
	for _, transaction := range response.Transactions {
		if !shopifyTransactionGID.MatchString(transaction.ID) || !shopifyTransactionGID.MatchString(transaction.ParentTransactionID) || !validMoneyBag(transaction.Amount, false) {
			return errors.New("return refund processed transaction is invalid")
		}
		switch transaction.Status {
		case "SUCCESS":
		case "AWAITING_RESPONSE", "PENDING":
			allSuccess = false
			anyPending = true
		case "ERROR", "FAILURE", "UNKNOWN":
			allSuccess = false
			anyFailure = true
		default:
			return errors.New("return refund processed transaction status is invalid")
		}
	}
	switch response.Outcome {
	case ReturnRefundProcessApplied:
		if !allSuccess {
			return errors.New("applied refund has incomplete transactions")
		}
	case ReturnRefundProcessPending:
		if allSuccess || !anyPending || anyFailure {
			return errors.New("pending refund transaction state is invalid")
		}
	case ReturnRefundProcessReviewRequired:
		if allSuccess || (len(response.Transactions) > 0 && anyPending && !anyFailure) {
			return errors.New("review-required refund state is invalid")
		}
	default:
		return errors.New("return refund process outcome is invalid")
	}
	return nil
}

func validateDisputeCatalogRequest(request DisputeCatalogRequest) error {
	if err := validateScopedRequest(ScopedRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if request.Limit < 1 || request.Limit > 100 {
		return errors.New("limit must be between 1 and 100")
	}
	if len(request.Cursor) > 4096 || strings.ContainsAny(request.Cursor, "\x00\r\n") {
		return errors.New("cursor is invalid")
	}
	return nil
}

func validateDisputeCatalogPage(request DisputeCatalogRequest, response DisputeCatalogPage) error {
	if response.ContractVersion != DisputeCatalogContractVersion ||
		response.TenantID != request.Identity.TenantID || response.ShopID != request.Identity.ShopID ||
		response.Disputes == nil || len(response.Disputes) > request.Limit ||
		len(response.PageInfo.EndCursor) > 4096 || strings.ContainsAny(response.PageInfo.EndCursor, "\x00\r\n") ||
		(response.PageInfo.HasNextPage && response.PageInfo.EndCursor == "") {
		return errors.New("dispute catalog contract mismatch")
	}
	if response.State == CatalogStateNotConfigured {
		if len(response.Disputes) != 0 || response.PageInfo.HasNextPage || response.PageInfo.EndCursor != "" || response.FetchedAt != nil {
			return errors.New("not-configured dispute catalog must be empty")
		}
		return nil
	}
	if response.State != CatalogStateConnected || response.FetchedAt == nil || response.FetchedAt.IsZero() {
		return errors.New("dispute catalog state is invalid")
	}
	seen := make(map[string]struct{}, len(response.Disputes))
	for _, dispute := range response.Disputes {
		if !shopifyDisputeGID.MatchString(dispute.ID) {
			return errors.New("dispute identity is invalid")
		}
		if _, duplicate := seen[dispute.ID]; duplicate {
			return errors.New("dispute catalog contains duplicates")
		}
		seen[dispute.ID] = struct{}{}
	}
	return nil
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	parsed := net.ParseIP(host)
	return parsed != nil && parsed.IsLoopback()
}
