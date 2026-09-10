package migration

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"encoding/base64"
	"strings"
	"testing"
)

func TestCredentialDecoderAcceptsOnlyExplicitLegacyKeyForEncryptedToken(t *testing.T) {
	secret := "explicit-legacy-key"
	stored := "enc:v1:" + encryptLegacyCredential(t, secret, "shpat_encrypted_legacy_token")

	withoutKey := NewCredentialDecoder("")
	if _, err := withoutKey.Decode(stored); err == nil {
		t.Fatal("encrypted token was accepted without explicit legacy key")
	}
	decoder := NewCredentialDecoder(secret)
	plain, err := decoder.Decode(stored)
	if err != nil || plain != "shpat_encrypted_legacy_token" {
		t.Fatalf("explicit-key decrypt mismatch: %q err=%v", plain, err)
	}
}

func TestCredentialDecoderNeverDowngradesUnknownOrDamagedCiphertext(t *testing.T) {
	decoder := NewCredentialDecoder("explicit-legacy-key")
	for _, stored := range []string{
		"enc:v2:shpat_not_plaintext",
		"enc:v1:shpat_not_ciphertext",
		"enc:broken",
	} {
		if _, err := decoder.Decode(stored); err == nil {
			t.Fatalf("ciphertext-like value was accepted as plaintext: %q", stored)
		}
	}
}

func TestCredentialDecoderAcceptsOnlyKnownLegacyPlaintextTokenShape(t *testing.T) {
	decoder := NewCredentialDecoder("")
	if plain, err := decoder.Decode("shpat_known_legacy_token"); err != nil || plain != "shpat_known_legacy_token" {
		t.Fatalf("known legacy plaintext rejected: %q err=%v", plain, err)
	}
	for _, value := range []string{"plain-secret", " bearer token ", "shpat_short", strings.Repeat("x", 5000)} {
		if _, err := decoder.Decode(value); err == nil {
			t.Fatalf("unknown plaintext shape accepted: %q", value)
		}
	}
}

func encryptLegacyCredential(t *testing.T, secret, token string) string {
	t.Helper()
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		t.Fatalf("aes.NewCipher failed: %v", err)
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM failed: %v", err)
	}
	nonce := make([]byte, aead.NonceSize())
	for index := range nonce {
		nonce[index] = byte(index + 1)
	}
	return base64.RawStdEncoding.EncodeToString(aead.Seal(nonce, nonce, []byte(token), nil))
}
