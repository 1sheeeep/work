package platform

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"log"
	"strconv"
	"strings"
	"time"

	imapclient "github.com/emersion/go-imap/client"
)

const (
	standardIMAPRealtimeSafetyInterval  = time.Hour
	standardIMAPIdleRestartInterval     = 25 * time.Minute
	standardIMAPNoopFallbackInterval    = 5 * time.Minute
	standardIMAPRealtimeStableSession   = 30 * time.Minute
	standardIMAPRealtimeFailureCountKey = "imap_realtime_failure_count"
)

var errStandardIMAPRealtimeSourceInactive = errors.New("standard IMAP source is no longer active")

var (
	standardIMAPRealtimeInitialJitter = time.Minute
	standardIMAPRealtimeRetryDelays   = []time.Duration{time.Minute, 10 * time.Minute}
)

type standardIMAPRealtimeConnection struct {
	*imapclient.Client
	updates chan imapclient.Update
}

func newStandardIMAPRealtimeConnection(client *imapclient.Client) *standardIMAPRealtimeConnection {
	updates := make(chan imapclient.Update, 16)
	client.Updates = updates
	return &standardIMAPRealtimeConnection{Client: client, updates: updates}
}

func (client *standardIMAPRealtimeConnection) WaitForMailboxUpdate(ctx context.Context) error {
	// SELECT and FETCH may leave status updates in the client channel. They have
	// already been covered by the preceding UID sync, so discard them before IDLE.
	for {
		select {
		case <-client.updates:
			continue
		default:
			goto drained
		}
	}

drained:
	stop := make(chan struct{})
	done := make(chan error, 1)
	commandTimeout := client.Timeout
	client.Timeout = 0 // IDLE is intentionally long-lived; normal commands keep their timeout.
	go func() {
		done <- client.Client.Idle(stop, &imapclient.IdleOptions{
			LogoutTimeout: standardIMAPIdleRestartInterval,
			PollInterval:  standardIMAPNoopFallbackInterval,
		})
	}()

	idleFinished := false
	var result error
	select {
	case <-ctx.Done():
		result = ctx.Err()
	case <-client.updates:
		result = nil
	case err := <-done:
		idleFinished = true
		if err == nil {
			result = errors.New("IMAP event wait ended unexpectedly")
		} else {
			result = err
		}
	}

	if !idleFinished {
		close(stop)
		shutdownTimeout := commandTimeout
		if shutdownTimeout <= 0 {
			shutdownTimeout = 30 * time.Second
		}
		timer := time.NewTimer(shutdownTimeout)
		select {
		case err := <-done:
			if result == nil && err != nil {
				result = err
			}
			if !timer.Stop() {
				<-timer.C
			}
		case <-timer.C:
			_ = client.Terminate()
			<-done
			if result == nil {
				result = errors.New("IMAP event wait did not stop cleanly")
			}
		}
	}
	client.Timeout = commandTimeout
	return result
}

type standardIMAPRealtimeWorker struct {
	cancel context.CancelFunc
	id     uint64
}

type standardIMAPRealtimeWorkerFinished struct {
	sourceID string
	workerID uint64
}

func (s *Server) StartStandardIMAPRealtime(ctx context.Context) {
	go s.runStandardIMAPRealtimeSupervisor(ctx)
}

func (s *Server) notifyStandardIMAPSupervisor() {
	select {
	case s.standardIMAPWake <- struct{}{}:
	default:
	}
}

func (s *Server) runStandardIMAPRealtimeSupervisor(ctx context.Context) {
	workers := map[string]standardIMAPRealtimeWorker{}
	finished := make(chan standardIMAPRealtimeWorkerFinished, 32)
	var nextWorkerID uint64
	reconcile := func(useInitialJitter bool) {
		sources, err := s.activeStandardIMAPSources(ctx)
		if err != nil {
			log.Printf("standard IMAP realtime: source discovery failed: %v", err)
			return
		}
		desired := make(map[string]ShopSource, len(sources))
		for _, source := range sources {
			desired[source.ID] = source
			if _, running := workers[source.ID]; running {
				continue
			}
			workerCtx, cancel := context.WithCancel(ctx)
			nextWorkerID++
			workerID := nextWorkerID
			workers[source.ID] = standardIMAPRealtimeWorker{cancel: cancel, id: workerID}
			go func(workerCtx context.Context, source ShopSource, workerID uint64) {
				s.runStandardIMAPRealtimeWorkerWithJitter(workerCtx, source, useInitialJitter)
				select {
				case finished <- standardIMAPRealtimeWorkerFinished{sourceID: source.ID, workerID: workerID}:
				case <-ctx.Done():
				}
			}(workerCtx, source, workerID)
		}
		for sourceID, worker := range workers {
			if _, keep := desired[sourceID]; keep {
				continue
			}
			worker.cancel()
			delete(workers, sourceID)
		}
	}

	reconcile(true)
	ticker := time.NewTicker(standardIMAPRealtimeSafetyInterval)
	defer ticker.Stop()
	defer func() {
		for _, worker := range workers {
			worker.cancel()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case completed := <-finished:
			if worker, ok := workers[completed.sourceID]; ok && worker.id == completed.workerID {
				worker.cancel()
				delete(workers, completed.sourceID)
			}
		case <-s.standardIMAPWake:
			reconcile(false)
		case <-ticker.C:
			reconcile(true)
		}
	}
}

func (s *Server) activeStandardIMAPSources(ctx context.Context) ([]ShopSource, error) {
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return nil, err
	}
	activeShops := make(map[string]bool, len(shops))
	for _, shop := range shops {
		activeShops[shop.ID] = shop.Status == ShopStatusActive
	}
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		return nil, err
	}
	active := make([]ShopSource, 0)
	for _, source := range sources {
		if activeShops[source.ShopID] && isActiveStandardIMAPSource(source) && emailSourceAutomaticSyncDue(source, time.Now().UTC()) {
			active = append(active, source)
		}
	}
	return active, nil
}

func isActiveStandardIMAPSource(source ShopSource) bool {
	return source.Type == SourceTypeEmail && source.Status == SourceStatusActive && strings.EqualFold(source.Provider, standardMailProvider)
}

func (s *Server) runStandardIMAPRealtimeWorker(ctx context.Context, initialSource ShopSource) {
	s.runStandardIMAPRealtimeWorkerWithJitter(ctx, initialSource, true)
}

func (s *Server) runStandardIMAPRealtimeWorkerWithJitter(ctx context.Context, initialSource ShopSource, useInitialJitter bool) {
	if useInitialJitter && !waitStandardIMAPRealtime(ctx, standardIMAPRealtimeJitter(initialSource.ID, standardIMAPRealtimeInitialJitter)) {
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		source, err := s.store.GetShopSource(ctx, initialSource.ShopID, initialSource.ID)
		if err != nil || !isActiveStandardIMAPSource(source) {
			return
		}
		if !emailSourceAutomaticSyncDue(source, time.Now().UTC()) {
			return
		}
		installation, err := s.store.GetEmailInstallation(ctx, source.ShopID, sourceEmailAddress(source))
		if err != nil {
			syncErr := fmt.Errorf("email installation missing: %w", err)
			_, _, _ = s.recordStandardIMAPRealtimeFailure(ctx, source, syncErr, false)
			log.Printf("standard IMAP realtime: authorization unavailable for %s: %v", source.Address, err)
			return
		}
		config, err := standardMailConfigFrom(source, installation)
		if err != nil {
			syncErr := fmt.Errorf("IMAP configuration invalid: %w", err)
			_, _, _ = s.recordStandardIMAPRealtimeFailure(ctx, source, syncErr, false)
			log.Printf("standard IMAP realtime: configuration invalid for %s: %v", source.Address, err)
			return
		}
		client, err := openStandardIMAPRealtime(ctx, config)
		if err != nil {
			syncErr := fmt.Errorf("IMAP connection failed: %w", err)
			retryDelay, stop, _ := s.recordStandardIMAPRealtimeFailure(ctx, source, syncErr, false)
			log.Printf("standard IMAP realtime: connect failed for %s: %v", source.Address, err)
			if stop || !waitStandardIMAPRealtime(ctx, retryDelay) {
				return
			}
			continue
		}
		connectedAt := time.Now()
		err = s.runStandardIMAPRealtimeSession(ctx, source, client)
		_ = client.Logout()
		if errors.Is(err, errStandardIMAPRealtimeSourceInactive) || ctx.Err() != nil {
			return
		}
		if err != nil {
			log.Printf("standard IMAP realtime: session interrupted for %s: %v", source.Address, err)
		}
		retryDelay, stop, _ := s.recordStandardIMAPRealtimeFailure(ctx, source, firstStandardIMAPError(err, errors.New("IMAP session ended unexpectedly")), time.Since(connectedAt) >= standardIMAPRealtimeStableSession)
		if stop || !waitStandardIMAPRealtime(ctx, retryDelay) {
			return
		}
	}
}

func firstStandardIMAPError(values ...error) error {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func standardIMAPConnectionErrorCode(syncErr error) string {
	message := strings.ToLower(firstNonEmpty(errorString(syncErr), "unknown"))
	switch {
	case strings.Contains(message, "email installation missing"):
		return "imap_installation_missing"
	case strings.Contains(message, "authentication failed"), strings.Contains(message, "invalid credentials"), strings.Contains(message, "login failed"):
		return "imap_authentication"
	case strings.Contains(message, "configuration invalid"), strings.Contains(message, "configuration incomplete"):
		return "imap_configuration"
	case strings.Contains(message, "x509"), strings.Contains(message, "certificate"), strings.Contains(message, "tls handshake"):
		return "imap_tls"
	case strings.Contains(message, "no such host"), strings.Contains(message, "name resolution"), strings.Contains(message, "server misbehaving"):
		return "imap_dns"
	case strings.Contains(message, "connection refused"):
		return "imap_connection_refused"
	case strings.Contains(message, "connection reset"), strings.Contains(message, "broken pipe"), strings.Contains(message, "connection closed"), strings.Contains(message, "disconnected"):
		return "imap_connection_interrupted"
	case strings.Contains(message, "timeout"), strings.Contains(message, "deadline exceeded"), strings.Contains(message, "i/o timeout"):
		return "imap_timeout"
	default:
		return "imap_unavailable"
	}
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func standardIMAPConnectionErrorNeedsManualRecovery(syncErr error) bool {
	return standardIMAPConnectionErrorCode(syncErr) == "imap_tls"
}

func standardIMAPConnectionReason(code string) string {
	switch strings.TrimSpace(code) {
	case "imap_installation_missing":
		return "邮箱的本地授权信息缺失，需要重新接入"
	case "imap_authentication":
		return "邮箱服务器拒绝登录，请检查客户端授权码或专用密码"
	case "imap_configuration":
		return "邮箱接入配置不完整或与邮箱后缀不匹配"
	case "imap_tls":
		return "邮箱服务器的 TLS 安全连接校验失败"
	case "imap_dns":
		return "无法解析邮箱服务器地址"
	case "imap_connection_refused":
		return "邮箱服务器拒绝了 IMAP 连接"
	case "imap_connection_interrupted":
		return "IMAP 网络连接被中断"
	case "imap_timeout":
		return "连接邮箱服务器超时"
	default:
		return "邮箱服务器暂时无法连接"
	}
}

func (s *Server) recordStandardIMAPRealtimeFailure(ctx context.Context, source ShopSource, syncErr error, resetCount bool) (time.Duration, bool, error) {
	now := time.Now().UTC()
	var retryDelay time.Duration
	var stopped bool
	var transitionedToManual bool
	updated, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata["email_sync_status"] = "error"
		metadata["email_last_sync_at"] = now.Format(time.RFC3339)
		metadata["email_last_error"] = truncateEmailPreview(errorString(syncErr), 500)
		state := emailRetryStateForError(syncErr)
		if emailRetryStateIsPermanent(state) {
			metadata = applyEmailRetryFailure(metadata, syncErr, now, false)
			metadata[emailRetryErrorCodeKey] = standardIMAPConnectionErrorCode(syncErr)
			delete(metadata, standardIMAPRealtimeFailureCountKey)
			stopped = true
			return metadata
		}

		failureCount := 0
		if !resetCount {
			failureCount, _ = strconv.Atoi(strings.TrimSpace(metadata[standardIMAPRealtimeFailureCountKey]))
		}
		failureCount++
		metadata[standardIMAPRealtimeFailureCountKey] = strconv.Itoa(failureCount)
		metadata[emailRetryFailureCountKey] = strconv.Itoa(failureCount)
		metadata[emailRetryErrorCodeKey] = standardIMAPConnectionErrorCode(syncErr)
		if standardIMAPConnectionErrorNeedsManualRecovery(syncErr) || failureCount > len(standardIMAPRealtimeRetryDelays) {
			transitionedToManual = metadata[emailRetryStateKey] != emailRetryStateManualRecoveryRequired
			metadata[emailRetryStateKey] = emailRetryStateManualRecoveryRequired
			metadata[emailRetryPausedAtKey] = now.Format(time.RFC3339Nano)
			delete(metadata, emailRetryNextAtKey)
			stopped = true
			return metadata
		}

		retryDelay = standardIMAPRealtimeRetryDelays[failureCount-1]
		metadata[emailRetryStateKey] = emailRetryStateWaiting
		metadata[emailRetryNextAtKey] = now.Add(retryDelay).Format(time.RFC3339Nano)
		delete(metadata, emailRetryPausedAtKey)
		return metadata
	})
	if err != nil {
		return 0, true, err
	}
	if source.Metadata[emailRetryStateKey] != updated.Metadata[emailRetryStateKey] || source.Metadata[emailRetryNextAtKey] != updated.Metadata[emailRetryNextAtKey] || source.Metadata["email_last_error"] != updated.Metadata["email_last_error"] {
		s.broadcast(Event{Type: "shop_source.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: now})
	}
	if transitionedToManual {
		s.recordEmailRuntimeEvent(ctx, EmailRuntimeEvent{
			Category: "imap.connection.paused", Severity: "warning", ShopID: updated.ShopID, SourceID: updated.ID,
			EntityID: updated.ID, Message: "标准邮箱连接连续失败，已停止自动重连并等待人工检测",
		})
	}
	return retryDelay, stopped, nil
}

func (s *Server) runStandardIMAPRealtimeSession(ctx context.Context, source ShopSource, client standardIMAPRealtimeClient) error {
	if err := s.syncStandardIMAPRealtimeConnection(ctx, source, client); err != nil {
		return err
	}
	for {
		if err := client.WaitForMailboxUpdate(ctx); err != nil {
			return fmt.Errorf("mailbox event wait failed: %w", err)
		}
		if err := s.syncStandardIMAPRealtimeConnection(ctx, source, client); err != nil {
			return err
		}
	}
}

func (s *Server) syncStandardIMAPRealtimeConnection(ctx context.Context, source ShopSource, client standardIMAPMailboxClient) error {
	lock := s.emailSourceSyncLock(source.ID)
	lock.Lock()
	defer lock.Unlock()

	syncCtx, cancel := context.WithTimeout(ctx, emailSourceSyncTimeout)
	defer cancel()
	latest, err := s.store.GetShopSource(syncCtx, source.ShopID, source.ID)
	if err != nil || !isActiveStandardIMAPSource(latest) || !emailSourceAutomaticSyncDue(latest, time.Now().UTC()) {
		return errStandardIMAPRealtimeSourceInactive
	}
	batch, err := fetchStandardIMAPBatchWithClient(client, sourceEmailAddress(latest), latest)
	if err != nil {
		_ = s.updateEmailSourceSyncState(syncCtx, latest, false, err)
		return fmt.Errorf("incremental sync failed: %w", err)
	}
	result := s.ingestEmailSyncBatch(syncCtx, latest.ShopID, latest, batch, emailSyncResult{
		Provider:       standardMailProvider,
		SourcesScanned: 1,
	})
	if result.SourcesFailed > 0 {
		return errors.New(strings.Join(result.Warnings, "; "))
	}
	return nil
}

func standardIMAPRealtimeJitter(sourceID string, maximum time.Duration) time.Duration {
	if maximum < time.Millisecond {
		return 0
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(sourceID))
	return time.Duration(hash.Sum32()%uint32(maximum/time.Millisecond)) * time.Millisecond
}

func waitStandardIMAPRealtime(ctx context.Context, duration time.Duration) bool {
	if duration <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
