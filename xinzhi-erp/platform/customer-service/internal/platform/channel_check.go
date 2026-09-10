package platform

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type emailChannelCheckResult struct {
	Provider       string `json:"provider"`
	SourcesChecked int    `json:"sourcesChecked"`
	SourcesHealthy int    `json:"sourcesHealthy"`
	SourcesFailed  int    `json:"sourcesFailed"`
	Error          string `json:"error,omitempty"`
}

type shopChannelCheckResult struct {
	CheckedAt    time.Time                 `json:"checkedAt"`
	Healthy      bool                      `json:"healthy"`
	HasChannels  bool                      `json:"hasChannels"`
	Shopify      *ShopifyConnectionStatus  `json:"shopify,omitempty"`
	ShopifyError string                    `json:"shopifyError,omitempty"`
	Email        []emailChannelCheckResult `json:"email"`
	Sources      []ShopSource              `json:"sources"`
}

func (s *Server) checkShopChannels(ctx context.Context, shopID string) (shopChannelCheckResult, error) {
	return s.checkShopChannelsWithEmail(ctx, shopID, true)
}

func (s *Server) checkShopChannelsWithEmail(ctx context.Context, shopID string, includeEmail bool) (shopChannelCheckResult, error) {
	shop, err := s.store.GetShop(ctx, strings.TrimSpace(shopID))
	if err != nil {
		return shopChannelCheckResult{}, err
	}
	sources, err := s.store.ListShopSources(ctx, shop.ID)
	if err != nil {
		return shopChannelCheckResult{}, err
	}
	result := shopChannelCheckResult{
		CheckedAt: time.Now().UTC(),
		Healthy:   true,
		Email:     []emailChannelCheckResult{},
		Sources:   sources,
	}

	hasShopify := shopifyDomainForShop(shop, sources) != ""
	providers := []string{}
	if includeEmail {
		providers = checkableEmailProviders(sources)
	}
	result.HasChannels = hasShopify || len(providers) > 0
	if !result.HasChannels {
		result.Healthy = false
		return result, nil
	}

	if hasShopify {
		status, statusErr := s.refreshShopifyConnectionStatus(ctx, shop.ID)
		if statusErr != nil {
			result.Healthy = false
			result.ShopifyError = statusErr.Error()
		} else {
			result.Shopify = &status
			shopifyHealthy := status.State == "installed"
			if isERPManagedShopifySource(sources) {
				shopifyHealthy = shopifyHealthy && shopifyChatWidgetRecentlyLoaded(sources, result.CheckedAt)
			} else {
				shopifyHealthy = shopifyHealthy && status.AppDeployStatus == ShopifyAppDeployReady && status.ThemeEmbedState == shopifyThemeEmbedEnabled
			}
			if !shopifyHealthy {
				result.Healthy = false
			}
		}
	}

	for _, provider := range providers {
		item := emailChannelCheckResult{Provider: provider}
		for _, source := range sources {
			if source.Type != SourceTypeEmail || source.Status != SourceStatusActive ||
				!strings.EqualFold(strings.TrimSpace(source.Provider), provider) {
				continue
			}
			item.SourcesChecked++
			lock := s.emailSourceSyncLock(source.ID)
			lock.Lock()
			sourceCtx, cancel := context.WithTimeout(ctx, emailSourceSyncTimeout)
			latest, latestErr := s.store.GetShopSource(sourceCtx, source.ShopID, source.ID)
			if latestErr == nil {
				latestErr = s.checkEmailSourceHealth(sourceCtx, latest, false)
			}
			cancel()
			lock.Unlock()
			if latestErr != nil {
				item.SourcesFailed++
				if item.Error != "" {
					item.Error += "; "
				}
				item.Error += source.Address + ": " + latestErr.Error()
				continue
			}
			item.SourcesHealthy++
		}
		if item.SourcesFailed > 0 || item.SourcesHealthy != item.SourcesChecked {
			result.Healthy = false
		}
		result.Email = append(result.Email, item)
	}
	updatedSources, listErr := s.store.ListShopSources(ctx, shop.ID)
	if listErr == nil {
		result.Sources = updatedSources
	}
	return result, nil
}

func shopifyChatWidgetRecentlyLoaded(sources []ShopSource, now time.Time) bool {
	for _, source := range sources {
		if source.Type != SourceTypeShopifyChat || source.Status != SourceStatusActive {
			continue
		}
		lastSeenAt, err := time.Parse(time.RFC3339, strings.TrimSpace(source.Metadata["widgetLastSeenAt"]))
		if err == nil && now.Sub(lastSeenAt) <= 30*time.Minute {
			return true
		}
	}
	return false
}

func (s *Server) checkEmailSourceHealth(ctx context.Context, source ShopSource, forceNotificationRenewal bool) error {
	provider := strings.ToLower(strings.TrimSpace(source.Provider))
	var checkErr error
	switch provider {
	case "gmail":
		if !defaultGmailPushSettings().configured() {
			checkErr = errors.New("Gmail push notification is not configured")
			break
		}
	case "outlook":
		if !defaultOutlookPushSettings().configured() {
			checkErr = errors.New("Outlook push notification is not configured")
			break
		}
	case cuiqiuProvider:
		// Cuiqiu accepts an optional per-domain webhook and always has hourly API reconciliation.
	case standardMailProvider:
		// Standard IMAP mailboxes are reconciled by the built-in five-minute poller.
	default:
		checkErr = fmt.Errorf("%w: unsupported email provider %q", ErrInvalid, provider)
	}
	installation := EmailInstallation{}
	if checkErr == nil {
		installation, checkErr = s.store.GetEmailInstallation(ctx, source.ShopID, source.Address)
	}
	if checkErr == nil {
		installation.Provider = provider
		installation, checkErr = s.emailInstallationWithFreshToken(ctx, installation)
	}
	if checkErr == nil {
		switch provider {
		case "gmail":
			checkErr = validateGmailGrantedScopes(installation.Scope)
		case "outlook":
			checkErr = validateOutlookGrantedScopes(installation.Scope)
		case cuiqiuProvider:
			_, checkErr = cuiqiuConfigFrom(source, installation)
		case standardMailProvider:
			_, checkErr = standardMailConfigFrom(source, installation)
		}
	}
	if checkErr == nil {
		var mailbox string
		switch provider {
		case "gmail":
			var profile gmailProfileResponse
			checkErr = getProviderJSON(ctx, installation.AccessToken, gmailAPIBase()+"/users/me/profile", &profile)
			mailbox = normalizeEmail(profile.EmailAddress)
		case "outlook":
			var profile outlookMeResponse
			checkErr = getProviderJSON(ctx, installation.AccessToken, outlookGraphBase()+"/me?$select=mail,userPrincipalName", &profile)
			mailbox = normalizeEmail(firstNonEmpty(profile.Mail, profile.UserPrincipalName))
		case cuiqiuProvider:
			var config cuiqiuConfig
			config, checkErr = cuiqiuConfigFrom(source, installation)
			if checkErr == nil {
				now := time.Now().UTC()
				_, checkErr = fetchCuiqiuMessageList(ctx, config, "Inbox", now.AddDate(0, 0, -1).Format("2006-01-02"), now.AddDate(0, 0, 1).Format("2006-01-02"), 1, 1)
				mailbox = config.Mailbox
			}
			if checkErr == nil {
				checkErr = verifyCuiqiuSMTPConnection(config)
			}
		case standardMailProvider:
			var config standardMailConfig
			config, checkErr = standardMailConfigFrom(source, installation)
			if checkErr == nil {
				_, checkErr = verifyStandardIMAPConnection(ctx, config)
				mailbox = config.Mailbox
			}
			if checkErr == nil {
				checkErr = verifyStandardSMTPConnection(ctx, config)
			}
		}
		if checkErr == nil && (mailbox == "" || mailbox != normalizeEmail(source.Address)) {
			checkErr = errors.New("authorized mailbox does not match the configured channel")
		}
	}
	if checkErr == nil && provider != cuiqiuProvider && provider != standardMailProvider {
		checkErr = s.ensureEmailSourceNotification(ctx, source, forceNotificationRenewal)
	}
	if stateErr := s.updateEmailHealthState(ctx, source, checkErr); stateErr != nil {
		if checkErr != nil {
			return fmt.Errorf("%v; save health state: %w", checkErr, stateErr)
		}
		return stateErr
	}
	return checkErr
}

func (s *Server) updateEmailHealthState(ctx context.Context, source ShopSource, healthErr error) error {
	now := time.Now().UTC()
	updated, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata[emailHealthCheckedAtKey] = now.Format(time.RFC3339Nano)
		if healthErr == nil {
			metadata[emailHealthStatusKey] = "ok"
			delete(metadata, emailHealthErrorKey)
		} else {
			metadata[emailHealthStatusKey] = "error"
			metadata[emailHealthErrorKey] = truncateEmailPreview(healthErr.Error(), 500)
			metadata = applyEmailRetryFailure(metadata, healthErr, now, true)
		}
		return metadata
	})
	if err == nil && (source.Metadata[emailHealthStatusKey] != updated.Metadata[emailHealthStatusKey] ||
		source.Metadata[emailHealthErrorKey] != updated.Metadata[emailHealthErrorKey] ||
		source.Metadata[emailRetryStateKey] != updated.Metadata[emailRetryStateKey]) {
		s.broadcast(Event{
			Type:      "shop_source.updated",
			ShopID:    updated.ShopID,
			EntityID:  updated.ID,
			Payload:   updated,
			CreatedAt: time.Now().UTC(),
		})
	}
	return err
}

func checkableEmailProviders(sources []ShopSource) []string {
	seen := map[string]bool{}
	for _, source := range sources {
		provider := strings.ToLower(strings.TrimSpace(source.Provider))
		if source.Type == SourceTypeEmail && source.Status == SourceStatusActive && (provider == "gmail" || provider == "outlook" || provider == cuiqiuProvider || provider == standardMailProvider) {
			seen[provider] = true
		}
	}
	out := make([]string, 0, len(seen))
	for provider := range seen {
		out = append(out, provider)
	}
	sort.Strings(out)
	return out
}

func shanghaiLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err == nil {
		return location
	}
	return time.FixedZone("Asia/Shanghai", 8*60*60)
}
