package main

import (
	"context"
	"encoding/base64"
	"errors"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	shopifyadmin "shopify-support-platform/internal/connectors/shopify/adminapi"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8790", "Shopify connector HTTP listen address")
	flag.Parse()

	config, repository, err := runtimeFromEnvironment()
	if err != nil {
		log.Fatalf("configure Shopify connector runtime failed: %v", err)
	}
	effects, err := revocationEffectsFromEnvironment(config.ServiceToken)
	if err != nil {
		log.Fatalf("configure Shopify connector revocation effects failed: %v", err)
	}
	exchanger := shopifyinstallations.NewShopifyOAuthExchanger(config.AppAPIKey, config.AppSecret, nil)
	catalogs, err := catalogProviderFromEnvironment()
	if err != nil {
		log.Fatalf("configure Shopify connector catalog providers failed: %v", err)
	}
	lifecycle := shopifyinstallations.NewServiceWithProviders(
		repository, config.Scopes, effects, exchanger,
		catalogs, catalogs, catalogs, catalogs, catalogs, catalogs, catalogs, catalogs, catalogs,
	)
	chatWidgetConfigurer, err := shopifyadmin.NewChatWidgetAppDataConfigurer(
		catalogs,
		strings.TrimSpace(os.Getenv("SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN")),
		strings.TrimSpace(os.Getenv("SHOPIFY_CHAT_WIDGET_SERVICE_ORIGIN_OVERRIDES")),
	)
	if err != nil {
		log.Fatalf("configure Shopify storefront support app data failed: %v", err)
	}
	if err := lifecycle.ConfigureInstallationAppData(chatWidgetConfigurer); err != nil {
		log.Fatalf("configure Shopify installation app data failed: %v", err)
	}
	if err := lifecycle.ConfigureInstallationUninstaller(catalogs); err != nil {
		log.Fatalf("configure Shopify installation uninstaller failed: %v", err)
	}
	if err := lifecycle.ConfigureInstallationChecker(catalogs); err != nil {
		log.Fatal("configure Shopify installation checker failed")
	}
	keyVersion := strings.TrimSpace(os.Getenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY_VERSION"))
	if err := lifecycle.RequireExpiringOfflineTokens(exchanger, keyVersion, 5*time.Minute); err != nil {
		log.Fatalf("configure Shopify expiring offline tokens failed: %v", err)
	}
	handler, err := shopifyinstallations.NewHandler(config, lifecycle, repository)
	if err != nil {
		log.Fatalf("configure Shopify connector HTTP handler failed: %v", err)
	}
	if _, err := repository.PrunePendingInstallations(context.Background(), time.Now().UTC()); err != nil {
		log.Fatal("expired pending Shopify authorization cleanup failed before startup")
	}
	maintenanceContext, stopMaintenance := context.WithCancel(context.Background())
	defer stopMaintenance()
	maintenanceTicker := time.NewTicker(time.Minute)
	defer maintenanceTicker.Stop()
	go runPendingInstallationCleanup(maintenanceContext, repository, maintenanceTicker.C)
	server := &http.Server{
		Addr: *addr, Handler: handler, ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout: 30 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second,
	}

	go func() {
		log.Printf("Shopify connector runtime listening on http://%s", *addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Shopify connector runtime failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	stopMaintenance()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Shopify connector shutdown failed: %v", err)
	}
}

func runPendingInstallationCleanup(ctx context.Context, repository shopifyinstallations.Repository, ticks <-chan time.Time) {
	for {
		select {
		case <-ctx.Done():
			return
		case now, open := <-ticks:
			if !open {
				return
			}
			if _, err := repository.PrunePendingInstallations(ctx, now.UTC()); err != nil && ctx.Err() == nil {
				// Never log provider credentials or encrypted-store error details.
				log.Print("expired pending Shopify authorization cleanup failed; retrying on next maintenance tick")
			}
		}
	}
}

func revocationEffectsFromEnvironment(serviceToken string) (shopifyinstallations.RevocationEffects, error) {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE"))) {
	case "connector-only":
		return shopifyinstallations.NewConnectorOnlyRevocationEffects(), nil
	case "customer-service":
		return shopifyinstallations.NewHTTPRevocationEffects(
			os.Getenv("XZ_CUSTOMER_SERVICE_INTERNAL_BASE_URL"), serviceToken, nil)
	default:
		return nil, errors.New("SHOPIFY_CONNECTOR_REVOCATION_EFFECTS_MODE must be connector-only or customer-service")
	}
}

func catalogProviderFromEnvironment() (*shopifyadmin.Client, error) {
	return shopifyadmin.NewClient(
		strings.TrimSpace(os.Getenv("SHOPIFY_APP_API_VERSION")),
		&http.Client{Timeout: 20 * time.Second},
	)
}

func runtimeFromEnvironment() (shopifyinstallations.RuntimeConfig, shopifyinstallations.Repository, error) {
	serviceToken := firstEnvironment("XZ_ERP_CONNECTOR_TOKEN", "ERP_XZ_ERP_APP_CONNECTOR_TOKEN")
	apiKey := firstEnvironment("SHOPIFY_APP_API_KEY", "SHOPIFY_API_KEY")
	appSecret := firstEnvironment("SHOPIFY_APP_API_SECRET", "SHOPIFY_API_SECRET")
	scopes := splitScopes(firstEnvironment("SHOPIFY_APP_SCOPES", "SHOPIFY_SCOPES"))
	callbackURL := strings.TrimSpace(os.Getenv("SHOPIFY_CONNECTOR_CALLBACK_URL"))
	dataFile := strings.TrimSpace(os.Getenv("SHOPIFY_CONNECTOR_DATA_FILE"))
	key, err := decodeEncryptionKey(os.Getenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY"))
	if err != nil {
		return shopifyinstallations.RuntimeConfig{}, nil, err
	}
	if serviceToken == "" || apiKey == "" || appSecret == "" || len(scopes) == 0 || callbackURL == "" || dataFile == "" {
		return shopifyinstallations.RuntimeConfig{}, nil,
			errors.New("required connector service token, Shopify app, scopes, callback URL, or data file is not configured")
	}
	repository, err := shopifyinstallations.OpenFileRepository(dataFile, key)
	if err != nil {
		return shopifyinstallations.RuntimeConfig{}, nil, err
	}
	return shopifyinstallations.RuntimeConfig{
		ServiceToken: serviceToken, AppAPIKey: apiKey, AppSecret: appSecret,
		Scopes: scopes, CallbackURL: callbackURL, StateTTL: 15 * time.Minute,
		PublicLegalName:         strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_LEGAL_NAME")),
		PublicCompanyWebsite:    strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_COMPANY_WEBSITE")),
		PublicSupportEmail:      strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_SUPPORT_EMAIL")),
		PublicPrivacyEmail:      strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_PRIVACY_EMAIL")),
		PublicEffectiveDate:     strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_EFFECTIVE_DATE")),
		PublicBusinessAddress:   strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_BUSINESS_ADDRESS")),
		PublicProcessingRegions: strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_PROCESSING_REGIONS")),
		PublicSubprocessors:     strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_SUBPROCESSORS")),
		PublicTransferMechanism: strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_TRANSFER_MECHANISM")),
		PublicOrderRetention:    strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_ORDER_RETENTION")),
		PublicBackupRetention:   strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_BACKUP_RETENTION")),
		PublicDeletionProcess:   strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_DELETION_PROCESS")),
		PublicPrivacyOfficer:    strings.TrimSpace(os.Getenv("SHOPIFY_PUBLIC_PRIVACY_OFFICER")),
	}, repository, nil
}

func decodeEncryptionKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding,
	} {
		if decoded, err := encoding.DecodeString(value); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	return nil, errors.New("SHOPIFY_CONNECTOR_ENCRYPTION_KEY must be a base64-encoded 32-byte key")
}

func firstEnvironment(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func splitScopes(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t' || r == '\r'
	})
}
