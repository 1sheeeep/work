package installations

import (
	"context"
	"crypto/subtle"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

var (
	ErrNotFound            = errors.New("connector installation not found")
	ErrBindingConflict     = errors.New("connector shop binding conflict")
	ErrInvalidBinding      = errors.New("connector shop binding is invalid")
	ErrOAuthGrantForbidden = errors.New("connector OAuth grant is unavailable")
	ErrRepositoryStale     = errors.New("connector repository generation is stale")
)

type Binding struct {
	Identity     shopifyconnector.CanonicalShopIdentity
	LegacyShopID string
	ShopDomain   string
}

type InstallationRecord struct {
	Binding
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresAt  time.Time
	RefreshTokenExpiresAt time.Time
	CredentialKeyVersion  string
	ShopName              string
	Scopes                []string
	State                 shopifyconnector.InstallationState
	InstalledAt           time.Time
	UpdatedAt             time.Time
	RevokedAt             time.Time
	EffectsApplied        bool
	// Native linking commits ownership before configuring external app data.
	// All business access stays locked until configuration is durably recorded.
	NativeLinkPending   bool
	NativeLinkProofHash string
	NativeLinkActorID   string
	NativeLinkExpiresAt time.Time
}

func (r InstallationRecord) String() string {
	return "installationRecord{" + identityKey(r.Identity) + " domain=" + r.ShopDomain + " state=" + string(r.State) + " credentials=[REDACTED]}"
}

func (r InstallationRecord) GoString() string { return r.String() }

type RevocationRecord struct {
	Identity     shopifyconnector.CanonicalShopIdentity `json:"identity"`
	LegacyShopID string                                 `json:"legacyShopId"`
	ShopDomain   string                                 `json:"shopDomain"`
	Context      shopifyconnector.RequestContext        `json:"context"`
}

type OAuthGrant struct {
	ID               string
	Identity         shopifyconnector.CanonicalShopIdentity
	Context          shopifyconnector.RequestContext
	LegacyShopID     string
	ShopDomain       string
	BrowserNonceHash string
	ExpiresAt        time.Time
	ConsumedAt       time.Time
}

type OutboxEvent struct {
	ID           string                                 `json:"id"`
	Kind         string                                 `json:"kind"`
	Identity     shopifyconnector.CanonicalShopIdentity `json:"identity"`
	ShopDomain   string                                 `json:"shopDomain"`
	Topic        string                                 `json:"topic"`
	ReferenceIDs []string                               `json:"referenceIds,omitempty"`
	OccurredAt   time.Time                              `json:"occurredAt"`
	CompletedAt  *time.Time                             `json:"completedAt,omitempty"`
	Outcome      string                                 `json:"outcome,omitempty"`
}

type ProtectedDataAccessEvent struct {
	ID          string                                 `json:"id"`
	Identity    shopifyconnector.CanonicalShopIdentity `json:"identity"`
	ActorID     string                                 `json:"actorId"`
	Surface     string                                 `json:"surface"`
	FieldSet    string                                 `json:"fieldSet"`
	RecordCount int                                    `json:"recordCount"`
	OccurredAt  time.Time                              `json:"occurredAt"`
}

func (e ProtectedDataAccessEvent) String() string {
	return "protectedDataAccessEvent{id=" + e.ID + " tenant=" + e.Identity.TenantID +
		" shop=" + e.Identity.ShopID + " actor=" + e.ActorID + " surface=" + e.Surface +
		" fields=" + e.FieldSet + " records=[COUNT]}"
}

func (e ProtectedDataAccessEvent) GoString() string { return e.String() }

func (g OAuthGrant) String() string {
	return "oauthGrant{id=[REDACTED] tenant=" + g.Identity.TenantID + " shop=" + g.Identity.ShopID +
		" domain=" + g.ShopDomain + " browser=[REDACTED]}"
}

func (g OAuthGrant) GoString() string { return g.String() }

type Repository interface {
	shopifyconnector.LegacyShopBindingResolver
	SaveBinding(context.Context, Binding) error
	ResolveLegacyShopID(context.Context, shopifyconnector.CanonicalShopIdentity) (string, error)
	ResolveIdentityByDomain(context.Context, string) (shopifyconnector.CanonicalShopIdentity, error)
	CompleteInstallation(context.Context, Binding, InstallationRecord) error
	GetInstallation(context.Context, shopifyconnector.CanonicalShopIdentity) (InstallationRecord, error)
	RotateCredential(context.Context, shopifyconnector.CanonicalShopIdentity, string, OAuthExchangeResult, string, time.Time) (InstallationRecord, error)
	MarkRevoked(context.Context, shopifyconnector.CanonicalShopIdentity, time.Time) (InstallationRecord, bool, error)
	MarkRevokedAndEnqueue(context.Context, shopifyconnector.CanonicalShopIdentity, time.Time, OutboxEvent) (InstallationRecord, bool, error)
	MarkRevocationEffectsApplied(context.Context, shopifyconnector.CanonicalShopIdentity, time.Time) error
	EnqueueOutbox(context.Context, OutboxEvent) error
	ListOutbox(context.Context) ([]OutboxEvent, error)
	CompleteOutbox(context.Context, string, string, time.Time) (OutboxEvent, bool, error)
	AppendProtectedDataAccess(context.Context, ProtectedDataAccessEvent) error
	ListProtectedDataAccess(context.Context) ([]ProtectedDataAccessEvent, error)
	CreateOAuthGrant(context.Context, OAuthGrant) error
	BindOAuthGrant(context.Context, string, string, time.Time) (OAuthGrant, error)
	ConsumeOAuthGrant(context.Context, string, string, string, time.Time) (OAuthGrant, error)
	GetPendingInstallation(context.Context, string) (PendingInstallationRecord, uint64, error)
	SavePendingInstallation(context.Context, PendingInstallationRecord, uint64, time.Time) error
	DiscardPendingInstallation(context.Context, string) error
	RecordUninstallWebhook(context.Context, UninstallWebhook, shopifyconnector.CanonicalShopIdentity, time.Time) (UninstallWebhookReceipt, bool, error)
	HasUninstallWebhook(context.Context, UninstallWebhook) (bool, error)
	CompleteUninstallWebhook(context.Context, string, string) error
	PrunePendingInstallations(context.Context, time.Time) (int, error)
	InspectNativeLink(context.Context, string, time.Time) (PendingInstallationSummary, error)
	ConsumeNativeLink(context.Context, NativeLinkRequest, []string, time.Time) (InstallationRecord, error)
	FinishNativeLink(context.Context, InstallationRecord, time.Time) (InstallationRecord, error)
}

type MemoryRepository struct {
	mu                    sync.RWMutex
	bindings              map[string]Binding
	legacyIndex           map[string]string
	domainIndex           map[string]string
	installations         map[string]InstallationRecord
	oauthGrants           map[string]OAuthGrant
	outbox                map[string]OutboxEvent
	protectedDataAccess   map[string]ProtectedDataAccessEvent
	pendingInstallations  map[string]PendingInstallationRecord
	pendingRevision       uint64
	uninstallReceipts     map[string]UninstallWebhookReceipt
	uninstallReceiptIndex map[string]string
}

func NewMemoryRepository() *MemoryRepository {
	return &MemoryRepository{
		bindings: map[string]Binding{}, legacyIndex: map[string]string{},
		domainIndex: map[string]string{}, installations: map[string]InstallationRecord{}, oauthGrants: map[string]OAuthGrant{}, outbox: map[string]OutboxEvent{},
		protectedDataAccess:   map[string]ProtectedDataAccessEvent{},
		pendingInstallations:  map[string]PendingInstallationRecord{},
		uninstallReceipts:     map[string]UninstallWebhookReceipt{},
		uninstallReceiptIndex: map[string]string{},
	}
}

func (r *MemoryRepository) SaveBinding(_ context.Context, binding Binding) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	normalized, err := validateAndNormalizeBinding(binding)
	if err != nil {
		return err
	}
	return r.saveBindingLocked(normalized)
}

func (r *MemoryRepository) saveBindingLocked(binding Binding) error {
	if err := r.checkBindingLocked(binding); err != nil {
		return err
	}
	key := identityKey(binding.Identity)
	legacy := strings.TrimSpace(binding.LegacyShopID)
	domain := normalizeDomain(binding.ShopDomain)
	binding.LegacyShopID = legacy
	binding.ShopDomain = domain
	r.bindings[key] = binding
	r.legacyIndex[legacy] = key
	r.domainIndex[domain] = key
	return nil
}

func (r *MemoryRepository) checkBindingLocked(binding Binding) error {
	key := identityKey(binding.Identity)
	legacy := strings.TrimSpace(binding.LegacyShopID)
	domain := normalizeDomain(binding.ShopDomain)
	if existing, ok := r.bindings[key]; ok &&
		(existing.LegacyShopID != legacy || existing.ShopDomain != domain) {
		return ErrBindingConflict
	}
	if existingKey, ok := r.legacyIndex[legacy]; ok && existingKey != key {
		return ErrBindingConflict
	}
	if existingKey, ok := r.domainIndex[domain]; ok && existingKey != key {
		return ErrBindingConflict
	}
	return nil
}

func (r *MemoryRepository) ResolveCanonicalIdentity(_ context.Context, legacyShopID string) (shopifyconnector.CanonicalShopIdentity, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	key, ok := r.legacyIndex[strings.TrimSpace(legacyShopID)]
	if !ok {
		return shopifyconnector.CanonicalShopIdentity{}, ErrNotFound
	}
	return r.bindings[key].Identity, nil
}

func (r *MemoryRepository) ResolveLegacyShopID(_ context.Context, identity shopifyconnector.CanonicalShopIdentity) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	binding, ok := r.bindings[identityKey(identity)]
	if !ok {
		return "", ErrNotFound
	}
	return binding.LegacyShopID, nil
}

func (r *MemoryRepository) ResolveIdentityByDomain(_ context.Context, domain string) (shopifyconnector.CanonicalShopIdentity, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	normalized, ok := shopifyconnector.NormalizeShopDomain(domain)
	if !ok {
		return shopifyconnector.CanonicalShopIdentity{}, ErrNotFound
	}
	key, ok := r.domainIndex[normalized]
	if !ok {
		return shopifyconnector.CanonicalShopIdentity{}, ErrNotFound
	}
	return r.bindings[key].Identity, nil
}

func (r *MemoryRepository) CompleteInstallation(_ context.Context, binding Binding, record InstallationRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	var err error
	binding, err = validateAndNormalizeBinding(binding)
	if err != nil {
		return err
	}
	if err := r.saveBindingLocked(binding); err != nil {
		return err
	}
	record.Binding = binding
	record.AccessToken = strings.TrimSpace(record.AccessToken)
	record.RefreshToken = strings.TrimSpace(record.RefreshToken)
	record.CredentialKeyVersion = strings.TrimSpace(record.CredentialKeyVersion)
	record.ShopName = strings.TrimSpace(record.ShopName)
	record.Scopes = append([]string(nil), record.Scopes...)
	r.installations[identityKey(binding.Identity)] = record
	// Explicit OAuth completion supersedes any unlinked credential for this
	// domain. It never promotes pending credentials into a business installation.
	delete(r.pendingInstallations, binding.ShopDomain)
	return nil
}

func (r *MemoryRepository) RotateCredential(
	_ context.Context,
	identity shopifyconnector.CanonicalShopIdentity,
	expectedRefreshToken string,
	replacement OAuthExchangeResult,
	keyVersion string,
	now time.Time,
) (InstallationRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := identityKey(identity)
	record, ok := r.installations[key]
	expectedRefreshToken = strings.TrimSpace(expectedRefreshToken)
	if !ok || record.State != shopifyconnector.InstallationStateInstalled ||
		expectedRefreshToken == "" || len(record.RefreshToken) != len(expectedRefreshToken) ||
		subtle.ConstantTimeCompare([]byte(record.RefreshToken), []byte(expectedRefreshToken)) != 1 {
		return InstallationRecord{}, ErrRepositoryStale
	}
	if err := validateExpiringOAuthResult(replacement); err != nil {
		return InstallationRecord{}, err
	}
	now = now.UTC()
	record.AccessToken = strings.TrimSpace(replacement.AccessToken)
	record.RefreshToken = strings.TrimSpace(replacement.RefreshToken)
	record.AccessTokenExpiresAt = now.Add(replacement.AccessTokenTTL)
	record.RefreshTokenExpiresAt = now.Add(replacement.RefreshTokenTTL)
	record.CredentialKeyVersion = strings.TrimSpace(keyVersion)
	record.Scopes = normalizeScopes(replacement.Scopes)
	record.UpdatedAt = now
	r.installations[key] = record
	return record, nil
}

func (r *MemoryRepository) GetInstallation(_ context.Context, identity shopifyconnector.CanonicalShopIdentity) (InstallationRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	record, ok := r.installations[identityKey(identity)]
	if !ok {
		return InstallationRecord{}, ErrNotFound
	}
	record.Scopes = append([]string(nil), record.Scopes...)
	return record, nil
}

func (r *MemoryRepository) MarkRevoked(_ context.Context, identity shopifyconnector.CanonicalShopIdentity, now time.Time) (InstallationRecord, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.markRevokedLocked(identity, now)
}

func (r *MemoryRepository) markRevokedLocked(identity shopifyconnector.CanonicalShopIdentity, now time.Time) (InstallationRecord, bool, error) {
	key := identityKey(identity)
	record, ok := r.installations[key]
	if !ok {
		return InstallationRecord{}, true, ErrNotFound
	}
	already := record.State == shopifyconnector.InstallationStateRevoked
	if !already {
		record.State = shopifyconnector.InstallationStateRevoked
		record.AccessToken = ""
		record.RefreshToken = ""
		record.AccessTokenExpiresAt = time.Time{}
		record.RefreshTokenExpiresAt = time.Time{}
		record.RevokedAt = now.UTC()
		record.UpdatedAt = now.UTC()
		record.EffectsApplied = false
		r.installations[key] = record
	}
	return record, already, nil
}

func (r *MemoryRepository) MarkRevokedAndEnqueue(_ context.Context, identity shopifyconnector.CanonicalShopIdentity, now time.Time, event OutboxEvent) (InstallationRecord, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	record, ok := r.installations[identityKey(identity)]
	if !ok {
		return InstallationRecord{}, false, ErrNotFound
	}
	if event.Identity != record.Identity || normalizeDomain(event.ShopDomain) != record.ShopDomain {
		return InstallationRecord{}, false, ErrInvalidBinding
	}
	event.ShopDomain = record.ShopDomain
	if err := validateOutboxEvent(event); err != nil {
		return InstallationRecord{}, false, err
	}
	record, already, err := r.markRevokedLocked(identity, now)
	if err != nil {
		return InstallationRecord{}, false, err
	}
	event.ReferenceIDs = append([]string(nil), event.ReferenceIDs...)
	if _, exists := r.outbox[event.ID]; !exists {
		r.outbox[event.ID] = event
	}
	return record, already, nil
}

func (r *MemoryRepository) EnqueueOutbox(_ context.Context, event OutboxEvent) error {
	if err := validateOutboxEvent(event); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.outbox[event.ID]; exists {
		return nil
	}
	event.ShopDomain = normalizeDomain(event.ShopDomain)
	event.ReferenceIDs = append([]string(nil), event.ReferenceIDs...)
	r.outbox[event.ID] = event
	return nil
}

func (r *MemoryRepository) ListOutbox(_ context.Context) ([]OutboxEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	events := make([]OutboxEvent, 0, len(r.outbox))
	for _, event := range r.outbox {
		event.ReferenceIDs = append([]string(nil), event.ReferenceIDs...)
		events = append(events, event)
	}
	sort.Slice(events, func(i, j int) bool { return events[i].ID < events[j].ID })
	return events, nil
}

func (r *MemoryRepository) AppendProtectedDataAccess(
	_ context.Context,
	event ProtectedDataAccessEvent,
) error {
	if err := validateProtectedDataAccessEvent(event); err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.protectedDataAccess[event.ID]; exists {
		return ErrRepositoryStale
	}
	event.OccurredAt = event.OccurredAt.UTC()
	r.protectedDataAccess[event.ID] = event
	return nil
}

func (r *MemoryRepository) ListProtectedDataAccess(
	_ context.Context,
) ([]ProtectedDataAccessEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	events := make([]ProtectedDataAccessEvent, 0, len(r.protectedDataAccess))
	for _, event := range r.protectedDataAccess {
		events = append(events, event)
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].OccurredAt.Equal(events[j].OccurredAt) {
			return events[i].ID < events[j].ID
		}
		return events[i].OccurredAt.Before(events[j].OccurredAt)
	})
	return events, nil
}

func (r *MemoryRepository) CompleteOutbox(_ context.Context, eventID string, outcome string, now time.Time) (OutboxEvent, bool, error) {
	eventID = strings.TrimSpace(eventID)
	outcome = strings.TrimSpace(outcome)
	if eventID == "" || now.IsZero() {
		return OutboxEvent{}, false, ErrInvalidBinding
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	event, ok := r.outbox[eventID]
	if !ok {
		return OutboxEvent{}, false, ErrNotFound
	}
	if !validComplianceOutcome(event, outcome) {
		return OutboxEvent{}, false, ErrInvalidBinding
	}
	if event.CompletedAt != nil {
		if event.Outcome != outcome {
			return OutboxEvent{}, false, ErrRepositoryStale
		}
		return event, true, nil
	}
	completedAt := now.UTC()
	event.CompletedAt = &completedAt
	event.Outcome = outcome
	r.outbox[eventID] = event
	return event, false, nil
}

func validComplianceOutcome(event OutboxEvent, outcome string) bool {
	if event.Kind != "shopify.compliance.requested" {
		return false
	}
	switch event.Topic {
	case "customers/data_request":
		return outcome == "exported" || outcome == "not_found"
	case "customers/redact", "shop/redact":
		return outcome == "anonymized" || outcome == "deleted" || outcome == "not_found"
	default:
		return false
	}
}

func validateOutboxEvent(event OutboxEvent) error {
	domain, ok := shopifyconnector.NormalizeShopDomain(event.ShopDomain)
	if strings.TrimSpace(event.ID) == "" || strings.TrimSpace(event.Kind) == "" ||
		strings.TrimSpace(event.Topic) == "" || event.OccurredAt.IsZero() || !ok || domain != event.ShopDomain ||
		strings.TrimSpace(event.Identity.TenantID) == "" || strings.TrimSpace(event.Identity.ShopID) == "" ||
		((event.CompletedAt == nil) != (event.Outcome == "")) ||
		(event.CompletedAt != nil && !validComplianceOutcome(event, event.Outcome)) {
		return errors.New("connector outbox event is invalid")
	}
	return nil
}

func validateProtectedDataAccessEvent(event ProtectedDataAccessEvent) error {
	if !validEmbeddedAccessEventID(event.ID) ||
		strings.TrimSpace(event.Identity.TenantID) == "" || strings.TrimSpace(event.Identity.ShopID) == "" ||
		!validEmbeddedActorID(event.ActorID) || event.Surface != "embeddedOrderPreview" ||
		event.FieldSet != "name,address,phone,email" || event.RecordCount < 0 || event.RecordCount > 10 ||
		event.OccurredAt.IsZero() {
		return errors.New("protected data access event is invalid")
	}
	return nil
}

func validEmbeddedAccessEventID(value string) bool {
	const prefix = "embedded-"
	if !strings.HasPrefix(value, prefix) || len(value) != len(prefix)+24 {
		return false
	}
	for _, char := range value[len(prefix):] {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') || char == '-' || char == '_') {
			return false
		}
	}
	return true
}

func validEmbeddedActorID(value string) bool {
	const prefix = "shopify-user:"
	if !strings.HasPrefix(value, prefix) || len(value) == len(prefix) || len(value) > len(prefix)+20 {
		return false
	}
	for _, char := range value[len(prefix):] {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func (r *MemoryRepository) MarkRevocationEffectsApplied(_ context.Context, identity shopifyconnector.CanonicalShopIdentity, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := identityKey(identity)
	record, ok := r.installations[key]
	if !ok {
		return ErrNotFound
	}
	record.EffectsApplied = true
	record.UpdatedAt = now.UTC()
	r.installations[key] = record
	return nil
}

func (r *MemoryRepository) CreateOAuthGrant(_ context.Context, grant OAuthGrant) error {
	if err := validateOAuthGrant(grant); err != nil {
		return err
	}
	binding, err := validateAndNormalizeBinding(Binding{
		Identity: grant.Identity, LegacyShopID: grant.LegacyShopID, ShopDomain: grant.ShopDomain,
	})
	if err != nil {
		return err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.checkBindingLocked(binding); err != nil {
		return err
	}
	if _, exists := r.oauthGrants[grant.ID]; exists {
		return ErrOAuthGrantForbidden
	}
	grant.ShopDomain, _ = shopifyconnector.NormalizeShopDomain(grant.ShopDomain)
	r.oauthGrants[grant.ID] = grant
	return nil
}

func (r *MemoryRepository) BindOAuthGrant(_ context.Context, grantID string, browserNonceHash string, now time.Time) (OAuthGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	grant, ok := r.oauthGrants[grantID]
	if !ok || !grant.ConsumedAt.IsZero() || !now.UTC().Before(grant.ExpiresAt) || !validNonceHash(browserNonceHash) {
		return OAuthGrant{}, ErrOAuthGrantForbidden
	}
	if grant.BrowserNonceHash != "" && subtle.ConstantTimeCompare([]byte(grant.BrowserNonceHash), []byte(browserNonceHash)) != 1 {
		return OAuthGrant{}, ErrOAuthGrantForbidden
	}
	grant.BrowserNonceHash = browserNonceHash
	r.oauthGrants[grantID] = grant
	return grant, nil
}

func (r *MemoryRepository) ConsumeOAuthGrant(_ context.Context, grantID string, browserNonceHash string, shopDomain string, now time.Time) (OAuthGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	grant, ok := r.oauthGrants[grantID]
	normalizedDomain, validDomain := shopifyconnector.NormalizeShopDomain(shopDomain)
	if !ok || !validDomain || grant.ShopDomain != normalizedDomain || !grant.ConsumedAt.IsZero() || !now.UTC().Before(grant.ExpiresAt) || grant.BrowserNonceHash == "" ||
		len(grant.BrowserNonceHash) != len(browserNonceHash) ||
		subtle.ConstantTimeCompare([]byte(grant.BrowserNonceHash), []byte(browserNonceHash)) != 1 {
		return OAuthGrant{}, ErrOAuthGrantForbidden
	}
	grant.ConsumedAt = now.UTC()
	delete(r.oauthGrants, grantID)
	return grant, nil
}

func validateAndNormalizeBinding(binding Binding) (Binding, error) {
	domain, ok := shopifyconnector.NormalizeShopDomain(binding.ShopDomain)
	request := shopifyconnector.CompleteOAuthRequest{
		Identity:     binding.Identity,
		Context:      shopifyconnector.RequestContext{CorrelationID: "binding-validation", RequestID: "binding-validation"},
		LegacyShopID: binding.LegacyShopID, ShopDomain: binding.ShopDomain, AuthorizationCode: "binding-validation",
	}
	if !ok || shopifyconnector.ValidateCompleteOAuthRequest(request) != nil {
		return Binding{}, ErrInvalidBinding
	}
	binding.LegacyShopID = strings.TrimSpace(binding.LegacyShopID)
	binding.ShopDomain = domain
	return binding, nil
}

func validateOAuthGrant(grant OAuthGrant) error {
	if !grant.ConsumedAt.IsZero() || grant.BrowserNonceHash != "" {
		return ErrOAuthGrantForbidden
	}
	return validateStoredOAuthGrant(grant)
}

func validateStoredOAuthGrant(grant OAuthGrant) error {
	if !validOpaqueSecret(grant.ID) || grant.ExpiresAt.IsZero() ||
		(grant.BrowserNonceHash != "" && !validNonceHash(grant.BrowserNonceHash)) ||
		(!grant.ConsumedAt.IsZero() && grant.BrowserNonceHash == "") {
		return ErrOAuthGrantForbidden
	}
	_, err := validateAndNormalizeBinding(Binding{
		Identity: grant.Identity, LegacyShopID: grant.LegacyShopID, ShopDomain: grant.ShopDomain,
	})
	if err != nil || shopifyconnector.ValidateInstallationProbeRequest(shopifyconnector.InstallationProbeRequest{
		Identity: grant.Identity, Context: grant.Context,
	}) != nil {
		return ErrOAuthGrantForbidden
	}
	return nil
}

func validNonceHash(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

func normalizeDomain(value string) string {
	normalized, _ := shopifyconnector.NormalizeShopDomain(value)
	return normalized
}

func identityKey(identity shopifyconnector.CanonicalShopIdentity) string {
	return strings.TrimSpace(identity.TenantID) + "/" + strings.TrimSpace(identity.ShopID)
}

var _ Repository = (*MemoryRepository)(nil)
