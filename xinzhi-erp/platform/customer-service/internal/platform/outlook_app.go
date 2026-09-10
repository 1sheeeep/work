package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const defaultOutlookScopes = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send"

type outlookAuthURLResponse struct {
	AuthURL string `json:"authUrl"`
}

type outlookConfigStatusResponse struct {
	Configured  bool     `json:"configured"`
	Missing     []string `json:"missing,omitempty"`
	RedirectURI string   `json:"redirectUri,omitempty"`
}

type outlookOAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
}

type outlookMeResponse struct {
	Mail              string `json:"mail"`
	UserPrincipalName string `json:"userPrincipalName"`
}

type outlookAppSettings struct {
	ClientID     string
	ClientSecret string
	Tenant       string
	Scopes       string
	BaseURL      string
	CallbackPath string
	AuthorizeURL string
	TokenURL     string
	MeURL        string
}

func (s *Server) handleOutlookCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	cfg, err := outlookAppConfig()
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if code == "" || state == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "code and state are required"})
		return
	}
	shopID, initialImport, ok := verifySignedEmailState(state, cfg.ClientSecret)
	if !ok {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Outlook state"})
		return
	}
	token, err := exchangeOutlookOAuthToken(r.Context(), code, cfg, r)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := validateOutlookGrantedScopes(token.Scope); err != nil {
		writeError(w, err)
		return
	}
	mailbox, err := fetchOutlookMailbox(r.Context(), token.AccessToken, cfg)
	if err != nil {
		writeError(w, err)
		return
	}
	shop, source, installation, err := s.ensureOutlookInstallation(r.Context(), shopID, mailbox, token, initialImport)
	if err != nil {
		if errors.Is(err, ErrConflict) {
			retryURL, _ := s.createOutlookAuthURL(r.Context(), shopID, initialImport, r)
			writeEmailMailboxBindingConflict(w, r, mailbox, err, retryURL)
			return
		}
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "email.outlook.installed", ShopID: shop.ID, EntityID: source.ID, Payload: map[string]any{
		"shop":         shop,
		"source":       source,
		"installation": installation,
	}, CreatedAt: time.Now().UTC()})
	s.initializeEmailSourceAsync(source)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Outlook connected</title></head><body><h1>Xzdesk Mail 已接入</h1><p>店铺: %s</p><p>邮箱: %s</p><p>可以回到 Xzdesk Admin 查看邮箱渠道状态。</p></body></html>`, html.EscapeString(shop.DisplayName), html.EscapeString(mailbox))
}

func (s *Server) createOutlookAuthURL(ctx context.Context, shopID string, initialImport string, r *http.Request) (string, error) {
	shopID = strings.TrimSpace(shopID)
	if shopID == "" {
		return "", fmt.Errorf("%w: shopId is required", ErrInvalid)
	}
	if _, err := s.store.GetShop(ctx, shopID); err != nil {
		return "", err
	}
	cfg, err := outlookAppConfig()
	if err != nil {
		return "", err
	}
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", cfg.RedirectURI(r))
	values.Set("response_mode", "query")
	values.Set("scope", cfg.Scopes)
	values.Set("state", signedEmailState(shopID, normalizeEmailInitialImport(initialImport), cfg.ClientSecret))
	values.Set("prompt", "select_account")
	return cfg.AuthorizeURL + "?" + values.Encode(), nil
}

func outlookConfigStatus(r *http.Request) outlookConfigStatusResponse {
	cfg := defaultOutlookAppConfig()
	missing := []string{}
	if cfg.ClientID == "" {
		missing = append(missing, "OUTLOOK_CLIENT_ID")
	}
	if cfg.ClientSecret == "" {
		missing = append(missing, "OUTLOOK_CLIENT_SECRET")
	}
	return outlookConfigStatusResponse{
		Configured:  len(missing) == 0,
		Missing:     missing,
		RedirectURI: cfg.RedirectURI(r),
	}
}

func (s *Server) ensureOutlookInstallation(ctx context.Context, shopID string, mailbox string, token outlookOAuthTokenResponse, initialImports ...string) (Shop, ShopSource, EmailInstallation, error) {
	shopID = strings.TrimSpace(shopID)
	mailbox = normalizeEmail(mailbox)
	shop, err := s.store.GetShop(ctx, shopID)
	if err != nil {
		return Shop{}, ShopSource{}, EmailInstallation{}, err
	}
	if err := s.ensureEmailMailboxAvailable(ctx, shop.ID, mailbox); err != nil {
		return Shop{}, ShopSource{}, EmailInstallation{}, err
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return Shop{}, ShopSource{}, EmailInstallation{}, err
	}
	var source ShopSource
	for _, item := range sources {
		if item.Type == SourceTypeEmail && normalizeEmail(item.Address) == mailbox {
			source = item
			break
		}
	}
	initialImport := emailInitialImportNow
	if len(initialImports) > 0 {
		initialImport = normalizeEmailInitialImport(initialImports[0])
	}
	if source.ID == "" {
		source, err = s.store.CreateShopSource(ctx, ShopSource{
			ShopID:   shop.ID,
			Type:     SourceTypeEmail,
			Provider: "outlook",
			Address:  mailbox,
			Metadata: newEmailSyncMetadata(mailbox, "microsoft_graph", initialImport),
		})
		if err != nil {
			return Shop{}, ShopSource{}, EmailInstallation{}, err
		}
	} else {
		metadata := markEmailAuthorizationPending(source.Metadata, mailbox, "microsoft_graph")
		if !strings.EqualFold(source.Provider, "outlook") {
			metadata = newEmailSyncMetadata(mailbox, "microsoft_graph", initialImport)
		}
		source, err = s.store.UpdateShopSource(ctx, shop.ID, source.ID, ShopSource{
			Status:   SourceStatusActive,
			Provider: "outlook",
			Address:  mailbox,
			Metadata: metadata,
		})
		if err != nil {
			return Shop{}, ShopSource{}, EmailInstallation{}, err
		}
	}
	installation, err := s.store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID:       shop.ID,
		Mailbox:      mailbox,
		Provider:     "outlook",
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		Scope:        token.Scope,
		ExpiresAt:    time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second),
	})
	if err != nil {
		return Shop{}, ShopSource{}, EmailInstallation{}, err
	}
	return shop, source, installation, nil
}

func outlookAppConfig() (outlookAppSettings, error) {
	cfg := defaultOutlookAppConfig()
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		return outlookAppSettings{}, fmt.Errorf("%w: OUTLOOK_CLIENT_ID and OUTLOOK_CLIENT_SECRET are required", ErrInvalid)
	}
	return cfg, nil
}

func defaultOutlookAppConfig() outlookAppSettings {
	tenant := firstNonEmptyEnv("OUTLOOK_TENANT_ID", "MICROSOFT_TENANT_ID")
	if tenant == "" {
		tenant = "common"
	}
	cfg := outlookAppSettings{
		ClientID:     firstNonEmptyEnv("OUTLOOK_CLIENT_ID", "MICROSOFT_CLIENT_ID"),
		ClientSecret: firstNonEmptyEnv("OUTLOOK_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET"),
		Tenant:       tenant,
		Scopes:       firstNonEmptyEnv("OUTLOOK_SCOPES", "MICROSOFT_GRAPH_SCOPES"),
		BaseURL:      strings.TrimRight(firstNonEmptyEnv("OUTLOOK_BASE_URL", "PUBLIC_BASE_URL"), "/"),
		CallbackPath: firstNonEmptyEnv("OUTLOOK_CALLBACK_PATH"),
		AuthorizeURL: firstNonEmptyEnv("OUTLOOK_AUTHORIZE_URL"),
		TokenURL:     firstNonEmptyEnv("OUTLOOK_TOKEN_URL"),
		MeURL:        firstNonEmptyEnv("OUTLOOK_ME_URL"),
	}
	if cfg.Scopes == "" {
		cfg.Scopes = defaultOutlookScopes
	}
	if cfg.CallbackPath == "" {
		cfg.CallbackPath = "/outlook/callback"
	}
	if !strings.HasPrefix(cfg.CallbackPath, "/") {
		cfg.CallbackPath = "/" + cfg.CallbackPath
	}
	if cfg.AuthorizeURL == "" {
		cfg.AuthorizeURL = "https://login.microsoftonline.com/" + url.PathEscape(cfg.Tenant) + "/oauth2/v2.0/authorize"
	}
	if cfg.TokenURL == "" {
		cfg.TokenURL = "https://login.microsoftonline.com/" + url.PathEscape(cfg.Tenant) + "/oauth2/v2.0/token"
	}
	if cfg.MeURL == "" {
		cfg.MeURL = "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName"
	}
	return cfg
}

func (cfg outlookAppSettings) RedirectURI(r *http.Request) string {
	baseURL := cfg.BaseURL
	if baseURL == "" {
		scheme := "https"
		if r.TLS == nil {
			scheme = "http"
		}
		if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
			scheme = strings.Split(forwarded, ",")[0]
		}
		baseURL = scheme + "://" + r.Host
	}
	return baseURL + cfg.CallbackPath
}

func signedOutlookState(shopID string, secret string) string {
	return signedEmailState(shopID, emailInitialImportNow, secret)
}

func verifySignedOutlookState(state string, secret string) (string, bool) {
	shopID, _, ok := verifySignedEmailState(state, secret)
	return shopID, ok
}

func signedEmailState(shopID string, initialImport string, secret string) string {
	shopID = strings.TrimSpace(shopID)
	ts := fmt.Sprintf("%d", time.Now().Unix())
	initialImport = normalizeEmailInitialImport(initialImport)
	payload := shopID + "|" + ts + "|" + initialImport
	return payload + "|" + hmacHex(secret, payload)
}

func verifySignedEmailState(state string, secret string) (string, string, bool) {
	parts := strings.Split(state, "|")
	if len(parts) != 3 && len(parts) != 4 {
		return "", "", false
	}
	shopID := strings.TrimSpace(parts[0])
	initialImport := emailInitialImportNow
	signatureIndex := 2
	payload := shopID + "|" + parts[1]
	if len(parts) == 4 {
		initialImport = normalizeEmailInitialImport(parts[2])
		signatureIndex = 3
		payload += "|" + initialImport
	}
	if shopID == "" || hmacHex(secret, payload) != parts[signatureIndex] {
		return "", "", false
	}
	issuedAt, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return "", "", false
	}
	age := time.Since(time.Unix(issuedAt, 0))
	if age < -time.Minute || age > 15*time.Minute {
		return "", "", false
	}
	return shopID, initialImport, true
}

func exchangeOutlookOAuthToken(ctx context.Context, code string, cfg outlookAppSettings, r *http.Request) (outlookOAuthTokenResponse, error) {
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("client_secret", cfg.ClientSecret)
	values.Set("code", strings.TrimSpace(code))
	values.Set("redirect_uri", cfg.RedirectURI(r))
	values.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return outlookOAuthTokenResponse{}, fmt.Errorf("Outlook OAuth token exchange returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var token outlookOAuthTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	token.AccessToken = strings.TrimSpace(token.AccessToken)
	if token.AccessToken == "" {
		return outlookOAuthTokenResponse{}, fmt.Errorf("%w: Outlook token response missing access_token", ErrInvalid)
	}
	if token.ExpiresIn <= 0 {
		token.ExpiresIn = 3600
	}
	return token, nil
}

func fetchOutlookMailbox(ctx context.Context, accessToken string, cfg outlookAppSettings) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.MeURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("Outlook /me returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var me outlookMeResponse
	if err := json.Unmarshal(body, &me); err != nil {
		return "", err
	}
	mailbox := normalizeEmail(firstNonEmpty(me.Mail, me.UserPrincipalName))
	if mailbox == "" {
		return "", fmt.Errorf("%w: Outlook account email is empty", ErrInvalid)
	}
	return mailbox, nil
}

func mergeStringMaps(base map[string]string, patch map[string]string) map[string]string {
	out := map[string]string{}
	for key, value := range base {
		out[key] = value
	}
	for key, value := range patch {
		out[key] = value
	}
	return out
}
