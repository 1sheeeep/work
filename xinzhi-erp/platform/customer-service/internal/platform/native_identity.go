package platform

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

// A new login is required after retiring federated authentication. Old bearer
// sessions are not silently promoted to native sessions; no account is changed.
const nativeSessionPrefix = "native_"

func NewNativeTenantMux(defaultServer *Server, factory ERPTenantStoreFactory, allowedOrigins []string) (*ERPTenantMux, error) {
	if defaultServer == nil || factory == nil {
		return nil, ErrInvalid
	}
	if _, ok := factory.(existingERPTenantStoreFactory); !ok {
		return nil, ErrInvalid
	}
	mux := newTenantMux(defaultServer, nil, factory, false, allowedOrigins)
	mux.nativeIdentity = true
	defaultServer.nativeTenantMode = true
	return mux, nil
}

// Tenant input selects a store, never grants access. Only an existing store is
// opened; its own password/session and role checks remain authoritative.
func (m *ERPTenantMux) serveNativeIdentity(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodOptions {
		return false
	}
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/v1/auth/one/") || path == "/api/v1/auth/erp/entry" || path == "/api/v1/bootstrap/admin" {
		writeJSONResponse(w, http.StatusNotFound, map[string]string{"error": "route unavailable"})
		return true
	}
	if path == "/api/v1/bootstrap/status" {
		m.defaultServer.Routes().ServeHTTP(w, r)
		return true
	}
	if erpDefaultRouteAllowed(r) || erpConnectorRouteAllowed(r) || erpShopifyComplianceRoute(r) || erpPublicChatRoute(r) || path == "/ws/events" {
		return false
	}
	if !strings.HasPrefix(path, "/api/") && !strings.HasPrefix(path, "/ws/") {
		m.defaultServer.Routes().ServeHTTP(w, r)
		return true
	}
	isLogin := path == "/api/v1/auth/login" && r.Method == http.MethodPost
	if !isLogin && !strings.HasPrefix(bearerToken(r), nativeSessionPrefix) {
		writeNativeLoginRequired(w)
		return true
	}
	values := r.Header.Values(erpTenantHeader)
	if len(values) != 1 {
		writeNativeLoginRequired(w)
		return true
	}
	tenantID, err := normalizeERPTenantID(values[0])
	if err != nil {
		writeNativeLoginRequired(w)
		return true
	}
	server, err := m.serverForExistingTenant(r.Context(), tenantID)
	if err != nil {
		writeNativeLoginRequired(w)
		return true
	}
	server.Routes().ServeHTTP(w, r)
	return true
}

func writeNativeLoginRequired(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSONResponse(w, http.StatusUnauthorized, map[string]string{"error": "invalid enterprise, account or session"})
}

// HTTP and live event access both follow the current local account and session.
func (s *Server) watchNativeEventSession(conn *websocket.Conn, client *eventClient, token string) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-client.done:
			return
		case <-ticker.C:
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, user, err := s.store.GetSessionByTokenHash(ctx, hashSessionToken(token))
			if err == nil && s.erpIdentityVerifier != nil {
				user, err = s.validateERPSession(ctx, hashSessionToken(token), user)
			}
			cancel()
			if err != nil || user.Status != UserStatusActive || (!userHasPermission(user, PermissionWorkbenchAccess) && !userHasPermission(user, PermissionTicketsView)) {
				s.removeEventClient(conn)
				return
			}
			s.refreshEventClientPermissions(user.ID)
		}
	}
}
