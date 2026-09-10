package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

const (
	erpCustomerServicePermission           = "customer_service.read"
	erpCustomerServiceConversationClaim    = "customer_service.conversation.claim"
	erpCustomerServiceConversationReply    = "customer_service.conversation.reply"
	erpCustomerServiceConversationTransfer = "customer_service.conversation.transfer"
	erpCustomerServiceConversationClose    = "customer_service.conversation.close"
	erpCustomerServiceTicketManage         = "customer_service.ticket.manage"
	erpIdentityResponseLimit               = 1 << 20
	erpIdentityExchangeMode                = "ERP_PASSWORDLESS"
)

var (
	errERPIdentityUnauthorized = errors.New("ERP identity is not authorized")
	errERPIdentityUnavailable  = errors.New("ERP identity service is unavailable")
)

type ERPIdentityVerifier interface {
	Redeem(context.Context, ERPEntryGrantRequest) (ERPIdentity, error)
}

type ERPEntryGrantRequest struct {
	Grant     string `json:"grant"`
	TenantID  string `json:"tenantId"`
	SubjectID string `json:"userId"`
}

type ERPIdentity struct {
	EntryProof  ERPEntryGrantRequest `json:"-"`
	ValidatedAt time.Time            `json:"-"`
	TenantID    string
	TenantCode  string
	SubjectID   string
	Email       string
	DisplayName string
	SystemAdmin bool `json:"systemAdmin"`
	ExpiresAt   time.Time
	Permissions []string
	Shops       []ERPShop
}

type ERPShop struct {
	ID                   string
	DisplayName          string
	ExternalShopRef      string
	Status               string
	AuthorizationStatus  string
	CredentialConfigured bool
	ChannelMode          string
	EmailConnections     []ERPEmailConnection
}

type ERPEmailConnection struct {
	ID       string
	Provider string
	Email    string
	Status   string
}

type HTTPERPIdentityVerifier struct {
	baseURL      *url.URL
	serviceToken string
	targetOrigin string
	client       *http.Client
}

func NewHTTPERPIdentityVerifier(
	rawBaseURL string,
	serviceToken string,
	targetOrigin string,
	client *http.Client,
) (*HTTPERPIdentityVerifier, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawBaseURL))
	if err != nil || parsed == nil || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("invalid ERP IAM base URL")
	}
	if parsed.Scheme != "https" {
		host := parsed.Hostname()
		ip := net.ParseIP(host)
		if parsed.Scheme != "http" || (host != "localhost" && (ip == nil || !ip.IsLoopback())) {
			return nil, fmt.Errorf("ERP IAM base URL must use HTTPS or loopback HTTP")
		}
	}
	parsed.Path = strings.TrimSuffix(parsed.Path, "/")
	serviceToken = strings.TrimSpace(serviceToken)
	targetOrigin, err = normalizeERPEntryTargetOrigin(targetOrigin)
	if serviceToken == "" || err != nil {
		return nil, fmt.Errorf("ERP customer-service entry is not configured")
	}
	if client == nil {
		client = &http.Client{Timeout: 4 * time.Second}
	}
	safeClient := *client
	safeClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &HTTPERPIdentityVerifier{
		baseURL: parsed, serviceToken: serviceToken,
		targetOrigin: targetOrigin, client: &safeClient,
	}, nil
}

func (v *HTTPERPIdentityVerifier) Redeem(
	ctx context.Context,
	grant ERPEntryGrantRequest,
) (ERPIdentity, error) {
	return v.verify(ctx, grant, "/api/v1/internal/customer-service/entry-grants/redeem")
}

func (v *HTTPERPIdentityVerifier) ValidateSession(ctx context.Context, grant ERPEntryGrantRequest) (ERPIdentity, error) {
	return v.verify(ctx, grant, "/api/v1/internal/customer-service/session/validate")
}

func (v *HTTPERPIdentityVerifier) verify(ctx context.Context, grant ERPEntryGrantRequest, route string) (ERPIdentity, error) {
	endpoint := *v.baseURL
	endpoint.Path = path.Join(v.baseURL.Path, route)
	endpoint.RawQuery = ""
	payload, err := json.Marshal(map[string]string{
		"grant": grant.Grant, "tenantId": grant.TenantID,
		"userId": grant.SubjectID, "targetOrigin": v.targetOrigin,
	})
	if err != nil {
		return ERPIdentity{}, errERPIdentityUnavailable
	}
	request, err := http.NewRequestWithContext(
		ctx, http.MethodPost, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return ERPIdentity{}, errERPIdentityUnavailable
	}
	request.Header.Set("X-XZ-ERP-Connector-Token", v.serviceToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := v.client.Do(request)
	if err != nil {
		return ERPIdentity{}, errERPIdentityUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusUnauthorized || response.StatusCode == http.StatusForbidden {
		return ERPIdentity{}, errERPIdentityUnauthorized
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ERPIdentity{}, errERPIdentityUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, erpIdentityResponseLimit+1))
	var identity ERPIdentity
	if err != nil || len(body) > erpIdentityResponseLimit || json.Unmarshal(body, &identity) != nil ||
		strings.TrimSpace(identity.TenantID) == "" || strings.TrimSpace(identity.SubjectID) == "" ||
		identity.ExpiresAt.IsZero() || !containsPermission(identity.Permissions, erpCustomerServicePermission) {
		return ERPIdentity{}, errERPIdentityUnavailable
	}
	identity.TenantID = strings.TrimSpace(identity.TenantID)
	identity.SubjectID = strings.TrimSpace(identity.SubjectID)
	identity.DisplayName = firstNonEmpty(strings.TrimSpace(identity.DisplayName), strings.TrimSpace(identity.SubjectID))
	identity.EntryProof = grant
	return identity, nil
}

func normalizeERPEntryTargetOrigin(raw string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" ||
		(parsed.Path != "" && parsed.Path != "/") ||
		(parsed.Scheme != "https" && (parsed.Scheme != "http" || !isLoopbackHost(parsed.Hostname()))) {
		return "", fmt.Errorf("invalid customer-service target origin")
	}
	parsed.Path = ""
	return strings.TrimSuffix(parsed.String(), "/"), nil
}

func isLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func (s *Server) ConfigureERPIdentity(verifier ERPIdentityVerifier, localDemo bool) {
	s.erpIdentityVerifier = verifier
	s.localDemo = localDemo
	s.erpSessionMu.Lock()
	if s.erpSessionIdentities == nil {
		s.erpSessionIdentities = map[string]ERPIdentity{}
	}
	s.erpSessionMu.Unlock()
	if localDemo {
		s.publicShopifyOrderSearch = deterministicShopifyOrders
		s.shopifyCustomerSearch = deterministicShopifyCustomer
		s.publicShopifyCustomerLookup = func(context.Context, string, string, string) (ShopifyCustomerSearchResult, error) {
			return ShopifyCustomerSearchResult{}, nil
		}
		s.shopifyConnectionChecker = func(context.Context, string, string) ShopifyConnectionStatus {
			return ShopifyConnectionStatus{
				State:     "not_configured",
				Message:   "本地演示数据；未连接真实 Shopify",
				CheckedAt: time.Now().UTC(),
			}
		}
		s.shopifyOrderAddressUpdate = func(context.Context, string, string, ShopifyOrderShippingAddressUpdate) (ShopifyMailingAddress, error) {
			return ShopifyMailingAddress{}, fmt.Errorf("%w: 本地演示未连接真实 Shopify，不会执行订单地址写入", ErrForbidden)
		}
		s.shopifyTrackingInfoUpdate = func(context.Context, string, string, ShopifyFulfillmentTrackingUpdate) (ShopifyFulfillment, error) {
			return ShopifyFulfillment{}, fmt.Errorf("%w: 本地演示未连接真实 Shopify，不会执行物流写入", ErrForbidden)
		}
	}
}

func (s *Server) handleERPIdentityEntry(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.erpIdentityVerifier == nil {
		writeERPEntryError(w, http.StatusServiceUnavailable)
		return
	}
	if requestOrigin(r) == "" || !s.originAllowed(r) {
		writeERPEntryError(w, http.StatusForbidden)
		return
	}
	grantRequest, ok := parseERPEntryGrantRequest(w, r)
	if !ok {
		return
	}
	identity, ok := erpEntryIdentityFromContext(r.Context())
	var err error
	if !ok {
		identity, err = s.erpIdentityVerifier.Redeem(r.Context(), grantRequest)
	}
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, errERPIdentityUnauthorized) {
			status = http.StatusForbidden
		}
		writeERPEntryError(w, status)
		return
	}
	if identity.TenantID != grantRequest.TenantID || identity.SubjectID != grantRequest.SubjectID ||
		!containsPermission(identity.Permissions, erpCustomerServicePermission) {
		writeERPEntryError(w, http.StatusForbidden)
		return
	}
	if identity.ExpiresAt.Before(time.Now().UTC().Add(30 * time.Second)) {
		writeERPEntryError(w, http.StatusForbidden)
		return
	}

	result, err := s.createERPIdentitySession(r.Context(), identity)
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, ErrForbidden) {
			status = http.StatusForbidden
		} else if errors.Is(err, ErrConflict) {
			status = http.StatusConflict
		}
		writeERPEntryError(w, status)
		return
	}
	writeERPEntryBootstrap(w, result)
}

func (s *Server) createERPIdentitySession(ctx context.Context, identity ERPIdentity) (AuthResult, error) {
	if !identity.ExpiresAt.After(time.Now().UTC().Add(30*time.Second)) ||
		!containsPermission(identity.Permissions, erpCustomerServicePermission) {
		return AuthResult{}, ErrForbidden
	}
	s.erpExchangeMu.Lock()
	defer s.erpExchangeMu.Unlock()
	tenantStore, ok := s.store.(ERPTenantBoundStore)
	if !ok {
		return AuthResult{}, errERPIdentityUnavailable
	}
	if err := tenantStore.BindERPTenant(ctx, identity.TenantID); err != nil {
		return AuthResult{}, err
	}

	user, err := s.upsertERPSeat(ctx, identity)
	if err != nil {
		return AuthResult{}, err
	}
	// A nil shop slice means the ERP did not provide an authoritative catalog.
	// A non-nil slice, including an empty one, is reconciled for both real ERP
	// entry and the local deterministic demo. Only the demo path seeds messages.
	if identity.Shops != nil && s.reconcileERPShops(ctx, identity, user, s.localDemo) != nil {
		return AuthResult{}, errERPIdentityUnavailable
	}
	result, err := s.createSessionForUserUntil(ctx, user, identity.ExpiresAt)
	if err != nil {
		return AuthResult{}, err
	}
	s.rememberERPSession(result.Token, identity)
	result.TenantID = identity.TenantID
	result.IntegrationMode = erpIdentityExchangeMode
	return result, nil
}

type erpEntryIdentityContextKey struct{}

func contextWithERPEntryIdentity(ctx context.Context, identity ERPIdentity) context.Context {
	return context.WithValue(ctx, erpEntryIdentityContextKey{}, identity)
}

func erpEntryIdentityFromContext(ctx context.Context) (ERPIdentity, bool) {
	identity, ok := ctx.Value(erpEntryIdentityContextKey{}).(ERPIdentity)
	return identity, ok
}

func parseERPEntryGrantRequest(w http.ResponseWriter, r *http.Request) (ERPEntryGrantRequest, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 4096)
	if err := r.ParseForm(); err != nil {
		writeERPEntryError(w, http.StatusBadRequest)
		return ERPEntryGrantRequest{}, false
	}
	request := ERPEntryGrantRequest{
		Grant:     strings.TrimSpace(r.Form.Get("grant")),
		TenantID:  strings.TrimSpace(r.Form.Get("tenantId")),
		SubjectID: strings.TrimSpace(r.Form.Get("userId")),
	}
	if len(request.Grant) != 43 || len(request.TenantID) == 0 || len(request.TenantID) > 160 ||
		len(request.SubjectID) == 0 || len(request.SubjectID) > 160 ||
		strings.ContainsAny(request.TenantID+request.SubjectID, "\x00\r\n\t") {
		writeERPEntryError(w, http.StatusBadRequest)
		return ERPEntryGrantRequest{}, false
	}
	return request, true
}

func writeERPEntryBootstrap(w http.ResponseWriter, result AuthResult) {
	writeIdentityBootstrap(w, result, "support-platform.erp-auth")
}

func writeIdentityBootstrap(w http.ResponseWriter, result AuthResult, storageKey string) {
	payload, err := json.Marshal(result)
	nonce, nonceErr := newSessionToken()
	if err != nil || nonceErr != nil {
		writeERPEntryError(w, http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = fmt.Fprintf(w, "<!doctype html><meta charset=utf-8><title>正在进入客服</title><p>正在安全进入客服工作台…</p><script nonce=%q>sessionStorage.setItem(%q,JSON.stringify(%s));location.replace('/');</script>",
		nonce, storageKey, payload)
}

func writeERPEntryError(w http.ResponseWriter, status int) {
	message := "客服统一身份入口暂时不可用，请返回 ERP 后重试。"
	if status == http.StatusBadRequest || status == http.StatusForbidden || status == http.StatusUnauthorized || status == http.StatusConflict {
		message = "客服统一身份入口已失效，请返回 ERP 重新打开。"
	}
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	_, _ = fmt.Fprintf(w, "<!doctype html><meta charset=utf-8><title>客服入口不可用</title><p>%s</p>", message)
}

func (s *Server) upsertERPSeat(ctx context.Context, identity ERPIdentity) (User, error) {
	userID := "erp:" + identity.TenantID + ":" + identity.SubjectID
	existing, err := s.store.GetUser(ctx, userID)
	if err == nil {
		// Stable ERP subject mapping is not permission to overwrite a local seat,
		// reactivate it, claim a native account or reset its credentials.
		if existing.Status != UserStatusActive || existing.PasswordHash != "!erp-sso-password-disabled!" {
			return User{}, ErrForbidden
		}
		return existing, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return User{}, err
	}
	email, err := s.availableERPSeatEmail(ctx, userID, identity)
	if err != nil {
		return User{}, err
	}
	permissions := erpWorkbenchPermissions(identity.Permissions)
	role := UserRoleAgent
	shopScope := AccessScopeAssigned
	workbenchShopScope := AccessScopeAssigned
	conversationScope := AccessScopeAssigned
	dataScope := AccessScopeAssigned
	var shopScopeIDs []string
	if identity.SystemAdmin {
		role = UserRoleAdmin
		permissions = normalizePermissions(allPermissions)
		shopScope = AccessScopeAll
		workbenchShopScope = AccessScopeAll
		conversationScope = AccessScopeAll
		dataScope = AccessScopeAll
		shopScopeIDs = nil
	}
	seat := User{
		Email:                 email,
		DisplayName:           firstNonEmpty(identity.DisplayName, email),
		Role:                  role,
		SystemAdmin:           identity.SystemAdmin,
		Status:                UserStatusActive,
		SkillGroup:            SkillGroupAfterSales,
		SetSkillGroup:         true,
		ReceptionLimit:        50,
		SetAccessControl:      true,
		Permissions:           permissions,
		PermissionsCustomized: true,
		DataScopes: map[string]string{
			DataScopeOrders:  dataScope,
			DataScopeTickets: dataScope,
			DataScopeShops:   dataScope,
		},
		ShopScope:          shopScope,
		ShopScopeIDs:       shopScopeIDs,
		WorkbenchShopScope: workbenchShopScope,
		ConversationScope:  conversationScope,
		PasswordHash:       "!erp-sso-password-disabled!",
	}
	seat.ID = userID
	return s.store.CreateUser(ctx, seat)
}

func erpShopIDs(shops []ERPShop) []string {
	ids := make([]string, 0, len(shops))
	for _, shop := range shops {
		ids = append(ids, shop.ID)
	}
	return normalizeShopScopeIDs(ids)
}

func (s *Server) availableERPSeatEmail(
	ctx context.Context,
	userID string,
	identity ERPIdentity,
) (string, error) {
	// Never reuse the ERP profile email: users.email is globally unique in the
	// imported service and a local password account must not be claimed by SSO.
	// A deterministic sequence also handles a pre-existing synthetic collision
	// without mutating the occupying account.
	seed := identity.TenantID + "\x00" + identity.SubjectID
	for attempt := 0; attempt < 16; attempt++ {
		digest := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%d", seed, attempt)))
		candidate := fmt.Sprintf("erp-seat-%x@iam.invalid", digest[:16])
		occupant, err := s.store.FindUserByEmail(ctx, candidate)
		if errors.Is(err, ErrNotFound) || (err == nil && occupant.ID == userID) {
			return candidate, nil
		}
		if err != nil {
			return "", err
		}
	}
	return "", fmt.Errorf("%w: no isolated ERP seat email is available", ErrConflict)
}

func erpWorkbenchPermissions(erpPermissions []string) []string {
	permissions := make([]string, 0, 8)
	if containsPermission(erpPermissions, erpCustomerServicePermission) {
		permissions = append(
			permissions,
			PermissionWorkbenchAccess,
			PermissionTicketsView,
			PermissionOrdersView,
		)
	}
	if containsPermission(erpPermissions, erpCustomerServiceConversationClaim) {
		permissions = append(permissions, PermissionConversationClaim)
	}
	if containsPermission(erpPermissions, erpCustomerServiceConversationReply) {
		permissions = append(permissions, PermissionConversationReply)
	}
	if containsPermission(erpPermissions, erpCustomerServiceConversationTransfer) {
		permissions = append(permissions, PermissionConversationTransfer)
	}
	if containsPermission(erpPermissions, erpCustomerServiceConversationClose) {
		permissions = append(permissions, PermissionConversationClose)
	}
	if containsPermission(erpPermissions, erpCustomerServiceTicketManage) {
		permissions = append(permissions, PermissionTicketsManage)
	}
	return normalizePermissions(permissions)
}

func (s *Server) rememberERPSession(localToken string, identity ERPIdentity) {
	localToken = strings.TrimSpace(localToken)
	if localToken == "" || identity.TenantID == "" || identity.SubjectID == "" || identity.ExpiresAt.IsZero() {
		return
	}
	localHash := hashSessionToken(localToken)
	s.erpSessionMu.Lock()
	s.erpSessionIdentities[localHash] = ERPIdentity{
		EntryProof: identity.EntryProof,
		TenantID:   identity.TenantID, SubjectID: identity.SubjectID,
		SystemAdmin: identity.SystemAdmin,
		ExpiresAt:   identity.ExpiresAt,
		Permissions: append([]string(nil), identity.Permissions...),
	}
	s.erpSessionMu.Unlock()
}

func (s *Server) forgetERPSession(localHash string) {
	if localHash == "" {
		return
	}
	s.erpSessionMu.Lock()
	delete(s.erpSessionIdentities, localHash)
	s.erpSessionMu.Unlock()
}

func (s *Server) validateERPSession(ctx context.Context, localHash string, user User) (User, error) {
	if !strings.HasPrefix(user.ID, "erp:") {
		return user, nil
	}
	if s.erpIdentityVerifier == nil {
		return User{}, errERPIdentityUnauthorized
	}
	s.erpSessionMu.RLock()
	identity, ok := s.erpSessionIdentities[localHash]
	s.erpSessionMu.RUnlock()
	if !ok || !identity.ExpiresAt.After(time.Now().UTC()) {
		return User{}, errERPIdentityUnauthorized
	}
	if verifier, live := s.erpIdentityVerifier.(interface {
		ValidateSession(context.Context, ERPEntryGrantRequest) (ERPIdentity, error)
	}); live {
		_, err, _ := s.erpIdentityChecks.Do(localHash, func() (any, error) {
			s.erpSessionMu.RLock()
			stored, exists := s.erpSessionIdentities[localHash]
			s.erpSessionMu.RUnlock()
			if !exists {
				return nil, errERPIdentityUnauthorized
			}
			if time.Since(stored.ValidatedAt) < 5*time.Second {
				return nil, nil
			}
			started := time.Now().UTC()
			current, err := verifier.ValidateSession(ctx, stored.EntryProof)
			if err != nil {
				return nil, err
			}
			if current.TenantID != stored.TenantID || current.SubjectID != stored.SubjectID ||
				!current.ExpiresAt.After(started) || current.SystemAdmin != stored.SystemAdmin ||
				!sameStrings(current.Permissions, stored.Permissions) {
				return nil, errERPIdentityUnauthorized
			}
			s.erpSessionMu.Lock()
			defer s.erpSessionMu.Unlock()
			if _, exists := s.erpSessionIdentities[localHash]; !exists {
				return nil, errERPIdentityUnauthorized
			}
			stored.ValidatedAt = started
			s.erpSessionIdentities[localHash] = stored
			return nil, nil
		})
		if err != nil {
			return User{}, err
		}
	}
	if !containsPermission(identity.Permissions, erpCustomerServicePermission) {
		return User{}, errERPIdentityUnauthorized
	}
	tenantStore, ok := s.store.(ERPTenantBoundStore)
	if !ok {
		return User{}, errERPIdentityUnauthorized
	}
	boundTenantID, err := tenantStore.GetERPTenantBinding(ctx)
	if err != nil ||
		boundTenantID != identity.TenantID ||
		user.ID != "erp:"+identity.TenantID+":"+identity.SubjectID {
		return User{}, errERPIdentityUnauthorized
	}
	s.erpExchangeMu.Lock()
	defer s.erpExchangeMu.Unlock()
	expectedPermissions := erpWorkbenchPermissions(identity.Permissions)
	if identity.SystemAdmin {
		expectedPermissions = normalizePermissions(allPermissions)
	}
	if user.SystemAdmin && !identity.SystemAdmin {
		return User{}, errERPIdentityUnauthorized
	}
	// Local business permissions are preserved; ERP permissions are an upper
	// bound, never a reason to expand the stored seat configuration.
	permissions := make([]string, 0, len(user.Permissions))
	for _, permission := range effectivePermissions(user) {
		if containsPermission(expectedPermissions, permission) {
			permissions = append(permissions, permission)
		}
	}
	user.Permissions = permissions
	user.PermissionsCustomized = true
	return user, nil
}

func sameStrings(left []string, right []string) bool {
	left = normalizePermissions(left)
	right = normalizePermissions(right)
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func (s *Server) reconcileERPShops(
	ctx context.Context,
	identity ERPIdentity,
	user User,
	includeDemoData bool,
) error {
	existingShops, err := s.store.ListShops(ctx)
	if err != nil {
		return err
	}
	authoritativeShopIDs := make(map[string]bool, len(identity.Shops))
	for index, erpShop := range identity.Shops {
		authoritativeShopIDs[erpShop.ID] = true
		shopStatus := ShopStatusActive
		if erpShop.Status != "ACTIVE" {
			shopStatus = ShopStatusDisabled
		}
		domain := normalizeShopifyDomain(erpShop.ExternalShopRef)
		connectionMode := strings.ToLower(firstNonEmpty(erpShop.ChannelMode, "unconfigured"))
		connectionState := "not_configured"
		connectionMessage := "Shopify 授权由 XZ ERP 统一管理"
		chatProvider := "xzdesk_widget"
		chatMessage := "客服插件由 Xzdesk 管理"
		if erpShop.AuthorizationStatus == "AUTHORIZED" && erpShop.CredentialConfigured {
			connectionState = "connected"
		}
		if includeDemoData {
			domain = fmt.Sprintf("local-%02d-%s.myshopify.com", index+1, compactID(erpShop.ID))
			connectionMode = "deterministic_fake"
			connectionState = "not_configured"
			connectionMessage = "本地演示数据；未连接真实 Shopify"
			chatProvider = "xzdesk_local_demo"
			chatMessage = "本地演示会话入口"
		}
		shop := Shop{
			ID:          erpShop.ID,
			DisplayName: erpShop.DisplayName,
			Platform:    "shopify",
			ExternalID:  domain,
			Status:      shopStatus,
			Metadata: map[string]string{
				"erpTenantId":          identity.TenantID,
				"erpCanonicalShopId":   erpShop.ID,
				"shopifyDomain":        domain,
				"authorizationStatus":  erpShop.AuthorizationStatus,
				"credentialConfigured": fmt.Sprintf("%t", erpShop.CredentialConfigured),
				"connectionMode":       connectionMode,
				"realConnectionStatus": connectionState,
			},
		}
		if _, err := s.store.GetShop(ctx, erpShop.ID); errors.Is(err, ErrNotFound) {
			if _, err := s.store.CreateShop(ctx, shop); err != nil {
				return err
			}
		} else if err == nil {
			if _, err := s.store.UpdateShop(ctx, erpShop.ID, shop); err != nil {
				return err
			}
		} else {
			return err
		}
		if _, err := s.store.AssignUserToShop(ctx, erpShop.ID, user.ID); err != nil {
			return err
		}

		apiSource := ShopSource{
			ID:       "erp-shopify:" + erpShop.ID,
			ShopID:   erpShop.ID,
			Type:     SourceTypeShopifyAPI,
			Provider: "unified_shopify_connector",
			Address:  domain,
			Status:   erpShopifySourceStatus(erpShop),
			Metadata: map[string]string{
				"shopifyDomain":     domain,
				"connectionState":   connectionState,
				"connectionMode":    connectionMode,
				"connectionMessage": connectionMessage,
			},
		}
		if err := s.upsertERPSource(ctx, apiSource); err != nil {
			return err
		}
		chatSource := ShopSource{
			ID:       "erp-chat:" + erpShop.ID,
			ShopID:   erpShop.ID,
			Type:     SourceTypeShopifyChat,
			Provider: chatProvider,
			Address:  domain,
			Status:   SourceStatusActive,
			Metadata: map[string]string{
				"connectionMode":    connectionMode,
				"connectionMessage": chatMessage,
			},
		}
		if err := s.upsertERPSource(ctx, chatSource); err != nil {
			return err
		}
		desiredSourceIDs := map[string]bool{
			apiSource.ID:  true,
			chatSource.ID: true,
		}
		if includeDemoData {
			for _, connection := range erpShop.EmailConnections {
				status := SourceStatusDisabled
				if connection.Status == "CONNECTED" && erpShop.ChannelMode == "DETERMINISTIC_FAKE" {
					status = SourceStatusActive
				}
				sourceID := firstNonEmpty(connection.ID, compactID(connection.Provider+"-"+connection.Email))
				emailSourceID := "erp-email:" + erpShop.ID + ":" + sourceID
				desiredSourceIDs[emailSourceID] = true
				if err := s.upsertERPSource(ctx, ShopSource{
					ID:       emailSourceID,
					ShopID:   erpShop.ID,
					Type:     SourceTypeEmail,
					Provider: strings.ToLower(connection.Provider),
					Address:  connection.Email,
					Status:   status,
					Metadata: map[string]string{
						"mailbox":          connection.Email,
						"connectionMode":   strings.ToLower(firstNonEmpty(erpShop.ChannelMode, "unconfigured")),
						"connectionStatus": strings.ToLower(firstNonEmpty(connection.Status, "not_connected")),
					},
				}); err != nil {
					return err
				}
			}
		}
		if err := s.disableRemovedERPSources(ctx, erpShop.ID, desiredSourceIDs); err != nil {
			return err
		}
		if includeDemoData {
			if err := s.seedERPConversation(ctx, erpShop, chatSource, index); err != nil {
				return err
			}
		}
	}
	return s.disableRemovedERPShops(ctx, identity.TenantID, authoritativeShopIDs, existingShops)
}

func erpShopifySourceStatus(shop ERPShop) string {
	if shop.AuthorizationStatus == "AUTHORIZED" &&
		shop.CredentialConfigured &&
		(shop.ChannelMode == "DETERMINISTIC_FAKE" || shop.ChannelMode == "XZ_ERP_APP") {
		return SourceStatusActive
	}
	return SourceStatusDisabled
}

func (s *Server) disableRemovedERPSources(
	ctx context.Context,
	shopID string,
	desiredSourceIDs map[string]bool,
) error {
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return err
	}
	for _, source := range sources {
		if !strings.HasPrefix(source.ID, "erp-") || desiredSourceIDs[source.ID] {
			continue
		}
		source.Status = SourceStatusDisabled
		if source.Metadata == nil {
			source.Metadata = map[string]string{}
		}
		source.Metadata["connectionStatus"] = "revoked"
		source.Metadata["reconciliationState"] = "removed_from_erp"
		if _, err := s.store.UpdateShopSource(ctx, shopID, source.ID, source); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) disableRemovedERPShops(
	ctx context.Context,
	tenantID string,
	authoritativeShopIDs map[string]bool,
	existingShops []Shop,
) error {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return err
	}
	for _, shop := range existingShops {
		if shop.Metadata["erpTenantId"] != tenantID || authoritativeShopIDs[shop.ID] {
			continue
		}
		shop.Status = ShopStatusDisabled
		if shop.Metadata == nil {
			shop.Metadata = map[string]string{}
		}
		shop.Metadata["reconciliationState"] = "removed_from_erp"
		if _, err := s.store.UpdateShop(ctx, shop.ID, shop); err != nil {
			return err
		}
		sources, err := s.store.ListShopSources(ctx, shop.ID)
		if err != nil {
			return err
		}
		for _, source := range sources {
			if _, err := s.store.SetShopSourceStatus(
				ctx,
				shop.ID,
				source.ID,
				SourceStatusDisabled,
			); err != nil {
				return err
			}
		}
		for _, candidate := range users {
			if strings.HasPrefix(candidate.ID, "erp:"+tenantID+":") {
				if err := s.store.UnassignUserFromShop(ctx, shop.ID, candidate.ID); err != nil &&
					!errors.Is(err, ErrNotFound) {
					return err
				}
			}
		}
	}
	return nil
}

func (s *Server) upsertERPSource(ctx context.Context, input ShopSource) error {
	existing, err := s.store.GetShopSource(ctx, input.ShopID, input.ID)
	if errors.Is(err, ErrNotFound) {
		_, err = s.store.CreateShopSource(ctx, input)
		return err
	} else if err != nil {
		return err
	}
	metadata := make(map[string]string, len(existing.Metadata)+len(input.Metadata))
	for key, value := range existing.Metadata {
		metadata[key] = value
	}
	for key, value := range input.Metadata {
		metadata[key] = value
	}
	input.Metadata = metadata
	_, err = s.store.UpdateShopSource(ctx, input.ShopID, input.ID, input)
	return err
}

func (s *Server) seedERPConversation(ctx context.Context, shop ERPShop, source ShopSource, index int) error {
	conversationID := "erp-demo-conversation:" + shop.ID
	if _, err := s.store.GetConversation(ctx, conversationID); err == nil {
		return nil
	} else if !errors.Is(err, ErrNotFound) {
		return err
	}
	conversation, err := s.store.CreateConversation(ctx, Conversation{
		ID:                    conversationID,
		ShopID:                shop.ID,
		SourceID:              source.ID,
		CustomerName:          "本地测试客户",
		CustomerEmail:         "customer@example.test",
		Subject:               "订单 #XZ1001 的配送进度",
		Status:                ConversationStatusOpen,
		LastMessageAt:         time.Date(2026, time.July, 30, 9+index, 30, 0, 0, time.UTC),
		CustomerLastMessageAt: time.Date(2026, time.July, 30, 9+index, 30, 0, 0, time.UTC),
		LastMessageDirection:  MessageDirectionCustomer,
		Unread:                true,
		Kind:                  ConversationKindCustomer,
		ReplyAllowed:          true,
	})
	if err != nil {
		return err
	}
	_, _, err = s.store.AddMessage(ctx, Message{
		ID:             "erp-demo-message:" + shop.ID + ":1",
		ConversationID: conversation.ID,
		Direction:      MessageDirectionCustomer,
		Type:           MessageTypeText,
		Body:           "你好，我想确认订单 #XZ1001 目前的配送进度。",
		SenderName:     "本地测试客户",
		SenderEmail:    "customer@example.test",
		CreatedAt:      time.Date(2026, time.July, 30, 9+index, 30, 0, 0, time.UTC),
	})
	return err
}

func deterministicShopifyOrders(_ context.Context, _, _, query string, limit int) (ShopifyOrderSearchResult, error) {
	if strings.TrimSpace(query) == "" || limit <= 0 {
		return ShopifyOrderSearchResult{}, nil
	}
	order := ShopifyOrderSummary{
		ID:                "gid://shopify/Order/1001",
		LegacyResourceID:  "1001",
		Name:              "#XZ1001",
		Email:             "customer@example.test",
		SourceName:        "web",
		CreatedAt:         "2026-07-29T08:30:00Z",
		FinancialStatus:   "PAID",
		FulfillmentStatus: "IN_PROGRESS",
		PaymentGateways:   []string{"deterministic_fake"},
		Total:             ShopifyMoney{Amount: "68.00", CurrencyCode: "USD"},
		Subtotal:          ShopifyMoney{Amount: "60.00", CurrencyCode: "USD"},
		Shipping:          ShopifyMoney{Amount: "8.00", CurrencyCode: "USD"},
		Customer: ShopifyCustomer{
			ID:          "gid://shopify/Customer/1001",
			DisplayName: "本地测试客户",
			Email:       "customer@example.test",
			CreatedAt:   "2026-07-01T00:00:00Z",
			TotalSpent:  ShopifyMoney{Amount: "168.00", CurrencyCode: "USD"},
		},
		ShippingAddress: ShopifyMailingAddress{
			Name:        "本地测试客户",
			Address1:    "Synthetic Test Street 1",
			City:        "Test City",
			CountryCode: "US",
			Zip:         "00000",
			Formatted:   []string{"Synthetic Test Street 1", "Test City 00000", "US"},
		},
		LineItems: []ShopifyLineItem{{
			Name:             "本地测试商品",
			Quantity:         1,
			SKU:              "DEMO-SKU-001",
			VariantTitle:     "默认规格",
			RequiresShipping: true,
			DiscountedTotal:  ShopifyMoney{Amount: "60.00", CurrencyCode: "USD"},
		}},
		Fulfillments: []ShopifyFulfillment{{
			ID:        "gid://shopify/Fulfillment/1001",
			Status:    "IN_TRANSIT",
			CreatedAt: "2026-07-30T01:00:00Z",
			UpdatedAt: "2026-07-30T02:00:00Z",
			TrackingInfo: []ShopifyTrackingInfo{{
				Company: "Synthetic Carrier",
				Number:  "DEMO-TRACK-1001",
			}},
		}},
	}
	return ShopifyOrderSearchResult{Orders: []ShopifyOrderSummary{order}}, nil
}

func deterministicShopifyCustomer(_ context.Context, _, _, email string) (ShopifyCustomerSearchResult, error) {
	if !strings.EqualFold(strings.TrimSpace(email), "customer@example.test") {
		return ShopifyCustomerSearchResult{}, nil
	}
	orderResult, _ := deterministicShopifyOrders(context.Background(), "", "", "email:"+email, 1)
	order := orderResult.Orders[0]
	return ShopifyCustomerSearchResult{Customer: &ShopifyCustomerProfile{
		ID:            "gid://shopify/Customer/1001",
		DisplayName:   "本地测试客户",
		Email:         "customer@example.test",
		CreatedAt:     "2026-07-01T00:00:00Z",
		VerifiedEmail: true,
		Tags:          []string{"local-demo"},
		TotalSpent:    ShopifyMoney{Amount: "168.00", CurrencyCode: "USD"},
		LastOrder: &ShopifyLastOrder{
			ID:                order.ID,
			LegacyResourceID:  order.LegacyResourceID,
			Name:              order.Name,
			Email:             order.Email,
			SourceName:        order.SourceName,
			CreatedAt:         order.CreatedAt,
			FinancialStatus:   order.FinancialStatus,
			FulfillmentStatus: order.FulfillmentStatus,
			PaymentGateways:   order.PaymentGateways,
			Total:             order.Total,
			Subtotal:          order.Subtotal,
			Shipping:          order.Shipping,
			ShippingAddress:   order.ShippingAddress,
			LineItems:         order.LineItems,
			Fulfillments:      order.Fulfillments,
		},
	}}, nil
}

func compactID(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.NewReplacer("-", "", ":", "", "/", "").Replace(value)
	if len(value) > 12 {
		return value[:12]
	}
	if value == "" {
		return "synthetic"
	}
	return value
}
