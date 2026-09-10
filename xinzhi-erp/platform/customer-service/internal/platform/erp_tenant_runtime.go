package platform

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const erpTenantHeader = "X-XZ-Tenant-ID"

type ERPTenantStoreFactory interface {
	StoreForTenant(context.Context, string) (ERPTenantBoundStore, error)
}

type existingERPTenantStoreFactory interface {
	ExistingStoreForTenant(context.Context, string) (ERPTenantBoundStore, error)
}

type MemoryERPTenantStoreFactory struct {
	mu     sync.Mutex
	stores map[string]ERPTenantBoundStore
}

func NewMemoryERPTenantStoreFactory() *MemoryERPTenantStoreFactory {
	return &MemoryERPTenantStoreFactory{
		stores: map[string]ERPTenantBoundStore{},
	}
}

func (f *MemoryERPTenantStoreFactory) StoreForTenant(
	ctx context.Context,
	tenantID string,
) (ERPTenantBoundStore, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if store := f.stores[tenantID]; store != nil {
		return store, nil
	}
	store := NewMemoryStore()
	if err := store.BindERPTenant(ctx, tenantID); err != nil {
		return nil, err
	}
	f.stores[tenantID] = store
	return store, nil
}

func (f *MemoryERPTenantStoreFactory) ExistingStoreForTenant(
	_ context.Context,
	tenantID string,
) (ERPTenantBoundStore, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	store := f.stores[tenantID]
	if store == nil {
		return nil, ErrNotFound
	}
	return store, nil
}

type FileERPTenantStoreFactory struct {
	root   string
	mu     sync.Mutex
	stores map[string]ERPTenantBoundStore
}

func NewFileERPTenantStoreFactory(dataFile string) *FileERPTenantStoreFactory {
	return &FileERPTenantStoreFactory{
		root:   filepath.Clean(strings.TrimSpace(dataFile)) + ".tenants",
		stores: map[string]ERPTenantBoundStore{},
	}
}

func (f *FileERPTenantStoreFactory) StoreForTenant(
	ctx context.Context,
	tenantID string,
) (ERPTenantBoundStore, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if store := f.stores[tenantID]; store != nil {
		return store, nil
	}
	path := f.tenantPath(tenantID)
	store, err := OpenFileStore(path)
	if err != nil {
		return nil, err
	}
	if err := store.BindERPTenant(ctx, tenantID); err != nil {
		return nil, err
	}
	f.stores[tenantID] = store
	return store, nil
}

func (f *FileERPTenantStoreFactory) ExistingStoreForTenant(
	ctx context.Context,
	tenantID string,
) (ERPTenantBoundStore, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	if store := f.stores[tenantID]; store != nil {
		f.mu.Unlock()
		return store, nil
	}
	path := f.tenantPath(tenantID)
	if _, err := os.Stat(path); err != nil {
		f.mu.Unlock()
		if os.IsNotExist(err) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	store, err := OpenFileStore(path)
	if err == nil {
		err = store.BindERPTenant(ctx, tenantID)
	}
	if err == nil {
		f.stores[tenantID] = store
	}
	f.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return store, nil
}

func (f *FileERPTenantStoreFactory) tenantPath(tenantID string) string {
	sum := sha256.Sum256([]byte(tenantID))
	return filepath.Join(f.root, hex.EncodeToString(sum[:])+".json")
}

type PostgresERPTenantStoreFactory struct {
	postgres *PostgresStore
	mu       sync.Mutex
	stores   map[string]ERPTenantBoundStore
}

func NewPostgresERPTenantStoreFactory(
	postgres *PostgresStore,
) (*PostgresERPTenantStoreFactory, error) {
	if postgres == nil || postgres.db == nil {
		return nil, ErrInvalid
	}
	return &PostgresERPTenantStoreFactory{
		postgres: postgres,
		stores:   map[string]ERPTenantBoundStore{},
	}, nil
}

func (f *PostgresERPTenantStoreFactory) StoreForTenant(
	ctx context.Context,
	tenantID string,
) (ERPTenantBoundStore, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if store := f.stores[tenantID]; store != nil {
		return store, nil
	}
	store, err := openTenantSnapshotStore(&postgresTenantSnapshotBackend{
		postgres: f.postgres,
		tenantID: tenantID,
	})
	if err != nil {
		return nil, err
	}
	if err := store.BindERPTenant(ctx, tenantID); err != nil {
		return nil, err
	}
	f.stores[tenantID] = store
	return store, nil
}

func (f *PostgresERPTenantStoreFactory) ExistingStoreForTenant(
	ctx context.Context,
	tenantID string,
) (ERPTenantBoundStore, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	f.mu.Lock()
	if store := f.stores[tenantID]; store != nil {
		f.mu.Unlock()
		return store, nil
	}
	var exists bool
	err = f.postgres.db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM erp_tenant_stores WHERE tenant_id = $1
		)
	`, tenantID).Scan(&exists)
	if err != nil || !exists {
		f.mu.Unlock()
		if err != nil {
			return nil, err
		}
		return nil, ErrNotFound
	}
	store, err := openTenantSnapshotStore(&postgresTenantSnapshotBackend{
		postgres: f.postgres,
		tenantID: tenantID,
	})
	if err == nil {
		err = store.BindERPTenant(ctx, tenantID)
	}
	if err == nil {
		f.stores[tenantID] = store
	}
	f.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return store, nil
}

type postgresTenantSnapshotBackend struct {
	postgres *PostgresStore
	tenantID string
}

func (b *postgresTenantSnapshotBackend) Load(ctx context.Context) ([]byte, int64, error) {
	var raw []byte
	var revision int64
	err := b.postgres.db.QueryRowContext(ctx, `
		SELECT snapshot, revision
		FROM erp_tenant_stores
		WHERE tenant_id = $1
	`, b.tenantID).Scan(&raw, &revision)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, nil
	}
	if err != nil {
		return nil, 0, err
	}
	return raw, revision, nil
}

func (b *postgresTenantSnapshotBackend) Save(
	ctx context.Context,
	raw []byte,
	expectedRevision int64,
) (int64, error) {
	if !json.Valid(raw) {
		return expectedRevision, fmt.Errorf("%w: invalid tenant store snapshot", ErrInvalid)
	}
	var nextRevision int64
	err := b.postgres.db.QueryRowContext(ctx, `
		INSERT INTO erp_tenant_stores (
			tenant_id, snapshot, revision, created_at, updated_at
		)
		VALUES ($1, $2, 1, NOW(), NOW())
		ON CONFLICT (tenant_id) DO UPDATE SET
			snapshot = EXCLUDED.snapshot,
			revision = erp_tenant_stores.revision + 1,
			updated_at = NOW()
		WHERE erp_tenant_stores.revision = $3
		RETURNING revision
	`, b.tenantID, raw, expectedRevision).Scan(&nextRevision)
	if errors.Is(err, sql.ErrNoRows) {
		return expectedRevision, fmt.Errorf(
			"%w: tenant store revision changed; reload before retrying",
			ErrConflict,
		)
	}
	return nextRevision, err
}

func (b *postgresTenantSnapshotBackend) Health(ctx context.Context) HealthStatus {
	return b.postgres.Health(ctx)
}

type ERPTenantMux struct {
	nativeIdentity      bool
	existingTenantsOnly bool
	defaultServer       *Server
	verifier            ERPIdentityVerifier
	factory             ERPTenantStoreFactory
	localDemo           bool
	allowedOrigin       []string

	mu               sync.RWMutex
	servers          map[string]*Server
	wsTickets        map[string]erpWSTicketRoute
	wsTicketRouteTTL time.Duration

	backgroundMu         sync.Mutex
	backgroundGeneration uint64
	backgroundContext    context.Context
	backgroundStarter    func(context.Context, *Server)
	backgroundCancels    map[string]context.CancelFunc
}

type erpWSTicketRoute struct {
	TenantID string
	Expires  time.Time
}

const erpWSTicketRouteTTL = 31 * time.Second

func NewERPTenantMux(
	defaultServer *Server,
	verifier ERPIdentityVerifier,
	factory ERPTenantStoreFactory,
	localDemo bool,
	allowedOrigins []string,
) (*ERPTenantMux, error) {
	if defaultServer == nil || verifier == nil || factory == nil {
		return nil, ErrInvalid
	}
	return newTenantMux(defaultServer, verifier, factory, localDemo, allowedOrigins), nil
}

// The shared-account deployment reuses existing enterprise partitions only.
// A request header or a newly authorized ERP user cannot create tenant data.
func NewERPSharedIdentityMux(defaultServer *Server, verifier ERPIdentityVerifier, factory ERPTenantStoreFactory, allowedOrigins []string) (*ERPTenantMux, error) {
	if _, ok := factory.(existingERPTenantStoreFactory); !ok {
		return nil, ErrInvalid
	}
	mux, err := NewERPTenantMux(defaultServer, verifier, factory, false, allowedOrigins)
	if err != nil {
		return nil, err
	}
	mux.existingTenantsOnly = true
	defaultServer.ConfigureERPIdentity(verifier, false)
	return mux, nil
}

func newTenantMux(defaultServer *Server, verifier ERPIdentityVerifier, factory ERPTenantStoreFactory, localDemo bool, allowedOrigins []string) *ERPTenantMux {
	mux := &ERPTenantMux{
		defaultServer:     defaultServer,
		verifier:          verifier,
		factory:           factory,
		localDemo:         localDemo,
		allowedOrigin:     normalizeAllowedOrigins(allowedOrigins),
		servers:           map[string]*Server{},
		wsTickets:         map[string]erpWSTicketRoute{},
		wsTicketRouteTTL:  erpWSTicketRouteTTL,
		backgroundCancels: map[string]context.CancelFunc{},
	}
	defaultServer.ConfigureAllowedOrigins(mux.allowedOrigin)
	return mux
}

func (m *ERPTenantMux) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if m.nativeIdentity && m.serveNativeIdentity(w, r) {
		return
	}
	if m.existingTenantsOnly && r.URL.Path == "/api/v1/auth/erp/login" && r.Method == http.MethodPost {
		m.handleERPPasswordLogin(w, r)
		return
	}
	if erpShopifyComplianceRoute(r) {
		if !m.defaultServer.requireERPConnectorToken(w, r) {
			return
		}
		tenantID, err := normalizeERPTenantID(r.Header.Get(erpTenantHeader))
		if err != nil {
			writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid ERP tenant"})
			return
		}
		var server *Server
		if m.nativeIdentity {
			server, err = m.serverForExistingTenant(r.Context(), tenantID)
		} else {
			server, err = m.serverForTenant(r.Context(), tenantID)
		}
		if err != nil {
			writeError(w, err)
			return
		}
		server.Routes().ServeHTTP(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == "/api/v1/auth/erp/entry" {
		if requestOrigin(r) == "" || !m.defaultServer.originAllowed(r) {
			writeERPEntryError(w, http.StatusForbidden)
			return
		}
		grantRequest, ok := parseERPEntryGrantRequest(w, r)
		if !ok {
			return
		}
		identity, err := m.verifier.Redeem(r.Context(), grantRequest)
		if err != nil {
			status := http.StatusServiceUnavailable
			if errors.Is(err, errERPIdentityUnauthorized) {
				status = http.StatusForbidden
			}
			writeERPEntryError(w, status)
			return
		}
		if identity.TenantID != grantRequest.TenantID || identity.SubjectID != grantRequest.SubjectID ||
			!identity.ExpiresAt.After(time.Now().UTC().Add(30*time.Second)) ||
			!containsPermission(identity.Permissions, erpCustomerServicePermission) {
			writeERPEntryError(w, http.StatusForbidden)
			return
		}
		server, err := m.serverForTenant(r.Context(), identity.TenantID)
		if err != nil {
			writeError(w, err)
			return
		}
		server.Routes().ServeHTTP(
			w,
			r.WithContext(contextWithERPEntryIdentity(r.Context(), identity)),
		)
		return
	}
	if erpPublicChatRoute(r) {
		tenantID, err := normalizeERPTenantID(r.URL.Query().Get("tenant"))
		if err != nil {
			writeJSONResponse(w, http.StatusNotFound, map[string]string{"error": "storefront support is unavailable"})
			return
		}
		server, err := m.serverForExistingTenant(r.Context(), tenantID)
		if err != nil {
			writeJSONResponse(w, http.StatusNotFound, map[string]string{"error": "storefront support is unavailable"})
			return
		}
		server.Routes().ServeHTTP(w, r)
		return
	}
	if r.Method == http.MethodOptions || erpDefaultRouteAllowed(r) || erpConnectorRouteAllowed(r) {
		m.defaultServer.Routes().ServeHTTP(w, r)
		return
	}
	if r.Method == http.MethodGet && r.URL.Path == "/ws/events" {
		ticketHash := hashSessionToken(strings.TrimSpace(r.URL.Query().Get("ticket")))
		tenantID, ok := m.takeWSTicketRoute(ticketHash)
		if !ok {
			writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid websocket ticket"})
			return
		}
		server := m.existingServerForTenant(tenantID)
		if server == nil {
			writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid websocket ticket"})
			return
		}
		server.Routes().ServeHTTP(w, r)
		return
	}
	tenantID := strings.TrimSpace(r.Header.Get(erpTenantHeader))
	if tenantID == "" {
		writeJSONResponse(w, http.StatusForbidden, map[string]any{
			"code":      "ERP_SSO_REQUIRED",
			"error":     "ERP unified sign-in and tenant context are required",
			"retryable": false,
		})
		return
	}
	if _, err := normalizeERPTenantID(tenantID); err != nil {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid tenant session"})
		return
	}
	server := m.existingServerForTenant(tenantID)
	if server == nil {
		writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid tenant session"})
		return
	}
	server.Routes().ServeHTTP(w, r)
}

func erpPublicChatRoute(r *http.Request) bool {
	if r == nil {
		return false
	}
	return strings.HasPrefix(r.URL.Path, "/api/v1/public/chat/") ||
		r.URL.Path == "/api/v1/public/chat/config" ||
		strings.HasPrefix(r.URL.Path, "/api/v1/chat/attachments/") ||
		r.URL.Path == "/ws/chat" ||
		r.URL.Path == "/shopify/proxy/chat/session"
}

func erpShopifyComplianceRoute(r *http.Request) bool {
	if r == nil || r.Method != http.MethodPost {
		return false
	}
	return r.URL.Path == "/api/v1/internal/customer-service/shopify-compliance/export" ||
		r.URL.Path == "/api/v1/internal/customer-service/shopify-compliance/redact"
}

func erpConnectorRouteAllowed(r *http.Request) bool {
	if r == nil || r.Method != http.MethodPost {
		return false
	}
	return strings.HasPrefix(r.URL.Path, "/api/v1/erp-connector/shopify/") ||
		r.URL.Path == "/api/v1/shopify-connector/installations/oauth/start" ||
		r.URL.Path == "/api/v1/shopify-connector/installations/uninstall" ||
		r.URL.Path == "/api/v1/shopify-connector/installations/revocation-effects"
}

func (m *ERPTenantMux) existingServerForTenant(tenantID string) *Server {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.servers[tenantID]
}

func (m *ERPTenantMux) serverForTenant(
	ctx context.Context,
	tenantID string,
) (*Server, error) {
	if m.existingTenantsOnly {
		return m.serverForExistingTenant(ctx, tenantID)
	}
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	m.mu.RLock()
	server := m.servers[tenantID]
	m.mu.RUnlock()
	if server != nil {
		return server, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if server = m.servers[tenantID]; server != nil {
		return server, nil
	}
	store, err := m.factory.StoreForTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	server = NewServer(store)
	server.ConfigureAllowedOrigins(m.allowedOrigin)
	server.ConfigureERPIdentity(m.verifier, m.localDemo)
	if m.nativeIdentity {
		server.nativeTenantID = tenantID
	}
	server.setWSTicketRouteHook(func(hash string) {
		m.rememberWSTicketRoute(hash, tenantID)
	})
	m.servers[tenantID] = server
	go m.startTenantBackground(tenantID, server)
	return server, nil
}

func (m *ERPTenantMux) serverForExistingTenant(
	ctx context.Context,
	tenantID string,
) (*Server, error) {
	tenantID, err := normalizeERPTenantID(tenantID)
	if err != nil {
		return nil, err
	}
	if server := m.existingServerForTenant(tenantID); server != nil {
		return server, nil
	}
	factory, ok := m.factory.(existingERPTenantStoreFactory)
	if !ok {
		return nil, ErrNotFound
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if server := m.servers[tenantID]; server != nil {
		return server, nil
	}
	store, err := factory.ExistingStoreForTenant(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	server := NewServer(store)
	server.ConfigureAllowedOrigins(m.allowedOrigin)
	server.ConfigureERPIdentity(m.verifier, m.localDemo)
	if m.nativeIdentity {
		server.nativeTenantID = tenantID
	}
	server.setWSTicketRouteHook(func(hash string) {
		m.rememberWSTicketRoute(hash, tenantID)
	})
	m.servers[tenantID] = server
	go m.startTenantBackground(tenantID, server)
	return server, nil
}

func erpDefaultRouteAllowed(r *http.Request) bool {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		return false
	}
	switch r.URL.Path {
	case "/", "/index.html", "/healthz", "/api/v1/bootstrap/status", "/chat/widget.js", "/chat/widget.css":
		return true
	default:
		return strings.HasPrefix(r.URL.Path, "/assets/") ||
			strings.HasPrefix(r.URL.Path, "/shopify/xz-erp")
	}
}

// ActivateTenantBackground installs the current background-role generation.
// Calling it again after role rotation cancels the previous generation and
// starts every existing tenant exactly once under the new context.
func (m *ERPTenantMux) ActivateTenantBackground(
	ctx context.Context,
	starter func(context.Context, *Server),
) {
	if ctx == nil || starter == nil {
		return
	}
	m.backgroundMu.Lock()
	for _, cancel := range m.backgroundCancels {
		cancel()
	}
	m.backgroundGeneration++
	generation := m.backgroundGeneration
	m.backgroundContext = ctx
	m.backgroundStarter = starter
	m.backgroundCancels = map[string]context.CancelFunc{}
	m.backgroundMu.Unlock()

	m.mu.RLock()
	servers := make(map[string]*Server, len(m.servers))
	for tenantID, server := range m.servers {
		servers[tenantID] = server
	}
	m.mu.RUnlock()
	for tenantID, server := range servers {
		m.startTenantBackground(tenantID, server)
	}

	go func() {
		<-ctx.Done()
		m.backgroundMu.Lock()
		defer m.backgroundMu.Unlock()
		if m.backgroundGeneration != generation {
			return
		}
		for _, cancel := range m.backgroundCancels {
			cancel()
		}
		m.backgroundContext = nil
		m.backgroundStarter = nil
		m.backgroundCancels = map[string]context.CancelFunc{}
	}()
}

func (m *ERPTenantMux) startTenantBackground(tenantID string, server *Server) {
	m.backgroundMu.Lock()
	if m.backgroundContext == nil ||
		m.backgroundStarter == nil ||
		m.backgroundContext.Err() != nil ||
		m.backgroundCancels[tenantID] != nil {
		m.backgroundMu.Unlock()
		return
	}
	ctx, cancel := context.WithCancel(m.backgroundContext)
	starter := m.backgroundStarter
	m.backgroundCancels[tenantID] = cancel
	m.backgroundMu.Unlock()
	starter(ctx, server)
}

func (m *ERPTenantMux) rememberWSTicketRoute(hash string, tenantID string) {
	if hash == "" {
		return
	}
	expires := time.Now().UTC().Add(m.wsTicketRouteTTL)
	m.mu.Lock()
	m.wsTickets[hash] = erpWSTicketRoute{TenantID: tenantID, Expires: expires}
	m.mu.Unlock()
	time.AfterFunc(m.wsTicketRouteTTL, func() {
		m.mu.Lock()
		current, ok := m.wsTickets[hash]
		if ok && current.Expires.Equal(expires) {
			delete(m.wsTickets, hash)
		}
		m.mu.Unlock()
	})
}

func (m *ERPTenantMux) takeWSTicketRoute(hash string) (string, bool) {
	if hash == "" {
		return "", false
	}
	now := time.Now().UTC()
	m.mu.Lock()
	route, ok := m.wsTickets[hash]
	if ok {
		delete(m.wsTickets, hash)
	}
	m.mu.Unlock()
	if !ok || !now.Before(route.Expires) {
		return "", false
	}
	return route.TenantID, true
}

func normalizeERPTenantID(tenantID string) (string, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" || len(tenantID) > 160 ||
		strings.ContainsAny(tenantID, "\x00\r\n\t") {
		return "", fmt.Errorf("%w: invalid ERP tenant ID", ErrInvalid)
	}
	return tenantID, nil
}
