package installations

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	fileRepositoryVersion = 1
	fileRepositoryAAD     = "xz-erp-shopify-connector-installations-v1"
)

type encryptedFileEnvelope struct {
	Version    int    `json:"version"`
	Generation uint64 `json:"generation,omitempty"`
	Nonce      string `json:"nonce"`
	Ciphertext string `json:"ciphertext"`
}

type fileRepositoryState struct {
	Bindings             []Binding                   `json:"bindings"`
	Installations        []InstallationRecord        `json:"installations"`
	OAuthGrants          []OAuthGrant                `json:"oauthGrants,omitempty"`
	Outbox               []OutboxEvent               `json:"outbox,omitempty"`
	ProtectedDataAccess  []ProtectedDataAccessEvent  `json:"protectedDataAccess,omitempty"`
	PendingInstallations []PendingInstallationRecord `json:"pendingInstallations,omitempty"`
	PendingRevision      uint64                      `json:"pendingRevision,omitempty"`
	UninstallReceipts    []UninstallWebhookReceipt   `json:"uninstallReceipts,omitempty"`
}

type FileRepository struct {
	mu         sync.RWMutex
	path       string
	key        []byte
	generation uint64
	inner      *MemoryRepository
}

func cloneMemoryRepository(source *MemoryRepository) *MemoryRepository {
	source.mu.RLock()
	defer source.mu.RUnlock()
	return cloneMemoryRepositoryLocked(source)
}

func cloneMemoryRepositoryLocked(source *MemoryRepository) *MemoryRepository {
	clone := NewMemoryRepository()
	clone.pendingRevision = source.pendingRevision
	for id, receipt := range source.uninstallReceipts {
		clone.uninstallReceipts[id] = cloneUninstallReceipt(receipt)
	}
	for key, id := range source.uninstallReceiptIndex {
		clone.uninstallReceiptIndex[key] = id
	}
	for domain, record := range source.pendingInstallations {
		record.Scopes = append([]string(nil), record.Scopes...)
		clone.pendingInstallations[domain] = record
	}
	for key, binding := range source.bindings {
		clone.bindings[key] = binding
	}
	for legacyShopID, key := range source.legacyIndex {
		clone.legacyIndex[legacyShopID] = key
	}
	for domain, key := range source.domainIndex {
		clone.domainIndex[domain] = key
	}
	for key, record := range source.installations {
		record.Scopes = append([]string(nil), record.Scopes...)
		clone.installations[key] = record
	}
	for grantID, grant := range source.oauthGrants {
		clone.oauthGrants[grantID] = grant
	}
	for eventID, event := range source.outbox {
		event.ReferenceIDs = append([]string(nil), event.ReferenceIDs...)
		clone.outbox[eventID] = event
	}
	for eventID, event := range source.protectedDataAccess {
		clone.protectedDataAccess[eventID] = event
	}
	return clone
}

func (r *FileRepository) ImportLegacyInstallations(ctx context.Context, records []LegacyInstallationImport) (LegacyImportResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	result, err := candidate.ImportLegacyInstallations(ctx, records)
	if err != nil {
		return LegacyImportResult{}, err
	}
	if result.Imported == 0 {
		return result, nil
	}
	if err := ctx.Err(); err != nil {
		return LegacyImportResult{}, err
	}
	if err := r.commit(candidate); err != nil {
		return LegacyImportResult{}, err
	}
	return result, nil
}

func (r *FileRepository) String() string {
	if r == nil {
		return "fileRepository{nil}"
	}
	return "fileRepository{path=" + r.path + " key=[REDACTED]}"
}

func (r *FileRepository) GoString() string { return r.String() }

func OpenFileRepository(path string, key []byte) (*FileRepository, error) {
	if len(key) != 32 {
		return nil, errors.New("connector repository encryption key must contain exactly 32 bytes")
	}
	path, err := filepath.Abs(path)
	if err != nil || path == "" {
		return nil, errors.New("connector repository path is invalid")
	}
	r := &FileRepository{path: path, key: append([]byte(nil), key...), inner: NewMemoryRepository()}
	if err := r.load(); err != nil {
		return nil, err
	}
	return r, nil
}

func (r *FileRepository) SaveBinding(ctx context.Context, binding Binding) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.SaveBinding(ctx, binding); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) ResolveCanonicalIdentity(ctx context.Context, legacyShopID string) (shopifyconnector.CanonicalShopIdentity, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.ResolveCanonicalIdentity(ctx, legacyShopID)
}

func (r *FileRepository) ResolveLegacyShopID(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity) (string, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.ResolveLegacyShopID(ctx, identity)
}

func (r *FileRepository) ResolveIdentityByDomain(ctx context.Context, domain string) (shopifyconnector.CanonicalShopIdentity, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.ResolveIdentityByDomain(ctx, domain)
}

func (r *FileRepository) CompleteInstallation(ctx context.Context, binding Binding, record InstallationRecord) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.CompleteInstallation(ctx, binding, record); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) GetInstallation(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity) (InstallationRecord, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.GetInstallation(ctx, identity)
}

func (r *FileRepository) RotateCredential(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity, expectedRefreshToken string, replacement OAuthExchangeResult, keyVersion string, now time.Time) (InstallationRecord, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	record, err := candidate.RotateCredential(ctx, identity, expectedRefreshToken, replacement, keyVersion, now)
	if err != nil {
		return InstallationRecord{}, err
	}
	if err := r.commit(candidate); err != nil {
		return InstallationRecord{}, err
	}
	return record, nil
}

func (r *FileRepository) MarkRevoked(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity, now time.Time) (InstallationRecord, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	record, already, err := candidate.MarkRevoked(ctx, identity, now)
	if err != nil {
		return record, already, err
	}
	if err := r.commit(candidate); err != nil {
		return InstallationRecord{}, false, err
	}
	return record, already, nil
}

func (r *FileRepository) MarkRevokedAndEnqueue(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity, now time.Time, event OutboxEvent) (InstallationRecord, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	record, already, err := candidate.MarkRevokedAndEnqueue(ctx, identity, now, event)
	if err != nil {
		return InstallationRecord{}, false, err
	}
	if err := r.commit(candidate); err != nil {
		return InstallationRecord{}, false, err
	}
	return record, already, nil
}

func (r *FileRepository) EnqueueOutbox(ctx context.Context, event OutboxEvent) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.EnqueueOutbox(ctx, event); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) ListOutbox(ctx context.Context) ([]OutboxEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.ListOutbox(ctx)
}

func (r *FileRepository) CompleteOutbox(ctx context.Context, eventID string, outcome string, now time.Time) (OutboxEvent, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	event, already, err := candidate.CompleteOutbox(ctx, eventID, outcome, now)
	if err != nil {
		return OutboxEvent{}, false, err
	}
	if !already {
		if err := r.commit(candidate); err != nil {
			return OutboxEvent{}, false, err
		}
	}
	return event, already, nil
}

func (r *FileRepository) AppendProtectedDataAccess(
	ctx context.Context,
	event ProtectedDataAccessEvent,
) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.AppendProtectedDataAccess(ctx, event); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) ListProtectedDataAccess(
	ctx context.Context,
) ([]ProtectedDataAccessEvent, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.inner.ListProtectedDataAccess(ctx)
}

func (r *FileRepository) MarkRevocationEffectsApplied(ctx context.Context, identity shopifyconnector.CanonicalShopIdentity, now time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.MarkRevocationEffectsApplied(ctx, identity, now); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) CreateOAuthGrant(ctx context.Context, grant OAuthGrant) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.CreateOAuthGrant(ctx, grant); err != nil {
		return err
	}
	return r.commit(candidate)
}

func (r *FileRepository) BindOAuthGrant(ctx context.Context, grantID string, browserNonceHash string, now time.Time) (OAuthGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	grant, err := candidate.BindOAuthGrant(ctx, grantID, browserNonceHash, now)
	if err != nil {
		return OAuthGrant{}, err
	}
	if err := r.commit(candidate); err != nil {
		return OAuthGrant{}, err
	}
	return grant, nil
}

func (r *FileRepository) ConsumeOAuthGrant(ctx context.Context, grantID string, browserNonceHash string, shopDomain string, now time.Time) (OAuthGrant, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	grant, err := candidate.ConsumeOAuthGrant(ctx, grantID, browserNonceHash, shopDomain, now)
	if err != nil {
		return OAuthGrant{}, err
	}
	if err := r.commit(candidate); err != nil {
		return OAuthGrant{}, err
	}
	return grant, nil
}

func (r *FileRepository) load() error {
	raw, err := os.ReadFile(r.path)
	if errors.Is(err, os.ErrNotExist) {
		r.inner = NewMemoryRepository()
		r.generation = 0
		return nil
	}
	if err != nil {
		return err
	}
	var envelope encryptedFileEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil || envelope.Version != fileRepositoryVersion {
		return errors.New("connector repository envelope is invalid")
	}
	nonce, err := base64.RawStdEncoding.DecodeString(envelope.Nonce)
	if err != nil {
		return errors.New("connector repository nonce is invalid")
	}
	ciphertext, err := base64.RawStdEncoding.DecodeString(envelope.Ciphertext)
	if err != nil {
		return errors.New("connector repository ciphertext is invalid")
	}
	block, err := aes.NewCipher(r.key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	plain, err := aead.Open(nil, nonce, ciphertext, []byte(fileRepositoryAAD))
	if err != nil {
		return errors.New("connector repository could not be decrypted")
	}
	var state fileRepositoryState
	if err := json.Unmarshal(plain, &state); err != nil {
		return errors.New("connector repository payload is invalid")
	}
	inner := NewMemoryRepository()
	for _, binding := range state.Bindings {
		if err := inner.SaveBinding(context.Background(), binding); err != nil {
			return errors.New("connector repository contains conflicting bindings")
		}
	}
	for _, record := range state.Installations {
		if validateNativeLinkReceipt(record) != nil {
			return errors.New("connector repository contains an invalid native link receipt")
		}
		if err := inner.CompleteInstallation(context.Background(), record.Binding, record); err != nil {
			return errors.New("connector repository contains an invalid installation")
		}
	}
	for _, grant := range state.OAuthGrants {
		if err := validateStoredOAuthGrant(grant); err != nil {
			return errors.New("connector repository contains an invalid OAuth grant")
		}
		grant.ShopDomain, _ = shopifyconnector.NormalizeShopDomain(grant.ShopDomain)
		if _, exists := inner.oauthGrants[grant.ID]; exists {
			return errors.New("connector repository contains duplicate OAuth grants")
		}
		inner.oauthGrants[grant.ID] = grant
	}
	inner.pendingRevision = state.PendingRevision
	for _, record := range state.PendingInstallations {
		if validatePendingInstallation(record) != nil || state.PendingRevision == 0 {
			return errors.New("connector repository contains an invalid pending installation")
		}
		if _, exists := inner.pendingInstallations[record.ShopDomain]; exists {
			return errors.New("connector repository contains duplicate pending installations")
		}
		if _, installed := inner.installations[inner.domainIndex[record.ShopDomain]]; installed {
			return errors.New("connector repository contains an installed pending shop")
		}
		inner.pendingInstallations[record.ShopDomain] = record
	}
	for _, event := range state.Outbox {
		if err := inner.EnqueueOutbox(context.Background(), event); err != nil {
			return errors.New("connector repository contains an invalid outbox event")
		}
	}
	for _, receipt := range state.UninstallReceipts {
		if err := inner.restoreUninstallReceipt(receipt); err != nil {
			return errors.New("connector repository contains an invalid uninstall receipt")
		}
	}
	for _, event := range state.ProtectedDataAccess {
		if err := inner.AppendProtectedDataAccess(context.Background(), event); err != nil {
			return errors.New("connector repository contains an invalid protected data access event")
		}
	}
	r.inner = inner
	r.generation = envelope.Generation
	return nil
}

func (r *FileRepository) commit(candidate *MemoryRepository) error {
	if err := os.MkdirAll(filepath.Dir(r.path), 0o700); err != nil {
		return errors.New("connector repository lock is unavailable")
	}
	release, err := acquireRepositoryFileLock(r.path + ".lock")
	if err != nil {
		return errors.New("connector repository lock is unavailable")
	}
	defer release()
	diskGeneration, err := readRepositoryGeneration(r.path)
	if err != nil {
		return err
	}
	if diskGeneration != r.generation || diskGeneration == math.MaxUint64 {
		return ErrRepositoryStale
	}
	nextGeneration := diskGeneration + 1
	if err := r.persist(candidate, nextGeneration); err != nil {
		return err
	}
	r.inner = candidate
	r.generation = nextGeneration
	return nil
}

func readRepositoryGeneration(path string) (uint64, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return 0, nil
	}
	if err != nil {
		return 0, errors.New("connector repository generation is unavailable")
	}
	var envelope encryptedFileEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil || envelope.Version != fileRepositoryVersion {
		return 0, errors.New("connector repository envelope is invalid")
	}
	return envelope.Generation, nil
}

func (r *FileRepository) persist(candidate *MemoryRepository, generation uint64) error {
	state := snapshotMemoryRepository(candidate)
	plain, err := json.Marshal(state)
	if err != nil {
		return err
	}
	block, err := aes.NewCipher(r.key)
	if err != nil {
		return err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return err
	}
	envelope := encryptedFileEnvelope{
		Version: fileRepositoryVersion, Generation: generation,
		Nonce: base64.RawStdEncoding.EncodeToString(nonce),
		Ciphertext: base64.RawStdEncoding.EncodeToString(
			aead.Seal(nil, nonce, plain, []byte(fileRepositoryAAD))),
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(r.path), ".shopify-connector-*.tmp")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o600); err != nil {
		_ = temp.Close()
		return err
	}
	if _, err := temp.Write(raw); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, r.path)
}

func snapshotMemoryRepository(inner *MemoryRepository) fileRepositoryState {
	inner.mu.RLock()
	defer inner.mu.RUnlock()
	state := fileRepositoryState{
		PendingRevision:     inner.pendingRevision,
		Bindings:            make([]Binding, 0, len(inner.bindings)),
		Installations:       make([]InstallationRecord, 0, len(inner.installations)),
		OAuthGrants:         make([]OAuthGrant, 0, len(inner.oauthGrants)),
		Outbox:              make([]OutboxEvent, 0, len(inner.outbox)),
		ProtectedDataAccess: make([]ProtectedDataAccessEvent, 0, len(inner.protectedDataAccess)),
	}
	for _, record := range inner.pendingInstallations {
		record.Scopes = append([]string(nil), record.Scopes...)
		state.PendingInstallations = append(state.PendingInstallations, record)
	}
	for _, receipt := range inner.uninstallReceipts {
		state.UninstallReceipts = append(state.UninstallReceipts, cloneUninstallReceipt(receipt))
	}
	for _, binding := range inner.bindings {
		state.Bindings = append(state.Bindings, binding)
	}
	for _, record := range inner.installations {
		record.Scopes = append([]string(nil), record.Scopes...)
		state.Installations = append(state.Installations, record)
	}
	for _, grant := range inner.oauthGrants {
		state.OAuthGrants = append(state.OAuthGrants, grant)
	}
	for _, event := range inner.outbox {
		event.ReferenceIDs = append([]string(nil), event.ReferenceIDs...)
		state.Outbox = append(state.Outbox, event)
	}
	for _, event := range inner.protectedDataAccess {
		state.ProtectedDataAccess = append(state.ProtectedDataAccess, event)
	}
	sort.Slice(state.Bindings, func(i, j int) bool {
		return identityKey(state.Bindings[i].Identity) < identityKey(state.Bindings[j].Identity)
	})
	sort.Slice(state.Installations, func(i, j int) bool {
		return identityKey(state.Installations[i].Identity) < identityKey(state.Installations[j].Identity)
	})
	sort.Slice(state.OAuthGrants, func(i, j int) bool {
		return state.OAuthGrants[i].ID < state.OAuthGrants[j].ID
	})
	sort.Slice(state.PendingInstallations, func(i, j int) bool {
		return state.PendingInstallations[i].ShopDomain < state.PendingInstallations[j].ShopDomain
	})
	sort.Slice(state.UninstallReceipts, func(i, j int) bool { return state.UninstallReceipts[i].ID < state.UninstallReceipts[j].ID })
	sort.Slice(state.Outbox, func(i, j int) bool { return state.Outbox[i].ID < state.Outbox[j].ID })
	sort.Slice(state.ProtectedDataAccess, func(i, j int) bool {
		if state.ProtectedDataAccess[i].OccurredAt.Equal(state.ProtectedDataAccess[j].OccurredAt) {
			return state.ProtectedDataAccess[i].ID < state.ProtectedDataAccess[j].ID
		}
		return state.ProtectedDataAccess[i].OccurredAt.Before(state.ProtectedDataAccess[j].OccurredAt)
	})
	return state
}

var _ Repository = (*FileRepository)(nil)
var _ LegacyInstallationImporter = (*FileRepository)(nil)
