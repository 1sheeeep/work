// Package identity runs only against synthetic memory or a marked, owned local
// test database. It has no production settings reader or external upstream.
package identity

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"reflect"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
	"shopify-support-platform/internal/platform"
)

const TenantID = "11111111-1111-4111-8111-111111111111"
const ERPUserID = "33333333-3333-4333-8333-333333333333"
const CSUserID = "cs-existing-agent"
const Email = "agent@example.invalid"
const Password = "Synthetic-password-123"
const ServiceToken = "synthetic-identity-service-token-not-real"
const OriginalSession = "synthetic-original-cs-session"

func NewSyntheticHandler() (http.Handler, error) {
	return newSyntheticHandler(platform.NewMemoryStore())
}

// Only a marked, fresh, loopback test database with fixed synthetic roles.
func NewPostgresSyntheticHandler(port int) (http.Handler, error) {
	if port < 1024 || port > 65535 {
		return nil, errors.New("invalid owned rehearsal port")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	base := fmt.Sprintf("postgres://%%s:%%s@127.0.0.1:%d/cs_identity_rehearsal?sslmode=disable", port)
	migration := fmt.Sprintf(base, "customer_service_migrator", "not-a-real-secret-customer-service-migrator")
	db, err := sql.Open("pgx", migration)
	if err != nil {
		return nil, errors.New("owned database unavailable")
	}
	defer db.Close()
	var marked bool
	if err = db.QueryRowContext(ctx, `SELECT coalesce(shobj_description(oid,'pg_database'),'')='xz-erp-owned-identity-rehearsal-v1' FROM pg_database WHERE datname=current_database()`).Scan(&marked); err != nil || !marked {
		return nil, errors.New("owned database marker missing")
	}
	store, err := platform.OpenPostgresStore(ctx, platform.PostgresStoreConfig{DatabaseURL: fmt.Sprintf(base, "customer_service_runtime", "not-a-real-secret-customer-service-runtime"), MigrationDatabaseURL: migration, Schema: platform.CustomerServiceDatabaseSchema})
	if err != nil {
		return nil, errors.New("owned customer service database setup failed")
	}
	return newSyntheticHandler(store)
}

type syntheticIdentityStore interface {
	platform.Store
	platform.ERPIdentityReadStore
}

func newSyntheticHandler(store syntheticIdentityStore) (http.Handler, error) {
	ctx := context.Background()
	u, err := store.GetUser(ctx, CSUserID)
	if err != nil && !errors.Is(err, platform.ErrNotFound) {
		return nil, err
	}
	if errors.Is(err, platform.ErrNotFound) {
		hash, err := bcrypt.GenerateFromPassword([]byte(Password), bcrypt.DefaultCost)
		if err != nil {
			return nil, err
		}
		u, err = store.CreateUser(ctx, platform.User{ID: CSUserID, Email: Email, DisplayName: "Synthetic original agent", Role: platform.UserRoleAgent, PasswordHash: string(hash),
			PermissionsCustomized: true, Permissions: []string{platform.PermissionWorkbenchAccess}, ShopScope: "assigned"})
		if err != nil {
			return nil, err
		}
		u, err = store.SetUserReceptionOnline(ctx, u.ID, false)
		if err != nil {
			return nil, err
		}
		sum := sha256.Sum256([]byte(OriginalSession))
		oldHash := hex.EncodeToString(sum[:])
		_, err = store.CreateSession(ctx, platform.Session{UserID: u.ID, TokenHash: oldHash, ExpiresAt: time.Now().Add(time.Hour)})
		if err != nil {
			return nil, err
		}
	}
	sum := sha256.Sum256([]byte(OriginalSession))
	oldHash := hex.EncodeToString(sum[:])
	b := platform.ERPIdentityBinding{TenantID: TenantID, ERPUserID: ERPUserID, CustomerServiceUserID: CSUserID, SubjectRef: "reviewed-subject-1", Version: 7,
		State: "CONFIRMED", ReviewedBy: "synthetic-reviewer", EvidenceRef: "synthetic-evidence", ReviewedAt: time.Now().Add(-time.Hour)}
	h, err := platform.NewERPIdentityPreparationHandler(store, ServiceToken, []platform.ERPIdentityBinding{b})
	if err != nil {
		return nil, err
	}
	var mu sync.RWMutex
	mux := http.NewServeMux()
	mux.HandleFunc(platform.ERPIdentityPreparationPrefix, func(w http.ResponseWriter, r *http.Request) {
		mu.RLock()
		current := h
		mu.RUnlock()
		current.ServeHTTP(w, r)
	})
	native := platform.NewServer(store).Routes()
	// Only native auth endpoints are exposed; no mailbox/shop/task operations.
	for _, path := range []string{"/api/v1/auth/login", "/api/v1/auth/me", "/api/v1/auth/logout"} {
		mux.Handle(path, native)
	}
	mux.HandleFunc("GET /rehearsal/evidence", func(w http.ResponseWriter, r *http.Request) {
		current, e := store.GetUser(r.Context(), u.ID)
		_, _, sessionErr := store.GetSessionByTokenHash(r.Context(), oldHash)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(map[string]any{"synthetic": true, "productionReady": false, "originalUserUnchanged": e == nil && reflect.DeepEqual(current, u),
			"originalSessionValid": sessionErr == nil, "receptionOnline": current.ReceptionOnline})
	})
	// Fixed fault injection against this process's ONLY synthetic account.
	mux.HandleFunc("POST /rehearsal/control/{action}", func(w http.ResponseWriter, r *http.Request) {
		var err error
		switch r.PathValue("action") {
		case "disable":
			_, err = store.UpdateUser(r.Context(), u.ID, platform.User{Status: platform.UserStatusDisabled})
		case "activate":
			_, err = store.UpdateUser(r.Context(), u.ID, platform.User{Status: platform.UserStatusActive})
		case "online":
			_, err = store.SetUserReceptionOnline(r.Context(), u.ID, true)
		case "offline":
			_, err = store.SetUserReceptionOnline(r.Context(), u.ID, false)
		case "replace-mapping":
			mu.Lock()
			b.Version++
			h, err = platform.NewERPIdentityPreparationHandler(store, ServiceToken, []platform.ERPIdentityBinding{b})
			mu.Unlock()
		default:
			w.WriteHeader(404)
			return
		}
		if err != nil {
			w.WriteHeader(500)
			return
		}
		w.WriteHeader(204)
	})
	return mux, nil
}
