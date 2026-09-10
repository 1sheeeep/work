package platform

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
)

const ERPIdentityPreparationPrefix = "/internal/v1/erp-identity-preparation/"
const ERPIdentityPreparationHeader = "X-XZ-Identity-Service-Token"

// Explicitly reviewed, immutable association. No email matching, provisioning,
// role merging or password migration. Replacing mappings requires a new handler,
// invalidating ALL outstanding preparation grants and leases.
type ERPIdentityBinding struct {
	TenantID, SubjectRef, CustomerServiceUserID, ERPUserID string
	Version                                                int64
	State, ReviewedBy, EvidenceRef                         string
	ReviewedAt                                             time.Time
	// Explicit original-source review only; never confers ERP administrator rights.
	AllowSourceAdministrator bool
}

// Deliberately excludes session, presence, account and permission writes.
type ERPIdentityReadStore interface {
	FindUserByEmail(context.Context, string) (User, error)
	GetUser(context.Context, string) (User, error)
	ReadIdentitySnapshot(context.Context, string) (User, error)
}

type identityPreparationGrant struct {
	binding            ERPIdentityBinding
	attempt            string
	credentialRevision [32]byte
	identityRevision   int64
	expires            time.Time
}

type erpIdentityPreparationHandler struct {
	store                    ERPIdentityReadStore
	persistent               *PostgresStore
	token, tenant, dummyHash string
	bindings                 map[string]ERPIdentityBinding
	mu                       sync.Mutex
	grants, leases           map[string]identityPreparationGrant
	loginWindow              time.Time
	loginCount               int
	userAttempts             map[string]int
	busy                     chan struct{}
	now                      func() time.Time
	leaseLifetime            time.Duration
	tokenCapacity            int
}

var preparationOpaque = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

// Preparation only: NOT mounted by Server.Routes, support-server or Connector.
// This is a private credential-verification contract, not OAuth/ROPC or an OIDC
// provider. Grants never go to the browser. Attempt binding must originate at
// the trusted ERP login handler, not from an arbitrary browser-supplied field.
func NewERPIdentityPreparationHandler(store ERPIdentityReadStore, token string, bindings []ERPIdentityBinding) (http.Handler, error) {
	invalid := errors.New("identity preparation configuration invalid")
	if store == nil || len(token) < 32 || len(token) > 256 || len(bindings) == 0 || len(bindings) > 100 {
		return nil, invalid
	}
	for _, c := range token {
		if c < 33 || c > 126 {
			return nil, invalid
		}
	}
	h := &erpIdentityPreparationHandler{store: store, token: token, tenant: bindings[0].TenantID,
		bindings: map[string]ERPIdentityBinding{}, grants: map[string]identityPreparationGrant{}, leases: map[string]identityPreparationGrant{},
		userAttempts: map[string]int{}, busy: make(chan struct{}, 1), now: time.Now, leaseLifetime: 5 * time.Minute, tokenCapacity: 128}
	h.persistent, _ = store.(*PostgresStore)
	seenSubjects, seenERP := map[string]bool{}, map[string]bool{}
	for _, b := range bindings {
		if b.TenantID != h.tenant || !storeAppUUID.MatchString(b.TenantID) || !storeAppUUID.MatchString(b.ERPUserID) ||
			!safeStoreAppRef(b.SubjectRef) || !safeStoreAppRef(b.CustomerServiceUserID) || b.Version < 1 || b.Version > 9007199254740991 ||
			b.State != "CONFIRMED" || !safeStoreAppRef(b.ReviewedBy) || !safeStoreAppRef(b.EvidenceRef) || b.ReviewedAt.IsZero() || b.ReviewedAt.After(time.Now()) ||
			seenSubjects[b.SubjectRef] || seenERP[b.ERPUserID] || h.bindings[b.CustomerServiceUserID].CustomerServiceUserID != "" {
			return nil, invalid
		}
		h.bindings[b.CustomerServiceUserID] = b
		seenSubjects[b.SubjectRef], seenERP[b.ERPUserID] = true, true
	}
	// Same bcrypt path for absent and disabled accounts. No persistent credential
	// is read or created; this dummy is private to the isolated adapter instance.
	random, err := newSessionToken()
	if err != nil {
		return nil, invalid
	}
	h.dummyHash, err = hashPassword(random)
	if err != nil {
		return nil, invalid
	}
	return h, nil
}

type identityPreparationRequest struct {
	TenantID string `json:"tenantId"`
	Target   string `json:"target"`
	Attempt  string `json:"attempt"`
	Email    string `json:"email,omitempty"`
	Password string `json:"password,omitempty"`
	Grant    string `json:"grant,omitempty"`
	Lease    string `json:"lease,omitempty"`
}

type identityPreparationResponse struct {
	Source                string    `json:"source"`
	Target                string    `json:"target"`
	TenantID              string    `json:"tenantId"`
	SubjectRef            string    `json:"subjectRef"`
	CustomerServiceUserID string    `json:"customerServiceUserId"`
	ERPUserID             string    `json:"erpUserId"`
	BindingVersion        int64     `json:"bindingVersion"`
	ExpiresAt             time.Time `json:"expiresAt"`
	Grant                 string    `json:"grant,omitempty"`
	Lease                 string    `json:"lease,omitempty"`
}

func (h *erpIdentityPreparationHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	started := time.Now()
	stage := "routing"
	fail := func(status int) {
		if status >= 500 {
			log.Printf("erp_identity stage=%s status=%d elapsed_ms=%d", stage, status, time.Since(started).Milliseconds())
		}
		writeJSONResponse(w, status, map[string]string{"code": "IDENTITY_PREPARATION_REJECTED"})
	}
	operation := strings.TrimPrefix(r.URL.Path, ERPIdentityPreparationPrefix)
	if r.Method != "POST" || !strings.HasPrefix(r.URL.Path, ERPIdentityPreparationPrefix) || (operation != "verify" && operation != "exchange" && operation != "validate") {
		fail(404)
		return
	}
	if len(r.Header.Values(ERPIdentityPreparationHeader)) != 1 || subtle.ConstantTimeCompare([]byte(r.Header.Get(ERPIdentityPreparationHeader)), []byte(h.token)) != 1 {
		fail(403)
		return
	}
	if r.URL.RawQuery != "" {
		fail(400)
		return
	}
	var input identityPreparationRequest
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if d.Decode(&input) != nil || d.Decode(&struct{}{}) != io.EOF {
		fail(400)
		return
	}
	if input.TenantID != h.tenant || input.Target != "ERP" || !preparationOpaque.MatchString(input.Attempt) {
		fail(401)
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Second)
	defer cancel()
	if operation == "verify" {
		if len(input.Email) == 0 || len(input.Email) > 254 || len(input.Password) == 0 || len(input.Password) > 72 || input.Grant != "" || input.Lease != "" {
			fail(401)
			return
		}
		select {
		case h.busy <- struct{}{}:
			defer func() { <-h.busy }()
		default:
			fail(429)
			return
		}
		now := h.now()
		h.mu.Lock()
		if !now.Before(h.loginWindow.Add(time.Minute)) {
			h.loginWindow, h.loginCount, h.userAttempts = now, 0, map[string]int{}
		}
		h.loginCount++
		limited := h.loginCount > 20
		h.mu.Unlock()
		if limited {
			fail(429)
			return
		}
		if e := h.durableAttempt(ctx, "all", 20); e != nil {
			if errors.Is(e, ErrRateLimited) {
				fail(429)
			} else {
				fail(503)
			}
			return
		}
		stage = "identity_lookup"
		var user User
		var err error
		if snapshot, ok := h.store.(interface {
			FindIdentitySnapshotByEmail(context.Context, string) (User, error)
		}); ok {
			user, err = snapshot.FindIdentitySnapshotByEmail(ctx, input.Email)
		} else {
			user, err = h.store.FindUserByEmail(ctx, input.Email)
			if err == nil {
				user, err = h.store.ReadIdentitySnapshot(ctx, user.ID)
				if err == nil && normalizeEmail(user.Email) != normalizeEmail(input.Email) {
					err = ErrNotFound
				}
			}
		}
		b, mapped := h.bindings[user.ID]
		if mapped {
			if e := h.durableAttempt(ctx, user.ID, 5); e != nil {
				if errors.Is(e, ErrRateLimited) {
					fail(429)
				} else {
					fail(503)
				}
				return
			}
		}
		stored := h.dummyHash
		if err == nil && mapped && user.Status == UserStatusActive && (!user.SystemAdmin || b.AllowSourceAdministrator) && user.PasswordHash != "" {
			stored = user.PasswordHash
		}
		stage = "password_verification"
		matched := verifyPassword(stored, input.Password)
		input.Password = ""
		h.mu.Lock()
		if mapped {
			h.userAttempts[user.ID]++
			limited = h.userAttempts[user.ID] > 5
		}
		h.mu.Unlock()
		if limited {
			fail(429)
			return
		}
		if ctx.Err() != nil || (err != nil && !errors.Is(err, ErrNotFound)) {
			fail(503)
			return
		}
		if err != nil || !mapped || user.Status != UserStatusActive || (user.SystemAdmin && !b.AllowSourceAdministrator) || !matched || ctx.Err() != nil {
			fail(401)
			return
		}
		g := identityPreparationGrant{binding: b, attempt: input.Attempt, credentialRevision: identityCredentialFingerprint(user), identityRevision: user.IdentityRevision, expires: now.Add(30 * time.Second).Truncate(time.Microsecond)}
		token, err := newSessionToken()
		if err != nil {
			fail(503)
			return
		}
		stage = "grant_persistence"
		if e := h.saveToken(ctx, "grant", hashSessionToken(token), g); e != nil {
			if errors.Is(e, ErrRateLimited) {
				fail(429)
			} else {
				fail(503)
			}
			return
		}
		output := identityResponse(g)
		output.Grant = token
		writeJSONResponse(w, 200, output)
		return
	}
	if input.Email != "" || input.Password != "" {
		fail(400)
		return
	}
	token := input.Lease
	if operation == "exchange" {
		token = input.Grant
		if input.Lease != "" {
			fail(400)
			return
		}
	} else if input.Grant != "" {
		fail(400)
		return
	}
	if !preparationOpaque.MatchString(token) {
		fail(401)
		return
	}
	hash := hashSessionToken(token)
	kind := "lease"
	if operation == "exchange" {
		kind = "grant"
	}
	g, ok, loadErr := h.loadToken(ctx, kind, hash)
	if loadErr != nil {
		fail(503)
		return
	}
	if !ok || g.attempt != input.Attempt {
		fail(401)
		return
	}
	valid, unavailable := h.current(ctx, g)
	if unavailable {
		fail(503)
		return
	}
	if !valid {
		h.dropToken(ctx, hash)
		fail(401)
		return
	}
	if operation == "exchange" {
		lease, err := newSessionToken()
		if err != nil {
			fail(503)
			return
		}
		// PostgreSQL stores microseconds; the wire and both databases must agree.
		g.expires = h.now().Add(h.leaseLifetime).Truncate(time.Microsecond)
		if e := h.saveToken(ctx, "lease", hashSessionToken(lease), g); e != nil {
			if errors.Is(e, ErrRateLimited) {
				fail(429)
			} else {
				fail(503)
			}
			return
		}
		output := identityResponse(g)
		output.Lease = lease
		writeJSONResponse(w, 200, output)
		return
	}
	writeJSONResponse(w, 200, identityResponse(g))
}

func (h *erpIdentityPreparationHandler) current(ctx context.Context, g identityPreparationGrant) (bool, bool) {
	b, ok := h.bindings[g.binding.CustomerServiceUserID]
	if !ok || b.Version != g.binding.Version || b.SubjectRef != g.binding.SubjectRef || b.ERPUserID != g.binding.ERPUserID || b.TenantID != g.binding.TenantID || b.AllowSourceAdministrator != g.binding.AllowSourceAdministrator {
		return false, false
	}
	u, err := h.store.ReadIdentitySnapshot(ctx, g.binding.CustomerServiceUserID)
	if ctx.Err() != nil || (err != nil && !errors.Is(err, ErrNotFound)) {
		return false, true
	}
	return err == nil && h.now().Before(g.expires) && u.ID == g.binding.CustomerServiceUserID &&
		u.Status == UserStatusActive && (!u.SystemAdmin || b.AllowSourceAdministrator) && u.PasswordHash != "" && u.IdentityRevision == g.identityRevision && identityCredentialFingerprint(u) == g.credentialRevision, false
}

// A recreated ID is not the original account, even in memory/file fixtures
// where native deletion removes the per-user revision alongside the user.
func identityCredentialFingerprint(u User) [32]byte {
	return sha256.Sum256([]byte(u.PasswordHash + "\x00" + u.CreatedAt.UTC().Format(time.RFC3339Nano)))
}

func (h *erpIdentityPreparationHandler) prune(now time.Time) {
	for k, g := range h.grants {
		if !now.Before(g.expires) {
			delete(h.grants, k)
		}
	}
	for k, g := range h.leases {
		if !now.Before(g.expires) {
			delete(h.leases, k)
		}
	}
}

func identityResponse(g identityPreparationGrant) identityPreparationResponse {
	b := g.binding
	return identityPreparationResponse{Source: "CUSTOMER_SERVICE", Target: "ERP", TenantID: b.TenantID, SubjectRef: b.SubjectRef,
		CustomerServiceUserID: b.CustomerServiceUserID, ERPUserID: b.ERPUserID, BindingVersion: b.Version, ExpiresAt: g.expires}
}
