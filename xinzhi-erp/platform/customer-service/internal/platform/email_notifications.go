package platform

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	gmailPushPath                              = "/webhooks/email/gmail"
	outlookPushPath                            = "/webhooks/email/outlook"
	gmailWatchExpirationKey                    = "gmail_watch_expiration_at"
	gmailWatchRenewedAtKey                     = "gmail_watch_renewed_at"
	gmailWatchScopeKey                         = "gmail_watch_scope"
	gmailPushReceivedAtKey                     = "gmail_push_received_at"
	outlookSubscriptionIDKey                   = "outlook_subscription_id"
	outlookSubscriptionExpirationKey           = "outlook_subscription_expiration_at"
	outlookSubscriptionRenewedAtKey            = "outlook_subscription_renewed_at"
	outlookSubscriptionStateFingerprintKey     = "outlook_subscription_state_fingerprint"
	outlookJunkSubscriptionIDKey               = "outlook_junk_subscription_id"
	outlookJunkSubscriptionExpirationKey       = "outlook_junk_subscription_expiration_at"
	outlookJunkSubscriptionRenewedAtKey        = "outlook_junk_subscription_renewed_at"
	outlookJunkSubscriptionStateFingerprintKey = "outlook_junk_subscription_state_fingerprint"
	outlookPushReceivedAtKey                   = "outlook_push_received_at"
	emailNotificationStatusKey                 = "email_notification_status"
	emailNotificationErrorKey                  = "email_notification_error"
	emailNotificationCheckedAtKey              = "email_notification_checked_at"
	emailHealthStatusKey                       = "email_health_status"
	emailHealthErrorKey                        = "email_health_error"
	emailHealthCheckedAtKey                    = "email_health_checked_at"
)

const (
	emailNotificationMaintenanceInterval = 24 * time.Hour
	emailNotificationStartupDelay        = 45 * time.Second
	emailNotificationWorkerCount         = 4
	gmailWatchRenewalInterval            = 24 * time.Hour
	outlookSubscriptionRenewBefore       = 48 * time.Hour
	outlookSubscriptionLifetime          = 6 * 24 * time.Hour
	emailMailboxScopeMigrationTimeout    = 5 * time.Minute
)

type gmailPushSettings struct {
	Topic               string
	Audience            string
	ServiceAccountEmail string
	TokenInfoURL        string
}

type outlookPushSettings struct {
	NotificationURL string
	Secret          string
}

type gmailPubSubEnvelope struct {
	Message struct {
		Data      string `json:"data"`
		MessageID string `json:"messageId"`
	} `json:"message"`
	Subscription string `json:"subscription"`
}

type gmailPushData struct {
	EmailAddress string `json:"emailAddress"`
	HistoryID    string `json:"historyId"`
}

func (data *gmailPushData) UnmarshalJSON(raw []byte) error {
	var payload struct {
		EmailAddress string          `json:"emailAddress"`
		HistoryID    json.RawMessage `json:"historyId"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return err
	}

	historyRaw := strings.TrimSpace(string(payload.HistoryID))
	var historyID string
	switch {
	case historyRaw == "" || historyRaw == "null":
	case strings.HasPrefix(historyRaw, `"`):
		if err := json.Unmarshal(payload.HistoryID, &historyID); err != nil {
			return err
		}
	default:
		for _, char := range historyRaw {
			if char < '0' || char > '9' {
				return errors.New("Gmail historyId must be a string or integer")
			}
		}
		historyID = historyRaw
	}

	data.EmailAddress = payload.EmailAddress
	data.HistoryID = historyID
	return nil
}

type gmailWatchResponse struct {
	HistoryID  string          `json:"historyId"`
	Expiration json.RawMessage `json:"expiration"`
}

type outlookSubscriptionResponse struct {
	ID                 string `json:"id"`
	ExpirationDateTime string `json:"expirationDateTime"`
}

type outlookNotificationEnvelope struct {
	Value []outlookNotification `json:"value"`
}

type outlookNotification struct {
	SubscriptionID string `json:"subscriptionId"`
	ClientState    string `json:"clientState"`
	ChangeType     string `json:"changeType"`
	Resource       string `json:"resource"`
	LifecycleEvent string `json:"lifecycleEvent"`
}

func defaultGmailPushSettings() gmailPushSettings {
	baseURL := strings.TrimRight(firstNonEmptyEnv("GMAIL_PUBSUB_BASE_URL", "GMAIL_BASE_URL", "PUBLIC_BASE_URL"), "/")
	audience := firstNonEmptyEnv("GMAIL_PUBSUB_AUDIENCE")
	if audience == "" && baseURL != "" {
		audience = baseURL + gmailPushPath
	}
	tokenInfoURL := firstNonEmptyEnv("GMAIL_PUBSUB_TOKENINFO_URL")
	if tokenInfoURL == "" {
		tokenInfoURL = "https://oauth2.googleapis.com/tokeninfo"
	}
	return gmailPushSettings{
		Topic:               firstNonEmptyEnv("GMAIL_PUBSUB_TOPIC"),
		Audience:            audience,
		ServiceAccountEmail: normalizeEmail(firstNonEmptyEnv("GMAIL_PUBSUB_SERVICE_ACCOUNT_EMAIL")),
		TokenInfoURL:        tokenInfoURL,
	}
}

func (cfg gmailPushSettings) configured() bool {
	return cfg.Topic != "" && cfg.Audience != "" && cfg.ServiceAccountEmail != ""
}

func defaultOutlookPushSettings() outlookPushSettings {
	baseURL := strings.TrimRight(firstNonEmptyEnv("OUTLOOK_WEBHOOK_BASE_URL", "OUTLOOK_BASE_URL", "PUBLIC_BASE_URL"), "/")
	secret := firstNonEmptyEnv("OUTLOOK_WEBHOOK_SECRET", "OUTLOOK_CLIENT_SECRET", "MICROSOFT_CLIENT_SECRET")
	notificationURL := firstNonEmptyEnv("OUTLOOK_WEBHOOK_URL")
	if notificationURL == "" && baseURL != "" {
		notificationURL = baseURL + outlookPushPath
	}
	return outlookPushSettings{NotificationURL: notificationURL, Secret: strings.TrimSpace(secret)}
}

func (cfg outlookPushSettings) configured() bool {
	return cfg.NotificationURL != "" && cfg.Secret != ""
}

func (s *Server) StartEmailNotificationMaintenance(ctx context.Context) {
	s.enableEmailBackgroundSync()
	go func() {
		startupDelay := time.NewTimer(emailNotificationStartupDelay)
		select {
		case <-ctx.Done():
			if !startupDelay.Stop() {
				<-startupDelay.C
			}
			return
		case <-startupDelay.C:
		}
		s.maintainEmailNotifications(ctx, false)
		ticker := time.NewTicker(emailNotificationMaintenanceInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.maintainEmailNotifications(ctx, false)
			}
		}
	}()
}

func (s *Server) maintainEmailNotifications(ctx context.Context, force bool) {
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		log.Printf("email notifications: list sources failed: %v", err)
		return
	}
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		log.Printf("email notifications: list shops failed: %v", err)
		return
	}
	activeShops := make(map[string]bool, len(shops))
	for _, shop := range shops {
		activeShops[shop.ID] = shop.Status == ShopStatusActive
	}
	due := make([]ShopSource, 0)
	now := time.Now().UTC()
	for _, source := range sources {
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		if !activeShops[source.ShopID] || source.Type != SourceTypeEmail || source.Status != SourceStatusActive ||
			(provider != "gmail" && provider != "outlook") {
			continue
		}
		if !emailNotificationMaintenanceDue(source, force, now) {
			continue
		}
		due = append(due, source)
	}
	if len(due) == 0 {
		return
	}
	jobs := make(chan ShopSource)
	var workers sync.WaitGroup
	workerCount := emailNotificationWorkerCount
	if len(due) < workerCount {
		workerCount = len(due)
	}
	for worker := 0; worker < workerCount; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for source := range jobs {
				lock := s.emailSourceSyncLock(source.ID)
				lock.Lock()
				sourceCtx, cancel := context.WithTimeout(ctx, emailSourceSyncTimeout)
				latest, latestErr := s.store.GetShopSource(sourceCtx, source.ShopID, source.ID)
				if latestErr != nil || latest.Status != SourceStatusActive || !emailNotificationMaintenanceDue(latest, force, time.Now().UTC()) {
					cancel()
					lock.Unlock()
					continue
				}
				source = latest
				err := s.ensureEmailSourceNotification(sourceCtx, source, force)
				cancel()
				if err == nil && emailMailboxScopeMigrationDue(source) {
					migrationCtx, migrationCancel := context.WithTimeout(ctx, emailMailboxScopeMigrationTimeout)
					latest, latestErr := s.store.GetShopSource(migrationCtx, source.ShopID, source.ID)
					if latestErr != nil {
						err = fmt.Errorf("reload mailbox scope migration state: %w", latestErr)
					} else if emailMailboxScopeMigrationDue(latest) {
						result := s.syncSingleEmailSource(migrationCtx, latest.ShopID, strings.ToLower(strings.TrimSpace(latest.Provider)), latest)
						if result.SourcesFailed > 0 {
							err = fmt.Errorf("mailbox scope migration failed: %s", strings.Join(result.Warnings, "; "))
						}
					}
					migrationCancel()
				}
				lock.Unlock()
				if err != nil {
					log.Printf("email notifications: %s/%s renewal failed: %v", source.ShopID, source.ID, err)
				}
			}
		}()
	}
	for _, source := range due {
		select {
		case <-ctx.Done():
			close(jobs)
			workers.Wait()
			return
		case jobs <- source:
		}
	}
	close(jobs)
	workers.Wait()
}

func emailNotificationMaintenanceDue(source ShopSource, force bool, now time.Time) bool {
	if force {
		return true
	}
	if !emailSourceAutomaticSyncDue(source, now) {
		return false
	}
	if emailMailboxScopeMigrationDue(source) {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(source.Provider)) {
	case "gmail":
		cfg := defaultGmailPushSettings()
		return cfg.configured() && gmailWatchDue(source, now)
	case "outlook":
		cfg := defaultOutlookPushSettings()
		return cfg.configured() && outlookSubscriptionDue(source, cfg, now)
	default:
		return false
	}
}

func emailMailboxScopeMigrationDue(source ShopSource) bool {
	version := strings.TrimSpace(source.Metadata[emailSyncVersionKey])
	return version != "" && version != emailSyncVersionCurrent
}

func (s *Server) ensureEmailSourceNotification(ctx context.Context, source ShopSource, force bool) error {
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	switch provider {
	case "gmail":
		cfg := defaultGmailPushSettings()
		if !cfg.configured() {
			return nil
		}
		if !force && !gmailWatchDue(source, time.Now().UTC()) {
			return nil
		}
	case "outlook":
		cfg := defaultOutlookPushSettings()
		if !cfg.configured() {
			return nil
		}
		if !force && !outlookSubscriptionDue(source, cfg, time.Now().UTC()) {
			return nil
		}
	default:
		return nil
	}

	installation, err := s.store.GetEmailInstallation(ctx, source.ShopID, source.Address)
	if err == nil {
		installation.Provider = provider
		installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	}
	var updates map[string]string
	if err == nil {
		switch provider {
		case "gmail":
			updates, err = renewGmailWatch(ctx, installation.AccessToken, source, defaultGmailPushSettings())
		case "outlook":
			updates, err = renewOutlookSubscription(ctx, installation.AccessToken, source, defaultOutlookPushSettings())
		}
	}
	if stateErr := s.updateEmailNotificationState(ctx, source, err, updates); stateErr != nil {
		if err != nil {
			return fmt.Errorf("%v; save notification state: %w", err, stateErr)
		}
		return stateErr
	}
	return err
}

func gmailWatchDue(source ShopSource, now time.Time) bool {
	renewedAt, renewed := parseEmailSyncTime(source.Metadata[gmailWatchRenewedAtKey])
	expiresAt, expires := parseEmailSyncTime(source.Metadata[gmailWatchExpirationKey])
	return source.Metadata[gmailWatchScopeKey] != "inbox+spam-v1" ||
		!renewed || now.Sub(renewedAt) >= gmailWatchRenewalInterval || !expires || expiresAt.Before(now.Add(outlookSubscriptionRenewBefore))
}

func outlookSubscriptionDue(source ShopSource, cfg outlookPushSettings, now time.Time) bool {
	fingerprint := outlookClientStateFingerprint(cfg, source)
	for _, keys := range []outlookSubscriptionKeys{
		inboxOutlookSubscriptionKeys(),
		junkOutlookSubscriptionKeys(),
	} {
		if strings.TrimSpace(source.Metadata[keys.ID]) == "" ||
			source.Metadata[keys.Fingerprint] != fingerprint {
			return true
		}
		expiresAt, ok := parseEmailSyncTime(source.Metadata[keys.Expiration])
		if !ok || expiresAt.Before(now.Add(outlookSubscriptionRenewBefore)) {
			return true
		}
	}
	return false
}

func renewGmailWatch(ctx context.Context, accessToken string, _ ShopSource, cfg gmailPushSettings) (map[string]string, error) {
	body := map[string]any{
		"topicName":           cfg.Topic,
		"labelIds":            []string{"INBOX", "SPAM"},
		"labelFilterBehavior": "INCLUDE",
	}
	var response gmailWatchResponse
	if err := emailNotificationJSON(ctx, http.MethodPost, gmailAPIBase()+"/users/me/watch", accessToken, body, &response); err != nil {
		return nil, fmt.Errorf("Gmail watch renewal failed: %w", err)
	}
	expiration, err := parseUnixMillis(response.Expiration)
	if err != nil {
		return nil, fmt.Errorf("Gmail watch renewal returned invalid expiration: %w", err)
	}
	now := time.Now().UTC()
	updates := map[string]string{
		gmailWatchExpirationKey: expiration.Format(time.RFC3339Nano),
		gmailWatchRenewedAtKey:  now.Format(time.RFC3339Nano),
		gmailWatchScopeKey:      "inbox+spam-v1",
		"email_sync_interval":   "push+24h_reconcile",
	}
	return updates, nil
}

func renewOutlookSubscription(ctx context.Context, accessToken string, source ShopSource, cfg outlookPushSettings) (map[string]string, error) {
	inbox, err := renewOutlookFolderSubscription(ctx, accessToken, source, cfg, "inbox", inboxOutlookSubscriptionKeys())
	if err != nil {
		return nil, err
	}
	junk, err := renewOutlookFolderSubscription(ctx, accessToken, source, cfg, "junkemail", junkOutlookSubscriptionKeys())
	if err != nil {
		return inbox, err
	}
	return mergeStringMaps(inbox, junk), nil
}

type outlookSubscriptionKeys struct {
	ID          string
	Expiration  string
	RenewedAt   string
	Fingerprint string
}

func inboxOutlookSubscriptionKeys() outlookSubscriptionKeys {
	return outlookSubscriptionKeys{
		ID:          outlookSubscriptionIDKey,
		Expiration:  outlookSubscriptionExpirationKey,
		RenewedAt:   outlookSubscriptionRenewedAtKey,
		Fingerprint: outlookSubscriptionStateFingerprintKey,
	}
}

func junkOutlookSubscriptionKeys() outlookSubscriptionKeys {
	return outlookSubscriptionKeys{
		ID:          outlookJunkSubscriptionIDKey,
		Expiration:  outlookJunkSubscriptionExpirationKey,
		RenewedAt:   outlookJunkSubscriptionRenewedAtKey,
		Fingerprint: outlookJunkSubscriptionStateFingerprintKey,
	}
}

func renewOutlookFolderSubscription(ctx context.Context, accessToken string, source ShopSource, cfg outlookPushSettings, folderID string, keys outlookSubscriptionKeys) (map[string]string, error) {
	subscriptionID := strings.TrimSpace(source.Metadata[keys.ID])
	stateFingerprint := outlookClientStateFingerprint(cfg, source)
	if subscriptionID != "" && source.Metadata[keys.Fingerprint] != stateFingerprint {
		_ = deleteOutlookSubscription(ctx, accessToken, subscriptionID)
		subscriptionID = ""
	}
	expiration := time.Now().UTC().Add(outlookSubscriptionLifetime).Truncate(time.Second)
	var response outlookSubscriptionResponse
	var err error
	if subscriptionID != "" {
		err = emailNotificationJSON(ctx, http.MethodPatch, outlookGraphBase()+"/subscriptions/"+url.PathEscape(subscriptionID), accessToken,
			map[string]string{"expirationDateTime": expiration.Format(time.RFC3339)}, &response)
		if isEmailProviderHTTPStatus(err, http.StatusNotFound) || isEmailProviderHTTPStatus(err, http.StatusGone) {
			subscriptionID = ""
			err = nil
		}
	}
	if subscriptionID == "" && err == nil {
		err = emailNotificationJSON(ctx, http.MethodPost, outlookGraphBase()+"/subscriptions", accessToken, map[string]string{
			"changeType":               "created",
			"notificationUrl":          cfg.NotificationURL,
			"lifecycleNotificationUrl": cfg.NotificationURL,
			"resource":                 "/me/mailFolders('" + folderID + "')/messages",
			"expirationDateTime":       expiration.Format(time.RFC3339),
			"clientState":              outlookClientState(cfg, source),
		}, &response)
	}
	if err != nil {
		return nil, fmt.Errorf("Outlook subscription renewal failed: %w", err)
	}
	response.ID = firstNonEmpty(strings.TrimSpace(response.ID), subscriptionID)
	if response.ID == "" {
		return nil, fmt.Errorf("Outlook subscription renewal returned no subscription id")
	}
	if parsed, parseErr := time.Parse(time.RFC3339, strings.TrimSpace(response.ExpirationDateTime)); parseErr == nil {
		expiration = parsed.UTC()
	}
	now := time.Now().UTC()
	return map[string]string{
		keys.ID:               response.ID,
		keys.Expiration:       expiration.Format(time.RFC3339Nano),
		keys.RenewedAt:        now.Format(time.RFC3339Nano),
		keys.Fingerprint:      stateFingerprint,
		"email_sync_interval": "push+24h_reconcile",
	}, nil
}

func deleteOutlookSubscription(ctx context.Context, accessToken string, subscriptionID string) error {
	err := emailNotificationJSON(ctx, http.MethodDelete, outlookGraphBase()+"/subscriptions/"+url.PathEscape(subscriptionID), accessToken, nil, nil)
	if isEmailProviderHTTPStatus(err, http.StatusNotFound) || isEmailProviderHTTPStatus(err, http.StatusGone) {
		return nil
	}
	return err
}

func outlookClientState(cfg outlookPushSettings, source ShopSource) string {
	return hmacHex(cfg.Secret, "outlook-webhook|"+strings.TrimSpace(source.ID))
}

func outlookClientStateFingerprint(cfg outlookPushSettings, source ShopSource) string {
	sum := sha256.Sum256([]byte(outlookClientState(cfg, source) + "|lifecycle-inbox+junk-v1"))
	return hex.EncodeToString(sum[:8])
}

func (s *Server) updateEmailNotificationState(ctx context.Context, source ShopSource, notificationErr error, updates map[string]string) error {
	stateCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	updated, err := s.store.MutateShopSourceMetadata(stateCtx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata[emailNotificationCheckedAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
		metadata = mergeStringMaps(metadata, updates)
		if notificationErr != nil {
			metadata[emailNotificationStatusKey] = "error"
			metadata[emailNotificationErrorKey] = truncateEmailPreview(notificationErr.Error(), 500)
			return metadata
		}
		metadata[emailNotificationStatusKey] = "ok"
		delete(metadata, emailNotificationErrorKey)
		return metadata
	})
	if err == nil && (source.Metadata[emailNotificationStatusKey] != updated.Metadata[emailNotificationStatusKey] ||
		source.Metadata[emailNotificationErrorKey] != updated.Metadata[emailNotificationErrorKey]) {
		s.broadcast(Event{Type: "shop_source.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	}
	return err
}

func (s *Server) initializeEmailSourceAsync(source ShopSource) {
	if !s.emailBackgroundSyncEnabled() {
		return
	}
	go func() {
		lock := s.emailSourceSyncLock(source.ID)
		lock.Lock()
		defer lock.Unlock()

		ctx, cancel := context.WithTimeout(context.Background(), emailSourceSyncTimeout*2)
		defer cancel()
		latest, err := s.store.GetShopSource(ctx, source.ShopID, source.ID)
		if err != nil || latest.Status != SourceStatusActive {
			return
		}
		if err := s.initializeEmailSourceBaseline(ctx, latest); err != nil {
			_ = s.updateEmailHealthState(ctx, latest, err)
			log.Printf("email authorization: initialize %s failed: %v", latest.Address, err)
			return
		}
		if refreshed, getErr := s.store.GetShopSource(ctx, latest.ShopID, latest.ID); getErr == nil {
			latest = refreshed
		}
		if err := s.checkEmailSourceHealth(ctx, latest, true); err != nil {
			log.Printf("email authorization: health check for %s failed: %v", latest.Address, err)
		}
	}()
}

func (s *Server) initializeEmailSourceBaseline(ctx context.Context, source ShopSource) error {
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	cursorKey := gmailHistoryIDKey
	if provider == "outlook" {
		cursorKey = outlookDeltaLinkKey
	}
	if strings.TrimSpace(source.Metadata[cursorKey]) != "" {
		return nil
	}

	installation, err := s.store.GetEmailInstallation(ctx, source.ShopID, source.Address)
	if err != nil {
		return err
	}
	installation.Provider = provider
	installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		return err
	}

	startedAt := time.Now().UTC()
	updates := map[string]string{
		emailSyncVersionKey:     emailSyncVersionCurrent,
		emailSyncStartedAtKey:   startedAt.Format(time.RFC3339Nano),
		emailInitialImportKey:   emailInitialImportNow,
		emailLastReconcileAtKey: startedAt.Format(time.RFC3339Nano),
		"email_sync_mode":       "incremental",
	}
	switch provider {
	case "gmail":
		var profile gmailSyncProfile
		if err := getProviderJSON(ctx, installation.AccessToken, gmailAPIBase()+"/users/me/profile", &profile); err != nil {
			return fmt.Errorf("Gmail synchronization baseline failed: %w", err)
		}
		if strings.TrimSpace(profile.HistoryID) == "" {
			return errors.New("Gmail synchronization baseline failed: provider returned no historyId")
		}
		updates[gmailHistoryIDKey] = strings.TrimSpace(profile.HistoryID)
		updates[gmailSpamBootstrapAtKey] = startedAt.Format(time.RFC3339Nano)
	case "outlook":
		for _, folder := range []struct {
			ID        string
			CursorKey string
		}{
			{ID: "inbox", CursorKey: outlookDeltaLinkKey},
			{ID: "junkemail", CursorKey: outlookJunkDeltaLinkKey},
		} {
			values := url.Values{}
			values.Set("changeType", "created")
			values.Set("$filter", "receivedDateTime ge "+startedAt.Format(time.RFC3339))
			values.Set("$top", outlookMessagePageSize)
			values.Set("$select", outlookAnchorSelect)
			endpoint := outlookGraphBase() + "/me/mailFolders/" + url.PathEscape(folder.ID) + "/messages/delta?" + values.Encode()
			_, deltaLink, err := fetchOutlookDeltaAnchors(ctx, installation.AccessToken, endpoint)
			if err != nil {
				return fmt.Errorf("Outlook synchronization baseline failed for %s: %w", folder.ID, err)
			}
			updates[folder.CursorKey] = deltaLink
		}
	default:
		return fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}

	updated, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		return mergeStringMaps(metadata, updates)
	})
	if err == nil {
		s.broadcast(Event{Type: "shop_source.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	}
	return err
}

func (s *Server) enableEmailBackgroundSync() {
	s.emailPushMu.Lock()
	s.emailPushEnabled = true
	s.emailPushMu.Unlock()
}

func (s *Server) emailBackgroundSyncEnabled() bool {
	s.emailPushMu.Lock()
	defer s.emailPushMu.Unlock()
	return s.emailPushEnabled
}

func (s *Server) EnableEmailPushProcessing() {
	s.enableEmailBackgroundSync()
}

func (s *Server) scheduleEmailSourceSync(source ShopSource, reason string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.enqueueEmailSourceSync(ctx, source, reason, time.Now().UTC())
}

func (s *Server) refreshEmailSourceHealthAsync(source ShopSource, force bool, reason string) {
	if !s.emailBackgroundSyncEnabled() {
		return
	}
	go func() {
		lock := s.emailSourceSyncLock(source.ID)
		lock.Lock()
		defer lock.Unlock()
		ctx, cancel := context.WithTimeout(context.Background(), emailSourceSyncTimeout)
		defer cancel()
		latest, err := s.store.GetShopSource(ctx, source.ShopID, source.ID)
		if err != nil || latest.Status != SourceStatusActive || !emailSourceAutomaticSyncDue(latest, time.Now().UTC()) {
			return
		}
		if err := s.checkEmailSourceHealth(ctx, latest, force); err != nil {
			log.Printf("email %s: health check for %s failed: %v", reason, latest.Address, err)
		}
	}()
}

func (s *Server) handleGmailPush(w http.ResponseWriter, r *http.Request) {
	cfg := defaultGmailPushSettings()
	if !cfg.configured() {
		http.Error(w, "Gmail push is not configured", http.StatusServiceUnavailable)
		return
	}
	token := bearerToken(r)
	if token == "" {
		http.Error(w, "missing authorization", http.StatusUnauthorized)
		return
	}
	if err := s.verifyGmailPushToken(r.Context(), token, cfg); err != nil {
		http.Error(w, "invalid authorization", http.StatusUnauthorized)
		return
	}
	var envelope gmailPubSubEnvelope
	if err := decodeLimitedJSON(r.Body, &envelope); err != nil {
		http.Error(w, "invalid Pub/Sub payload", http.StatusBadRequest)
		return
	}
	data, err := decodeGmailPushData(envelope.Message.Data)
	if err != nil {
		http.Error(w, "invalid Gmail notification", http.StatusBadRequest)
		return
	}
	sources, err := s.findActiveEmailSources(r.Context(), "gmail", func(source ShopSource) bool {
		return normalizeEmail(source.Address) == normalizeEmail(data.EmailAddress)
	})
	if err != nil {
		http.Error(w, "email notification queue unavailable", http.StatusServiceUnavailable)
		return
	}
	queueFailed := false
	for _, source := range sources {
		updated, updateErr := s.store.MutateShopSourceMetadata(r.Context(), source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
			metadata[gmailPushReceivedAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
			metadata[emailNotificationStatusKey] = "ok"
			delete(metadata, emailNotificationErrorKey)
			return metadata
		})
		if updateErr == nil {
			source = updated
		}
		if updateErr != nil || s.scheduleEmailSourceSync(source, "Gmail push") != nil {
			queueFailed = true
		}
	}
	if queueFailed {
		http.Error(w, "email notification queue unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleOutlookPush(w http.ResponseWriter, r *http.Request) {
	if validationToken := r.URL.Query().Get("validationToken"); validationToken != "" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, validationToken)
		return
	}
	cfg := defaultOutlookPushSettings()
	if !cfg.configured() {
		http.Error(w, "Outlook push is not configured", http.StatusServiceUnavailable)
		return
	}
	var envelope outlookNotificationEnvelope
	if err := decodeLimitedJSON(r.Body, &envelope); err != nil {
		http.Error(w, "invalid Microsoft Graph payload", http.StatusBadRequest)
		return
	}
	queueFailed := false
	for _, notification := range envelope.Value {
		lifecycleEvent := strings.ToLower(strings.TrimSpace(notification.LifecycleEvent))
		isMessageCreated := strings.EqualFold(strings.TrimSpace(notification.ChangeType), "created")
		if notification.SubscriptionID == "" || (!isMessageCreated && lifecycleEvent == "") {
			continue
		}
		source, err := s.findActiveEmailSource(r.Context(), "outlook", func(source ShopSource) bool {
			return source.Metadata[outlookSubscriptionIDKey] == notification.SubscriptionID ||
				source.Metadata[outlookJunkSubscriptionIDKey] == notification.SubscriptionID
		})
		if err != nil {
			continue
		}
		expectedState := outlookClientState(cfg, source)
		if subtle.ConstantTimeCompare([]byte(expectedState), []byte(notification.ClientState)) != 1 {
			continue
		}
		updated, updateErr := s.store.MutateShopSourceMetadata(r.Context(), source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
			metadata[outlookPushReceivedAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
			metadata[emailNotificationStatusKey] = "ok"
			delete(metadata, emailNotificationErrorKey)
			if lifecycleEvent == "missed" {
				metadata["outlook_missed_notification_at"] = time.Now().UTC().Format(time.RFC3339Nano)
			}
			if lifecycleEvent == "subscriptionremoved" {
				keys := inboxOutlookSubscriptionKeys()
				if metadata[outlookJunkSubscriptionIDKey] == notification.SubscriptionID {
					keys = junkOutlookSubscriptionKeys()
				}
				delete(metadata, keys.ID)
				delete(metadata, keys.Expiration)
				delete(metadata, keys.RenewedAt)
				delete(metadata, keys.Fingerprint)
			}
			return metadata
		})
		if updateErr == nil {
			source = updated
		}
		if updateErr != nil {
			queueFailed = true
			continue
		}
		if isMessageCreated {
			queueFailed = s.scheduleEmailSourceSync(source, "Outlook push") != nil || queueFailed
		}
		if lifecycleEvent == "missed" {
			queueFailed = s.scheduleEmailSourceSync(source, "Outlook missed notification delta recovery") != nil || queueFailed
		}
		if lifecycleEvent == "reauthorizationrequired" || lifecycleEvent == "subscriptionremoved" {
			s.refreshEmailSourceHealthAsync(source, true, "Outlook lifecycle "+lifecycleEvent)
		}
	}
	if queueFailed {
		http.Error(w, "email notification queue unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

func (s *Server) findActiveEmailSource(ctx context.Context, provider string, matches func(ShopSource) bool) (ShopSource, error) {
	sources, err := s.findActiveEmailSources(ctx, provider, matches)
	if err != nil {
		return ShopSource{}, err
	}
	return sources[0], nil
}

func (s *Server) findActiveEmailSources(ctx context.Context, provider string, matches func(ShopSource) bool) ([]ShopSource, error) {
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		return nil, err
	}
	active := make([]ShopSource, 0, 1)
	for _, source := range sources {
		if source.Type == SourceTypeEmail && source.Status == SourceStatusActive &&
			strings.EqualFold(strings.TrimSpace(source.Provider), provider) && matches(source) {
			shop, shopErr := s.store.GetShop(ctx, source.ShopID)
			if shopErr != nil || shop.Status != ShopStatusActive {
				continue
			}
			active = append(active, source)
		}
	}
	if len(active) == 0 {
		return nil, ErrNotFound
	}
	return active, nil
}

func (s *Server) verifyGmailPushToken(ctx context.Context, token string, cfg gmailPushSettings) error {
	cacheKey := sha256.Sum256([]byte(token))
	key := hex.EncodeToString(cacheKey[:])
	now := time.Now().UTC()
	s.gmailPushAuthMu.Lock()
	expiresAt, cached := s.gmailPushAuthCache[key]
	if cached && now.Before(expiresAt) {
		s.gmailPushAuthMu.Unlock()
		return nil
	}
	delete(s.gmailPushAuthCache, key)
	s.gmailPushAuthMu.Unlock()

	endpoint, err := url.Parse(cfg.TokenInfoURL)
	if err != nil {
		return err
	}
	query := endpoint.Query()
	query.Set("id_token", token)
	endpoint.RawQuery = query.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint.String(), nil)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("Google token validation failed: %s", resp.Status)
	}
	var claims map[string]any
	if err := json.Unmarshal(body, &claims); err != nil {
		return err
	}
	if strings.TrimSpace(stringClaim(claims["aud"])) != cfg.Audience ||
		normalizeEmail(stringClaim(claims["email"])) != cfg.ServiceAccountEmail ||
		!boolClaim(claims["email_verified"]) {
		return errors.New("Google token claims do not match the configured Pub/Sub subscription")
	}
	issuer := strings.TrimSpace(stringClaim(claims["iss"]))
	if issuer != "accounts.google.com" && issuer != "https://accounts.google.com" {
		return errors.New("Google token issuer is invalid")
	}
	exp, err := int64Claim(claims["exp"])
	if err != nil || exp <= now.Unix() {
		return errors.New("Google token is expired")
	}
	cacheUntil := time.Unix(exp, 0).UTC()
	s.gmailPushAuthMu.Lock()
	s.gmailPushAuthCache[key] = cacheUntil
	s.gmailPushAuthMu.Unlock()
	return nil
}

func decodeGmailPushData(encoded string) (gmailPushData, error) {
	var raw []byte
	var err error
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		raw, err = encoding.DecodeString(strings.TrimSpace(encoded))
		if err == nil {
			break
		}
	}
	if err != nil {
		return gmailPushData{}, err
	}
	var data gmailPushData
	if err := json.Unmarshal(raw, &data); err != nil {
		return gmailPushData{}, err
	}
	data.EmailAddress = normalizeEmail(data.EmailAddress)
	data.HistoryID = strings.TrimSpace(data.HistoryID)
	if data.EmailAddress == "" || data.HistoryID == "" {
		return gmailPushData{}, errors.New("Gmail notification is missing emailAddress or historyId")
	}
	return data, nil
}

func emailNotificationJSON(ctx context.Context, method string, endpoint string, accessToken string, input any, output any) error {
	var body io.Reader
	if input != nil {
		encoded, err := json.Marshal(input)
		if err != nil {
			return err
		}
		body = strings.NewReader(string(encoded))
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	if input != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(responseBody), RetryAfter: resp.Header.Get("Retry-After")}
	}
	if output == nil || len(responseBody) == 0 {
		return nil
	}
	return json.Unmarshal(responseBody, output)
}

func decodeLimitedJSON(body io.Reader, output any) error {
	decoder := json.NewDecoder(io.LimitReader(body, 1<<20))
	decoder.UseNumber()
	return decoder.Decode(output)
}

func parseUnixMillis(raw json.RawMessage) (time.Time, error) {
	value := strings.Trim(strings.TrimSpace(string(raw)), `"`)
	millis, err := strconv.ParseInt(value, 10, 64)
	if err != nil || millis <= 0 {
		return time.Time{}, errors.New("invalid Unix millisecond timestamp")
	}
	return time.UnixMilli(millis).UTC(), nil
}

func stringClaim(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	default:
		return ""
	}
}

func boolClaim(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, _ := strconv.ParseBool(typed)
		return parsed
	default:
		return false
	}
}

func int64Claim(value any) (int64, error) {
	switch typed := value.(type) {
	case json.Number:
		return typed.Int64()
	case float64:
		return int64(typed), nil
	case string:
		return strconv.ParseInt(typed, 10, 64)
	default:
		return 0, errors.New("claim is not an integer")
	}
}
