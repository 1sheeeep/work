package installations

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type storefrontSessionPayload struct {
	Shop       string `json:"shop"`
	CustomerID string `json:"customerId"`
	IssuedAt   int64  `json:"issuedAt"`
}

type storefrontSessionResponse struct {
	Authenticated bool   `json:"authenticated"`
	Token         string `json:"token,omitempty"`
}

func (h *Handler) handleStorefrontSessionProxy(w http.ResponseWriter, r *http.Request) {
	domain, domainOK := shopifyconnector.NormalizeShopDomain(strings.TrimSpace(r.URL.Query().Get("shop")))
	if !domainOK || !verifyAppProxyQuery(r.URL.Query(), h.config.AppSecret) || !freshAppProxyTimestamp(r.URL.Query(), h.now()) {
		writeRuntimeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify app proxy request"})
		return
	}
	identity, err := h.repository.ResolveIdentityByDomain(r.Context(), domain)
	if err != nil || (strings.TrimSpace(r.URL.Query().Get("tenant")) != "" &&
		strings.TrimSpace(r.URL.Query().Get("tenant")) != strings.TrimSpace(identity.TenantID)) {
		writeRuntimeJSON(w, http.StatusNotFound, map[string]string{"error": "storefront support is unavailable"})
		return
	}
	customerID := strings.TrimSpace(r.URL.Query().Get("logged_in_customer_id"))
	if customerID == "" {
		writeRuntimeJSON(w, http.StatusOK, storefrontSessionResponse{Authenticated: false})
		return
	}
	if !numericStorefrontCustomerID(customerID) {
		writeRuntimeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid Shopify customer identity"})
		return
	}
	token, err := signStorefrontSession(storefrontSessionPayload{
		Shop: domain, CustomerID: customerID, IssuedAt: h.now().UTC().Unix(),
	}, h.config.AppSecret)
	if err != nil {
		writeRuntimeJSON(w, http.StatusInternalServerError, map[string]string{"error": "storefront support is unavailable"})
		return
	}
	writeRuntimeJSON(w, http.StatusOK, storefrontSessionResponse{Authenticated: true, Token: token})
}

func verifyAppProxyQuery(values url.Values, secret string) bool {
	received := strings.TrimSpace(values.Get("signature"))
	secret = strings.TrimSpace(secret)
	if received == "" || secret == "" {
		return false
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		if key != "signature" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	var payload strings.Builder
	for _, key := range keys {
		payload.WriteString(key)
		payload.WriteString("=")
		payload.WriteString(strings.Join(values[key], ","))
	}
	expected := hmacHexValue(secret, payload.String())
	return len(received) == len(expected) && hmac.Equal([]byte(received), []byte(expected))
}

func freshAppProxyTimestamp(values url.Values, now time.Time) bool {
	timestamp, err := strconv.ParseInt(strings.TrimSpace(values.Get("timestamp")), 10, 64)
	if err != nil {
		return false
	}
	delta := now.UTC().Sub(time.Unix(timestamp, 0))
	if delta < 0 {
		delta = -delta
	}
	return delta <= 5*time.Minute
}

func numericStorefrontCustomerID(value string) bool {
	if len(value) == 0 || len(value) > 32 {
		return false
	}
	for _, character := range value {
		if character < '0' || character > '9' {
			return false
		}
	}
	return true
}

func signStorefrontSession(payload storefrontSessionPayload, secret string) (string, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	encoded := base64.RawURLEncoding.EncodeToString(raw)
	return encoded + "." + hmacHexValue(secret, encoded), nil
}

func hmacHexValue(secret string, value string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
