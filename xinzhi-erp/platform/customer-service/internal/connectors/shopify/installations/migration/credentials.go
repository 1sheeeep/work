package migration

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"regexp"
	"strings"
)

var (
	ErrLegacyCredentialInvalid = errors.New("legacy Shopify credential is invalid")
	legacyPlainTokenPattern    = regexp.MustCompile(`^(?:shpat|shpca|shppa|shpua|shpss)_[A-Za-z0-9_-]+$`)
)

type CredentialDecoder struct {
	secret string `json:"-"`
}

func (CredentialDecoder) String() string     { return "credentialDecoder{secret=[REDACTED]}" }
func (d CredentialDecoder) GoString() string { return d.String() }

func NewCredentialDecoder(explicitLegacySecret string) CredentialDecoder {
	return CredentialDecoder{secret: strings.TrimSpace(explicitLegacySecret)}
}

func (d CredentialDecoder) Decode(stored string) (string, error) {
	if strings.HasPrefix(stored, "enc:v1:") {
		if d.secret == "" {
			return "", ErrLegacyCredentialInvalid
		}
		plain, err := decryptLegacyV1(strings.TrimPrefix(stored, "enc:v1:"), d.secret)
		if err != nil || !validLegacyPlainToken(plain) {
			return "", ErrLegacyCredentialInvalid
		}
		return plain, nil
	}
	if strings.HasPrefix(strings.ToLower(stored), "enc:") || !validLegacyPlainToken(stored) {
		return "", ErrLegacyCredentialInvalid
	}
	return stored, nil
}

func validLegacyPlainToken(value string) bool {
	return value == strings.TrimSpace(value) && len(value) >= 14 && len(value) <= 4096 && legacyPlainTokenPattern.MatchString(value)
}

func decryptLegacyV1(encoded, secret string) (string, error) {
	raw, err := base64.RawStdEncoding.DecodeString(encoded)
	if err != nil {
		return "", ErrLegacyCredentialInvalid
	}
	defer zeroBytes(raw)
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return "", ErrLegacyCredentialInvalid
	}
	aead, err := cipher.NewGCM(block)
	if err != nil || len(raw) < aead.NonceSize() {
		return "", ErrLegacyCredentialInvalid
	}
	plain, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], nil)
	if err != nil {
		return "", ErrLegacyCredentialInvalid
	}
	decrypted := string(plain)
	for index := range plain {
		plain[index] = 0
	}
	return decrypted, nil
}
