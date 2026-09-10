package platform

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type shopifySessionClaims struct {
	Audience  string `json:"aud"`
	Dest      string `json:"dest"`
	ExpiresAt int64  `json:"exp"`
	IssuedAt  int64  `json:"iat"`
	Issuer    string `json:"iss"`
	NotBefore int64  `json:"nbf"`
	SessionID string `json:"sid"`
	Subject   string `json:"sub"`
}

func renderShopifyEmbeddedApp(apiKey string, shopDomain string) string {
	apiKey = html.EscapeString(strings.TrimSpace(apiKey))
	shopDomain = html.EscapeString(normalizeShopifyDomain(shopDomain))
	return fmt.Sprintf(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="shopify-api-key" content="%s">
  <title>Xinzhi ERP</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    :root{color-scheme:light;--ink:#0f172a;--muted:#526075;--line:#dfe5ec;--surface:#fff;--page:#f6f7f9;--blue:#005bd3;--blue-soft:#eaf3ff;--green:#087f5b;--green-soft:#e7f6ef;--danger:#b42318}
    *{box-sizing:border-box}
    body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
    button{font:inherit}
    .shell{max-width:1120px;margin:0 auto;padding:24px}
    .hero,.panel{background:var(--surface);border:1px solid var(--line);border-radius:12px}
    .hero{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:24px}
    .eyebrow{margin:0 0 4px;color:var(--blue);font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
    h1{margin:0;font-size:24px;line-height:1.25}
    .summary{max-width:680px;margin:8px 0 0;color:var(--muted)}
    .status{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:8px 12px;border-radius:999px;background:var(--blue-soft);color:#003a8c;font-weight:600;white-space:nowrap}
    .dot{width:8px;height:8px;border-radius:50%%;background:currentColor}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;margin-top:16px}
    .panel{padding:20px}
    .panel h2{margin:0 0 6px;font-size:16px}
    .panel p{margin:0;color:var(--muted)}
    .label{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;margin-bottom:14px;border-radius:9px;background:#eef2f6;color:#25354d;font-size:12px;font-weight:800}
    .setup{margin-top:16px}
    .setup-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .setup h2{margin:0;font-size:18px}
    .setup ol{margin:16px 0 0;padding-left:22px;color:var(--muted)}
    .setup li+li{margin-top:8px}
    .shop{font-variant-numeric:tabular-nums;color:var(--ink);font-weight:600}
    .error{display:none;margin-top:16px;padding:12px 14px;border:1px solid #f3b7b2;border-radius:8px;background:#fff1f0;color:var(--danger)}
    .error.visible{display:block}
    .ready{background:var(--green-soft);color:var(--green)}
    @media(max-width:760px){.shell{padding:16px}.hero{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:1fr}}
    @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero" aria-labelledby="app-title">
      <div>
        <p class="eyebrow">Shopify 店铺连接</p>
        <h1 id="app-title">Xinzhi ERP</h1>
        <p class="summary">此页面仅用于验证 Shopify API 连接。订单、库存、履约、退货退款、客户和拒付管理均在独立的 Xinzhi ERP Web 后台完成。</p>
      </div>
      <div id="connection-status" class="status" role="status" aria-live="polite"><span class="dot" aria-hidden="true"></span>正在安全连接</div>
    </section>

    <section class="grid" aria-label="连接后可在外部 ERP 使用的能力">
      <article class="panel"><span class="label" aria-hidden="true">PI</span><h2>商品导入</h2><p>连接完成后，在独立 ERP 后台预览商品与变体并按唯一 SKU 匹配。</p></article>
      <article class="panel"><span class="label" aria-hidden="true">OD</span><h2>订单处理</h2><p>连接完成后，在独立 ERP 后台预览、导入并处理符合条件的订单。</p></article>
      <article class="panel"><span class="label" aria-hidden="true">FS</span><h2>退货与履约</h2><p>连接完成后，在独立 ERP 后台处理退货并安全回传履约结果。</p></article>
      <article class="panel"><span class="label" aria-hidden="true">DP</span><h2>拒付概览</h2><p>连接完成后，在独立 ERP 后台查看拒付状态、金额、原因和处理截止时间；证据材料在 Shopify Admin 中处理。</p></article>
    </section>

    <section class="panel setup">
      <div class="setup-head">
        <h2>连接状态</h2>
        <span class="shop">%s</span>
      </div>
      <ol>
        <li>验证当前 Shopify 管理员会话。</li>
        <li>为本店铺创建加密的离线授权。</li>
        <li>绑定 Xinzhi ERP 店铺；业务管理请前往独立的 Xinzhi ERP Web 后台。</li>
      </ol>
      <div id="connection-error" class="error" role="alert"></div>
    </section>
  </main>
  <script>
    (async function connectXZERP(){
      const status=document.getElementById("connection-status");
      const error=document.getElementById("connection-error");
      try{
        if(!window.shopify||typeof window.shopify.idToken!=="function"){throw new Error("Shopify App Bridge 尚未就绪，请刷新页面。")}
        const token=await window.shopify.idToken();
        const response=await fetch("/api/v1/shopify/session/exchange",{
          method:"POST",
          headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
          body:"{}"
        });
        const payload=await response.json().catch(function(){return {};});
        if(!response.ok){throw new Error(payload.error||"无法连接 Shopify，请稍后重试。")}
        status.classList.add("ready");
        status.innerHTML='<span class="dot" aria-hidden="true"></span>店铺已安全连接';
      }catch(err){
        status.textContent="连接失败";
        error.textContent=err&&err.message?err.message:"无法连接 Shopify，请稍后重试。";
        error.classList.add("visible");
      }
    })();
  </script>
</body>
</html>`, apiKey, shopDomain)
}

func (s *Server) handleShopifySessionExchange(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if shopifyDistributionMode() != shopifyDistributionPublic {
		writeJSONResponse(w, http.StatusForbidden, map[string]string{"error": "Shopify public app mode is not enabled"})
		return
	}
	cfg, err := shopifyAppConfig()
	if err != nil {
		log.Printf("shopify session exchange configuration failed: %s", shopifySessionDiagnostic(err))
		writeShopifySessionFailure(
			w,
			http.StatusServiceUnavailable,
			"SHOPIFY_APP_NOT_CONFIGURED",
			"Shopify app is temporarily unavailable",
		)
		return
	}
	sessionToken := bearerToken(r)
	claims, err := verifyShopifySessionToken(sessionToken, cfg, time.Now().UTC())
	if err != nil {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify session token"})
		return
	}
	token, err := s.shopifySessionTokenExchange(r.Context(), claims.ShopDomain(), sessionToken, cfg)
	if err != nil {
		log.Printf(
			"shopify session exchange failed for shop %s: %s",
			claims.ShopDomain(),
			shopifySessionDiagnostic(err, cfg.Secret, sessionToken),
		)
		writeShopifySessionFailure(
			w,
			http.StatusBadGateway,
			"SHOPIFY_SESSION_EXCHANGE_FAILED",
			"Unable to connect Shopify. Please try again later.",
		)
		return
	}
	shop, source, installation, err := s.ensureShopifyAppInstallation(r.Context(), claims.ShopDomain(), token)
	if err != nil {
		log.Printf(
			"shopify installation persistence failed for shop %s: %s",
			claims.ShopDomain(),
			shopifySessionDiagnostic(err, cfg.Secret, sessionToken, token.AccessToken),
		)
		writeShopifySessionFailure(
			w,
			http.StatusInternalServerError,
			"SHOPIFY_INSTALLATION_FAILED",
			"Unable to connect Shopify. Please try again later.",
		)
		return
	}
	s.broadcast(Event{
		Type:      "shopify_app.session_connected",
		ShopID:    shop.ID,
		EntityID:  shop.ID,
		Payload:   map[string]any{"shop": shop, "source": source},
		CreatedAt: time.Now().UTC(),
	})
	writeJSONResponse(w, http.StatusOK, map[string]any{
		"shopId":      shop.ID,
		"shopDomain":  installation.ShopDomain,
		"scope":       installation.Scope,
		"installedAt": installation.InstalledAt,
	})
}

var shopifyCredentialPattern = regexp.MustCompile(`(?i)\b(?:shpat|shpca|shppa|shpua|shpss)_[a-z0-9_-]+\b`)

func shopifySessionDiagnostic(err error, secrets ...string) string {
	if err == nil {
		return "unknown failure"
	}
	return shopifyCredentialPattern.ReplaceAllString(
		sanitizeShopifyDeployMessage(err.Error(), secrets...),
		"[REDACTED]",
	)
}

func writeShopifySessionFailure(w http.ResponseWriter, status int, code string, message string) {
	writeJSONResponse(w, status, map[string]any{
		"code":      code,
		"error":     message,
		"retryable": status >= http.StatusInternalServerError,
	})
}

func verifyShopifySessionToken(raw string, cfg shopifyAppSettings, now time.Time) (shopifySessionClaims, error) {
	parts := strings.Split(strings.TrimSpace(raw), ".")
	if len(parts) != 3 {
		return shopifySessionClaims{}, fmt.Errorf("%w: malformed Shopify session token", ErrInvalid)
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return shopifySessionClaims{}, fmt.Errorf("%w: malformed Shopify session token header", ErrInvalid)
	}
	var header struct {
		Algorithm string `json:"alg"`
		Type      string `json:"typ"`
	}
	if err := json.Unmarshal(headerJSON, &header); err != nil || header.Algorithm != "HS256" {
		return shopifySessionClaims{}, fmt.Errorf("%w: unsupported Shopify session token algorithm", ErrInvalid)
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return shopifySessionClaims{}, fmt.Errorf("%w: malformed Shopify session token signature", ErrInvalid)
	}
	mac := hmac.New(sha256.New, []byte(cfg.Secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return shopifySessionClaims{}, fmt.Errorf("%w: invalid Shopify session token signature", ErrInvalid)
	}
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return shopifySessionClaims{}, fmt.Errorf("%w: malformed Shopify session token payload", ErrInvalid)
	}
	var claims shopifySessionClaims
	if err := json.Unmarshal(payloadJSON, &claims); err != nil {
		return shopifySessionClaims{}, fmt.Errorf("%w: malformed Shopify session token claims", ErrInvalid)
	}
	const clockSkew = 5 * time.Second
	switch {
	case strings.TrimSpace(claims.Audience) != strings.TrimSpace(cfg.APIKey):
		return shopifySessionClaims{}, fmt.Errorf("%w: Shopify session token audience mismatch", ErrInvalid)
	case claims.ExpiresAt == 0 || now.After(time.Unix(claims.ExpiresAt, 0).Add(clockSkew)):
		return shopifySessionClaims{}, fmt.Errorf("%w: Shopify session token expired", ErrInvalid)
	case claims.NotBefore != 0 && now.Add(clockSkew).Before(time.Unix(claims.NotBefore, 0)):
		return shopifySessionClaims{}, fmt.Errorf("%w: Shopify session token is not active", ErrInvalid)
	case claims.IssuedAt != 0 && now.Add(clockSkew).Before(time.Unix(claims.IssuedAt, 0)):
		return shopifySessionClaims{}, fmt.Errorf("%w: Shopify session token was issued in the future", ErrInvalid)
	case claims.ShopDomain() == "":
		return shopifySessionClaims{}, fmt.Errorf("%w: Shopify session token destination is invalid", ErrInvalid)
	}
	if issuerShop := shopifyDomainFromAdminURL(claims.Issuer); issuerShop == "" || issuerShop != claims.ShopDomain() {
		return shopifySessionClaims{}, fmt.Errorf("%w: Shopify session token issuer mismatch", ErrInvalid)
	}
	return claims, nil
}

func (c shopifySessionClaims) ShopDomain() string {
	return shopifyDomainFromDestinationURL(c.Dest)
}

func shopifyDomainFromDestinationURL(value string) string {
	return shopifyDomainFromURL(value, false)
}

func shopifyDomainFromAdminURL(value string) string {
	return shopifyDomainFromURL(value, true)
}

func shopifyDomainFromURL(value string, requireAdminPath bool) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil || parsed.Port() != "" ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return ""
	}
	if requireAdminPath {
		if parsed.Path != "/admin" && parsed.Path != "/admin/" {
			return ""
		}
	} else if parsed.Path != "" && parsed.Path != "/" {
		return ""
	}
	return normalizeShopifyDomain(parsed.Host)
}

func exchangeShopifySessionToken(
	ctx context.Context,
	shop string,
	sessionToken string,
	cfg shopifyAppSettings,
) (shopifyOAuthTokenResponse, error) {
	body, err := json.Marshal(map[string]string{
		"client_id":            cfg.APIKey,
		"client_secret":        cfg.Secret,
		"grant_type":           "urn:ietf:params:oauth:grant-type:token-exchange",
		"subject_token":        strings.TrimSpace(sessionToken),
		"subject_token_type":   "urn:ietf:params:oauth:token-type:id_token",
		"requested_token_type": "urn:shopify:params:oauth:token-type:offline-access-token",
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
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return shopifyOAuthTokenResponse{}, fmt.Errorf("Shopify token exchange returned %d", resp.StatusCode)
	}
	var token shopifyOAuthTokenResponse
	if err := json.Unmarshal(raw, &token); err != nil {
		return shopifyOAuthTokenResponse{}, err
	}
	if strings.TrimSpace(token.AccessToken) == "" {
		return shopifyOAuthTokenResponse{}, fmt.Errorf("Shopify token exchange returned an empty access token")
	}
	return token, nil
}
