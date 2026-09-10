package installations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type ShopifyOAuthExchanger struct {
	apiKey string
	secret string
	client *http.Client
}

// Shopify documents this terminal refresh result separately from transient
// failures. It requires reauthentication, but does not prove why access ended.
var ErrOfflineRefreshInactive = errors.New("Shopify offline credential requires reauthentication")

func NewShopifyOAuthExchanger(apiKey string, secret string, client *http.Client) *ShopifyOAuthExchanger {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	clientCopy := *client
	clientCopy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &ShopifyOAuthExchanger{
		apiKey: strings.TrimSpace(apiKey), secret: strings.TrimSpace(secret), client: &clientCopy,
	}
}

func (e *ShopifyOAuthExchanger) ExchangeOAuthCode(ctx context.Context, domain string, code string) (OAuthExchangeResult, error) {
	domain = normalizeDomain(domain)
	code = strings.TrimSpace(code)
	if e == nil || e.apiKey == "" || e.secret == "" || e.client == nil || !validConnectorDomain(domain) || code == "" {
		return OAuthExchangeResult{}, errors.New("Shopify OAuth exchange is unavailable")
	}
	body := url.Values{
		"client_id": {e.apiKey}, "client_secret": {e.secret}, "code": {code}, "expiring": {"1"},
	}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://"+domain+"/admin/oauth/access_token", strings.NewReader(body))
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify OAuth exchange is unavailable")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := e.client.Do(request)
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify OAuth exchange is unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return OAuthExchangeResult{}, errors.New("Shopify OAuth exchange was rejected")
	}
	result, err := decodeExpiringOAuthResponse(raw)
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify OAuth exchange returned an invalid response")
	}
	return result, nil
}

func (e *ShopifyOAuthExchanger) ExchangeSessionToken(ctx context.Context, domain string, sessionToken string) (OAuthExchangeResult, error) {
	domain = normalizeDomain(domain)
	sessionToken = strings.TrimSpace(sessionToken)
	if e == nil || e.apiKey == "" || e.secret == "" || e.client == nil || !validConnectorDomain(domain) || sessionToken == "" {
		return OAuthExchangeResult{}, errors.New("Shopify session token exchange is unavailable")
	}
	body := url.Values{
		"client_id":            {e.apiKey},
		"client_secret":        {e.secret},
		"grant_type":           {"urn:ietf:params:oauth:grant-type:token-exchange"},
		"subject_token":        {sessionToken},
		"subject_token_type":   {"urn:ietf:params:oauth:token-type:id_token"},
		"requested_token_type": {"urn:shopify:params:oauth:token-type:offline-access-token"},
		"expiring":             {"1"},
	}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://"+domain+"/admin/oauth/access_token", strings.NewReader(body))
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify session token exchange is unavailable")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := e.client.Do(request)
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify session token exchange is unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil || response.StatusCode < 200 || response.StatusCode >= 300 {
		return OAuthExchangeResult{}, errors.New("Shopify session token exchange was rejected")
	}
	result, err := decodeExpiringOAuthResponse(raw)
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify session token exchange returned an invalid response")
	}
	return result, nil
}

func (e *ShopifyOAuthExchanger) RefreshOfflineToken(ctx context.Context, domain string, refreshToken string) (OAuthExchangeResult, error) {
	domain = normalizeDomain(domain)
	refreshToken = strings.TrimSpace(refreshToken)
	if e == nil || e.apiKey == "" || e.secret == "" || e.client == nil || !validConnectorDomain(domain) || refreshToken == "" {
		return OAuthExchangeResult{}, errors.New("Shopify offline credential refresh is unavailable")
	}
	body := url.Values{
		"client_id": {e.apiKey}, "client_secret": {e.secret},
		"grant_type": {"refresh_token"}, "refresh_token": {refreshToken},
	}.Encode()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+domain+"/admin/oauth/access_token", strings.NewReader(body))
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify offline credential refresh is unavailable")
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")
	response, err := e.client.Do(request)
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify offline credential refresh is unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, (1<<20)+1))
	if err == nil && len(raw) <= 1<<20 && response.StatusCode == http.StatusUnauthorized {
		var failure struct {
			Error       string `json:"error"`
			Description string `json:"error_description"`
		}
		if json.Unmarshal(raw, &failure) == nil && failure.Error == "invalid_request" && failure.Description == "This request requires an active refresh_token" {
			return OAuthExchangeResult{}, ErrOfflineRefreshInactive
		}
	}
	if err != nil || len(raw) > 1<<20 || response.StatusCode < 200 || response.StatusCode >= 300 {
		return OAuthExchangeResult{}, errors.New("Shopify offline credential refresh was rejected")
	}
	result, err := decodeExpiringOAuthResponse(raw)
	if err != nil {
		return OAuthExchangeResult{}, errors.New("Shopify offline credential refresh returned an invalid response")
	}
	return result, nil
}

func decodeExpiringOAuthResponse(raw []byte) (OAuthExchangeResult, error) {
	var payload struct {
		AccessToken           string          `json:"access_token"`
		RefreshToken          string          `json:"refresh_token"`
		ExpiresIn             json.RawMessage `json:"expires_in"`
		RefreshTokenExpiresIn json.RawMessage `json:"refresh_token_expires_in"`
		Scope                 string          `json:"scope"`
	}
	if json.Unmarshal(raw, &payload) != nil {
		return OAuthExchangeResult{}, errors.New("invalid OAuth response")
	}
	parseSeconds := func(raw json.RawMessage) (time.Duration, error) {
		value := strings.Trim(strings.TrimSpace(string(raw)), `"`)
		seconds, err := strconv.ParseInt(value, 10, 64)
		if err != nil || seconds <= 0 {
			return 0, errors.New("invalid OAuth expiry")
		}
		return time.Duration(seconds) * time.Second, nil
	}
	accessTTL, accessErr := parseSeconds(payload.ExpiresIn)
	refreshTTL, refreshErr := parseSeconds(payload.RefreshTokenExpiresIn)
	result := OAuthExchangeResult{
		AccessToken: strings.TrimSpace(payload.AccessToken), RefreshToken: strings.TrimSpace(payload.RefreshToken),
		AccessTokenTTL: accessTTL, RefreshTokenTTL: refreshTTL,
		Scopes: strings.FieldsFunc(payload.Scope, func(r rune) bool { return r == ',' || r == ' ' || r == '\n' || r == '\t' || r == '\r' }),
	}
	if accessErr != nil || refreshErr != nil || validateExpiringOAuthResult(result) != nil {
		return OAuthExchangeResult{}, errors.New("invalid OAuth response")
	}
	return result, nil
}

func validConnectorDomain(domain string) bool {
	normalized, ok := shopifyconnector.NormalizeShopDomain(domain)
	return ok && normalized == domain
}

var _ OAuthExchanger = (*ShopifyOAuthExchanger)(nil)
var _ OfflineTokenRefresher = (*ShopifyOAuthExchanger)(nil)
var _ SessionTokenExchanger = (*ShopifyOAuthExchanger)(nil)
