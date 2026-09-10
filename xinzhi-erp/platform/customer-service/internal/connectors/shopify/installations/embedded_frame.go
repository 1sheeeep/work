package installations

import (
	"net/http"
	"net/url"
	"strconv"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

// Framing permission is not a business session. Every data request still needs
// its own App Bridge token; no installation lookup or token exchange happens here.
func (h *Handler) embeddedFrameShop(r *http.Request) string {
	values, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return ""
	}
	for _, entries := range values {
		if len(entries) != 1 {
			return ""
		}
	}
	domain, valid := shopifyconnector.NormalizeShopDomain(values.Get("shop"))
	if !valid {
		return ""
	}
	now := h.now().UTC()
	if len(r.Header.Values("Authorization")) > 1 {
		return ""
	}
	if authorization := r.Header.Get("Authorization"); authorization != "" {
		claims, err := verifyEmbeddedSessionToken(embeddedBearerToken(authorization), h.config.AppAPIKey, h.config.AppSecret, now)
		if err != nil || claims.ShopDomain() != domain {
			return ""
		}
		// Do not let two different credentials choose different framing tenants.
		if values.Has("id_token") {
			queryClaims, queryErr := verifyEmbeddedSessionToken(values.Get("id_token"), h.config.AppAPIKey, h.config.AppSecret, now)
			if queryErr != nil || queryClaims.ShopDomain() != domain {
				return ""
			}
		}
		return domain
	}
	if values.Has("id_token") {
		claims, err := verifyEmbeddedSessionToken(values.Get("id_token"), h.config.AppAPIKey, h.config.AppSecret, now)
		if err != nil || claims.ShopDomain() != domain {
			return ""
		}
		return domain
	}
	// Shopify also signs initial app launches without an ID-token query parameter.
	// Bound that launch proof to five minutes; it is never accepted by JSON APIs.
	timestamp, err := strconv.ParseInt(values.Get("timestamp"), 10, 64)
	if err != nil || timestamp <= 0 || !verifyShopifyQuery(values, h.config.AppSecret) {
		return ""
	}
	issuedAt := time.Unix(timestamp, 0)
	if issuedAt.After(now.Add(5*time.Second)) || issuedAt.Before(now.Add(-5*time.Minute)) {
		return ""
	}
	return domain
}

func embeddedFrameAncestors(domain string) string {
	if normalized, valid := shopifyconnector.NormalizeShopDomain(domain); valid {
		return "https://" + normalized + " https://admin.shopify.com"
	}
	// The credential-free public shell remains readable in a top-level tab.
	// Unsigned shop/host/Origin/Referer values cannot opt into embedding.
	return "'none'"
}
