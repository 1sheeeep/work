package platform

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"
)

const (
	emailSyncPriorityReconcile = 20
	emailSyncPriorityRetry     = 40
	emailSyncPriorityBacklog   = 70
	emailSyncPriorityManual    = 90
	emailSyncPriorityPush      = 100
)

var emailSyncProviderWorkers = map[string]int{
	"gmail":              2,
	"outlook":            2,
	cuiqiuProvider:       1,
	standardMailProvider: 1,
}

const emailSyncQueueErrorRetryDelay = 30 * time.Second
const emailProviderFailureWindow = 2 * time.Minute
const emailProviderGlobalGateThreshold = 3

func newEmailSyncWakeChannels() map[string]chan struct{} {
	channels := make(map[string]chan struct{}, len(emailSyncProviderWorkers))
	for provider, count := range emailSyncProviderWorkers {
		channels[provider] = make(chan struct{}, count)
	}
	return channels
}

func (s *Server) notifyEmailSyncWorkers(provider string) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	wake := s.emailSyncWake[provider]
	for worker := 0; wake != nil && worker < emailSyncProviderWorkers[provider]; worker++ {
		select {
		case wake <- struct{}{}:
		default:
		}
	}
}

func emailProviderSourceGateKey(provider string, sourceID string) string {
	return strings.ToLower(strings.TrimSpace(provider)) + "|" + strings.TrimSpace(sourceID)
}

func (s *Server) emailProviderRetryGate(provider string, sourceID string, now time.Time) (time.Time, bool) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.emailProviderGateMu.Lock()
	defer s.emailProviderGateMu.Unlock()
	for _, key := range []string{emailProviderSourceGateKey(provider, sourceID), provider} {
		next := s.emailProviderGates[key]
		if next.IsZero() {
			continue
		}
		if !now.Before(next) {
			delete(s.emailProviderGates, key)
			continue
		}
		return next, true
	}
	return time.Time{}, false
}

func (s *Server) setEmailProviderRetryGate(provider string, source ShopSource) {
	errorCode := strings.TrimSpace(source.Metadata[emailRetryErrorCodeKey])
	if errorCode != "provider_unavailable" && errorCode != "rate_limited" && errorCode != "timeout" {
		return
	}
	next, ok := parseEmailSyncTime(source.Metadata[emailRetryNextAtKey])
	if !ok || !next.After(time.Now().UTC()) {
		return
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.emailProviderGateMu.Lock()
	sourceKey := emailProviderSourceGateKey(provider, source.ID)
	if current := s.emailProviderGates[sourceKey]; current.IsZero() || next.After(current) {
		s.emailProviderGates[sourceKey] = next
	}
	failures := s.emailProviderFailures[provider]
	if failures == nil {
		failures = map[string]time.Time{}
		s.emailProviderFailures[provider] = failures
	}
	now := time.Now().UTC()
	for failedSourceID, failedAt := range failures {
		if now.Sub(failedAt) > emailProviderFailureWindow {
			delete(failures, failedSourceID)
		}
	}
	failures[source.ID] = now
	if len(failures) >= emailProviderGlobalGateThreshold {
		if current := s.emailProviderGates[provider]; current.IsZero() || next.After(current) {
			s.emailProviderGates[provider] = next
		}
	}
	s.emailProviderGateMu.Unlock()
}

func (s *Server) clearEmailProviderRetryGate(provider string, sourceID string) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.emailProviderGateMu.Lock()
	delete(s.emailProviderGates, emailProviderSourceGateKey(provider, sourceID))
	if failures := s.emailProviderFailures[provider]; failures != nil {
		delete(failures, strings.TrimSpace(sourceID))
		if len(failures) == 0 {
			delete(s.emailProviderFailures, provider)
		}
	}
	s.emailProviderGateMu.Unlock()
}

func emailSyncPriority(reason string) int {
	reason = strings.ToLower(strings.TrimSpace(reason))
	switch {
	case strings.Contains(reason, "push"), strings.Contains(reason, "webhook"), strings.Contains(reason, "missed"):
		return emailSyncPriorityPush
	case strings.Contains(reason, "manual"), strings.Contains(reason, "connect"), strings.Contains(reason, "resume"):
		return emailSyncPriorityManual
	case strings.Contains(reason, "backlog"):
		return emailSyncPriorityBacklog
	case strings.Contains(reason, "retry"):
		return emailSyncPriorityRetry
	default:
		return emailSyncPriorityReconcile
	}
}

func (s *Server) enqueueEmailSourceSync(ctx context.Context, source ShopSource, reason string, availableAt time.Time) error {
	queue, ok := s.store.(emailSyncJobStore)
	if !ok {
		return errors.New("email sync queue storage is unavailable")
	}
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	if provider == "" {
		return errors.New("email sync provider is missing")
	}
	_, err := queue.EnqueueEmailSyncJob(ctx, EmailSyncJob{
		ShopID: source.ShopID, SourceID: source.ID, Provider: provider,
		Priority: emailSyncPriority(reason), Reason: reason, AvailableAt: availableAt,
	})
	if err == nil {
		s.notifyEmailSyncWorkers(provider)
	}
	return err
}

func (s *Server) StartEmailSyncWorkers(ctx context.Context) {
	queue, ok := s.store.(emailSyncJobStore)
	if !ok {
		log.Printf("email sync queue: durable store is unavailable")
		return
	}
	if recovered, err := queue.RecoverEmailSyncJobs(ctx, time.Now().UTC().Add(-2*time.Minute)); err != nil {
		if ctx.Err() == nil {
			log.Printf("email sync queue: recover interrupted jobs failed: %v", err)
		}
	} else if recovered > 0 {
		log.Printf("email sync queue: recovered %d interrupted job(s)", recovered)
	}
	for provider, count := range emailSyncProviderWorkers {
		for worker := 0; worker < count; worker++ {
			go s.runEmailSyncWorker(ctx, queue, provider)
		}
	}
}

func (s *Server) runEmailSyncWorker(ctx context.Context, queue emailSyncJobStore, provider string) {
	for {
		job, err := queue.ClaimEmailSyncJob(ctx, provider, time.Now().UTC())
		if err == nil {
			s.processEmailSyncJob(ctx, queue, job)
			continue
		}
		if !errors.Is(err, ErrNotFound) && ctx.Err() == nil {
			log.Printf("email sync queue: claim %s job failed: %v", provider, err)
		}
		var due <-chan time.Time
		var timer *time.Timer
		if err != nil && !errors.Is(err, ErrNotFound) {
			timer = time.NewTimer(emailSyncQueueErrorRetryDelay)
			due = timer.C
		} else if availableAt, nextErr := queue.NextEmailSyncJobAvailableAt(ctx, provider); nextErr == nil {
			delay := time.Until(availableAt)
			if delay < 0 {
				delay = 0
			}
			timer = time.NewTimer(delay)
			due = timer.C
		} else if !errors.Is(nextErr, ErrNotFound) {
			if ctx.Err() == nil {
				log.Printf("email sync queue: read next %s job failed: %v", provider, nextErr)
			}
			timer = time.NewTimer(emailSyncQueueErrorRetryDelay)
			due = timer.C
		}
		select {
		case <-ctx.Done():
			if timer != nil && !timer.Stop() {
				select {
				case <-due:
				default:
				}
			}
			return
		case <-s.emailSyncWake[provider]:
			if timer != nil && !timer.Stop() {
				select {
				case <-due:
				default:
				}
			}
		case <-due:
		}
	}
}

func (s *Server) processEmailSyncJob(parent context.Context, queue emailSyncJobStore, job EmailSyncJob) {
	lock := s.emailSourceSyncLock(job.SourceID)
	lock.Lock()
	defer lock.Unlock()
	ctx, cancel := context.WithTimeout(parent, emailSourceSyncTimeout)
	defer cancel()
	finish := func(rerun bool, availableAt time.Time, lastError string) {
		finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
		defer finishCancel()
		if err := queue.FinishEmailSyncJob(finishCtx, job.SourceID, rerun, availableAt, lastError); err != nil && !errors.Is(err, ErrNotFound) {
			log.Printf("email sync queue: finish %s failed: %v", job.SourceID, err)
		}
	}
	latest, err := s.store.GetShopSource(ctx, job.ShopID, job.SourceID)
	if err != nil || latest.Status != SourceStatusActive || latest.Type != SourceTypeEmail {
		finish(false, time.Time{}, "")
		return
	}
	now := time.Now().UTC()
	if next, blocked := s.emailProviderRetryGate(latest.Provider, latest.ID, now); blocked {
		finish(true, next, "provider recovery window")
		return
	}
	if strings.Contains(strings.ToLower(job.Reason), "read-state") {
		pending := pendingEmailReadMessageIDs(latest.Metadata)
		if len(pending) == 0 || emailRetryStateIsPermanent(latest.Metadata[emailReadRetryStateKey]) {
			finish(false, time.Time{}, "")
			return
		}
		if next, ok := parseEmailSyncTime(latest.Metadata[emailReadRetryNextAtKey]); ok && now.Before(next) {
			finish(true, next, "waiting for read-state retry window")
			return
		}
		installation, retryErr := s.store.GetEmailInstallation(ctx, latest.ShopID, latest.Address)
		if retryErr == nil {
			installation.Provider = latest.Provider
			installation, retryErr = s.emailInstallationWithFreshToken(ctx, installation)
		}
		var updated ShopSource
		if retryErr == nil {
			updated, retryErr = s.retryPendingEmailReadStates(ctx, latest, installation)
		} else {
			updated, _ = s.updatePendingEmailReadMessageIDs(ctx, latest, pending, nil, retryErr)
		}
		if retryErr == nil || len(pendingEmailReadMessageIDs(updated.Metadata)) == 0 || emailRetryStateIsPermanent(updated.Metadata[emailReadRetryStateKey]) {
			finish(false, time.Time{}, "")
			return
		}
		if next, ok := parseEmailSyncTime(updated.Metadata[emailReadRetryNextAtKey]); ok {
			finish(true, next, retryErr.Error())
			return
		}
		finish(false, time.Time{}, retryErr.Error())
		return
	}
	if !emailSourceAutomaticSyncDue(latest, now) {
		if strings.TrimSpace(latest.Metadata[emailRetryStateKey]) == emailRetryStateWaiting {
			if next, ok := parseEmailSyncTime(latest.Metadata[emailRetryNextAtKey]); ok {
				finish(true, next, "waiting for provider retry window")
				return
			}
		}
		finish(false, time.Time{}, "")
		return
	}
	result := s.syncSingleEmailSource(ctx, latest.ShopID, strings.ToLower(strings.TrimSpace(latest.Provider)), latest)
	if result.BacklogPending {
		finish(true, time.Now().UTC(), "")
		return
	}
	if result.SourcesFailed > 0 {
		lastError := strings.Join(result.Warnings, "; ")
		s.recordEmailRuntimeEvent(context.WithoutCancel(ctx), EmailRuntimeEvent{
			Category: "sync.failed", Severity: "error", ShopID: latest.ShopID, SourceID: latest.ID,
			EntityID: job.SourceID, Message: "邮箱同步失败；系统已按重试策略处理",
		})
		refreshed, refreshErr := s.store.GetShopSource(context.WithoutCancel(ctx), latest.ShopID, latest.ID)
		if refreshErr == nil && strings.TrimSpace(refreshed.Metadata[emailRetryStateKey]) == emailRetryStateWaiting {
			s.setEmailProviderRetryGate(latest.Provider, refreshed)
			if next, ok := parseEmailSyncTime(refreshed.Metadata[emailRetryNextAtKey]); ok {
				finish(true, next, lastError)
				return
			}
		}
		finish(false, time.Time{}, lastError)
		return
	}
	s.clearEmailProviderRetryGate(latest.Provider, latest.ID)
	if strings.Contains(strings.ToLower(job.Reason), "reconciliation") {
		if err := s.markEmailSourceReconciled(ctx, latest, time.Now().UTC()); err != nil {
			finish(true, time.Now().UTC().Add(time.Minute), "save reconciliation checkpoint: "+err.Error())
			return
		}
	}
	finish(false, time.Time{}, "")
}
