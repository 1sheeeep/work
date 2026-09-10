package installations

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"math"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

// These receipts belong to the verified app/uninstalled ingress, not to the
// business revoke API. Never deduplicate by shop payload alone: two real
// uninstall cycles can have identical bodies.
type UninstallWebhook struct {
	ShopDomain  string
	DeliveryID  string
	EventID     string
	PayloadHash string
	observation *uninstallObservation
}

type UninstallWebhookReceipt struct {
	ID          string                                 `json:"id"`
	Keys        []string                               `json:"keys"`
	EventKey    string                                 `json:"eventKey,omitempty"`
	ShopDomain  string                                 `json:"shopDomain"`
	PayloadHash string                                 `json:"payloadHash"`
	Identity    shopifyconnector.CanonicalShopIdentity `json:"identity"`
	Status      string                                 `json:"status"`
	ReceivedAt  time.Time                              `json:"receivedAt"`
}

const (
	uninstallEffectsPending = "effects_pending"
	uninstallCompleted      = "completed"
	uninstallSuperseded     = "superseded"
	uninstallUnbound        = "no_installation"
	uninstallStillActive    = "authorization_active"
)

type UninstallWebhookReceiver interface {
	ReceiveUninstallWebhook(context.Context, UninstallWebhook) error
}

func validWebhookIdentifier(value string) bool {
	if value == "" || len(value) > 100 || value != strings.TrimSpace(value) {
		return false
	}
	for _, char := range value {
		if !((char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || strings.ContainsRune("._:-", char)) {
			return false
		}
	}
	return true
}

func validWebhookDigest(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size && value == strings.ToLower(value)
}

func (delivery UninstallWebhook) keys() ([]string, error) {
	domain, ok := shopifyconnector.NormalizeShopDomain(delivery.ShopDomain)
	if !ok || domain != delivery.ShopDomain || !validWebhookIdentifier(delivery.DeliveryID) ||
		(delivery.EventID != "" && !validWebhookIdentifier(delivery.EventID)) || !validWebhookDigest(delivery.PayloadHash) {
		return nil, ErrInvalidBinding
	}
	key := func(kind, id string) string {
		digest := sha256.Sum256([]byte(domain + "\x00app/uninstalled\x00" + kind + "\x00" + id))
		return hex.EncodeToString(digest[:])
	}
	keys := []string{key("delivery", delivery.DeliveryID)}
	if delivery.EventID != "" {
		keys = append(keys, key("event", delivery.EventID))
	}
	return keys, nil
}

// RecordUninstallWebhook commits the receipt, pending-credential fence,
// credential revocation and outbox event together. A retry NEVER revokes again.
// expectedIdentity closes the resolve/lock race with first native association.
func (r *MemoryRepository) RecordUninstallWebhook(ctx context.Context, delivery UninstallWebhook, expectedIdentity shopifyconnector.CanonicalShopIdentity, now time.Time) (UninstallWebhookReceipt, bool, error) {
	keys, err := delivery.keys()
	if err != nil || now.IsZero() {
		return UninstallWebhookReceipt{}, false, ErrInvalidBinding
	}
	if err := ctx.Err(); err != nil {
		return UninstallWebhookReceipt{}, false, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return UninstallWebhookReceipt{}, false, err
	}
	var existingID string
	for _, key := range keys {
		if id := r.uninstallReceiptIndex[key]; id != "" {
			if existingID != "" && existingID != id {
				return UninstallWebhookReceipt{}, false, ErrRepositoryStale
			}
			existingID = id
		}
	}
	if existingID != "" {
		receipt := r.uninstallReceipts[existingID]
		if receipt.ShopDomain != delivery.ShopDomain || receipt.PayloadHash != delivery.PayloadHash ||
			(len(keys) == 2 && receipt.EventKey != "" && receipt.EventKey != keys[1]) {
			return UninstallWebhookReceipt{}, false, ErrRepositoryStale
		}
		receipt.Keys = append([]string(nil), receipt.Keys...)
		changed := false
		if len(keys) == 2 && receipt.EventKey == "" {
			receipt.EventKey = keys[1]
			changed = true
		}
		for _, key := range keys {
			if r.uninstallReceiptIndex[key] == "" {
				r.uninstallReceiptIndex[key] = receipt.ID
				receipt.Keys = append(receipt.Keys, key)
				changed = true
			}
		}
		r.uninstallReceipts[receipt.ID] = receipt
		return cloneUninstallReceipt(receipt), changed, nil
	}
	key := r.domainIndex[delivery.ShopDomain]
	if r.bindings[key].Identity != expectedIdentity || r.pendingRevision == math.MaxUint64 {
		return UninstallWebhookReceipt{}, false, ErrRepositoryStale
	}
	receipt := UninstallWebhookReceipt{ID: keys[0], Keys: keys, ShopDomain: delivery.ShopDomain,
		PayloadHash: delivery.PayloadHash, Status: uninstallUnbound, ReceivedAt: now.UTC()}
	if len(keys) == 2 {
		receipt.EventKey = keys[1]
	}
	record, installed := r.installations[key]
	if observation := delivery.observation; observation != nil {
		currentHash := uninstallCredentialHash(record, installed)
		if (installed && currentHash == "") || observation.pendingRevision != r.pendingRevision || observation.credentialHash != currentHash {
			return UninstallWebhookReceipt{}, false, ErrRepositoryStale
		}
		if observation.preserve {
			receipt.Status = uninstallStillActive
			if installed {
				receipt.Identity = record.Identity
			}
			r.uninstallReceipts[receipt.ID] = receipt
			for _, key := range keys {
				r.uninstallReceiptIndex[key] = receipt.ID
			}
			return cloneUninstallReceipt(receipt), true, nil
		}
	}
	// Older releases persisted delivery IDs in the revocation outbox. Honor
	// that evidence too, but only for this verified shop and canonical identity.
	legacyEvent, legacyFound := r.outbox["shopify-revocation/shopify-uninstall:"+delivery.DeliveryID]
	legacySeen := legacyFound && legacyEvent.Kind == "shopify.installation.revoked" &&
		legacyEvent.Topic == "app/uninstalled" && legacyEvent.ShopDomain == delivery.ShopDomain && legacyEvent.Identity == expectedIdentity
	if legacySeen && !installed {
		return UninstallWebhookReceipt{}, false, ErrRepositoryStale
	}
	var event OutboxEvent
	if installed {
		receipt.Identity = record.Identity
		receipt.Status = uninstallEffectsPending
		event = OutboxEvent{ID: uninstallOutboxID(receipt.ID), Kind: "shopify.installation.revoked",
			Identity: record.Identity, ShopDomain: record.ShopDomain, Topic: "app/uninstalled", OccurredAt: now.UTC()}
		if err := validateOutboxEvent(event); err != nil {
			return UninstallWebhookReceipt{}, false, err
		}
		if _, exists := r.outbox[event.ID]; exists {
			return UninstallWebhookReceipt{}, false, ErrRepositoryStale
		}
	}
	// All fallible validation precedes these in-memory mutations; FileRepository
	// publishes the candidate only after a successful encrypted-file commit.
	if !legacySeen {
		delete(r.pendingInstallations, delivery.ShopDomain)
		r.pendingRevision++
	}
	if legacySeen {
		if record.State == shopifyconnector.InstallationStateInstalled {
			receipt.Status = uninstallSuperseded
		} else if record.State != shopifyconnector.InstallationStateRevoked {
			return UninstallWebhookReceipt{}, false, ErrRepositoryStale
		} else if record.EffectsApplied {
			receipt.Status = uninstallCompleted
		}
	} else if installed {
		record, _, _ = r.markRevokedLocked(record.Identity, now)
		if record.EffectsApplied {
			receipt.Status = uninstallCompleted
		}
		r.outbox[event.ID] = event
	}
	r.uninstallReceipts[receipt.ID] = receipt
	for _, key := range keys {
		r.uninstallReceiptIndex[key] = receipt.ID
	}
	return cloneUninstallReceipt(receipt), true, nil
}

func (r *MemoryRepository) CompleteUninstallWebhook(ctx context.Context, receiptID, status string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if status != uninstallCompleted && status != uninstallSuperseded {
		return ErrInvalidBinding
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	receipt, ok := r.uninstallReceipts[receiptID]
	if !ok {
		return ErrNotFound
	}
	if receipt.Status != uninstallEffectsPending {
		if receipt.Status == status {
			return nil
		}
		return ErrRepositoryStale
	}
	receipt.Status = status
	r.uninstallReceipts[receipt.ID] = receipt
	return nil
}

func (r *FileRepository) RecordUninstallWebhook(ctx context.Context, delivery UninstallWebhook, expectedIdentity shopifyconnector.CanonicalShopIdentity, now time.Time) (UninstallWebhookReceipt, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	receipt, changed, err := candidate.RecordUninstallWebhook(ctx, delivery, expectedIdentity, now)
	if err != nil {
		return UninstallWebhookReceipt{}, false, err
	}
	if changed {
		if err := r.commit(candidate); err != nil {
			return UninstallWebhookReceipt{}, false, err
		}
	}
	return receipt, changed, nil
}

func (r *FileRepository) CompleteUninstallWebhook(ctx context.Context, receiptID, status string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepository(r.inner)
	if err := candidate.CompleteUninstallWebhook(ctx, receiptID, status); err != nil {
		return err
	}
	return r.commit(candidate)
}

func cloneUninstallReceipt(receipt UninstallWebhookReceipt) UninstallWebhookReceipt {
	receipt.Keys = append([]string(nil), receipt.Keys...)
	return receipt
}

func (r *MemoryRepository) restoreUninstallReceipt(receipt UninstallWebhookReceipt) error {
	domain, ok := shopifyconnector.NormalizeShopDomain(receipt.ShopDomain)
	if !ok || domain != receipt.ShopDomain || !validWebhookDigest(receipt.ID) ||
		!validWebhookDigest(receipt.PayloadHash) || len(receipt.Keys) == 0 || receipt.Keys[0] != receipt.ID || receipt.ReceivedAt.IsZero() {
		return ErrInvalidBinding
	}
	if receipt.Status == uninstallUnbound || (receipt.Status == uninstallStillActive && receipt.Identity == (shopifyconnector.CanonicalShopIdentity{})) {
		if receipt.Identity != (shopifyconnector.CanonicalShopIdentity{}) {
			return ErrInvalidBinding
		}
	} else {
		if receipt.Status != uninstallEffectsPending && receipt.Status != uninstallCompleted && receipt.Status != uninstallSuperseded && receipt.Status != uninstallStillActive {
			return ErrInvalidBinding
		}
		if r.bindings[r.domainIndex[domain]].Identity != receipt.Identity || receipt.Identity == (shopifyconnector.CanonicalShopIdentity{}) {
			return ErrInvalidBinding
		}
	}
	seen := make(map[string]bool)
	for _, key := range receipt.Keys {
		if !validWebhookDigest(key) || r.uninstallReceiptIndex[key] != "" || seen[key] {
			return ErrInvalidBinding
		}
		seen[key] = true
	}
	if receipt.EventKey != "" && (!seen[receipt.EventKey] || receipt.EventKey == receipt.ID) {
		return ErrInvalidBinding
	}
	r.uninstallReceipts[receipt.ID] = cloneUninstallReceipt(receipt)
	for _, key := range receipt.Keys {
		r.uninstallReceiptIndex[key] = receipt.ID
	}
	return nil
}

func uninstallRequestContext(receiptID string) shopifyconnector.RequestContext {
	return shopifyconnector.RequestContext{RequestID: "shopify-uninstall:" + receiptID, CorrelationID: "shopify-uninstall:" + receiptID}
}

func uninstallOutboxID(receiptID string) string {
	return "shopify-revocation/" + uninstallRequestContext(receiptID).RequestID
}

func (s *Service) ReceiveUninstallWebhook(ctx context.Context, delivery UninstallWebhook) error {
	if s == nil || s.repository == nil {
		return errors.New("installation repository unavailable")
	}
	identity, err := s.repository.ResolveIdentityByDomain(ctx, delivery.ShopDomain)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	if err == nil {
		unlock := s.lockIdentity(identity)
		defer unlock()
	}
	known, err := s.repository.HasUninstallWebhook(ctx, delivery)
	if err != nil {
		return err
	}
	if !known {
		probeCtx, cancel := context.WithTimeout(ctx, uninstallObservationTimeout)
		defer cancel()
		delivery.observation, err = s.observeUninstall(probeCtx, identity, delivery.ShopDomain)
		if err != nil {
			return err
		}
	}
	receipt, _, err := s.repository.RecordUninstallWebhook(ctx, delivery, identity, s.now().UTC())
	if err != nil || receipt.Status != uninstallEffectsPending {
		return err
	}
	// The first atomic write already revoked this event's credential. A retry
	// may finish effects, but must never call Revoke again after a reinstall.
	current, err := s.repository.GetInstallation(ctx, receipt.Identity)
	if err != nil {
		return err
	}
	if current.State == shopifyconnector.InstallationStateInstalled {
		return s.repository.CompleteUninstallWebhook(ctx, receipt.ID, uninstallSuperseded)
	}
	if current.State != shopifyconnector.InstallationStateRevoked || current.Identity != identity {
		return ErrRepositoryStale
	}
	request := shopifyconnector.InstallationRevokeRequest{Identity: receipt.Identity, Context: uninstallRequestContext(receipt.ID)}
	if _, err := s.applyRevocationEffectsLocked(ctx, request, current, true); err != nil {
		return err
	}
	return s.repository.CompleteUninstallWebhook(ctx, receipt.ID, uninstallCompleted)
}
