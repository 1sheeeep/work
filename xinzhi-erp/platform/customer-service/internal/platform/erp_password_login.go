package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"path"
	"regexp"
	"strings"
	"time"
)

var erpLoginTenantCode = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,63}$`)
var erpLoginGrant = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)
var errERPLoginRateLimited = errors.New("ERP login rate limited")

type erpPasswordLoginRequest struct {
	TenantCode      string `json:"tenantCode"`
	LoginIdentifier string `json:"loginIdentifier"`
	Password        string `json:"password"`
}

// Passwords and the ERP bearer remain transient server-side values. The browser
// receives only the existing customer-service session, as with entry from ERP.
func (m *ERPTenantMux) handleERPPasswordLogin(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	verifier, ok := m.verifier.(*HTTPERPIdentityVerifier)
	if !ok {
		writeERPPasswordLoginError(w, errERPIdentityUnavailable)
		return
	}
	if requestOrigin(r) != verifier.targetOrigin || r.URL.RawQuery != "" ||
		r.Header.Get("Authorization") != "" || r.Header.Get(erpTenantHeader) != "" {
		writeERPPasswordLoginError(w, ErrForbidden)
		return
	}
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeERPPasswordLoginError(w, ErrInvalid)
		return
	}
	var input erpPasswordLoginRequest
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(new(any)) != io.EOF {
		writeERPPasswordLoginError(w, ErrInvalid)
		return
	}
	input.TenantCode = strings.TrimSpace(input.TenantCode)
	input.LoginIdentifier = strings.TrimSpace(input.LoginIdentifier)
	if !erpLoginTenantCode.MatchString(input.TenantCode) || input.LoginIdentifier == "" ||
		len(input.LoginIdentifier) > 254 || strings.ContainsAny(input.LoginIdentifier, "\x00\r\n\t") ||
		strings.TrimSpace(input.Password) == "" || len([]rune(input.Password)) > 128 {
		writeERPPasswordLoginError(w, ErrInvalid)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 12*time.Second)
	defer cancel()
	identity, release, err := verifier.loginForCustomerService(ctx, input)
	input.Password = ""
	if err != nil {
		writeERPPasswordLoginError(w, err)
		return
	}
	completed := false
	defer func() {
		if !completed {
			release()
		}
	}()
	server, err := m.serverForExistingTenant(ctx, identity.TenantID)
	if errors.Is(err, ErrNotFound) {
		err = ErrForbidden
	}
	if err != nil {
		writeERPPasswordLoginError(w, err)
		return
	}
	result, err := server.createERPIdentitySession(ctx, identity)
	if err != nil {
		writeERPPasswordLoginError(w, err)
		return
	}
	completed = true
	writeJSONResponse(w, http.StatusOK, result)
}

func (v *HTTPERPIdentityVerifier) loginForCustomerService(ctx context.Context, input erpPasswordLoginRequest) (ERPIdentity, func(), error) {
	credentials := map[string]string{"tenantCode": input.TenantCode, "password": input.Password}
	if strings.Contains(input.LoginIdentifier, "@") {
		credentials["email"] = input.LoginIdentifier
	} else {
		credentials["username"] = input.LoginIdentifier
	}
	var login struct {
		TokenType   string    `json:"tokenType"`
		AccessToken string    `json:"accessToken"`
		ExpiresAt   time.Time `json:"expiresAt"`
		Tenant      struct {
			ID   string `json:"id"`
			Code string `json:"code"`
		} `json:"tenant"`
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	err := v.passwordLoginRequest(ctx, http.MethodPost, "/api/v1/auth/login", "", credentials, &login)
	delete(credentials, "password")
	if err != nil {
		return ERPIdentity{}, nil, err
	}
	if login.TokenType != "Bearer" || login.AccessToken == "" || len(login.AccessToken) > 512 ||
		strings.ContainsAny(login.AccessToken, " \r\n\t") {
		return ERPIdentity{}, nil, errERPIdentityUnavailable
	}
	release := func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		_ = v.passwordLoginRequest(cleanupCtx, http.MethodDelete, "/api/v1/auth/session", login.AccessToken, nil, nil)
	}
	success := false
	defer func() {
		if !success {
			release()
		}
	}()
	if login.Tenant.Code != input.TenantCode || login.Tenant.ID == "" || login.User.ID == "" ||
		!login.ExpiresAt.After(time.Now().UTC().Add(30*time.Second)) {
		return ERPIdentity{}, nil, errERPIdentityUnavailable
	}
	var grant struct {
		Grant     string    `json:"grant"`
		EntryURL  string    `json:"entryUrl"`
		TenantID  string    `json:"tenantId"`
		UserID    string    `json:"userId"`
		ExpiresAt time.Time `json:"expiresAt"`
	}
	if err := v.passwordLoginRequest(ctx, http.MethodPost, "/api/v1/customer-service/entry-grants", login.AccessToken,
		map[string]string{"targetOrigin": v.targetOrigin}, &grant); err != nil {
		return ERPIdentity{}, nil, err
	}
	if !erpLoginGrant.MatchString(grant.Grant) || grant.TenantID != login.Tenant.ID || grant.UserID != login.User.ID ||
		grant.EntryURL != v.targetOrigin+"/api/v1/auth/erp/entry" || !grant.ExpiresAt.After(time.Now().UTC()) {
		return ERPIdentity{}, nil, errERPIdentityUnavailable
	}
	identity, err := v.Redeem(ctx, ERPEntryGrantRequest{Grant: grant.Grant, TenantID: grant.TenantID, SubjectID: grant.UserID})
	if err != nil {
		return ERPIdentity{}, nil, err
	}
	if identity.SystemAdmin || identity.TenantID != login.Tenant.ID || identity.SubjectID != login.User.ID ||
		identity.TenantCode != input.TenantCode || !identity.ExpiresAt.After(time.Now().UTC().Add(30*time.Second)) {
		return ERPIdentity{}, nil, ErrForbidden
	}
	success = true
	return identity, release, nil
}

func (v *HTTPERPIdentityVerifier) passwordLoginRequest(ctx context.Context, method, route, token string, input, output any) error {
	endpoint := *v.baseURL
	endpoint.Path = path.Join(v.baseURL.Path, route)
	payload, err := json.Marshal(input)
	if err != nil {
		return errERPIdentityUnavailable
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bytes.NewReader(payload))
	if err != nil {
		return errERPIdentityUnavailable
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := v.client.Do(request)
	if err != nil {
		return errERPIdentityUnavailable
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusTooManyRequests {
		return errERPLoginRateLimited
	}
	if response.StatusCode == http.StatusUnauthorized {
		return errERPIdentityUnauthorized
	}
	if response.StatusCode == http.StatusForbidden {
		return ErrForbidden
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errERPIdentityUnavailable
	}
	if output == nil {
		return nil
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		return errERPIdentityUnavailable
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, erpIdentityResponseLimit+1))
	if err != nil || len(body) > erpIdentityResponseLimit || json.Unmarshal(body, output) != nil {
		return errERPIdentityUnavailable
	}
	return nil
}

func writeERPPasswordLoginError(w http.ResponseWriter, err error) {
	status, code := http.StatusServiceUnavailable, "ERP_LOGIN_UNAVAILABLE"
	if errors.Is(err, errERPIdentityUnauthorized) {
		status, code = http.StatusUnauthorized, "INVALID_CREDENTIALS"
	}
	if errors.Is(err, ErrForbidden) {
		status, code = http.StatusForbidden, "CUSTOMER_SERVICE_ACCESS_DENIED"
	}
	if errors.Is(err, ErrInvalid) {
		status, code = http.StatusBadRequest, "INVALID_LOGIN_INPUT"
	}
	if errors.Is(err, errERPLoginRateLimited) {
		status, code = http.StatusTooManyRequests, "LOGIN_RATE_LIMITED"
	}
	writeJSONResponse(w, status, map[string]string{"code": code, "error": "Customer-service sign-in could not be completed."})
}
