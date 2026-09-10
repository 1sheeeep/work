package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	defaultShopifyAppScopes      = "read_all_orders,read_customers,read_locations,read_products,read_shopify_payments_disputes,write_inventory,write_merchant_managed_fulfillment_orders,write_order_edits,write_orders,write_returns"
	shopifyPublicAdminAPIVersion = "2026-07"

	shopifyDistributionPublic   = "public"
	shopifyDistributionPerShop  = "per_shop"
	encryptedShopifyTokenPrefix = "enc:v1:"
)

type shopifyOAuthTokenResponse struct {
	AccessToken string `json:"access_token"`
	Scope       string `json:"scope"`
}

func (s *Server) handleShopifyApp(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	shop := normalizeShopifyDomain(r.URL.Query().Get("shop"))
	if shop == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "shop is required"})
		return
	}
	cfg, err := s.readyShopifyAppConfigForShop(r.Context(), shop)
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Security-Policy", fmt.Sprintf(
		"frame-ancestors https://%s https://admin.shopify.com;",
		shop,
	))
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = io.WriteString(w, renderShopifyEmbeddedApp(cfg.APIKey, shop))
}

func (s *Server) handleShopifyInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	shop := normalizeShopifyOAuthTarget(r.URL.Query().Get("shop"))
	if shop == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "shop is required"})
		return
	}
	cfg, state, err := s.shopifyAuthorizationContext(r.Context(), shop, strings.TrimSpace(r.URL.Query().Get("profile")))
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	values := url.Values{}
	values.Set("client_id", cfg.APIKey)
	values.Set("scope", cfg.Scopes)
	values.Set("redirect_uri", cfg.RedirectURI(r))
	values.Set("state", state)
	redirectURL := fmt.Sprintf("https://%s/admin/oauth/authorize?%s", shop, values.Encode())
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

func (s *Server) handleShopifyCallback(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	shop := normalizeShopifyOAuthTarget(r.URL.Query().Get("shop"))
	code := strings.TrimSpace(r.URL.Query().Get("code"))
	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if shop == "" || code == "" || state == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "shop, code, and state are required"})
		return
	}
	cfg, targetShopID, err := s.shopifyCallbackContext(r.Context(), shop, state)
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if !verifyShopifyCallbackHMAC(r.URL.Query(), cfg.Secret) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify HMAC"})
		return
	}
	if targetShopID == "" && !verifySignedShopifyState(state, shop, cfg.Secret) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify state"})
		return
	}
	token, err := exchangeShopifyOAuthToken(r.Context(), shop, code, cfg)
	if err != nil {
		writeError(w, err)
		return
	}
	shopRecord, source, installation, err := s.ensureShopifyAppInstallationForShop(r.Context(), targetShopID, shop, token)
	if err != nil {
		writeError(w, err)
		return
	}
	webhookWarning := ""
	if cfg.BaseURL != "" && shopifyDistributionMode() != shopifyDistributionPublic {
		if err := registerShopifyAppUninstalledWebhook(r.Context(), shop, token.AccessToken, cfg); err != nil {
			webhookWarning = err.Error()
		}
	}
	s.broadcast(Event{Type: "shopify_app.installed", ShopID: shopRecord.ID, EntityID: shopRecord.ID, Payload: map[string]any{
		"shop":         shopRecord,
		"source":       source,
		"installation": installation,
		"webhookError": webhookWarning,
	}, CreatedAt: time.Now().UTC()})
	s.queueShopifyOrderSyncs(context.Background(), []Shop{shopRecord})
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	if webhookWarning != "" {
		_, _ = fmt.Fprintf(w, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Install complete</title></head><body><h1>Xzdesk for Shopify is installed</h1><p>Store: %s</p><p>Shopify Connector is available, but app uninstall webhook registration failed: %s</p></body></html>`, html.EscapeString(shop), html.EscapeString(webhookWarning))
		return
	}
	_, _ = fmt.Fprintf(w, `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Install complete</title></head><body><h1>Xzdesk for Shopify is installed</h1><p>Store: %s</p><p>You can return to Xzdesk Admin and test the Shopify Connector.</p></body></html>`, html.EscapeString(shop))
}

func (s *Server) ensureShopifyAppInstallation(ctx context.Context, shopDomain string, token shopifyOAuthTokenResponse) (Shop, ShopSource, ShopifyInstallation, error) {
	return s.ensureShopifyAppInstallationForShop(ctx, "", shopDomain, token)
}

func (s *Server) ensureShopifyAppInstallationForShop(ctx context.Context, targetShopID string, shopDomain string, token shopifyOAuthTokenResponse) (Shop, ShopSource, ShopifyInstallation, error) {
	shopDomain = normalizeShopifyDomain(shopDomain)
	shopName := ""
	connectionStatus := s.checkShopifyConnection(ctx, shopDomain, token.AccessToken)
	connectionStatus.CheckedAt = time.Now().UTC()
	if connectionStatus.State == "installed" {
		shopName = strings.TrimSpace(connectionStatus.ShopName)
		if verifiedDomain := normalizeShopifyDomain(connectionStatus.ShopDomain); verifiedDomain != "" {
			shopDomain = verifiedDomain
		}
	}
	var shop Shop
	var previousProfileDomain string
	if strings.TrimSpace(targetShopID) != "" {
		var err error
		shop, err = s.store.GetShop(ctx, targetShopID)
		if err != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
		if existingStoreID := strings.TrimSpace(shop.Metadata["shopifyStoreID"]); existingStoreID != "" && connectionStatus.ShopifyStoreID != "" && existingStoreID != connectionStatus.ShopifyStoreID {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, fmt.Errorf("%w: 当前 Shopify 店铺与该 Xzdesk 店铺原有绑定不一致", ErrConflict)
		}
		if existing, err := s.store.GetShopifyInstallationByDomain(ctx, shopDomain); err == nil && existing.ShopID != shop.ID {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, fmt.Errorf("%w: 该 Shopify 店铺已绑定到其他 Xzdesk 店铺", ErrConflict)
		} else if err != nil && !errors.Is(err, ErrNotFound) {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
		if profile, err := s.store.GetShopifyAppProfile(ctx, shop.ID); err == nil {
			previousProfileDomain = normalizeShopifyDomain(profile.ShopDomain)
		} else if !errors.Is(err, ErrNotFound) {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
		if connectionStatus.ShopifyStoreID != "" {
			shops, err := s.store.ListShops(ctx)
			if err != nil {
				return Shop{}, ShopSource{}, ShopifyInstallation{}, err
			}
			for _, item := range shops {
				if item.ID != shop.ID && strings.TrimSpace(item.Metadata["shopifyStoreID"]) == connectionStatus.ShopifyStoreID {
					return Shop{}, ShopSource{}, ShopifyInstallation{}, fmt.Errorf("%w: 该 Shopify 店铺已绑定到其他 Xzdesk 店铺", ErrConflict)
				}
			}
		}
		if previousProfileDomain != "" && previousProfileDomain != shopDomain && connectionStatus.ShopifyStoreID != "" {
			if previous, err := s.store.GetShopifyInstallationByDomain(ctx, previousProfileDomain); err == nil && previous.ShopID == shop.ID {
				previousStatus := s.checkShopifyConnection(ctx, previousProfileDomain, previous.AccessToken)
				if previousStatus.State == "installed" && previousStatus.ShopifyStoreID != "" && previousStatus.ShopifyStoreID != connectionStatus.ShopifyStoreID {
					return Shop{}, ShopSource{}, ShopifyInstallation{}, fmt.Errorf("%w: 当前 Shopify 店铺与该 Xzdesk 店铺原有绑定不一致", ErrConflict)
				}
			} else if err != nil && !errors.Is(err, ErrNotFound) {
				return Shop{}, ShopSource{}, ShopifyInstallation{}, err
			}
		}
		metadata := cloneStringMap(shop.Metadata)
		metadata["shopifyDomain"] = shopDomain
		metadata["shopifyOnboarding"] = "installed"
		if connectionStatus.ShopifyStoreID != "" {
			metadata["shopifyStoreID"] = connectionStatus.ShopifyStoreID
		}
		shop, err = s.store.UpdateShop(ctx, shop.ID, Shop{
			DisplayName: shop.DisplayName,
			Platform:    "shopify",
			ExternalID:  shopDomain,
			Status:      shop.Status,
			Metadata:    metadata,
		})
		if err != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
	} else {
		shops, err := s.store.ListShops(ctx)
		if err != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
		for _, item := range shops {
			if normalizeShopifyDomain(item.ExternalID) == shopDomain || normalizeShopifyDomain(item.Metadata["shopifyDomain"]) == shopDomain {
				shop = item
				break
			}
		}
		if shop.ID == "" {
			displayName := shopDomain
			if shopName != "" {
				displayName = shopName
			}
			shop, err = s.store.CreateShop(ctx, Shop{
				DisplayName: displayName,
				Platform:    "shopify",
				ExternalID:  shopDomain,
				Metadata:    map[string]string{"shopifyDomain": shopDomain},
			})
			if err != nil {
				return Shop{}, ShopSource{}, ShopifyInstallation{}, err
			}
		}
	}
	if updatedShop, updated, syncErr := s.syncShopifyDisplayName(ctx, shop, shopDomain, shopName); syncErr != nil {
		return Shop{}, ShopSource{}, ShopifyInstallation{}, syncErr
	} else if updated {
		shop = updatedShop
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return Shop{}, ShopSource{}, ShopifyInstallation{}, err
	}
	var source ShopSource
	for _, item := range sources {
		if item.Type != SourceTypeShopifyAPI {
			continue
		}
		if normalizeShopifyDomain(item.Address) == shopDomain {
			source = item
			break
		}
		if source.ID == "" && strings.TrimSpace(targetShopID) != "" {
			source = item
		}
	}
	if source.ID == "" {
		source, err = s.store.CreateShopSource(ctx, ShopSource{
			ShopID:   shop.ID,
			Type:     SourceTypeShopifyAPI,
			Provider: "shopify_admin",
			Address:  shopDomain,
			Metadata: map[string]string{"shopifyDomain": shopDomain},
		})
		if err != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
	} else if source.Status != SourceStatusActive || normalizeShopifyDomain(source.Address) != shopDomain {
		metadata := cloneStringMap(source.Metadata)
		metadata["shopifyDomain"] = shopDomain
		source, err = s.store.UpdateShopSource(ctx, shop.ID, source.ID, ShopSource{
			Provider: "shopify_admin",
			Address:  shopDomain,
			Status:   SourceStatusActive,
			Metadata: metadata,
		})
		if err != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
	}
	accessToken := strings.TrimSpace(token.AccessToken)
	if shopifyDistributionMode() == shopifyDistributionPublic {
		encryptedToken, encryptErr := encryptShopifyCredential(accessToken)
		if encryptErr != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, encryptErr
		}
		accessToken = encryptedShopifyTokenPrefix + encryptedToken
	}
	installation, err := s.store.SaveShopifyInstallation(ctx, ShopifyInstallation{
		ShopID:      shop.ID,
		ShopDomain:  shopDomain,
		AccessToken: accessToken,
		Scope:       token.Scope,
	})
	if err != nil {
		return Shop{}, ShopSource{}, ShopifyInstallation{}, err
	}
	if strings.TrimSpace(targetShopID) != "" {
		profile, err := s.store.GetShopifyAppProfile(ctx, shop.ID)
		if err != nil {
			return Shop{}, ShopSource{}, ShopifyInstallation{}, err
		}
		if normalizeShopifyDomain(profile.ShopDomain) != shopDomain {
			profile.ShopDomain = shopDomain
			if _, err := s.store.SaveShopifyAppProfile(ctx, profile); err != nil {
				return Shop{}, ShopSource{}, ShopifyInstallation{}, err
			}
		}
		if previousProfileDomain != "" && previousProfileDomain != shopDomain {
			if previous, err := s.store.GetShopifyInstallationByDomain(ctx, previousProfileDomain); err == nil && previous.ShopID == shop.ID {
				if err := s.store.DeleteShopifyInstallationByDomain(ctx, previousProfileDomain); err != nil {
					return Shop{}, ShopSource{}, ShopifyInstallation{}, err
				}
			} else if err != nil && !errors.Is(err, ErrNotFound) {
				return Shop{}, ShopSource{}, ShopifyInstallation{}, err
			}
		}
	}
	if _, updatedSource, statusErr := s.finalizeShopifyConnectionStatus(ctx, shop, shopDomain, token.AccessToken, connectionStatus); statusErr != nil {
		return Shop{}, ShopSource{}, ShopifyInstallation{}, statusErr
	} else if updatedSource.ID != "" {
		source = updatedSource
	}
	return shop, source, installation, nil
}

type shopifyAppSettings struct {
	APIKey       string
	Secret       string
	Scopes       string
	BaseURL      string
	CallbackPath string
	APIVersion   string
}

func shopifyAppConfig() (shopifyAppSettings, error) {
	cfg := shopifyBaseSettings()
	if shopifyDistributionMode() == shopifyDistributionPublic {
		cfg.APIKey = firstNonEmptyEnv("SHOPIFY_APP_API_KEY")
		cfg.Secret = firstNonEmptyEnv("SHOPIFY_APP_API_SECRET")
	} else {
		cfg.APIKey = firstNonEmptyEnv("SHOPIFY_APP_API_KEY", "SHOPIFY_API_KEY")
		cfg.Secret = firstNonEmptyEnv("SHOPIFY_APP_API_SECRET", "SHOPIFY_API_SECRET")
	}
	if cfg.APIKey == "" || cfg.Secret == "" {
		return shopifyAppSettings{}, fmt.Errorf("%w: Shopify App API key and secret are required", ErrInvalid)
	}
	return cfg, nil
}

func shopifyBaseSettings() shopifyAppSettings {
	scopes := firstNonEmptyEnv("SHOPIFY_APP_SCOPES")
	apiVersion := firstNonEmptyEnv("SHOPIFY_APP_API_VERSION")
	if shopifyDistributionMode() != shopifyDistributionPublic {
		scopes = firstNonEmpty(scopes, firstNonEmptyEnv("SHOPIFY_SCOPES"))
		apiVersion = firstNonEmpty(apiVersion, firstNonEmptyEnv("SHOPIFY_API_VERSION"))
	}
	cfg := shopifyAppSettings{
		Scopes:       scopes,
		BaseURL:      strings.TrimRight(firstNonEmptyEnv("SHOPIFY_APP_BASE_URL", "PUBLIC_BASE_URL"), "/"),
		CallbackPath: firstNonEmptyEnv("SHOPIFY_APP_CALLBACK_PATH"),
		APIVersion:   apiVersion,
	}
	cfg.Scopes = mergeShopifyAppScopes(cfg.Scopes, defaultShopifyAppScopes)
	if cfg.CallbackPath == "" {
		cfg.CallbackPath = "/auth/callback"
	}
	if !strings.HasPrefix(cfg.CallbackPath, "/") {
		cfg.CallbackPath = "/" + cfg.CallbackPath
	}
	if cfg.APIVersion == "" {
		if shopifyDistributionMode() == shopifyDistributionPublic {
			cfg.APIVersion = shopifyPublicAdminAPIVersion
		} else {
			cfg.APIVersion = shopifyAdminAPIVersion
		}
	}
	return cfg
}

func mergeShopifyAppScopes(scopeSets ...string) string {
	seen := map[string]bool{}
	merged := make([]string, 0)
	for _, scopes := range scopeSets {
		for _, scope := range strings.FieldsFunc(strings.ToLower(scopes), func(r rune) bool {
			return r == ',' || r == ' ' || r == '\t' || r == '\n'
		}) {
			scope = strings.TrimSpace(scope)
			if scope == "" || seen[scope] {
				continue
			}
			seen[scope] = true
			merged = append(merged, scope)
		}
	}
	canonical := merged[:0]
	for _, scope := range merged {
		if strings.HasPrefix(scope, "read_") && seen["write_"+strings.TrimPrefix(scope, "read_")] {
			continue
		}
		canonical = append(canonical, scope)
	}
	return strings.Join(canonical, ",")
}

func (s *Server) shopifyAppConfigForShop(ctx context.Context, shopDomain string) (shopifyAppSettings, error) {
	if shopifyDistributionMode() == shopifyDistributionPublic {
		return shopifyAppConfig()
	}
	profile, err := s.store.GetShopifyAppProfileByDomain(ctx, shopDomain)
	if err == nil {
		return shopifyAppSettingsFromProfile(profile)
	}
	if !errors.Is(err, ErrNotFound) {
		return shopifyAppSettings{}, err
	}
	return shopifyAppSettings{}, fmt.Errorf("%w: 该店铺尚未配置独立 Shopify App，请先在 Xzdesk 新增店铺流程中保存并发布 App", ErrNotFound)
}

func (s *Server) readyShopifyAppConfigForShop(ctx context.Context, shopDomain string) (shopifyAppSettings, error) {
	if shopifyDistributionMode() == shopifyDistributionPublic {
		return shopifyAppConfig()
	}
	profile, err := s.store.GetShopifyAppProfileByDomain(ctx, shopDomain)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return shopifyAppSettings{}, fmt.Errorf("%w: 该店铺尚未配置独立 Shopify App，请先在 Xzdesk 新增店铺流程中保存并发布 App", ErrNotFound)
		}
		return shopifyAppSettings{}, err
	}
	if profile.DeployStatus != ShopifyAppDeployReady {
		return shopifyAppSettings{}, fmt.Errorf("%w: 该店铺的独立 Shopify App 内部版本尚未发布成功，暂不能授权", ErrInvalid)
	}
	return shopifyAppSettingsFromProfile(profile)
}

func (s *Server) readyShopifyAppConfigForProfile(ctx context.Context, shopID string) (ShopifyAppProfile, shopifyAppSettings, error) {
	profile, err := s.store.GetShopifyAppProfile(ctx, strings.TrimSpace(shopID))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return ShopifyAppProfile{}, shopifyAppSettings{}, fmt.Errorf("%w: 该店铺尚未配置独立 Shopify App", ErrNotFound)
		}
		return ShopifyAppProfile{}, shopifyAppSettings{}, err
	}
	if profile.DeployStatus != ShopifyAppDeployReady {
		return ShopifyAppProfile{}, shopifyAppSettings{}, fmt.Errorf("%w: 该店铺的独立 Shopify App 内部版本尚未发布成功，暂不能授权", ErrInvalid)
	}
	cfg, err := shopifyAppSettingsFromProfile(profile)
	if err != nil {
		return ShopifyAppProfile{}, shopifyAppSettings{}, err
	}
	return profile, cfg, nil
}

func (s *Server) shopifyAuthorizationContext(ctx context.Context, shopDomain string, profileReference string) (shopifyAppSettings, string, error) {
	if strings.TrimSpace(profileReference) == "" {
		cfg, err := s.readyShopifyAppConfigForShop(ctx, shopDomain)
		if err != nil {
			return shopifyAppSettings{}, "", err
		}
		return cfg, signedShopifyState(shopDomain, cfg.Secret), nil
	}
	shopID, ok := unsignedShopifyProfileReferenceShopID(profileReference)
	if !ok {
		return shopifyAppSettings{}, "", fmt.Errorf("%w: Shopify 授权链接无效，请返回 Xzdesk 重新生成", ErrInvalid)
	}
	_, cfg, err := s.readyShopifyAppConfigForProfile(ctx, shopID)
	if err != nil {
		return shopifyAppSettings{}, "", err
	}
	if !verifySignedShopifyProfileReference(profileReference, shopID, cfg.Secret) {
		return shopifyAppSettings{}, "", fmt.Errorf("%w: Shopify 授权链接已失效，请返回 Xzdesk 重新生成", ErrInvalid)
	}
	return cfg, signedShopifyBoundState(shopID, cfg.Secret), nil
}

func (s *Server) shopifyCallbackContext(ctx context.Context, shopDomain string, state string) (shopifyAppSettings, string, error) {
	shopID, bound := unsignedShopifyBoundStateShopID(state)
	if !bound {
		cfg, err := s.readyShopifyAppConfigForShop(ctx, shopDomain)
		return cfg, "", err
	}
	_, cfg, err := s.readyShopifyAppConfigForProfile(ctx, shopID)
	if err != nil {
		return shopifyAppSettings{}, "", err
	}
	if !verifySignedShopifyBoundState(state, shopID, cfg.Secret) {
		return shopifyAppSettings{}, "", fmt.Errorf("%w: Shopify 授权状态无效，请返回 Xzdesk 重新授权", ErrInvalid)
	}
	return cfg, shopID, nil
}

func shopifyAppSettingsFromProfile(profile ShopifyAppProfile) (shopifyAppSettings, error) {
	secret, err := decryptShopifyCredential(profile.EncryptedClientSecret)
	if err != nil {
		return shopifyAppSettings{}, err
	}
	cfg := shopifyBaseSettings()
	cfg.APIKey = profile.ClientID
	cfg.Secret = secret
	return cfg, nil
}

func (s *Server) shopifyWebhookConfigForShop(ctx context.Context, shopDomain string) (shopifyAppSettings, error) {
	if shopifyDistributionMode() == shopifyDistributionPublic {
		return shopifyAppConfig()
	}
	cfg, err := s.shopifyAppConfigForShop(ctx, shopDomain)
	if err == nil || !errors.Is(err, ErrNotFound) {
		return cfg, err
	}
	// Legacy compatibility is limited to uninstall webhooks from stores that
	// were connected before per-shop App profiles were introduced.
	return shopifyAppConfig()
}

func shopifyDistributionMode() string {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("SHOPIFY_APP_DISTRIBUTION")))
	switch mode {
	case shopifyDistributionPublic:
		return shopifyDistributionPublic
	case "", shopifyDistributionPerShop:
		return shopifyDistributionPerShop
	default:
		return shopifyDistributionPerShop
	}
}

func (cfg shopifyAppSettings) RedirectURI(r *http.Request) string {
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

func (cfg shopifyAppSettings) PublicURL(path string) string {
	baseURL := strings.TrimRight(cfg.BaseURL, "/")
	if baseURL == "" {
		return ""
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return baseURL + path
}

func signedShopifyState(shop string, secret string) string {
	shop = normalizeShopifyDomain(shop)
	ts := fmt.Sprintf("%d", time.Now().Unix())
	payload := shop + "|" + ts
	return payload + "|" + hmacHex(secret, payload)
}

const shopifyProfileReferenceTTL = 24 * time.Hour

func signedShopifyProfileReference(shopID string, secret string) string {
	payload := "v1." + base64.RawURLEncoding.EncodeToString([]byte(strings.TrimSpace(shopID))) + "." + strconv.FormatInt(time.Now().Unix(), 10)
	return payload + "." + hmacHex(secret, payload)
}

func unsignedShopifyProfileReferenceShopID(reference string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(reference), ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || strings.TrimSpace(string(raw)) == "" {
		return "", false
	}
	return strings.TrimSpace(string(raw)), true
}

func verifySignedShopifyProfileReference(reference string, shopID string, secret string) bool {
	parts := strings.Split(strings.TrimSpace(reference), ".")
	if len(parts) != 4 || parts[0] != "v1" {
		return false
	}
	decodedShopID, ok := unsignedShopifyProfileReferenceShopID(reference)
	if !ok || decodedShopID != strings.TrimSpace(shopID) {
		return false
	}
	payload := strings.Join(parts[:3], ".")
	if !hmac.Equal([]byte(parts[3]), []byte(hmacHex(secret, payload))) {
		return false
	}
	return shopifySignedTimestampValid(parts[2], shopifyProfileReferenceTTL)
}

func signedShopifyBoundState(shopID string, secret string) string {
	payload := strings.Join([]string{
		"v2",
		base64.RawURLEncoding.EncodeToString([]byte(strings.TrimSpace(shopID))),
		strconv.FormatInt(time.Now().Unix(), 10),
	}, ".")
	return payload + "." + hmacHex(secret, payload)
}

func unsignedShopifyBoundStateShopID(state string) (string, bool) {
	parts := strings.Split(strings.TrimSpace(state), ".")
	if len(parts) != 4 || parts[0] != "v2" {
		return "", false
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || strings.TrimSpace(string(raw)) == "" {
		return "", false
	}
	return strings.TrimSpace(string(raw)), true
}

func verifySignedShopifyBoundState(state string, shopID string, secret string) bool {
	parts := strings.Split(strings.TrimSpace(state), ".")
	if len(parts) != 4 || parts[0] != "v2" {
		return false
	}
	decodedShopID, ok := unsignedShopifyBoundStateShopID(state)
	if !ok || decodedShopID != strings.TrimSpace(shopID) {
		return false
	}
	payload := strings.Join(parts[:3], ".")
	if !hmac.Equal([]byte(parts[3]), []byte(hmacHex(secret, payload))) {
		return false
	}
	return shopifySignedTimestampValid(parts[2], 15*time.Minute)
}

func shopifySignedTimestampValid(raw string, ttl time.Duration) bool {
	issuedAt, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return false
	}
	age := time.Since(time.Unix(issuedAt, 0))
	return age >= -time.Minute && age <= ttl
}

func verifySignedShopifyState(state string, shop string, secret string) bool {
	parts := strings.Split(state, "|")
	if len(parts) != 3 || normalizeShopifyDomain(parts[0]) != normalizeShopifyDomain(shop) {
		return false
	}
	payload := parts[0] + "|" + parts[1]
	if !hmac.Equal([]byte(parts[2]), []byte(hmacHex(secret, payload))) {
		return false
	}
	issuedAt, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return false
	}
	return time.Since(time.Unix(issuedAt, 0)) <= 15*time.Minute
}

func verifyShopifyCallbackHMAC(values url.Values, secret string) bool {
	got := strings.TrimSpace(values.Get("hmac"))
	if got == "" {
		return false
	}
	items := make([]string, 0, len(values))
	for key, rawValues := range values {
		if key == "hmac" || key == "signature" {
			continue
		}
		for _, value := range rawValues {
			items = append(items, key+"="+value)
		}
	}
	sort.Strings(items)
	expected := hmacHex(secret, strings.Join(items, "&"))
	return hmac.Equal([]byte(got), []byte(expected))
}

func hmacHex(secret string, payload string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func exchangeShopifyOAuthToken(ctx context.Context, shop string, code string, cfg shopifyAppSettings) (shopifyOAuthTokenResponse, error) {
	body, err := json.Marshal(map[string]string{
		"client_id":     cfg.APIKey,
		"client_secret": cfg.Secret,
		"code":          code,
	})
	if err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	endpoint := fmt.Sprintf("https://%s/admin/oauth/access_token", normalizeShopifyDomain(shop))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return shopifyOAuthTokenResponse{}, fmt.Errorf("Shopify OAuth returned %d: %s", resp.StatusCode, strings.TrimSpace(string(raw)))
	}
	var token shopifyOAuthTokenResponse
	if err := json.Unmarshal(raw, &token); err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	if strings.TrimSpace(token.AccessToken) == "" {
		return shopifyOAuthTokenResponse{}, fmt.Errorf("Shopify OAuth returned an empty access token")
	}
	return token, nil
}

func registerShopifyAppUninstalledWebhook(ctx context.Context, shop string, accessToken string, cfg shopifyAppSettings) error {
	callbackURL := cfg.PublicURL("/webhooks/shopify/app/uninstalled")
	if callbackURL == "" {
		return fmt.Errorf("%w: PUBLIC_BASE_URL is required to register Shopify webhooks", ErrInvalid)
	}
	body, err := json.Marshal(map[string]any{
		"query": `mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id }
    userErrors { field message }
  }
}`,
		"variables": map[string]any{
			"topic": "APP_UNINSTALLED",
			"webhookSubscription": map[string]string{
				"uri":    callbackURL,
				"format": "JSON",
			},
		},
	})
	if err != nil {
		return err
	}
	endpoint := fmt.Sprintf("https://%s/admin/api/%s/graphql.json", normalizeShopifyDomain(shop), cfg.APIVersion)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Shopify-Access-Token", strings.TrimSpace(accessToken))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Shopify webhook GraphQL request returned %d", resp.StatusCode)
	}
	var result struct {
		Data struct {
			Create struct {
				WebhookSubscription *struct {
					ID string `json:"id"`
				} `json:"webhookSubscription"`
				UserErrors []struct {
					Message string `json:"message"`
				} `json:"userErrors"`
			} `json:"webhookSubscriptionCreate"`
		} `json:"data"`
		Errors []struct {
			Message string `json:"message"`
		} `json:"errors"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return fmt.Errorf("decode Shopify webhook GraphQL response: %w", err)
	}
	if len(result.Errors) > 0 {
		return errors.New("Shopify webhook GraphQL request failed")
	}
	if len(result.Data.Create.UserErrors) > 0 {
		for _, userError := range result.Data.Create.UserErrors {
			message := strings.ToLower(userError.Message)
			if strings.Contains(message, "already") && strings.Contains(message, "taken") {
				return nil
			}
		}
		return errors.New("Shopify rejected the uninstall webhook subscription")
	}
	if result.Data.Create.WebhookSubscription == nil || strings.TrimSpace(result.Data.Create.WebhookSubscription.ID) == "" {
		return errors.New("Shopify returned an empty uninstall webhook subscription")
	}
	return nil
}

func (s *Server) handleShopifyAppUninstalled(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeError(w, err)
		return
	}
	defer r.Body.Close()
	shop := normalizeShopifyDomain(r.Header.Get("X-Shopify-Shop-Domain"))
	if shop == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "missing Shopify shop domain"})
		return
	}
	cfg, err := s.shopifyWebhookConfigForShop(r.Context(), shop)
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if !verifyShopifyWebhookHMAC(raw, r.Header.Get("X-Shopify-Hmac-Sha256"), cfg.Secret) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify webhook HMAC"})
		return
	}
	installation, _ := s.store.GetShopifyInstallationByDomain(r.Context(), shop)
	if err := s.store.DeleteShopifyInstallationByDomain(r.Context(), shop); err != nil {
		writeError(w, err)
		return
	}
	if installation.ShopID != "" {
		if err := s.disableShopifyAPISourceByDomain(r.Context(), installation.ShopID, shop); err != nil {
			writeError(w, err)
			return
		}
	}
	s.broadcast(Event{Type: "shopify_app.uninstalled", ShopID: installation.ShopID, EntityID: installation.ShopID, Payload: map[string]string{
		"shopDomain": shop,
	}, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) handleShopifyOrderWebhook(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 2<<20))
	if err != nil {
		writeError(w, err)
		return
	}
	defer r.Body.Close()
	shopDomain := normalizeShopifyDomain(r.Header.Get("X-Shopify-Shop-Domain"))
	if shopDomain == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "missing Shopify shop domain"})
		return
	}
	cfg, err := s.shopifyWebhookConfigForShop(r.Context(), shopDomain)
	if err != nil || !verifyShopifyWebhookHMAC(raw, r.Header.Get("X-Shopify-Hmac-Sha256"), cfg.Secret) {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify webhook HMAC"})
		return
	}
	queue, ok := s.store.(shopifyOrderSyncJobStore)
	if !ok {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{"error": "Shopify order sync queue is unavailable"})
		return
	}
	webhookID := strings.TrimSpace(r.Header.Get("X-Shopify-Webhook-Id"))
	topic := strings.TrimSpace(r.Header.Get("X-Shopify-Topic"))
	installation, err := s.store.GetShopifyInstallationByDomain(r.Context(), shopDomain)
	if err != nil || installation.ShopID == "" {
		writeJSONResponse(w, http.StatusAccepted, map[string]bool{"queued": false})
		return
	}
	shop, err := s.store.GetShop(r.Context(), installation.ShopID)
	if err != nil || shop.Status != ShopStatusActive {
		writeJSONResponse(w, http.StatusAccepted, map[string]bool{"queued": false})
		return
	}
	targetOrderID := shopifyWebhookOrderID(raw)
	job, accepted, err := queue.EnqueueShopifyWebhookJob(r.Context(), webhookID, shopDomain, topic, time.Now().UTC(), ShopifyOrderSyncJob{
		ShopID: shop.ID, Priority: shopifyOrderSyncPriorityWebhook, Reason: "Shopify webhook " + topic,
		TargetOrderID: targetOrderID, AvailableAt: time.Now().UTC(),
	})
	if err != nil {
		writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{"error": "Shopify webhook could not be queued"})
		return
	}
	if !accepted {
		writeJSONResponse(w, http.StatusOK, map[string]bool{"queued": false, "duplicate": true})
		return
	}
	s.publishShopifyOrderSyncQueued(r.Context(), shop, job)
	s.notifyShopifyOrderSyncWorkers()
	writeJSONResponse(w, http.StatusAccepted, map[string]bool{"queued": true})
}

func shopifyWebhookOrderID(raw []byte) string {
	var payload struct {
		ID      json.Number `json:"id"`
		OrderID json.Number `json:"order_id"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	if err := decoder.Decode(&payload); err != nil {
		return ""
	}
	if strings.TrimSpace(payload.OrderID.String()) != "" {
		return strings.TrimSpace(payload.OrderID.String())
	}
	return strings.TrimSpace(payload.ID.String())
}

func (s *Server) disableShopifyAPISourceByDomain(ctx context.Context, shopID string, shopDomain string) error {
	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return err
	}
	for _, source := range sources {
		if source.Type == SourceTypeShopifyAPI && sourceShopifyDomain(source) == shopDomain && source.Status != SourceStatusDisabled {
			updated, err := s.store.SetShopSourceStatus(ctx, shopID, source.ID, SourceStatusDisabled)
			if err != nil {
				return err
			}
			s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
		}
	}
	return nil
}

func verifyShopifyWebhookHMAC(raw []byte, header string, secret string) bool {
	header = strings.TrimSpace(header)
	secret = strings.TrimSpace(secret)
	if header == "" || secret == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write(raw)
	expected := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(header)) == 1
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}
