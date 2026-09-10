package platform

import (
	"context"
	"fmt"
	"strings"
)

type emailInstallationCredentialMigrator interface {
	MigrateEmailInstallationCredentials(context.Context) error
}

// MigrateEmailInstallationCredentials upgrades credentials in the server's
// tenant-bound store. Stores without legacy credential state need no work.
func (s *Server) MigrateEmailInstallationCredentials(ctx context.Context) error {
	migrator, ok := s.store.(emailInstallationCredentialMigrator)
	if !ok {
		return nil
	}
	return migrator.MigrateEmailInstallationCredentials(ctx)
}

const emailCredentialEnvelopePrefix = "enc:v1:"

func encryptEmailCredential(value string) (string, error) {
	if value == "" {
		return "", nil
	}
	if isEncryptedEmailCredential(value) {
		if _, err := decryptEmailCredential(value); err != nil {
			return "", err
		}
		return value, nil
	}
	encrypted, err := encryptAIKey(value)
	if err != nil {
		return "", fmt.Errorf("email credential encryption failed: %w", err)
	}
	return emailCredentialEnvelopePrefix + encrypted, nil
}

func decryptEmailCredential(value string) (string, error) {
	if value == "" || !isEncryptedEmailCredential(value) {
		return value, nil
	}
	decrypted, err := decryptAIKey(strings.TrimPrefix(value, emailCredentialEnvelopePrefix))
	if err != nil {
		return "", fmt.Errorf("email credential decryption failed: %w", err)
	}
	return decrypted, nil
}

func isEncryptedEmailCredential(value string) bool {
	return strings.HasPrefix(value, emailCredentialEnvelopePrefix)
}

func decryptEmailInstallationCredentials(input EmailInstallation) (EmailInstallation, error) {
	accessToken, err := decryptEmailCredential(input.AccessToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	refreshToken, err := decryptEmailCredential(input.RefreshToken)
	if err != nil {
		return EmailInstallation{}, err
	}
	input.AccessToken = accessToken
	input.RefreshToken = refreshToken
	return input, nil
}
