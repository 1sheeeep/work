package platform

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultGmailScopes = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"

type gmailOAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
}

type gmailProfileResponse struct {
	EmailAddress string `json:"emailAddress"`
}

type gmailAppSettings struct {
	ClientID     string
	ClientSecret string
	Scopes       string
	BaseURL      string
	CallbackPath string
	AuthorizeURL string
	TokenURL     string
	ProfileURL   string
}

func (s *Server) handleGmailCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	cfg, err := gmailAppConfig()
	if err != nil {
		log.Printf("Gmail callback configuration failed: %v", err)
		writeGmailCallbackFailure(w, http.StatusBadRequest, "Gmail 应用配置不完整", "请先完成服务端 Google OAuth 配置，再返回 Xzdesk 重新生成授权地址。")
		return
	}
	if oauthError := strings.TrimSpace(r.URL.Query().Get("error")); oauthError != "" {
		log.Printf("Gmail authorization was not completed: error=%s description=%s", oauthError, strings.TrimSpace(r.URL.Query().Get("error_description")))
		writeGmailCallbackFailure(w, http.StatusBadRequest, "Gmail 授权未完成", "你取消或拒绝了 Gmail 授权。可以关闭此页面，返回 Xzdesk 后重新发起授权。")
		return
	}
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if code == "" || state == "" {
		writeGmailCallbackFailure(w, http.StatusBadRequest, "Gmail 授权回调缺少参数", "请关闭此页面，返回 Xzdesk 重新生成 Gmail 授权地址。")
		return
	}
	shopID, initialImport, ok := verifySignedEmailState(state, cfg.ClientSecret)
	if !ok {
		writeGmailCallbackFailure(w, http.StatusUnauthorized, "Gmail 授权链接无效或已过期", "请关闭此页面，返回 Xzdesk 重新生成 Gmail 授权地址。")
		return
	}
	token, err := exchangeGmailOAuthToken(r.Context(), code, cfg, r)
	if err != nil {
		log.Printf("Gmail OAuth token exchange failed for shop %s: %v", shopID, err)
		writeGmailCallbackFailure(w, http.StatusBadGateway, "Gmail 授权凭证交换失败", "请稍后返回 Xzdesk 重新发起授权；如果持续失败，请检查 Google OAuth Client 配置。")
		return
	}
	if err := validateGmailGrantedScopes(defaultString(token.Scope, defaultGmailScopes)); err != nil {
		log.Printf("Gmail OAuth token missing required scopes for shop %s: %v", shopID, err)
		writeGmailCallbackFailure(w, http.StatusBadRequest, "Gmail scope incomplete", "Gmail authorization must include read, modify, and send permissions. Recreate the authorization URL in Xzdesk and allow all Gmail permissions in the Google test app.")
		return
	}
	mailbox, err := fetchGmailMailbox(r.Context(), token.AccessToken, cfg)
	if err != nil {
		log.Printf("Gmail profile lookup failed for shop %s: %v", shopID, err)
		writeGmailCallbackFailure(w, http.StatusBadGateway, "读取 Gmail 账号信息失败", "请稍后返回 Xzdesk 重新发起授权，并确认 Gmail API 已启用。")
		return
	}
	shop, source, installation, err := s.ensureGmailInstallation(r.Context(), shopID, mailbox, token, initialImport)
	if err != nil {
		log.Printf("saving Gmail installation failed for shop %s mailbox %s: %v", shopID, mailbox, err)
		if errors.Is(err, ErrConflict) {
			retryURL, _ := s.createGmailAuthURL(r.Context(), shopID, initialImport, r)
			writeEmailMailboxBindingConflict(w, r, mailbox, err, retryURL)
			return
		}
		writeGmailCallbackFailure(w, http.StatusInternalServerError, "保存 Gmail 邮箱接入信息失败", "请返回 Xzdesk 后重试；如果持续失败，请检查服务端存储状态。")
		return
	}
	s.broadcast(Event{Type: "email.gmail.installed", ShopID: shop.ID, EntityID: source.ID, Payload: map[string]any{
		"shop":         shop,
		"source":       source,
		"installation": installation,
	}, CreatedAt: time.Now().UTC()})
	s.initializeEmailSourceAsync(source)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Gmail 已接入</title></head><body><h1>Xzdesk 邮箱已接入</h1><p>店铺：%s</p><p>邮箱：%s</p><p>可以返回 Xzdesk Admin 查看邮箱渠道状态。</p></body></html>`, html.EscapeString(shop.DisplayName), html.EscapeString(mailbox))
}

func writeGmailCallbackFailure(w http.ResponseWriter, status int, title string, message string) {
	writeEmailCallbackFailure(w, status, title, message)
}

func (s *Server) createGmailAuthURL(ctx context.Context, shopID string, initialImport string, r *http.Request) (string, error) {
	shopID = strings.TrimSpace(shopID)
	if shopID == "" {
		return "", fmt.Errorf("%w: shopId is required", ErrInvalid)
	}
	if _, err := s.store.GetShop(ctx, shopID); err != nil {
		return "", err
	}
	cfg, err := gmailAppConfig()
	if err != nil {
		return "", err
	}
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", cfg.RedirectURI(r))
	values.Set("scope", cfg.Scopes)
	values.Set("state", signedEmailState(shopID, normalizeEmailInitialImport(initialImport), cfg.ClientSecret))
	values.Set("access_type", "offline")
	values.Set("prompt", "consent select_account")
	return cfg.AuthorizeURL + "?" + values.Encode(), nil
}

func gmailConfigStatus(r *http.Request) outlookConfigStatusResponse {
	cfg := defaultGmailAppConfig()
	missing := []string{}
	if cfg.ClientID == "" {
		missing = append(missing, "GMAIL_CLIENT_ID")
	}
	if cfg.ClientSecret == "" {
		missing = append(missing, "GMAIL_CLIENT_SECRET")
	}
	return outlookConfigStatusResponse{
		Configured:  len(missing) == 0,
		Missing:     missing,
		RedirectURI: cfg.RedirectURI(r),
	}
}

func (s *Server) ensureGmailInstallation(ctx context.Context, shopID string, mailbox string, token gmailOAuthTokenResponse, initialImports ...string) (Shop, ShopSource, EmailInstallation, error) {
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
			Provider: "gmail",
			Address:  mailbox,
			Metadata: newEmailSyncMetadata(mailbox, "gmail_api", initialImport),
		})
		if err != nil {
			return Shop{}, ShopSource{}, EmailInstallation{}, err
		}
	} else {
		metadata := markEmailAuthorizationPending(source.Metadata, mailbox, "gmail_api")
		if !strings.EqualFold(source.Provider, "gmail") {
			metadata = newEmailSyncMetadata(mailbox, "gmail_api", initialImport)
		}
		source, err = s.store.UpdateShopSource(ctx, shop.ID, source.ID, ShopSource{
			Status:   SourceStatusActive,
			Provider: "gmail",
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
		Provider:     "gmail",
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		Scope:        defaultString(token.Scope, defaultGmailScopes),
		ExpiresAt:    time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second),
	})
	if err != nil {
		return Shop{}, ShopSource{}, EmailInstallation{}, err
	}
	return shop, source, installation, nil
}

func gmailAppConfig() (gmailAppSettings, error) {
	cfg := defaultGmailAppConfig()
	if cfg.ClientID == "" || cfg.ClientSecret == "" {
		return gmailAppSettings{}, fmt.Errorf("%w: GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET are required", ErrInvalid)
	}
	return cfg, nil
}

func defaultGmailAppConfig() gmailAppSettings {
	cfg := gmailAppSettings{
		ClientID:     firstNonEmptyEnv("GMAIL_CLIENT_ID", "GOOGLE_CLIENT_ID"),
		ClientSecret: firstNonEmptyEnv("GMAIL_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
		Scopes:       firstNonEmptyEnv("GMAIL_SCOPES", "GOOGLE_GMAIL_SCOPES"),
		BaseURL:      strings.TrimRight(firstNonEmptyEnv("GMAIL_BASE_URL", "PUBLIC_BASE_URL"), "/"),
		CallbackPath: firstNonEmptyEnv("GMAIL_CALLBACK_PATH"),
		AuthorizeURL: firstNonEmptyEnv("GMAIL_AUTHORIZE_URL"),
		TokenURL:     firstNonEmptyEnv("GMAIL_TOKEN_URL"),
		ProfileURL:   firstNonEmptyEnv("GMAIL_PROFILE_URL"),
	}
	if cfg.Scopes == "" {
		cfg.Scopes = defaultGmailScopes
	}
	if cfg.CallbackPath == "" {
		cfg.CallbackPath = "/gmail/callback"
	}
	if !strings.HasPrefix(cfg.CallbackPath, "/") {
		cfg.CallbackPath = "/" + cfg.CallbackPath
	}
	if cfg.AuthorizeURL == "" {
		cfg.AuthorizeURL = "https://accounts.google.com/o/oauth2/v2/auth"
	}
	if cfg.TokenURL == "" {
		cfg.TokenURL = "https://oauth2.googleapis.com/token"
	}
	if cfg.ProfileURL == "" {
		cfg.ProfileURL = "https://gmail.googleapis.com/gmail/v1/users/me/profile"
	}
	return cfg
}

func (cfg gmailAppSettings) RedirectURI(r *http.Request) string {
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

func exchangeGmailOAuthToken(ctx context.Context, code string, cfg gmailAppSettings, r *http.Request) (gmailOAuthTokenResponse, error) {
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("client_secret", cfg.ClientSecret)
	values.Set("code", strings.TrimSpace(code))
	values.Set("redirect_uri", cfg.RedirectURI(r))
	values.Set("grant_type", "authorization_code")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return gmailOAuthTokenResponse{}, fmt.Errorf("Gmail OAuth token exchange returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var token gmailOAuthTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	token.AccessToken = strings.TrimSpace(token.AccessToken)
	if token.AccessToken == "" {
		return gmailOAuthTokenResponse{}, fmt.Errorf("%w: Gmail token response missing access_token", ErrInvalid)
	}
	if token.ExpiresIn <= 0 {
		token.ExpiresIn = 3600
	}
	return token, nil
}

func fetchGmailMailbox(ctx context.Context, accessToken string, cfg gmailAppSettings) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, cfg.ProfileURL, nil)
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
		return "", fmt.Errorf("Gmail profile returned %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var profile gmailProfileResponse
	if err := json.Unmarshal(body, &profile); err != nil {
		return "", err
	}
	mailbox := normalizeEmail(profile.EmailAddress)
	if mailbox == "" {
		return "", fmt.Errorf("%w: Gmail account email is empty", ErrInvalid)
	}
	return mailbox, nil
}
