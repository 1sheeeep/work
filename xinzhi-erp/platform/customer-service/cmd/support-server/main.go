package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"shopify-support-platform/internal/offlinehttp"
	"shopify-support-platform/internal/platform"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "HTTP listen address")
	flag.Parse()
	strictOffline := strictOfflineLocalEnabled()
	if strictOffline {
		configureStrictOfflineHTTP()
	}

	store, tenantStores, cleanup, err := openStore()
	if err != nil {
		log.Fatalf("open store failed: %v", err)
	}
	defer cleanup()

	platformServer := platform.NewServer(store)
	allowedOrigins := splitCSV(os.Getenv("XZDESK_ALLOWED_ORIGINS"))
	platformServer.ConfigureAllowedOrigins(allowedOrigins)
	verifier, err := platform.NewHTTPERPIdentityVerifier(
		os.Getenv("XZDESK_ERP_IAM_BASE_URL"),
		firstEnvironment("XZ_ERP_CONNECTOR_TOKEN", "ERP_XZ_ERP_APP_CONNECTOR_TOKEN"),
		os.Getenv("XZDESK_PUBLIC_ORIGIN"),
		&http.Client{Timeout: 4 * time.Second},
	)
	if err != nil {
		log.Fatalf("configure ERP shared identity failed: %v", err)
	}
	platformServer.ConfigureERPIdentity(verifier, false)
	tenantMux, err := platform.NewERPSharedIdentityMux(platformServer, verifier, tenantStores, allowedOrigins)
	if err != nil {
		log.Fatalf("configure ERP tenant runtime failed: %v", err)
	}
	var handler http.Handler = tenantMux
	backgroundContext, stopBackground := context.WithCancel(context.Background())
	defer stopBackground()
	startBackgroundRuntime(backgroundContext, strictOffline, func(ctx context.Context) {
		startServerBackground := func(serverCtx context.Context, server *platform.Server) {
			migrationContext, cancel := context.WithTimeout(serverCtx, 30*time.Second)
			if err := server.MigrateEmailInstallationCredentials(migrationContext); err != nil {
				log.Printf("email credential migration failed: %v", err)
			}
			cancel()
			server.EnableEmailPushProcessing()
			server.StartEmailSyncWorkers(serverCtx)
			server.StartEmailAttachmentArchives(serverCtx)
			server.StartEmailPolling(serverCtx, emailReconcileInterval())
			server.StartStandardIMAPRealtime(serverCtx)
			server.StartEmailNotificationMaintenance(serverCtx)
			server.StartEmailOutboxMaintenance(serverCtx)
			server.StartEmailHistoryImports(serverCtx)
			server.StartEmailStatisticsExports(serverCtx)
			server.StartEmailRuntimeEventMaintenance(serverCtx)
			server.StartMaintenance(serverCtx)
			server.StartConversationAutoClose(serverCtx)
			server.StartShopifyOrderSync(serverCtx)
		}
		if tenantMux != nil {
			tenantMux.ActivateTenantBackground(ctx, startServerBackground)
			return
		}
		startServerBackground(ctx, platformServer)
	})
	server := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		log.Printf("support platform server listening on http://%s", *addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	stopBackground()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("server shutdown failed: %v", err)
	}
}

func strictOfflineLocalEnabled() bool {
	return offlinehttp.Enabled()
}

func startBackgroundRuntime(ctx context.Context, strictOffline bool, start func(context.Context)) {
	if strictOffline {
		log.Print("strict offline local runtime: external provider background work is disabled")
		return
	}
	go manageBackgroundRole(ctx, backgroundRoleConfigFromEnv(), start)
}

func configureStrictOfflineHTTP() {
	base := http.DefaultTransport
	if transport, ok := http.DefaultTransport.(*http.Transport); ok {
		clone := transport.Clone()
		clone.Proxy = nil
		base = clone
	}
	guard := offlinehttp.Guard(base)
	http.DefaultTransport = guard
	http.DefaultClient.Transport = guard
}

func firstEnvironment(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func emailReconcileInterval() time.Duration {
	value := os.Getenv("EMAIL_RECONCILE_INTERVAL")
	if value == "" {
		return 24 * time.Hour
	}
	interval, err := time.ParseDuration(value)
	if err != nil {
		log.Printf("invalid email reconciliation interval %q; using 24h", value)
		return 24 * time.Hour
	}
	if interval < time.Hour {
		log.Printf("email reconciliation interval %q is below 1h; using 24h", value)
		return 24 * time.Hour
	}
	return interval
}

func openStore() (platform.Store, platform.ERPTenantStoreFactory, func(), error) {
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	production := strings.EqualFold(strings.TrimSpace(os.Getenv("XZDESK_ENVIRONMENT")), "production")
	if databaseURL == "" {
		if production {
			return nil, nil, nil, fmt.Errorf("production customer-service storage requires PostgreSQL")
		}
		dataFile := os.Getenv("DATA_FILE")
		if dataFile != "" {
			store, err := platform.OpenFileStore(dataFile)
			if err != nil {
				return nil, nil, nil, err
			}
			log.Printf("using file store: %s", dataFile)
			return store, platform.NewFileERPTenantStoreFactory(dataFile), func() {}, nil
		}
		log.Print("DATABASE_URL and DATA_FILE are not set; using in-memory store")
		return platform.NewMemoryStore(), platform.NewMemoryERPTenantStoreFactory(), func() {}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	store, err := platform.OpenPostgresStore(ctx, platform.PostgresStoreConfig{
		DatabaseURL:          databaseURL,
		MigrationDatabaseURL: os.Getenv("XZDESK_DATABASE_MIGRATION_URL"),
		Schema:               os.Getenv("XZDESK_DATABASE_SCHEMA"),
	})
	if err != nil {
		return nil, nil, nil, err
	}
	tenantStores, err := platform.NewPostgresERPTenantStoreFactory(store)
	if err != nil {
		_ = store.Close()
		return nil, nil, nil, err
	}
	log.Print("using PostgreSQL store")
	return store, tenantStores, func() { _ = store.Close() }, nil
}

func splitCSV(value string) []string {
	items := strings.Split(value, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item = strings.TrimSpace(item); item != "" {
			result = append(result, item)
		}
	}
	return result
}
