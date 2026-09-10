package platform

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

const defaultShopifyExtensionHandle = "xinzhi-chat"

var shopifyOAuthStoreHandlePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`)

func normalizeShopifyOAuthTarget(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if !strings.Contains(value, "://") {
		value = "https://" + strings.TrimLeft(value, "/")
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return ""
	}
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme != "http" && scheme != "https") || parsed.User != nil || parsed.Port() != "" {
		return ""
	}
	host := strings.ToLower(strings.TrimSuffix(parsed.Hostname(), "."))
	handle := ""
	if host == "admin.shopify.com" {
		segments := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
		if len(segments) < 2 || strings.ToLower(segments[0]) != "store" {
			return ""
		}
		handle, err = url.PathUnescape(segments[1])
		if err != nil {
			return ""
		}
		handle = strings.ToLower(strings.TrimSpace(handle))
	} else if strings.HasSuffix(host, ".myshopify.com") {
		handle = strings.TrimSuffix(host, ".myshopify.com")
		if strings.Contains(handle, ".") {
			return ""
		}
	} else if !strings.Contains(host, ".") {
		handle = host
	}
	if !shopifyOAuthStoreHandlePattern.MatchString(handle) {
		return ""
	}
	return handle + ".myshopify.com"
}

func requestBaseURL(r *http.Request) string {
	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")); forwarded != "" {
		scheme = strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	return scheme + "://" + r.Host
}

func encryptShopifyCredential(value string) (string, error) {
	aead, err := shopifyCredentialCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptShopifyCredential(value string) (string, error) {
	aead, err := shopifyCredentialCipher()
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < aead.NonceSize() {
		return "", fmt.Errorf("%w: Shopify 凭证密文无效", ErrInvalid)
	}
	plain, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], nil)
	if err != nil {
		return "", fmt.Errorf("%w: 无法解密 Shopify 凭证，请检查 SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", ErrInvalid)
	}
	return string(plain), nil
}

func shopifyCredentialCipher() (cipher.AEAD, error) {
	secret := firstNonEmptyEnv("SHOPIFY_CREDENTIALS_ENCRYPTION_KEY", "AI_SETTINGS_ENCRYPTION_KEY")
	if secret == "" {
		return nil, fmt.Errorf("%w: 服务器未配置 SHOPIFY_CREDENTIALS_ENCRYPTION_KEY，不能安全保存 Shopify 凭证", ErrInvalid)
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

func sanitizeShopifyDeployMessage(message string, secrets ...string) string {
	message = strings.TrimSpace(message)
	for _, secret := range secrets {
		if secret = strings.TrimSpace(secret); secret != "" {
			message = strings.ReplaceAll(message, secret, "[REDACTED]")
		}
	}
	if len(message) > 4000 {
		message = message[len(message)-4000:]
	}
	return message
}
