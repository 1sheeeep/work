package platform

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
)

const (
	emailDisconnectedAtKey     = "email_disconnected_at"
	emailDisconnectedReasonKey = "email_disconnected_reason"
)

type emailDisconnectResponse struct {
	Source                      ShopSource `json:"source"`
	ProviderNotificationStopped bool       `json:"providerNotificationStopped"`
}

func disconnectedEmailSourceMetadata(source ShopSource, disconnectedAt time.Time) map[string]string {
	metadata := map[string]string{
		"mailbox":                   normalizeEmail(sourceEmailAddress(source)),
		emailDisconnectedAtKey:      disconnectedAt.UTC().Format(time.RFC3339Nano),
		emailDisconnectedReasonKey:  "manual",
		"email_sync_status":         "disconnected",
		"email_notification_status": "disconnected",
		"email_health_status":       "disconnected",
	}
	if auth := strings.TrimSpace(source.Metadata["auth"]); auth != "" {
		metadata["auth"] = auth
	}
	return metadata
}

func (s *Server) disconnectEmailSource(ctx context.Context, shopID string, sourceID string) (emailDisconnectResponse, error) {
	lock := s.emailSourceSyncLock(sourceID)
	lock.Lock()
	defer lock.Unlock()

	source, err := s.store.GetShopSource(ctx, shopID, sourceID)
	if err != nil {
		return emailDisconnectResponse{}, err
	}
	if source.Type != SourceTypeEmail {
		return emailDisconnectResponse{}, ErrInvalid
	}

	providerStopped := true
	installation, installErr := s.store.GetEmailInstallation(ctx, shopID, sourceEmailAddress(source))
	if installErr == nil {
		providerCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		providerStopped = s.stopEmailProviderNotifications(providerCtx, source, installation) == nil
		cancel()
		if !providerStopped {
			log.Printf("email disconnect: provider notification cleanup failed for source %s", source.ID)
		}
	} else if !errors.Is(installErr, ErrNotFound) {
		return emailDisconnectResponse{}, installErr
	}

	updated, err := s.store.DisconnectEmailSource(ctx, shopID, sourceID)
	if err != nil {
		return emailDisconnectResponse{}, err
	}
	s.notifyStandardIMAPSupervisor()
	return emailDisconnectResponse{Source: updated, ProviderNotificationStopped: providerStopped}, nil
}

func (s *Server) stopEmailProviderNotifications(ctx context.Context, source ShopSource, installation EmailInstallation) error {
	provider := strings.ToLower(strings.TrimSpace(installation.Provider))
	if provider == "outlook" && strings.TrimSpace(source.Metadata[outlookSubscriptionIDKey]) == "" && strings.TrimSpace(source.Metadata[outlookJunkSubscriptionIDKey]) == "" {
		return nil
	}
	fresh, err := s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		return err
	}
	switch provider {
	case "gmail":
		return emailNotificationJSON(ctx, http.MethodPost, gmailAPIBase()+"/users/me/stop", fresh.AccessToken, nil, nil)
	case "outlook":
		for _, subscriptionID := range []string{source.Metadata[outlookSubscriptionIDKey], source.Metadata[outlookJunkSubscriptionIDKey]} {
			if subscriptionID = strings.TrimSpace(subscriptionID); subscriptionID != "" {
				if err := deleteOutlookSubscription(ctx, fresh.AccessToken, subscriptionID); err != nil {
					return err
				}
			}
		}
		return nil
	case cuiqiuProvider:
		return nil
	case standardMailProvider:
		return nil
	default:
		return ErrInvalid
	}
}
