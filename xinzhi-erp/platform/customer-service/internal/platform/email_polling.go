package platform

import (
	"context"
	"hash/fnv"
	"log"
	"strings"
	"time"
)

func (s *Server) StartEmailPolling(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	s.enableEmailBackgroundSync()
	go s.pollAllEmailSources(ctx, interval)
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.pollAllEmailSources(ctx, interval)
			}
		}
	}()
}

func (s *Server) pollAllEmailSources(ctx context.Context, interval time.Duration) {
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		log.Printf("email polling: list shops failed: %v", err)
		return
	}
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		log.Printf("email polling: list sources failed: %v", err)
		return
	}
	activeShops := make(map[string]bool, len(shops))
	for _, shop := range shops {
		if shop.Status == ShopStatusActive {
			activeShops[shop.ID] = true
		}
	}
	now := time.Now().UTC()
	for _, source := range sources {
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		if !activeShops[source.ShopID] || source.Type != SourceTypeEmail || source.Status != SourceStatusActive || (provider != "gmail" && provider != "outlook" && provider != cuiqiuProvider && provider != standardMailProvider) {
			continue
		}
		if strings.TrimSpace(source.Metadata[emailManualPausedAtKey]) != "" || emailRetryStateIsPermanent(source.Metadata[emailRetryStateKey]) {
			continue
		}
		sourceInterval := interval
		if provider == standardMailProvider {
			sourceInterval = standardIMAPReconcileInterval(source)
			if sourceInterval <= 0 {
				continue
			}
		}
		if !emailSourcePollDue(source, now, sourceInterval) {
			continue
		}
		if err := s.enqueueEmailSourceSync(ctx, source, "scheduled reconciliation", now); err != nil && ctx.Err() == nil {
			log.Printf("email polling: enqueue reconciliation %s/%s failed: %v", source.ShopID, source.ID, err)
		}
	}
}

func emailSourcePollDue(source ShopSource, now time.Time, interval time.Duration) bool {
	if strings.EqualFold(strings.TrimSpace(source.Metadata[emailSyncBacklogPendingKey]), "true") {
		return emailSourceAutomaticSyncDue(source, now)
	}
	retryState := strings.TrimSpace(source.Metadata[emailRetryStateKey])
	if retryState == emailRetryStateWaiting {
		return emailSourceAutomaticSyncDue(source, now)
	}
	if !emailSourceAutomaticSyncDue(source, now) {
		return false
	}
	lastReconcile, ok := parseEmailSyncTime(source.Metadata[emailLastReconcileAtKey])
	if !ok {
		return now.UTC().Hour() == emailSourceInitialReconcileHour(source)
	}
	return !now.Before(lastReconcile.Add(interval))
}

func emailSourceInitialReconcileHour(source ShopSource) int {
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(firstNonEmpty(source.ID, source.ShopID+"|"+source.Address)))
	return int(hash.Sum32() % 24)
}

func (s *Server) markEmailSourceReconciled(ctx context.Context, source ShopSource, reconciledAt time.Time) error {
	_, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata[emailLastReconcileAtKey] = reconciledAt.UTC().Format(time.RFC3339Nano)
		if strings.EqualFold(source.Provider, cuiqiuProvider) {
			metadata["email_sync_interval"] = "webhook+24h_reconcile"
		} else if strings.EqualFold(source.Provider, standardMailProvider) {
			metadata["email_sync_interval"] = standardIMAPSyncInterval(source)
		} else {
			metadata["email_sync_interval"] = "push+24h_reconcile"
		}
		return metadata
	})
	return err
}
