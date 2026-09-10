package installations

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"html"
	"net/http"
	"net/url"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type embeddedSessionClaims struct {
	Audience  string `json:"aud"`
	Dest      string `json:"dest"`
	ExpiresAt int64  `json:"exp"`
	IssuedAt  int64  `json:"iat"`
	Issuer    string `json:"iss"`
	NotBefore int64  `json:"nbf"`
	SessionID string `json:"sid"`
	Subject   string `json:"sub"`
}

type embeddedProduct struct {
	Title        string `json:"title"`
	Status       string `json:"status,omitempty"`
	VariantCount int    `json:"variantCount"`
}

type embeddedOrder struct {
	Name              string   `json:"name"`
	CreatedAt         string   `json:"createdAt"`
	FinancialStatus   string   `json:"financialStatus,omitempty"`
	FulfillmentStatus string   `json:"fulfillmentStatus,omitempty"`
	Total             string   `json:"total"`
	CurrencyCode      string   `json:"currencyCode"`
	RecipientName     string   `json:"recipientName,omitempty"`
	RecipientEmail    string   `json:"recipientEmail,omitempty"`
	RecipientPhone    string   `json:"recipientPhone,omitempty"`
	ShippingAddress   []string `json:"shippingAddress,omitempty"`
}

func (h *Handler) handleEmbeddedSession(w http.ResponseWriter, r *http.Request) {
	claims, token, ok := h.authenticateEmbeddedRequest(w, r)
	if !ok {
		return
	}
	connection, ok := h.connectEmbeddedRequest(w, r, claims.ShopDomain(), token)
	if !ok {
		return
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{
		"state":          "CONNECTED",
		"shopDomain":     connection.Summary.ShopDomain,
		"shopName":       connection.Summary.ShopName,
		"grantedScopes":  connection.Summary.GrantedScopes,
		"requiredScopes": h.config.Scopes,
		"erpLinkURL":     "/shops?shopifyInstallShop=" + url.QueryEscape(connection.Summary.ShopDomain),
		"updatedAt":      connection.Summary.UpdatedAt,
	})
}

func (h *Handler) handleEmbeddedProducts(w http.ResponseWriter, r *http.Request) {
	claims, token, ok := h.authenticateEmbeddedRequest(w, r)
	if !ok {
		return
	}
	connection, ok := h.connectEmbeddedRequest(w, r, claims.ShopDomain(), token)
	if !ok {
		return
	}
	requestID, err := embeddedRequestID()
	if err != nil {
		writeEmbeddedError(w, http.StatusServiceUnavailable, "EMBEDDED_REQUEST_UNAVAILABLE", "商品读取暂时不可用。", false)
		return
	}
	request := shopifyconnector.ProductCatalogPageRequest{
		Identity: connection.Identity,
		Context:  shopifyconnector.RequestContext{CorrelationID: requestID, RequestID: requestID},
		Limit:    10,
	}
	page, err := h.product.FetchProductCatalogPage(r.Context(), request)
	if err != nil || page.State != shopifyconnector.ProductCatalogStateConnected {
		writeEmbeddedError(w, http.StatusBadGateway, "SHOPIFY_PRODUCTS_UNAVAILABLE", "暂时无法读取 Shopify 商品，请稍后重试。", true)
		return
	}
	products := make([]embeddedProduct, 0, len(page.Products))
	for _, product := range page.Products {
		products = append(products, embeddedProduct{
			Title: product.Title, Status: product.Status, VariantCount: len(product.Variants),
		})
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{
		"products": products, "hasNextPage": page.PageInfo.HasNextPage, "fetchedAt": page.FetchedAt,
	})
}

func (h *Handler) handleEmbeddedOrders(w http.ResponseWriter, r *http.Request) {
	claims, token, ok := h.authenticateEmbeddedRequest(w, r)
	if !ok {
		return
	}
	connection, ok := h.connectEmbeddedRequest(w, r, claims.ShopDomain(), token)
	if !ok {
		return
	}
	requestID, err := embeddedRequestID()
	if err != nil {
		writeEmbeddedError(w, http.StatusServiceUnavailable, "EMBEDDED_REQUEST_UNAVAILABLE", "订单读取暂时不可用。", false)
		return
	}
	request := shopifyconnector.OrderCatalogPageRequest{
		Identity: connection.Identity,
		Context:  shopifyconnector.RequestContext{CorrelationID: requestID, RequestID: requestID},
		Limit:    10,
	}
	page, err := h.order.FetchOrderCatalogPage(r.Context(), request)
	if err != nil || page.State != shopifyconnector.OrderCatalogStateConnected {
		writeEmbeddedError(w, http.StatusBadGateway, "SHOPIFY_ORDERS_UNAVAILABLE", "暂时无法读取 Shopify 订单，请稍后重试。", true)
		return
	}
	orders := make([]embeddedOrder, 0, len(page.Orders))
	for _, order := range page.Orders {
		recipientName := strings.TrimSpace(order.Customer.DisplayName)
		if recipientName == "" {
			recipientName = strings.TrimSpace(order.ShippingAddress.Name)
		}
		recipientEmail := strings.TrimSpace(order.Customer.Email)
		if recipientEmail == "" {
			recipientEmail = strings.TrimSpace(order.Email)
		}
		recipientPhone := strings.TrimSpace(order.ShippingAddress.Phone)
		if recipientPhone == "" {
			recipientPhone = strings.TrimSpace(order.Customer.Phone)
		}
		orders = append(orders, embeddedOrder{
			Name: order.Name, CreatedAt: order.CreatedAt,
			FinancialStatus: order.DisplayFinancialStatus, FulfillmentStatus: order.DisplayFulfillmentStatus,
			Total: order.Total.Amount, CurrencyCode: order.Total.CurrencyCode,
			RecipientName: recipientName, RecipientEmail: recipientEmail, RecipientPhone: recipientPhone,
			ShippingAddress: compactEmbeddedAddress(order.ShippingAddress.Formatted),
		})
	}
	if err := h.repository.AppendProtectedDataAccess(r.Context(), ProtectedDataAccessEvent{
		ID: requestID, Identity: connection.Identity, ActorID: embeddedActorID(claims.Subject),
		Surface: "embeddedOrderPreview", FieldSet: "name,address,phone,email",
		RecordCount: len(orders), OccurredAt: h.now().UTC(),
	}); err != nil {
		writeEmbeddedError(w, http.StatusServiceUnavailable, "PROTECTED_DATA_AUDIT_UNAVAILABLE", "Protected-data access logging is temporarily unavailable.", true)
		return
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{
		"orders": orders, "hasNextPage": page.PageInfo.HasNextPage, "fetchedAt": page.FetchedAt,
	})
}

func compactEmbeddedAddress(lines []string) []string {
	address := make([]string, 0, len(lines))
	for _, line := range lines {
		if value := strings.TrimSpace(line); value != "" {
			address = append(address, value)
		}
	}
	return address
}

func (h *Handler) authenticateEmbeddedRequest(w http.ResponseWriter, r *http.Request) (embeddedSessionClaims, string, bool) {
	w.Header().Set("Cache-Control", "no-store")
	token := embeddedBearerToken(r.Header.Get("Authorization"))
	claims, err := verifyEmbeddedSessionToken(token, h.config.AppAPIKey, h.config.AppSecret, h.now().UTC())
	if err != nil {
		writeEmbeddedError(w, http.StatusUnauthorized, "INVALID_SHOPIFY_SESSION", "Shopify 会话已失效，请刷新页面。", false)
		return embeddedSessionClaims{}, "", false
	}
	return claims, token, true
}

func (h *Handler) connectEmbeddedRequest(w http.ResponseWriter, r *http.Request, domain string, token string) (EmbeddedSessionConnection, bool) {
	connection, err := h.embedded.ConnectEmbeddedSession(r.Context(), domain, token)
	if errors.Is(err, ErrEmbeddedERPLinkRequired) {
		if connection.Pending == nil || connection.Pending.ShopDomain != domain {
			writeEmbeddedError(w, http.StatusServiceUnavailable, "SHOPIFY_SESSION_UNAVAILABLE", "Shopify authorization is temporarily unavailable.", true)
			return EmbeddedSessionConnection{}, false
		}
		writeRuntimeJSON(w, http.StatusConflict, map[string]any{
			"code": "INSTALLATION_LINK_REQUIRED", "state": "AUTHORIZED_UNLINKED",
			"error":   "Shopify authorization is complete. A native ERP administrator must confirm ownership; business data and storefront configuration remain locked until linking completes.",
			"pending": connection.Pending, "retryable": true,
		})
		return EmbeddedSessionConnection{}, false
	}
	if err != nil {
		writeEmbeddedError(w, http.StatusServiceUnavailable, "SHOPIFY_SESSION_UNAVAILABLE", "暂时无法连接 Shopify，请稍后重试。", true)
		return EmbeddedSessionConnection{}, false
	}
	return connection, true
}

func embeddedRequestID() (string, error) {
	value, err := randomOpaqueValue(18)
	if err != nil {
		return "", err
	}
	return "embedded-" + value, nil
}

func embeddedBearerToken(header string) string {
	parts := strings.Fields(strings.TrimSpace(header))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func verifyEmbeddedSessionToken(raw string, apiKey string, secret string, now time.Time) (embeddedSessionClaims, error) {
	parts := strings.Split(strings.TrimSpace(raw), ".")
	if len(parts) != 3 || strings.TrimSpace(apiKey) == "" || strings.TrimSpace(secret) == "" {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	headerJSON, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	var header struct {
		Algorithm string `json:"alg"`
	}
	if json.Unmarshal(headerJSON, &header) != nil || header.Algorithm != "HS256" {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	payloadJSON, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	var claims embeddedSessionClaims
	if json.Unmarshal(payloadJSON, &claims) != nil {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	const skew = 5 * time.Second
	domain := claims.ShopDomain()
	if strings.TrimSpace(claims.Audience) != strings.TrimSpace(apiKey) || domain == "" || embeddedActorID(claims.Subject) == "" ||
		claims.ExpiresAt == 0 || now.After(time.Unix(claims.ExpiresAt, 0).Add(skew)) ||
		(claims.NotBefore != 0 && now.Add(skew).Before(time.Unix(claims.NotBefore, 0))) ||
		(claims.IssuedAt != 0 && now.Add(skew).Before(time.Unix(claims.IssuedAt, 0))) ||
		embeddedDomainFromAdminURL(claims.Issuer) != domain {
		return embeddedSessionClaims{}, errors.New("invalid Shopify session token")
	}
	return claims, nil
}

func embeddedActorID(value string) string {
	value = strings.TrimSpace(value)
	const gidPrefix = "gid://shopify/User/"
	if strings.HasPrefix(value, gidPrefix) {
		value = strings.TrimPrefix(value, gidPrefix)
	}
	if value == "" || len(value) > 20 {
		return ""
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return ""
		}
	}
	return "shopify-user:" + value
}

func (c embeddedSessionClaims) ShopDomain() string {
	return embeddedDomainFromDestinationURL(c.Dest)
}

func embeddedDomainFromDestinationURL(value string) string {
	return embeddedDomainFromShopifyURL(value, false)
}

func embeddedDomainFromAdminURL(value string) string {
	return embeddedDomainFromShopifyURL(value, true)
}

func embeddedDomainFromShopifyURL(value string, requireAdminPath bool) string {
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
	domain, ok := shopifyconnector.NormalizeShopDomain(parsed.Hostname())
	if !ok {
		return ""
	}
	return domain
}

func writeEmbeddedError(w http.ResponseWriter, status int, code string, message string, retryable bool) {
	writeRuntimeJSON(w, status, map[string]any{
		"code": code, "error": message, "retryable": retryable,
	})
}

func renderEmbeddedApp(w http.ResponseWriter, apiKey string, shopDomain string) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Content-Security-Policy", "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors "+embeddedFrameAncestors(shopDomain)+"; form-action 'self'; img-src 'self' data:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' https://cdn.shopify.com; connect-src 'self'")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Del("X-Frame-Options")
	page := strings.ReplaceAll(embeddedAppHTML, "__SHOPIFY_API_KEY__", html.EscapeString(strings.TrimSpace(apiKey)))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(page))
}

const embeddedAppHTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="shopify-api-key" content="__SHOPIFY_API_KEY__">
  <title>Xinzhi ERP · Shopify connection</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    :root{color-scheme:light;--ink:#172033;--muted:#667085;--subtle:#8993a4;--line:#dfe4ec;--surface:#fff;--page:#f5f7fa;--brand:#2447b8;--brand-hover:#1d3b9d;--brand-soft:#eef2ff;--success:#087443;--success-soft:#eaf8f1;--warning:#985f0d;--warning-soft:#fff7df;--danger:#b42318;--danger-soft:#fff1f0;--shadow:0 1px 2px rgba(16,24,40,.04)}
    *{box-sizing:border-box}body{margin:0;background:var(--page);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif;-webkit-font-smoothing:antialiased}button,a{font:inherit}button,.button{display:inline-flex;min-height:42px;align-items:center;justify-content:center;gap:7px;border:1px solid transparent;border-radius:8px;background:var(--brand);color:#fff;font-weight:650;padding:9px 15px;cursor:pointer;text-decoration:none;transition:background .15s ease,border-color .15s ease,box-shadow .15s ease}.button:hover,button:hover{background:var(--brand-hover)}.button.secondary,button.secondary{background:#fff;color:var(--ink);border-color:#b8c0cc}.button.secondary:hover,button.secondary:hover{background:#f8fafc;border-color:#8d98a8}button:disabled{cursor:wait;opacity:.62}button:focus-visible,.button:focus-visible,a:focus-visible{outline:3px solid #9dc1ff;outline-offset:2px}[hidden]{display:none!important}
    .shell{max-width:1160px;margin:0 auto;padding:24px}.app-bar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:16px}.brand-lockup{display:flex;align-items:center;gap:12px;min-width:0}.app-mark{display:grid;width:42px;height:42px;flex:0 0 42px;place-items:center;border-radius:10px;background:var(--brand);color:#fff;box-shadow:var(--shadow)}.brand-lockup h1{margin:0;font-size:20px;line-height:1.3;letter-spacing:-.01em}.eyebrow{margin:0 0 3px;color:var(--brand);font-size:11px;font-weight:750;letter-spacing:.06em}.language{min-width:74px;background:#fff;color:var(--ink);border-color:#b8c0cc}.language:hover{background:#f8fafc}
    .panel{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow)}.connection-panel{padding:22px}.connection-top{display:flex;align-items:flex-start;justify-content:space-between;gap:24px}.connection-copy{display:flex;gap:14px;min-width:0}.state-icon{display:grid;width:38px;height:38px;flex:0 0 38px;place-items:center;border-radius:50%;background:#eef1f5;color:var(--subtle);font-size:19px;font-weight:800}.state-icon.ready{background:var(--success-soft);color:var(--success)}.state-icon.warning{background:var(--warning-soft);color:var(--warning)}.state-icon.error{background:var(--danger-soft);color:var(--danger)}.connection-copy h2{margin:0;font-size:18px;line-height:1.35}.connection-copy .hint{margin:5px 0 0;max-width:680px}.connection-actions{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:9px}.status{display:inline-flex;align-items:center;gap:7px;min-height:34px;border-radius:999px;background:#eef1f5;color:#465266;padding:7px 11px;font-size:13px;font-weight:700;white-space:nowrap}.status:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}.status.ready{background:var(--success-soft);color:var(--success)}.status.warning{background:var(--warning-soft);color:var(--warning)}.status.error{background:var(--danger-soft);color:var(--danger)}
    .hint{color:var(--muted)}.connection-grid{display:grid;grid-template-columns:1.4fr .8fr .8fr 1fr;gap:10px;margin:20px 0 0}.connection-item{min-width:0;margin:0;padding:13px 14px;border:1px solid #e5e9ef;border-radius:9px;background:#fafbfc}.connection-item dt{color:var(--muted);font-size:12px}.connection-item dd{margin:4px 0 0;font-weight:700;overflow-wrap:anywhere}.scope-warning{display:flex;gap:9px;margin-top:12px;padding:11px 13px;border:1px solid #f4d69a;border-radius:9px;background:var(--warning-soft);color:var(--warning)}.scope-warning p{margin:0;font-size:13px;overflow-wrap:anywhere}
    .notice{display:none;margin-bottom:16px;padding:17px 18px;border:1px solid #f0b7b2;border-radius:11px;background:#fff;box-shadow:var(--shadow)}.notice.visible{display:flex;align-items:flex-start;justify-content:space-between;gap:20px}.notice-copy{display:flex;gap:12px}.notice strong{display:block}.notice p{margin:4px 0 0;color:var(--muted)}.notice-actions{display:flex;flex-wrap:wrap;gap:8px}
    .workspace{display:grid;grid-template-columns:minmax(0,1.65fr) minmax(280px,.75fr);align-items:start;gap:16px;margin-top:16px}.validation-panel,.permissions-panel{padding:20px}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.section-head h2{margin:0;font-size:17px}.section-head .hint{margin:5px 0 0}.preview-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px}.preview-card{min-width:0;border:1px solid var(--line);border-radius:10px;padding:16px}.preview-card h3{margin:0;font-size:15px}.preview-card .hint{min-height:42px;margin:7px 0 13px;font-size:13px}.preview-card .button-row{display:flex;justify-content:flex-start}.list{margin:13px 0 0;padding:0;list-style:none}.list li{display:block;padding:11px 0;border-top:1px solid #edf0f4}.list strong,.list span{overflow-wrap:anywhere}.meta{color:var(--muted);font-size:12px}.empty{color:var(--muted);padding:13px 0}.empty.error{color:var(--danger)}
    .permissions-summary{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:16px 0 10px;padding:12px;border-radius:9px;background:var(--brand-soft)}.permissions-summary strong{font-size:20px;color:var(--brand)}.permissions-summary span{color:var(--muted);font-size:12px}.scope-list{display:grid;gap:7px;margin:0;padding:0;list-style:none}.scope-list li{display:flex;align-items:center;justify-content:space-between;gap:10px;min-width:0;padding:9px 10px;border:1px solid #e6eaf0;border-radius:8px}.scope-name{min-width:0;color:#354052;font:12px/1.35 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;overflow-wrap:anywhere}.scope-state{flex:0 0 auto;color:var(--success);font-size:12px;font-weight:700}.scope-state.missing{color:var(--warning)}
    .contact-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px;margin:12px 0 0;padding:12px;border-radius:8px;background:#f6f7f9}.contact-grid div{min-width:0}.contact-grid .wide{grid-column:1/-1}.contact-grid dt{margin:0;color:var(--muted);font-size:12px}.contact-grid dd{margin:2px 0 0;overflow-wrap:anywhere;white-space:pre-line}.legal{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin:18px 2px 0;color:var(--muted);font-size:12px}.legal p{margin:0;max-width:760px}.legal-links{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:8px 16px}.legal a{color:var(--brand)}
    .chat-setup{margin-top:16px;padding:20px}.chat-setup .section-head{flex-wrap:wrap}.chat-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:16px 0 0;padding:0;list-style:none}.chat-step{min-width:0;padding:16px;border:1px solid var(--line);border-radius:10px}.chat-step h3{margin:0 0 10px;font-size:15px}.chat-step p{overflow-wrap:anywhere}.chat-step .button{min-height:44px;width:100%;margin-top:8px;text-align:center}.chat-state{font-weight:700}.chat-setup button{min-height:44px}.chat-note{margin:14px 0 0;font-size:13px}.chat-origin{font-size:12px;color:var(--muted);overflow-wrap:anywhere}
    .connection-management{margin-top:16px;padding:20px}.management-actions{display:flex;flex-wrap:wrap;gap:10px;margin:12px 0}.connection-management button,.connection-management .button{min-height:44px;max-width:100%;text-align:center}.connection-management h2{margin:0;font-size:17px}.connection-management h3{font-size:15px;margin:0 0 8px}.management-remove{border-top:1px solid var(--line);padding-top:16px;margin-top:16px}.management-result{overflow-wrap:anywhere}.management-result.error{color:var(--danger)}
    @media(prefers-reduced-motion:reduce){button,.button{transition:none}}
    @media(max-width:900px){.connection-grid{grid-template-columns:1fr 1fr}.workspace{grid-template-columns:1fr}.permissions-panel{order:-1}.chat-steps{grid-template-columns:1fr}}
    @media(max-width:680px){.shell{padding:16px}.app-bar,.connection-top,.notice.visible,.legal{align-items:stretch;flex-direction:column}.connection-actions{justify-content:flex-start}.connection-grid,.preview-grid,.contact-grid{grid-template-columns:1fr}.contact-grid .wide{grid-column:auto}.connection-panel,.validation-panel,.permissions-panel{padding:17px}.preview-card .hint{min-height:auto}.legal-links{flex:1 1 auto}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="app-bar">
      <div class="brand-lockup">
        <span class="app-mark" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M7 5.5h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2Z" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 9h7M8.5 12h4.5M8.5 15h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span>
        <div><p class="eyebrow" data-i18n="eyebrow">SHOPIFY CONNECTOR</p><h1>Xinzhi ERP</h1></div>
      </div>
      <button id="language-toggle" class="language" type="button" aria-label="切换至中文">中文</button>
    </header>

    <section id="notice" class="notice" role="alert">
      <div class="notice-copy"><span class="state-icon error" aria-hidden="true">!</span><div><strong id="notice-title" data-i18n="connectionIncomplete">Connection incomplete</strong><p id="notice-message"></p></div></div>
      <div class="notice-actions"><button id="retry-session" class="secondary" type="button" data-i18n="retry" hidden>Retry connection</button></div>
    </section>

    <section class="panel connection-panel" aria-labelledby="connection-title">
      <div class="connection-top">
        <div class="connection-copy">
          <span id="connection-icon" class="state-icon" aria-hidden="true">…</span>
          <div><p class="eyebrow" data-i18n="connectionEyebrow">Connection overview</p><h2 id="connection-title" data-i18n="verifying">Verifying store connection…</h2><p id="connection-description" class="hint" data-i18n="summary">Connect this Shopify store to the independent Xinzhi ERP web admin. Business operations remain in Xinzhi ERP.</p></div>
        </div>
        <div class="connection-actions"><div id="status" class="status" role="status" aria-live="polite" aria-atomic="true" data-i18n="verifyingShort">Verifying</div><a id="erp-action" class="button" target="_top" rel="noreferrer" hidden data-i18n="openERP">Open Xinzhi ERP</a><button id="native-link-start" type="button" hidden data-i18n="prepareNativeLink">Link an existing ERP account</button><a id="native-link-open" class="button" target="_blank" rel="noopener noreferrer" hidden data-i18n="openNativeLink">Open ERP confirmation</a></div>
      </div>
      <p id="access-policy" class="hint" data-i18n="accessPolicy">Access requires an account provisioned and authorized by Xinzhi staff. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access.</p>
      <a id="access-contact" href="/shopify/support" target="_blank" rel="noopener noreferrer" data-i18n="accessContact">Contact staff for access</a>
      <div id="content" hidden>
        <dl class="connection-grid">
          <div class="connection-item"><dt data-i18n="shopLabel">Shopify store</dt><dd id="shop-value">—</dd></div>
          <div class="connection-item"><dt data-i18n="bindingLabel">ERP binding</dt><dd id="binding-value">—</dd></div>
          <div class="connection-item"><dt data-i18n="scopesLabel">Permission coverage</dt><dd id="scope-count">—</dd></div>
          <div class="connection-item"><dt data-i18n="updatedLabel">Credential last updated</dt><dd id="updated-value">—</dd></div>
        </dl>
        <div id="scope-warning" class="scope-warning" hidden><span aria-hidden="true">!</span><p><strong data-i18n="missingScopesTitle">Authorization update required.</strong> <span id="missing-scopes"></span></p></div>
      </div>
    </section>

    <section id="connection-management" class="panel connection-management" aria-labelledby="management-title">
      <h2 id="management-title" data-i18n="managementTitle">Connection management</h2>
      <p class="hint" data-i18n="managementHint">Recheck the saved ERP connection here. This does not change the enterprise or transfer access between business accounts.</p>
      <div class="management-actions"><button id="connection-recheck" class="secondary" type="button" data-i18n="recheckConnection">Recheck ERP connection</button><button id="permissions-check" class="secondary" type="button" data-i18n="checkPermissions">Check current Shopify permissions</button></div>
      <p id="permissions-result" class="management-result" role="status" aria-live="polite" aria-atomic="true"></p>
      <p class="hint" data-i18n="managedPermissionsHint">Required permission updates are handled by Shopify when the app version is released. Reopen Xinzhi ERP from Shopify Apps and complete any permission prompt, then recheck here. If the mismatch persists, contact support; do not uninstall just to repair a permission mismatch.</p>
      <div class="management-remove">
        <h3 data-i18n="removeTitle">Disconnect this store</h3>
        <p class="hint" data-i18n="removeHint">In Shopify Settings → Apps, select Xinzhi ERP and confirm Uninstall. This affects Shopify access for both ERP and customer service, including Xinzhi Chat. Independent business accounts are not deleted by this action. Retained data follows the privacy policy.</p>
        <a id="shopify-app-settings" class="button secondary" href="shopify://admin/settings/apps" target="_top" data-i18n="openAppSettings">Open Shopify app settings</a>
        <p class="hint" data-i18n="removeConfirmation">Opening settings does not uninstall the app. Shopify checks your permissions and asks for confirmation.</p>
      </div>
    </section>

    <section id="chat-setup" class="panel chat-setup" aria-labelledby="chat-title" hidden>
      <div class="section-head"><div><p class="eyebrow" data-i18n="chatEyebrow">INCLUDED STOREFRONT EXTENSION</p><h2 id="chat-title" data-i18n="chatTitle">Xinzhi Chat setup</h2><p class="hint" data-i18n="chatIntro">Configure the included plugin here; reply to customers in the independent customer-service workspace.</p></div><button id="chat-check" class="secondary" type="button" data-i18n="chatCheck">Check plugin setup</button></div>
      <ol class="chat-steps">
        <li class="chat-step"><h3 data-i18n="chatConfigTitle">1. Verify store configuration</h3><p id="chat-config-state" class="chat-state" role="status" aria-live="polite"></p><p id="chat-config-hint" class="hint"></p><p id="chat-origin" class="chat-origin"></p></li>
        <li class="chat-step"><h3 data-i18n="chatThemeTitle">2. Enable in the theme editor</h3><p id="chat-theme-state" class="chat-state" role="status" aria-live="polite"></p><p class="hint" data-i18n="chatThemeHint">Open App embeds, enable Support Chat (Xinzhi Chat), customize its appearance and select Save. Confirm you are editing the published theme.</p><a id="chat-theme-link" class="button secondary" target="_blank" rel="noopener noreferrer" hidden data-i18n="chatThemeOpen">Open theme editor (new tab)</a></li>
        <li class="chat-step"><h3 data-i18n="chatWorkspaceTitle">3. Sign in and test a conversation</h3><p class="hint" data-i18n="chatWorkspaceHint">Use the same ERP account via Customer service in ERP; no second password is required. An administrator must have assigned this store to the correct customer-service workspace. Then send a storefront message and reply from that workspace.</p><a id="chat-workspace-link" class="button secondary" target="_blank" rel="noopener noreferrer" hidden data-i18n="chatWorkspaceOpen">Open customer service (new tab)</a><a id="chat-storefront-link" class="button secondary" target="_blank" rel="noopener noreferrer" hidden data-i18n="chatStorefrontOpen">Open storefront to test (new tab)</a></li>
      </ol>
      <p class="hint chat-note" data-i18n="chatVerificationNote">Theme detection covers the published theme only. A detected embed does not prove the toggle was saved or that chat works. After saving, check again and verify both sides of a conversation; this page does not mark that test as passed.</p>
    </section>

    <div id="workspace" class="workspace" hidden>
      <section class="panel validation-panel" aria-labelledby="validation-title">
        <div class="section-head"><div><p class="eyebrow" data-i18n="validationEyebrow">API ACCESS VALIDATION</p><h2 id="validation-title" data-i18n="validationTitle">Read-only reviewer preview</h2><p class="hint" data-i18n="validationHint">Data is read only after you select a validation action. No business changes are made here.</p></div></div>
        <div class="preview-grid">
          <article class="preview-card" aria-labelledby="products-title"><h3 id="products-title" data-i18n="productsTitle">Product preview</h3><p class="hint" data-i18n="productsHint">Reads up to 10 products using the authorized read_products scope.</p><div class="button-row"><button id="products-refresh" class="secondary" type="button" data-i18n="readProducts">Read products</button></div><ul id="products" class="list" aria-live="polite"><li class="empty" data-i18n="notRun">Not run yet.</li></ul></article>
          <article class="preview-card" aria-labelledby="orders-title"><h3 id="orders-title" data-i18n="ordersTitle">Order fulfillment preview</h3><p class="hint" data-i18n="ordersHint">Reads up to 10 orders and displays the minimum recipient details needed for fulfillment and order support. The preview is read-only; actions are performed in the independent ERP web admin.</p><div class="button-row"><button id="orders-refresh" class="secondary" type="button" data-i18n="readOrders">Read orders</button></div><ul id="orders" class="list" aria-live="polite"><li class="empty" data-i18n="notRun">Not run yet.</li></ul></article>
        </div>
      </section>

      <aside class="panel permissions-panel" aria-labelledby="permissions-title">
        <div class="section-head"><div><p class="eyebrow" data-i18n="permissionsEyebrow">AUTHORIZED ACCESS</p><h2 id="permissions-title" data-i18n="permissionsTitle">Required permissions</h2><p class="hint" data-i18n="permissionsHint">Exact Shopify API scopes required by this ERP connection.</p></div></div>
        <div class="permissions-summary"><strong id="permission-summary">—</strong><span data-i18n="permissionCoverageLabel">permission coverage</span></div>
        <ul id="scope-list" class="scope-list" aria-label="Required Shopify API permissions"></ul>
      </aside>
    </div>

    <footer class="legal"><p data-i18n="legal">Xinzhi ERP uses protected customer data only for merchant-authorized order fulfillment and support, and stops Shopify access after uninstall.</p><nav class="legal-links" aria-label="Legal and support"><a href="/shopify/support" target="_top" data-i18n="supportLink">Support</a><a href="/shopify/privacy" target="_top" data-i18n="privacyLink">Privacy</a><a href="/shopify/terms" target="_top" data-i18n="termsLink">Terms</a></nav></footer>
  </main>

  <script>
    (function(){
      const status=document.getElementById("status"),connectionIcon=document.getElementById("connection-icon"),connectionTitle=document.getElementById("connection-title"),connectionDescription=document.getElementById("connection-description"),notice=document.getElementById("notice"),noticeTitle=document.getElementById("notice-title"),message=document.getElementById("notice-message"),retry=document.getElementById("retry-session"),content=document.getElementById("content"),workspace=document.getElementById("workspace");
      const translations={
        en:{eyebrow:"SHOPIFY CONNECTOR",summary:"Connect this Shopify store to the independent Xinzhi ERP web admin. Business operations remain in Xinzhi ERP.",connectionEyebrow:"Connection overview",verifying:"Verifying store connection…",verifyingShort:"Verifying",connectionReady:"Connection ready",connectionReadyHint:"ERP binding and saved permissions are available. Check current Shopify permissions below; API previews are verified separately.",actionRequired:"Action required",actionRequiredHint:"The store is connected, but its authorization must be updated before all ERP functions are available.",connected:"Connected",retry:"Retry connection",shopLabel:"Shopify store",bindingLabel:"ERP binding",bindingConnected:"Connected",scopesLabel:"Permission coverage",updatedLabel:"Credential last updated",missingScopesTitle:"Authorization update required.",missingScopes:"Missing permissions: ",openERP:"Open Xinzhi ERP",validationEyebrow:"API ACCESS VALIDATION",validationTitle:"Read-only reviewer preview",validationHint:"Data is read only after you select a validation action. No business changes are made here.",productsTitle:"Product preview",ordersTitle:"Order fulfillment preview",readProducts:"Read products",readOrders:"Read orders",productsHint:"Reads up to 10 products using the authorized read_products scope.",ordersHint:"Reads up to 10 orders and displays the minimum recipient details needed for fulfillment and order support. The preview is read-only; actions are performed in the independent ERP web admin.",notRun:"Not run yet.",loading:"Loading…",permissionsEyebrow:"AUTHORIZED ACCESS",permissionsTitle:"Required permissions",permissionsHint:"Exact Shopify API scopes required by this ERP connection.",permissionCoverageLabel:"permission coverage",scopeGranted:"Granted",scopeMissing:"Missing",scopesUnavailable:"No required permissions were returned.",legal:"Xinzhi ERP uses protected customer data only for merchant-authorized order fulfillment and support, and stops Shopify access after uninstall.",supportLink:"Support",privacyLink:"Privacy",termsLink:"Terms",bridgeError:"Shopify App Bridge is not ready. Refresh the page.",sessionExpired:"The Shopify session has expired. Refresh the page.",invalidResponse:"The service returned an invalid response.",requestFailed:"Request failed. Try again later.",connectionIncomplete:"Connection incomplete",shopifyUnavailable:"Unable to connect to Shopify right now.",productsUnavailable:"Unable to read Shopify products right now. Try again later.",ordersUnavailable:"Unable to read Shopify orders right now. Try again later.",productsEmpty:"No products are available to display.",ordersEmpty:"No orders are available to display.",unknownStatus:"Unknown status",variants:"variants",recipient:"Recipient",address:"Shipping address",phone:"Phone",email:"Email",notProvided:"Not provided",switchLabel:"切换至中文",switchText:"中文"},
        zh:{eyebrow:"SHOPIFY 连接器",summary:"将当前 Shopify 店铺连接到独立的 Xinzhi ERP Web 后台，业务操作仍在 Xinzhi ERP 中完成。",connectionEyebrow:"连接概览",verifying:"正在验证店铺连接…",verifyingShort:"正在验证",connectionReady:"连接已就绪",connectionReadyHint:"店铺已绑定 ERP，已保存所需权限。当前 Shopify 权限请在下方检查；API 预览需单独验证。",actionRequired:"需要处理",actionRequiredHint:"店铺已连接，但需要更新授权后才能使用全部 ERP 功能。",connected:"已连接",retry:"重新验证连接",shopLabel:"Shopify 店铺",bindingLabel:"ERP 绑定",bindingConnected:"已绑定",scopesLabel:"权限覆盖",updatedLabel:"凭据最近更新",missingScopesTitle:"需要更新授权。",missingScopes:"缺少权限：",openERP:"打开 Xinzhi ERP",validationEyebrow:"API 访问验证",validationTitle:"只读审核预览",validationHint:"只有点击验证按钮后才会读取数据，此处不会执行任何业务变更。",productsTitle:"商品预览",ordersTitle:"订单履约预览",readProducts:"读取商品",readOrders:"读取订单",productsHint:"使用已授权的 read_products 权限读取最多 10 个商品。",ordersHint:"读取最多 10 个订单，并显示履约和订单支持所需的最少收件人信息。此处为只读预览，操作在独立 ERP Web 后台完成。",notRun:"尚未执行验证。",loading:"正在读取…",permissionsEyebrow:"已授权访问",permissionsTitle:"所需权限",permissionsHint:"当前 ERP 连接所需的准确 Shopify API 权限。",permissionCoverageLabel:"权限覆盖",scopeGranted:"已授权",scopeMissing:"缺失",scopesUnavailable:"未返回所需权限。",legal:"Xinzhi ERP 仅将受保护的客户数据用于商家授权的订单履约和支持；应用卸载后停止访问 Shopify。",supportLink:"支持",privacyLink:"隐私",termsLink:"条款",bridgeError:"Shopify App Bridge 尚未就绪，请刷新页面。",sessionExpired:"Shopify 会话已失效，请刷新页面。",invalidResponse:"服务返回了无效响应。",requestFailed:"请求失败，请稍后重试。",connectionIncomplete:"连接未完成",shopifyUnavailable:"暂时无法连接 Shopify。",productsUnavailable:"暂时无法读取 Shopify 商品，请稍后重试。",ordersUnavailable:"暂时无法读取 Shopify 订单，请稍后重试。",productsEmpty:"当前店铺没有可显示的商品。",ordersEmpty:"当前店铺没有可显示的订单。",unknownStatus:"未知状态",variants:"个变体",recipient:"收件人",address:"收货地址",phone:"电话",email:"邮箱",notProvided:"未提供",switchLabel:"Switch to English",switchText:"EN"}
      };
      const localeKey="xinzhi-erp.shopify-locale";
      Object.assign(translations.en,{
        managementTitle:"Connection management",managementHint:"Recheck the saved ERP connection here. This does not change the enterprise or transfer access between business accounts.",
        recheckConnection:"Recheck ERP connection",checkPermissions:"Check current Shopify permissions",
        permissionsIdle:"Current Shopify permissions have not been checked.",permissionsLoading:"Checking current Shopify permissions…",
        permissionsReady:"Shopify currently grants the required permissions. This does not verify the Connector token or business account access.",
        permissionsMissing:"Shopify currently reports missing permissions: ",permissionsMismatch:"The released Shopify requirements differ from the Connector configuration. Contact support before continuing.",
        permissionsUnknown:"Current Shopify permissions could not be verified. Retry in Shopify Admin or contact support. Saved connection details are not live authorization evidence.",
        managedPermissionsHint:"Required permission updates are handled by Shopify when the app version is released. Reopen Xinzhi ERP from Shopify Apps and complete any permission prompt, then recheck here. If the mismatch persists, contact support; do not uninstall just to repair a permission mismatch.",
        removeTitle:"Disconnect this store",removeHint:"In Shopify Settings → Apps, select Xinzhi ERP and confirm Uninstall. This affects Shopify access for both ERP and customer service, including Xinzhi Chat. Independent business accounts are not deleted by this action. Retained data follows the privacy policy.",
        openAppSettings:"Open Shopify app settings",removeConfirmation:"Opening settings does not uninstall the app. Shopify checks your permissions and asks for confirmation."
      });
      Object.assign(translations.zh,{
        managementTitle:"连接管理",managementHint:"在此重新检查已保存的 ERP 连接，不会变更企业归属，也不会转交业务账号权限。",
        recheckConnection:"重新检查 ERP 连接",checkPermissions:"检查当前 Shopify 权限",
        permissionsIdle:"尚未检查当前 Shopify 权限。",permissionsLoading:"正在检查当前 Shopify 权限…",
        permissionsReady:"Shopify 当前已授予所需权限；这不代表 Connector 令牌或业务账号访问已通过验证。",
        permissionsMissing:"Shopify 当前报告缺少权限：",permissionsMismatch:"Shopify 已发布版本的所需权限与 Connector 配置不一致，请联系支持核对后再继续。",
        permissionsUnknown:"暂时无法核实当前 Shopify 权限。请在 Shopify 后台重试或联系支持；已保存的连接信息不作为实时授权证据。",
        managedPermissionsHint:"所需权限的更新由 Shopify 在应用版本发布后管理。请从 Shopify 应用列表重新打开 Xinzhi ERP，完成出现的权限确认，再回此处检查。若仍不一致，请联系支持，不要仅为修复权限差异而卸载应用。",
        removeTitle:"断开此店铺连接",removeHint:"在 Shopify 设置 → 应用中，选择 Xinzhi ERP 并确认卸载。这会影响 ERP 与客服对该店铺的 Shopify 访问，包括 Xinzhi Chat。本操作不删除独立业务账号，保留数据按隐私政策处理。",
        openAppSettings:"打开 Shopify 应用设置",removeConfirmation:"打开设置不会立即卸载；Shopify 会校验您的操作权限并要求确认。"
      });
      let connectionBusy=false,connectionGeneration=0,permissionGeneration=0,permissionState={key:"permissionsIdle",missing:[]};
      const recheckConnection=document.getElementById("connection-recheck"),permissionCheck=document.getElementById("permissions-check");
      function renderPermissionCheck(){
        const result=document.getElementById("permissions-result");
        result.textContent=copy[permissionState.key]+(permissionState.missing.length?permissionState.missing.join(", "):"");
        result.classList.toggle("error",["permissionsMissing","permissionsMismatch","permissionsUnknown"].includes(permissionState.key));
      }
      function strictScopeList(value){
        if(!Array.isArray(value)||value.length>200||value.some(function(scope){return typeof scope!=="string"||!/^[a-z][a-z0-9_]{0,127}$/.test(scope)}))throw new Error("invalid scope list");
        return Array.from(new Set(value)).sort();
      }
      async function checkPermissions(){
        if(permissionCheck.disabled||connectionBusy)return;
        const generation=++permissionGeneration;
        permissionCheck.disabled=true;permissionState={key:"permissionsLoading",missing:[]};renderPermissionCheck();
        try{
          const result=await withDeadline(function(){
            if(!window.shopify||!window.shopify.scopes||typeof window.shopify.scopes.query!=="function")throw new Error("scopes unavailable");
            return window.shopify.scopes.query();
          });
          if(generation!==permissionGeneration)return;
          const required=strictScopeList(result.required),granted=new Set(strictScopeList(result.granted));
          strictScopeList(result.optional);
          if(!required.length)throw new Error("requirements unavailable");
          const missing=required.filter(function(scope){return !granted.has(scope)});
          const mismatch=sessionData&&JSON.stringify(required)!==JSON.stringify(strictScopeList(sessionData.requiredScopes));
          permissionState={key:mismatch?"permissionsMismatch":missing.length?"permissionsMissing":"permissionsReady",missing:mismatch?[]:missing};
        }catch(_){if(generation===permissionGeneration)permissionState={key:"permissionsUnknown",missing:[]}}
        finally{if(generation===permissionGeneration){permissionCheck.disabled=false;renderPermissionCheck()}}
      }
      function withDeadline(operation){
        let timer;
        return Promise.race([Promise.resolve().then(operation),new Promise(function(_,reject){timer=setTimeout(function(){reject(new Error("request timeout"))},12000)})]).finally(function(){clearTimeout(timer)});
      }
      let locale=initialLocale(),copy=translations[locale],sessionData=null,lastFailure=null;
      const productState={state:"idle",data:null,message:"",messageKey:""},orderState={state:"idle",data:null,message:"",messageKey:""};

      function normalizeLocale(value){return String(value||"").toLowerCase().startsWith("zh")?"zh":"en"}
      function initialLocale(){const requested=new URLSearchParams(location.search).get("locale");if(requested)return normalizeLocale(requested);try{const stored=localStorage.getItem(localeKey);if(stored)return normalizeLocale(stored)}catch(_){}return normalizeLocale(navigator.language)}
      function formatUpdatedAt(value){const date=new Date(value);return Number.isNaN(date.getTime())?"—":date.toLocaleString(locale==="zh"?"zh-CN":"en-US",{year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
      function cleanScopes(value){return Array.isArray(value)?value.map(function(scope){return String(scope||"").trim()}).filter(Boolean):[]}
      function translatedError(key){const error=new Error(copy[key]||copy.requestFailed);error.translationKey=key;return error}
      translations.en.pendingTitle="Shopify authorized · ERP linking pending";
      translations.en.accessPolicy="Access requires an account provisioned and authorized by Xinzhi staff. Self-service registration is not available. Installing or authorizing the Shopify app does not grant system access.";
      translations.zh.accessPolicy="本系统须由新知工作人员开通账号并授权后使用，不开放自助注册。安装或授权 Shopify 应用不会获得系统使用权。";
      translations.en.accessContact="Contact staff for access";
      translations.zh.accessContact="联系工作人员开通";
      translations.en.pendingMessage="Shopify authorization is complete; no ERP store has been created or claimed. A native ERP business administrator must confirm ownership using an existing account. Orders, customers and storefront configuration remain locked until linking completes.";
      translations.zh.pendingTitle="Shopify 已授权 · 待关联 ERP";
      translations.zh.pendingMessage="Shopify 授权已完成；未创建或认领 ERP 店铺。请由目标企业的原生 ERP 管理员使用已有账号确认归属。确认完成前，订单、客户和插件配置保持锁定。";
      translations.en.prepareNativeLink="Link an existing ERP account";
      translations.zh.prepareNativeLink="关联已有 ERP 账号";
      translations.en.openNativeLink="Open ERP confirmation";
      translations.zh.openNativeLink="打开 ERP 确认页";
      translations.en.nativeLinkReady="The secure link is ready. Open ERP confirmation in a new tab, sign in and confirm ownership. Then return here and retry the connection.";
      translations.zh.nativeLinkReady="关联入口已准备好。请在新标签页打开 ERP 确认页，登录并确认归属；完成后回到这里刷新连接。";
      translations.en.nativeLinkError="Unable to prepare a secure link. Refresh the connection status and try again.";
      translations.zh.nativeLinkError="暂时无法准备安全关联入口，请刷新连接状态后重试。";
      const nativeLinkStart=document.getElementById("native-link-start"),nativeLinkOpen=document.getElementById("native-link-open");
      let nativeLinkGeneration=0,nativeLinkTimer;
      function clearNativeLink(){nativeLinkGeneration++;clearTimeout(nativeLinkTimer);nativeLinkOpen.hidden=true;nativeLinkOpen.removeAttribute("href");nativeLinkStart.hidden=true;nativeLinkStart.disabled=false}
      async function prepareNativeLink(){
        const generation=nativeLinkGeneration,expectedDomain=lastFailure&&lastFailure.payload&&lastFailure.payload.pending&&lastFailure.payload.pending.shopDomain;
        nativeLinkStart.disabled=true;
        try{
          const grant=await request("/shopify/session/link-grant"),expiry=Date.parse(grant.pending&&grant.pending.expiresAt);
          if(generation!==nativeLinkGeneration)return;
          if(grant.contractVersion!=="shopify.connector.native_link.v1"||typeof grant.proof!=="string"||!/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(grant.proof)||!expectedDomain||grant.pending.shopDomain!==expectedDomain||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+905000)throw translatedError("nativeLinkError");
          nativeLinkOpen.href="/shopify/link#proof="+grant.proof;nativeLinkOpen.hidden=false;nativeLinkStart.hidden=true;message.textContent=copy.nativeLinkReady;
          nativeLinkTimer=setTimeout(function(){clearNativeLink();if(lastFailure)renderFailure(lastFailure)},expiry-Date.now());
        }catch(_){if(generation===nativeLinkGeneration)message.textContent=copy.nativeLinkError}
        finally{if(generation===nativeLinkGeneration)nativeLinkStart.disabled=false}
      }
      function errorKeyForCode(code){return {INSTALLATION_LINK_REQUIRED:"pendingMessage",INVALID_SHOPIFY_SESSION:"sessionExpired",SHOPIFY_SESSION_UNAVAILABLE:"shopifyUnavailable",SHOPIFY_PRODUCTS_UNAVAILABLE:"productsUnavailable",SHOPIFY_ORDERS_UNAVAILABLE:"ordersUnavailable"}[code]||"requestFailed"}
      function safeLocalPath(value){const raw=String(value||"").trim();if(!raw)throw translatedError("invalidResponse");const target=new URL(raw,location.origin);if(target.origin!==location.origin)throw translatedError("invalidResponse");return target.pathname+target.search}
      function setConnectionState(kind,title,description,badge){connectionIcon.className="state-icon "+kind;connectionIcon.textContent=kind==="ready"?"✓":kind==="warning"?"!":"×";connectionTitle.textContent=title;connectionDescription.textContent=description;status.className="status "+kind;status.textContent=badge}

      Object.assign(translations.en,{
        chatEyebrow:"INCLUDED STOREFRONT EXTENSION",chatTitle:"Xinzhi Chat setup",chatIntro:"Configure the included plugin here; reply to customers in the independent customer-service workspace.",chatCheck:"Check plugin setup",chatConfigTitle:"1. Verify store configuration",chatThemeTitle:"2. Enable in the theme editor",chatWorkspaceTitle:"3. Sign in and test a conversation",chatThemeHint:"Open App embeds, enable Support Chat (Xinzhi Chat), customize its appearance and select Save. Confirm you are editing the published theme.",chatThemeOpen:"Open theme editor (new tab)",chatWorkspaceHint:"Use the same ERP account via Customer service in ERP; no second password is required. An administrator must have assigned this store to the correct customer-service workspace. Then send a storefront message and reply from that workspace.",chatWorkspaceOpen:"Open customer service (new tab)",chatStorefrontOpen:"Open storefront to test (new tab)",chatVerificationNote:"Theme detection covers the published theme only. A detected embed does not prove the toggle was saved or that chat works. After saving, check again and verify both sides of a conversation; this page does not mark that test as passed.",chatIdle:"Not checked",chatChecking:"Checking…",chatConfigured:"App configuration matches",chatConfiguredHint:"Shopify app data matches this store's bound enterprise and configured service address. Customer-service account access and messaging are not checked.",chatMismatch:"Configuration needs attention",chatMismatchHint:"The app data is missing or does not match this store's configured enterprise/address. Contact support to verify the configuration. No values were changed.",chatUnavailable:"Unable to verify configuration",chatUnavailableHint:"Check the store connection and try again. Setup links stay locked until the configuration is verified.",chatIdleHint:"Select Check plugin setup to read this app's configuration. No theme settings will be changed.",chatPresent:"Embed detected · verify toggle and Save",chatAvailable:"Embed available · activation pending",chatThemeUnavailable:"Embed reported unavailable",chatThemeUnknown:"Theme status unknown · verify manually",chatThemeMissing:"Embed not reported · verify app release",chatChecked:"Checked: "
      });
      Object.assign(translations.zh,{
        chatEyebrow:"应用内含的店面插件",chatTitle:"Xinzhi Chat 插件设置",chatIntro:"在此完成插件配置引导；接待与回复在独立客服工作台中进行。",chatCheck:"检查插件配置",chatConfigTitle:"1. 核对店铺配置",chatThemeTitle:"2. 在主题编辑器中启用",chatWorkspaceTitle:"3. 登录客服并验证会话",chatThemeHint:"打开「应用嵌入」，启用 Support Chat（Xinzhi Chat），设置外观后点击「保存」。请确认操作的是已发布主题。",chatThemeOpen:"打开主题编辑器（新标签页）",chatWorkspaceHint:"从 ERP 的「客服工作台」使用同一账号进入，无需第二套密码；业务会话独立。管理员需要先把该店铺分配到正确的客服工作区，再从店面发送消息并在客服工作台回复。",chatWorkspaceOpen:"打开客服工作台（新标签页）",chatStorefrontOpen:"打开店面测试（新标签页）",chatVerificationNote:"主题检测仅覆盖已发布主题。检测到插件不代表开关已保存或聊天可用。保存后请重新检查，并验证双向会话；此页不会把会话测试标为已通过。",chatIdle:"尚未检查",chatChecking:"正在检查…",chatConfigured:"应用配置匹配",chatConfiguredHint:"Shopify 应用数据与该店铺绑定企业及配置的客服地址匹配；尚未验证客服账号权限或消息收发。",chatMismatch:"配置需要处理",chatMismatchHint:"应用数据缺失，或与该店铺配置的企业／地址不一致。请联系支持核对配置；本次检查未修改任何值。",chatUnavailable:"暂时无法验证配置",chatUnavailableHint:"请检查店铺连接后重试。配置验证成功前，启用及客服入口保持锁定。",chatIdleHint:"点击「检查插件配置」读取本应用配置，不会修改主题设置。",chatPresent:"已检测到插件 · 请核对开关并保存",chatAvailable:"插件可用 · 待启用",chatThemeUnavailable:"Shopify 报告插件不可用",chatThemeUnknown:"主题状态未知 · 请手动核对",chatThemeMissing:"未报告此插件 · 请核对应用版本",chatChecked:"检查时间："
      });
      const chatPanel=document.getElementById("chat-setup"),chatCheck=document.getElementById("chat-check");
      const chatLinks=["chat-theme-link","chat-workspace-link","chat-storefront-link"].map(function(id){return document.getElementById(id)});
      let chatGeneration=0,chatState={config:"IDLE",theme:"IDLE",origin:"",checkedAt:""};
      function clearChatSetup(){chatGeneration++;chatState={config:"IDLE",theme:"IDLE",origin:"",checkedAt:""};chatPanel.hidden=true;chatCheck.disabled=false;renderChatSetup()}
      function chatOrigin(value){if(typeof value!=="string"||/[\\\s?#]/.test(value))throw translatedError("invalidResponse");const url=new URL(value);if(url.protocol!=="https:"||!url.hostname||url.username||url.password||url.pathname!=="/"||url.search||url.hash)throw translatedError("invalidResponse");return url.origin}
      function chatThemeStatus(extensions){
        if(!Array.isArray(extensions))return "UNKNOWN";
        const blocks=extensions.filter(function(ext){return ext&&ext.type==="theme_app_extension"&&Array.isArray(ext.activations)}).flatMap(function(ext){return ext.activations}).filter(function(block){return block&&block.handle==="xinzhi-chat"&&block.target==="body"});
        if(!blocks.length)return "MISSING";
        if(blocks.length!==1)return "UNKNOWN";
        return {active:"PRESENT",available:"AVAILABLE",unavailable:"UNAVAILABLE"}[blocks[0].status]||"UNKNOWN";
      }
      function renderChatSetup(){
        const configKey={IDLE:"chatIdle",LOADING:"chatChecking",CONFIGURED:"chatConfigured",MISMATCH:"chatMismatch",UNAVAILABLE:"chatUnavailable"}[chatState.config]||"chatUnavailable";
        document.getElementById("chat-config-state").textContent=copy[configKey];
        document.getElementById("chat-config-hint").textContent=copy[{CONFIGURED:"chatConfiguredHint",MISMATCH:"chatMismatchHint",UNAVAILABLE:"chatUnavailableHint"}[chatState.config]||"chatIdleHint"];
        document.getElementById("chat-theme-state").textContent=copy[{IDLE:"chatIdle",LOADING:"chatChecking",PRESENT:"chatPresent",AVAILABLE:"chatAvailable",UNAVAILABLE:"chatThemeUnavailable",MISSING:"chatThemeMissing"}[chatState.theme]||"chatThemeUnknown"];
        document.getElementById("chat-origin").textContent=[chatState.origin,chatState.checkedAt?copy.chatChecked+formatUpdatedAt(chatState.checkedAt):""].filter(Boolean).join(" · ");
        chatCheck.disabled=chatState.config==="LOADING";
        chatCheck.textContent=chatCheck.disabled?copy.chatChecking:copy.chatCheck;
        chatLinks.forEach(function(link){link.hidden=true;link.removeAttribute("href")});
        if(chatState.config!=="CONFIGURED"||!sessionData)return;
        const domain=String(sessionData.shopDomain||""),key=document.querySelector('meta[name="shopify-api-key"]').content;
        if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)||!key)return;
        const editor=new URL("https://"+domain+"/admin/themes/current/editor");editor.searchParams.set("context","apps");editor.searchParams.set("activateAppId",key+"/xinzhi-chat");
        chatLinks[0].href=editor.href;chatLinks[1].href=chatState.origin+"/";chatLinks[2].href="https://"+domain+"/";
        chatLinks.forEach(function(link){link.hidden=false});
      }
      function chatTimeout(task){return new Promise(function(resolve,reject){const timer=setTimeout(function(){reject(new Error("timeout"))},12000);Promise.resolve().then(task).then(function(value){clearTimeout(timer);resolve(value)},function(error){clearTimeout(timer);reject(error)})})}
      async function checkChatSetup(){
        if(!sessionData||chatCheck.disabled)return;
        const generation=++chatGeneration,domain=sessionData.shopDomain;
        chatState={config:"LOADING",theme:"LOADING",origin:"",checkedAt:""};renderChatSetup();
        const configTask=chatTimeout(function(){return request("/shopify/session/chat-setup")}).then(function(data){
          if(generation!==chatGeneration)return;
          if(data.contractVersion!=="shopify.connector.chat_setup.v1"||data.shopDomain!==domain||!["CONFIGURED","MISMATCH","UNAVAILABLE"].includes(data.state))throw translatedError("invalidResponse");
          const origin=data.state==="CONFIGURED"?chatOrigin(data.serviceOrigin):"";
          if(data.state!=="UNAVAILABLE"&&(!data.checkedAt||!Number.isFinite(Date.parse(data.checkedAt))))throw translatedError("invalidResponse");
          chatState.config=data.state;chatState.origin=origin;chatState.checkedAt=data.checkedAt||"";
        }).catch(function(){if(generation===chatGeneration){chatState.config="UNAVAILABLE";chatState.origin="";chatState.checkedAt=""}});
        const themeTask=chatTimeout(function(){if(!window.shopify||!window.shopify.app||typeof window.shopify.app.extensions!=="function")throw new Error("unavailable");return window.shopify.app.extensions()}).then(function(data){if(generation===chatGeneration)chatState.theme=chatThemeStatus(data)}).catch(function(){if(generation===chatGeneration)chatState.theme="UNKNOWN"});
        await Promise.all([configTask,themeTask]);
        if(generation===chatGeneration)renderChatSetup();
      }

      function renderScopes(required,granted){
        const list=document.getElementById("scope-list");
        list.replaceChildren();
        if(!required.length){const item=document.createElement("li");item.className="empty";item.textContent=copy.scopesUnavailable;list.append(item);return}
        required.forEach(function(scope){const item=document.createElement("li"),name=document.createElement("span"),state=document.createElement("span"),isGranted=granted.has(scope);name.className="scope-name";name.textContent=scope;state.className="scope-state"+(isGranted?"":" missing");state.textContent=isGranted?copy.scopeGranted:copy.scopeMissing;item.append(name,state);list.append(item)})
      }

      function renderConnection(){
        if(!sessionData)return;
        const required=cleanScopes(sessionData.requiredScopes),granted=new Set(cleanScopes(sessionData.grantedScopes)),missing=required.filter(function(scope){return !granted.has(scope)}),complete=required.length>0&&missing.length===0,covered=required.length-missing.length,action=document.getElementById("erp-action"),warning=document.getElementById("scope-warning"),domain=String(sessionData.shopDomain||"").trim(),shopName=String(sessionData.shopName||"").trim();
        document.getElementById("shop-value").textContent=shopName?shopName+" · "+domain:domain;
        document.getElementById("binding-value").textContent=copy.bindingConnected;
        document.getElementById("scope-count").textContent=covered+" / "+required.length;
        document.getElementById("permission-summary").textContent=covered+" / "+required.length;
        document.getElementById("updated-value").textContent=formatUpdatedAt(sessionData.updatedAt);
        document.getElementById("missing-scopes").textContent=complete?"":copy.missingScopes+missing.join(", ");
        warning.hidden=complete;
        renderScopes(required,granted);
        action.href=safeLocalPath(sessionData.erpLinkURL);
        action.textContent=copy.openERP;
        action.hidden=false;
        setConnectionState(complete?"ready":"warning",complete?copy.connectionReady:copy.actionRequired,complete?copy.connectionReadyHint:copy.actionRequiredHint,complete?copy.connected:copy.actionRequired);
        content.hidden=false;
        workspace.hidden=false;
        chatPanel.hidden=false;renderChatSetup();
      }

      function applyLocale(next){
        locale=next;copy=translations[locale];document.documentElement.lang=locale==="zh"?"zh-CN":"en";
        document.querySelectorAll("[data-i18n]").forEach(function(node){const value=copy[node.dataset.i18n];if(value)node.textContent=value});
        const toggle=document.getElementById("language-toggle");toggle.textContent=copy.switchText;toggle.setAttribute("aria-label",copy.switchLabel);
        document.getElementById("scope-list").setAttribute("aria-label",copy.permissionsTitle);
        if(sessionData)renderConnection();else if(lastFailure){renderFailure(lastFailure)}else{connectionTitle.textContent=copy.verifying;connectionDescription.textContent=copy.summary;status.textContent=copy.verifyingShort}
        renderProducts();renderOrders();renderChatSetup();renderPermissionCheck();
        try{localStorage.setItem(localeKey,locale)}catch(_){}
      }

      async function request(path){
        const controller=new AbortController();
        try{return await withDeadline(async function(){
          if(!window.shopify||typeof window.shopify.idToken!=="function")throw translatedError("bridgeError");
          const token=await window.shopify.idToken();
          if(controller.signal.aborted)throw translatedError("requestFailed");
          const response=await fetch(path,{method:"POST",headers:{Authorization:"Bearer "+token,Accept:"application/json"},signal:controller.signal});
          const payload=await response.json().catch(function(){throw translatedError("invalidResponse")});
          if(!response.ok){const error=translatedError(errorKeyForCode(payload.code));error.payload=payload;throw error}
          return payload;
        })}catch(error){if(error&&error.translationKey)throw error;throw translatedError("requestFailed")}
        finally{controller.abort()}
      }

      function renderFailure(error){
        const payload=error&&error.payload||{};
        const text=error&&error.translationKey&&copy[error.translationKey]||error&&error.message||copy.shopifyUnavailable,isLinkRequired=payload.code==="INSTALLATION_LINK_REQUIRED";
        const title=isLinkRequired?copy.pendingTitle:copy.connectionIncomplete;
        setConnectionState("error",title,text,title);
        noticeTitle.textContent=title;notice.classList.add("visible");message.textContent=text;content.hidden=true;workspace.hidden=true;retry.hidden=false;
        document.getElementById("erp-action").hidden=true;
        clearChatSetup();
        nativeLinkStart.hidden=!isLinkRequired||!nativeLinkOpen.hidden;
        if(isLinkRequired&&!nativeLinkOpen.hidden)message.textContent=copy.nativeLinkReady;
      }

      function showFailure(error){lastFailure=error;renderFailure(error)}

      async function connect(){
        if(connectionBusy)return;
        connectionBusy=true;connectionGeneration++;permissionGeneration++;
        recheckConnection.disabled=true;permissionCheck.disabled=true;permissionState={key:"permissionsIdle",missing:[]};renderPermissionCheck();
        Object.assign(productState,{state:"idle",data:null,message:"",messageKey:""});Object.assign(orderState,{state:"idle",data:null,message:"",messageKey:""});
        document.getElementById("products-refresh").disabled=false;document.getElementById("orders-refresh").disabled=false;
        renderProducts();renderOrders();
        clearChatSetup();sessionData=null;content.hidden=true;workspace.hidden=true;
        clearNativeLink();document.getElementById("erp-action").hidden=true;
        lastFailure=null;retry.disabled=true;notice.classList.remove("visible");retry.hidden=true;connectionIcon.className="state-icon";connectionIcon.textContent="…";connectionTitle.textContent=copy.verifying;connectionDescription.textContent=copy.summary;status.className="status";status.textContent=copy.verifyingShort;
        try{sessionData=await request("/shopify/session/exchange");renderConnection()}catch(error){sessionData=null;showFailure(error)}finally{connectionBusy=false;retry.disabled=false;recheckConnection.disabled=false;permissionCheck.disabled=false}
      }

      function row(primary,secondary){const item=document.createElement("li"),left=document.createElement("span"),strong=document.createElement("strong"),meta=document.createElement("span");strong.textContent=primary;meta.className="meta";meta.textContent=secondary;left.append(strong,document.createElement("br"),meta);item.append(left);return item}
      function orderDetail(label,value,wide){const wrapper=document.createElement("div"),term=document.createElement("dt"),detail=document.createElement("dd");if(wide)wrapper.className="wide";term.textContent=label;detail.textContent=value||copy.notProvided;wrapper.append(term,detail);return wrapper}
      function orderRow(order){const item=row(order.name,(order.total||"0")+" "+(order.currencyCode||"")+" / "+(order.financialStatus||copy.unknownStatus)),details=document.createElement("dl"),address=Array.isArray(order.shippingAddress)?order.shippingAddress.join("\n"):"";details.className="contact-grid";details.append(orderDetail(copy.recipient,order.recipientName),orderDetail(copy.phone,order.recipientPhone),orderDetail(copy.address,address,true),orderDetail(copy.email,order.recipientEmail,true));item.append(details);return item}
      function empty(list,text,isError){list.replaceChildren();const item=document.createElement("li");item.className="empty"+(isError?" error":"");item.textContent=text;list.append(item)}

      function renderProducts(){const list=document.getElementById("products");if(productState.state==="idle")return empty(list,copy.notRun,false);if(productState.state==="loading")return empty(list,copy.loading,false);if(productState.state==="error")return empty(list,productState.messageKey&&copy[productState.messageKey]||productState.message||copy.requestFailed,true);const products=productState.data&&Array.isArray(productState.data.products)?productState.data.products:[];list.replaceChildren();if(!products.length)return empty(list,copy.productsEmpty,false);products.forEach(function(product){list.append(row(product.title,(product.status||copy.unknownStatus)+" · "+product.variantCount+" "+copy.variants))})}
      function renderOrders(){const list=document.getElementById("orders");if(orderState.state==="idle")return empty(list,copy.notRun,false);if(orderState.state==="loading")return empty(list,copy.loading,false);if(orderState.state==="error")return empty(list,orderState.messageKey&&copy[orderState.messageKey]||orderState.message||copy.requestFailed,true);const orders=orderState.data&&Array.isArray(orderState.data.orders)?orderState.data.orders:[];list.replaceChildren();if(!orders.length)return empty(list,copy.ordersEmpty,false);orders.forEach(function(order){list.append(orderRow(order))})}
      async function loadProducts(){if(connectionBusy||!sessionData)return;const generation=connectionGeneration;const button=document.getElementById("products-refresh");button.disabled=true;productState.state="loading";renderProducts();try{const data=await request("/shopify/session/products");if(generation!==connectionGeneration)return;productState.data=data;productState.state="ready";productState.message="";productState.messageKey=""}catch(error){if(generation!==connectionGeneration)return;productState.data=null;productState.state="error";productState.message=error&&error.message||copy.requestFailed;productState.messageKey=error&&error.translationKey||""}finally{if(generation!==connectionGeneration)return;button.disabled=false;renderProducts()}}
      async function loadOrders(){if(connectionBusy||!sessionData)return;const generation=connectionGeneration;const button=document.getElementById("orders-refresh");button.disabled=true;orderState.state="loading";renderOrders();try{const data=await request("/shopify/session/orders");if(generation!==connectionGeneration)return;orderState.data=data;orderState.state="ready";orderState.message="";orderState.messageKey=""}catch(error){if(generation!==connectionGeneration)return;orderState.data=null;orderState.state="error";orderState.message=error&&error.message||copy.requestFailed;orderState.messageKey=error&&error.translationKey||""}finally{if(generation!==connectionGeneration)return;button.disabled=false;renderOrders()}}

      document.getElementById("language-toggle").addEventListener("click",function(){applyLocale(locale==="en"?"zh":"en")});
      document.getElementById("retry-session").addEventListener("click",connect);
      recheckConnection.addEventListener("click",connect);
      permissionCheck.addEventListener("click",checkPermissions);
      nativeLinkStart.addEventListener("click",prepareNativeLink);
      chatCheck.addEventListener("click",checkChatSetup);
      document.getElementById("products-refresh").addEventListener("click",loadProducts);
      document.getElementById("orders-refresh").addEventListener("click",loadOrders);
      applyLocale(locale);
      connect();
    })();
  </script>
</body>
</html>`
