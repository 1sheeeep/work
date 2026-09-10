package platform

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (s *Server) setEmailSourceManualPause(ctx context.Context, shopID string, sourceID string, paused bool, userID string) (ShopSource, error) {
	source, err := s.store.GetShopSource(ctx, strings.TrimSpace(shopID), strings.TrimSpace(sourceID))
	if err != nil {
		return ShopSource{}, err
	}
	if source.Type != SourceTypeEmail || source.Status != SourceStatusActive {
		return ShopSource{}, fmt.Errorf("%w: active email source is required", ErrInvalid)
	}
	updated, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		if paused {
			metadata[emailManualPausedAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
			metadata[emailManualPausedByKey] = strings.TrimSpace(userID)
			metadata["email_sync_status"] = "paused"
			return metadata
		}
		delete(metadata, emailManualPausedAtKey)
		delete(metadata, emailManualPausedByKey)
		delete(metadata, "email_flood_pause_reason")
		delete(metadata, "email_flood_pause_count")
		metadata["email_sync_status"] = "pending"
		return metadata
	})
	if err != nil {
		return ShopSource{}, err
	}
	s.notifyStandardIMAPSupervisor()
	s.broadcast(Event{Type: "shop_source.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	return updated, nil
}

func (s *Server) recoverStandardIMAPSource(ctx context.Context, shopID string, sourceID string) (ShopSource, error) {
	lock := s.emailSourceSyncLock(strings.TrimSpace(sourceID))
	lock.Lock()
	defer lock.Unlock()

	source, err := s.store.GetShopSource(ctx, strings.TrimSpace(shopID), strings.TrimSpace(sourceID))
	if err != nil {
		return ShopSource{}, err
	}
	if !isActiveStandardIMAPSource(source) {
		return ShopSource{}, fmt.Errorf("%w: active standard IMAP source is required", ErrInvalid)
	}
	installation, err := s.store.GetEmailInstallation(ctx, source.ShopID, sourceEmailAddress(source))
	if err != nil {
		return ShopSource{}, fmt.Errorf("%w: email installation missing", ErrInvalid)
	}
	config, err := standardMailConfigFrom(source, installation)
	if err != nil {
		return ShopSource{}, err
	}
	if _, err = verifyStandardIMAPConnection(ctx, config); err != nil {
		syncErr := fmt.Errorf("IMAP connection failed: %w", err)
		_, _, _ = s.recordStandardIMAPRealtimeFailure(ctx, source, syncErr, false)
		return ShopSource{}, fmt.Errorf("%w: %s，请检查后再手动恢复", ErrConflict, standardIMAPConnectionReason(standardIMAPConnectionErrorCode(syncErr)))
	}

	now := time.Now().UTC()
	updated, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata = clearEmailRetryState(metadata)
		delete(metadata, standardIMAPRealtimeFailureCountKey)
		delete(metadata, "email_last_error")
		metadata["email_sync_status"] = "pending"
		metadata["email_health_status"] = "ok"
		metadata["email_notification_status"] = "ok"
		metadata["email_last_connection_check_at"] = now.Format(time.RFC3339Nano)
		return metadata
	})
	if err != nil {
		return ShopSource{}, err
	}
	s.notifyStandardIMAPSupervisor()
	s.scheduleEmailSourceSync(updated, "manual IMAP connection recovery")
	s.broadcast(Event{Type: "shop_source.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: now})
	return updated, nil
}
