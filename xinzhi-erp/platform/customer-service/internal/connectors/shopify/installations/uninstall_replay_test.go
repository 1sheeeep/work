package installations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func sendUninstallFixture(t *testing.T, handler *Handler, webhookID, eventID string) *httptest.ResponseRecorder {
	t.Helper()
	raw := []byte(`{"id":123,"myshopify_domain":"demo.myshopify.com"}`)
	return sendUninstallPayload(t, handler, raw, "demo.myshopify.com", webhookID, eventID)
}

func sendUninstallPayload(t *testing.T, handler *Handler, raw []byte, domain, webhookID, eventID string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, AppUninstalledWebhookPath, bytes.NewReader(raw))
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Shopify-Topic", "app/uninstalled")
	r.Header.Set("X-Shopify-Shop-Domain", domain)
	r.Header.Set("X-Shopify-Webhook-Id", webhookID)
	r.Header.Set("X-Shopify-Event-Id", eventID)
	r.Header.Set("X-Shopify-Hmac-Sha256", shopifyWebhookHMAC(raw, "app-secret"))
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, r)
	return w
}

func TestUninstallReplayDoesNotRevokeReinstalledShop(t *testing.T) {
	exchanger := &recordingExchanger{result: OAuthExchangeResult{AccessToken: "synthetic-old", Scopes: []string{"read_orders"}}}
	handler := newTestHandler(t, exchanger)
	request := shopifyconnector.CompleteOAuthRequest{Identity: identity(), Context: requestContext("fixture-initial"), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com", AuthorizationCode: "synthetic-code"}
	if _, err := handler.lifecycle.CompleteOAuth(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	if response := sendUninstallFixture(t, handler, "delivery-old", "event-old"); response.Code != 204 {
		t.Fatalf("initial uninstall status=%d", response.Code)
	}
	exchanger.result.AccessToken = "synthetic-new"
	request.Context = requestContext("fixture-reinstall")
	if _, err := handler.lifecycle.CompleteOAuth(t.Context(), request); err != nil {
		t.Fatal(err)
	}
	for _, delivery := range []string{"delivery-old", "delivery-retry"} {
		if response := sendUninstallFixture(t, handler, delivery, "event-old"); response.Code != 204 {
			t.Fatalf("repeat status=%d", response.Code)
		}
		current, err := handler.repository.GetInstallation(t.Context(), identity())
		if err != nil || current.State != shopifyconnector.InstallationStateInstalled || current.AccessToken != "synthetic-new" {
			t.Fatal("old uninstall delivery revoked the new installation")
		}
	}
	// An event ID may be absent on a later retry; the delivery alias is durable.
	if response := sendUninstallFixture(t, handler, "delivery-retry", ""); response.Code != 204 {
		t.Fatal("delivery alias was not retained")
	}
	// A new merchant action with an identical body must not be hash-deduplicated.
	if response := sendUninstallFixture(t, handler, "delivery-new", "event-new"); response.Code != 204 {
		t.Fatal("second real uninstall failed")
	}
	current, err := handler.repository.GetInstallation(t.Context(), identity())
	if err != nil || current.State != shopifyconnector.InstallationStateRevoked || current.AccessToken != "" || current.Identity != identity() || current.LegacyShopID != "legacy-shop" {
		t.Fatal("new event did not revoke while preserving canonical mapping")
	}
	events, err := handler.repository.ListOutbox(t.Context())
	if err != nil || len(events) != 2 {
		t.Fatal("expected one outbox entry for each real uninstall")
	}
}

func TestUninstallReplayDoesNotDiscardLaterPendingAuthorization(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	if response := sendUninstallFixture(t, handler, "pending-old", "pending-event"); response.Code != 204 {
		t.Fatalf("initial unbound uninstall status=%d", response.Code)
	}
	now := time.Now().UTC()
	_, revision, _ := handler.repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	pending := PendingInstallationRecord{ShopDomain: "demo.myshopify.com", ShopName: "Synthetic Shop", AccessToken: "synthetic-new", RefreshToken: "synthetic-refresh", CredentialKeyVersion: "fixture-v1", Scopes: []string{"read_orders"}, AuthorizedAt: now, ExpiresAt: now.Add(10 * time.Minute), AccessTokenExpiresAt: now.Add(time.Hour), RefreshTokenExpiresAt: now.Add(24 * time.Hour)}
	if err := handler.repository.SavePendingInstallation(t.Context(), pending, revision, now); err != nil {
		t.Fatal(err)
	}
	if response := sendUninstallFixture(t, handler, "pending-new-delivery", "pending-event"); response.Code != 204 {
		t.Fatalf("repeat status=%d", response.Code)
	}
	current, _, err := handler.repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil || current.AccessToken != "synthetic-new" {
		t.Fatal("old uninstall delivery discarded a later pending authorization")
	}
}

func uninstallHandlerForRepository(t *testing.T, repository Repository, effects RevocationEffects) (*Handler, *Service) {
	t.Helper()
	service := NewService(repository, []string{"read_orders"}, effects, &recordingExchanger{})
	service.installationChecker = fixtureInstallationRejected{}
	handler, err := NewHandler(RuntimeConfig{ServiceToken: "fixture-service", AppAPIKey: "app-key", AppSecret: "app-secret", Scopes: []string{"read_orders"}, CallbackURL: "https://connector.example/shopify/oauth/callback"}, service, repository)
	if err != nil {
		t.Fatal(err)
	}
	return handler, service
}

func seedUninstallInstallation(t *testing.T, repository Repository) {
	t.Helper()
	now := time.Date(2026, 9, 5, 0, 0, 0, 0, time.UTC)
	binding := Binding{Identity: identity(), LegacyShopID: "legacy-shop", ShopDomain: "demo.myshopify.com"}
	if err := repository.CompleteInstallation(t.Context(), binding, InstallationRecord{
		Binding: binding, AccessToken: "synthetic-installed", RefreshToken: "synthetic-refresh", CredentialKeyVersion: "fixture-v1",
		Scopes: []string{"read_orders"}, State: shopifyconnector.InstallationStateInstalled, InstalledAt: now, UpdatedAt: now,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestUninstallReceiptSurvivesEncryptedRestartAndReinstall(t *testing.T) {
	for _, bound := range []bool{false, true} {
		t.Run(map[bool]string{true: "bound", false: "unbound"}[bound], func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "uninstall.enc")
			key := bytes.Repeat([]byte{0x5a}, 32)
			repository, err := OpenFileRepository(file, key)
			if err != nil {
				t.Fatal(err)
			}
			if bound {
				seedUninstallInstallation(t, repository)
			}
			handler, _ := uninstallHandlerForRepository(t, repository, &fakeEffects{})
			if w := sendUninstallFixture(t, handler, "restart-delivery", "restart-event"); w.Code != 204 {
				t.Fatalf("first response=%d", w.Code)
			}
			raw, err := os.ReadFile(file)
			if err != nil || bytes.Contains(raw, []byte("demo.myshopify.com")) || bytes.Contains(raw, []byte("uninstallReceipts")) || bytes.Contains(raw, []byte("synthetic-")) {
				t.Fatal("repository envelope leaked uninstall or credential data")
			}
			reopened, err := OpenFileRepository(file, key)
			if err != nil {
				t.Fatal(err)
			}
			seedUninstallInstallation(t, reopened)
			effects := &fakeEffects{}
			handler, _ = uninstallHandlerForRepository(t, reopened, effects)
			if w := sendUninstallFixture(t, handler, "different-delivery", "restart-event"); w.Code != 204 {
				t.Fatal("reopened receipt did not correlate same-event delivery")
			}
			current, err := reopened.GetInstallation(t.Context(), identity())
			if err != nil || current.State != shopifyconnector.InstallationStateInstalled || current.AccessToken != "synthetic-installed" || effects.calls != 0 {
				t.Fatal("restarted duplicate damaged the reinstalled shop")
			}
			generation := reopened.generation
			if w := sendUninstallFixture(t, handler, "different-delivery", ""); w.Code != 204 || reopened.generation != generation {
				t.Fatal("exact completed duplicate wrote the repository again")
			}
		})
	}
}

func TestUninstallEffectsRetryAfterRestartNeverRevokeTwice(t *testing.T) {
	for _, reinstall := range []bool{false, true} {
		t.Run(map[bool]string{true: "reinstalled", false: "still-revoked"}[reinstall], func(t *testing.T) {
			file := filepath.Join(t.TempDir(), "effects.enc")
			key := bytes.Repeat([]byte{9}, 32)
			repository, err := OpenFileRepository(file, key)
			if err != nil {
				t.Fatal(err)
			}
			seedUninstallInstallation(t, repository)
			effects := &fakeEffects{err: errors.New("synthetic remote secret must be redacted")}
			handler, _ := uninstallHandlerForRepository(t, repository, effects)
			w := sendUninstallFixture(t, handler, "effects-first", "effects-event")
			if w.Code != 503 || strings.Contains(w.Body.String(), "synthetic") || effects.calls != 1 {
				t.Fatal("failed effects were acknowledged or leaked")
			}
			current, _ := repository.GetInstallation(t.Context(), identity())
			if current.State != shopifyconnector.InstallationStateRevoked || current.AccessToken != "" || current.RefreshToken != "" || current.EffectsApplied {
				t.Fatal("failure must retain a revoked credential with retryable effects")
			}
			reopened, err := OpenFileRepository(file, key)
			if err != nil {
				t.Fatal(err)
			}
			if reinstall {
				seedUninstallInstallation(t, reopened)
			}
			effects = &fakeEffects{}
			handler, _ = uninstallHandlerForRepository(t, reopened, effects)
			for attempt := 0; attempt < 2; attempt++ {
				if w := sendUninstallFixture(t, handler, "effects-second", "effects-event"); w.Code != 204 {
					t.Fatal("effect retry did not finish")
				}
			}
			current, _ = reopened.GetInstallation(t.Context(), identity())
			if reinstall {
				if current.State != shopifyconnector.InstallationStateInstalled || effects.calls != 0 {
					t.Fatal("old failed effects ran against a new installation")
				}
			} else if !current.EffectsApplied || effects.calls != 1 {
				t.Fatal("unfinished effects were not retried exactly once")
			}
			events, _ := reopened.ListOutbox(t.Context())
			if len(events) != 1 {
				t.Fatal("retry duplicated revocation outbox")
			}
		})
	}
}

type uninstallCompletionFailure struct {
	Repository
	fail bool
}

func (r *uninstallCompletionFailure) CompleteUninstallWebhook(ctx context.Context, receiptID, status string) error {
	if r.fail {
		return errors.New("synthetic receipt completion failure")
	}
	return r.Repository.CompleteUninstallWebhook(ctx, receiptID, status)
}

func TestUninstallReceiptCompletionFailureIsRetryable(t *testing.T) {
	repository := &uninstallCompletionFailure{Repository: NewMemoryRepository(), fail: true}
	seedUninstallInstallation(t, repository)
	effects := &fakeEffects{}
	handler, _ := uninstallHandlerForRepository(t, repository, effects)
	if w := sendUninstallFixture(t, handler, "finish-first", "finish-event"); w.Code != 503 || effects.calls != 1 {
		t.Fatal("completion failure did not request retry")
	}
	repository.fail = false
	if w := sendUninstallFixture(t, handler, "finish-retry", "finish-event"); w.Code != 204 || effects.calls != 1 {
		t.Fatal("receipt retry duplicated already-persisted effects")
	}
}

func TestUninstallCommitFailureLeavesLiveAndDiskStateUntouched(t *testing.T) {
	file := filepath.Join(t.TempDir(), "atomic.enc")
	key := bytes.Repeat([]byte{6}, 32)
	repository, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	seedUninstallInstallation(t, repository)
	effects := &fakeEffects{}
	handler, _ := uninstallHandlerForRepository(t, repository, effects)
	// An existing file cannot be used as a parent directory; no real files are touched.
	repository.path = filepath.Join(file, "cannot-write.enc")
	if w := sendUninstallFixture(t, handler, "save-first", "save-event"); w.Code != 503 || effects.calls != 0 {
		t.Fatal("failed commit invoked effects or acknowledged success")
	}
	current, _ := repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled || len(repository.inner.uninstallReceipts) != 0 || repository.inner.pendingRevision != 0 {
		t.Fatal("failed commit changed live state")
	}
	repository.path = file
	reopened, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	current, _ = reopened.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled || len(reopened.inner.uninstallReceipts) != 0 {
		t.Fatal("failed commit changed disk state")
	}
	if w := sendUninstallFixture(t, handler, "save-first", "save-event"); w.Code != 204 || effects.calls != 1 {
		t.Fatal("same delivery could not recover after commit failure")
	}
}

func TestUninstallRejectsMissingIdentifiersAndConflictingReceipts(t *testing.T) {
	for _, headers := range [][2]string{{"", ""}, {"", "event"}, {"contains space", ""}, {strings.Repeat("x", 101), ""}, {"valid", "event with space"}} {
		handler := newTestHandler(t, &recordingExchanger{})
		seedUninstallInstallation(t, handler.repository)
		if w := sendUninstallFixture(t, handler, headers[0], headers[1]); w.Code != 400 {
			t.Fatal("invalid ID fell back to unsafe permanent payload deduplication")
		}
		current, _ := handler.repository.GetInstallation(t.Context(), identity())
		if current.State != shopifyconnector.InstallationStateInstalled {
			t.Fatal("invalid ID changed installation")
		}
	}
	handler := newTestHandler(t, &recordingExchanger{})
	seedUninstallInstallation(t, handler.repository)
	if w := sendUninstallFixture(t, handler, "conflict-delivery", "conflict-event"); w.Code != 204 {
		t.Fatal("fixture uninstall failed")
	}
	seedUninstallInstallation(t, handler.repository)
	changed := []byte(`{"id":999,"myshopify_domain":"demo.myshopify.com"}`)
	if w := sendUninstallPayload(t, handler, changed, "demo.myshopify.com", "conflict-delivery", "conflict-event"); w.Code != 503 {
		t.Fatal("same identifier accepted a different signed payload")
	}
	if w := sendUninstallFixture(t, handler, "conflict-delivery", "different-event"); w.Code != 503 {
		t.Fatal("same delivery merged two events")
	}
	current, _ := handler.repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled {
		t.Fatal("conflicting receipt changed current installation")
	}
}

func TestUninstallReceiptKeysAreShopScopedAndResolveRaceFailsClosed(t *testing.T) {
	repository := NewMemoryRepository()
	handler, _ := uninstallHandlerForRepository(t, repository, &fakeEffects{})
	if w := sendUninstallFixture(t, handler, "shared-delivery", "shared-event"); w.Code != 204 {
		t.Fatal("first shop failed")
	}
	raw := []byte(`{"id":999,"myshopify_domain":"other.myshopify.com"}`)
	if w := sendUninstallPayload(t, handler, raw, "other.myshopify.com", "shared-delivery", "shared-event"); w.Code != 204 || len(repository.uninstallReceipts) != 2 {
		t.Fatal("delivery ID collided across shops")
	}
	seedUninstallInstallation(t, repository)
	digest := sha256.Sum256([]byte("synthetic"))
	delivery := UninstallWebhook{ShopDomain: "demo.myshopify.com", DeliveryID: "racing-delivery", PayloadHash: hex.EncodeToString(digest[:])}
	if _, _, err := repository.RecordUninstallWebhook(t.Context(), delivery, shopifyconnector.CanonicalShopIdentity{}, time.Now()); !errors.Is(err, ErrRepositoryStale) {
		t.Fatal("first association crossed an unlocked canonical revocation")
	}
	current, _ := repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled {
		t.Fatal("resolve race changed credential")
	}
}

func TestUninstallRecognizesPreviousReleaseDeliveryOutbox(t *testing.T) {
	handler := newTestHandler(t, &recordingExchanger{})
	seedUninstallInstallation(t, handler.repository)
	if _, err := handler.lifecycle.Revoke(t.Context(), shopifyconnector.InstallationRevokeRequest{
		Identity: identity(), Context: shopifyconnector.RequestContext{RequestID: "shopify-uninstall:legacy-delivery", CorrelationID: "legacy-correlation"},
	}); err != nil {
		t.Fatal(err)
	}
	seedUninstallInstallation(t, handler.repository)
	if w := sendUninstallFixture(t, handler, "legacy-delivery", "legacy-event"); w.Code != 204 {
		t.Fatal("legacy delivery was not acknowledged")
	}
	current, _ := handler.repository.GetInstallation(t.Context(), identity())
	events, _ := handler.repository.ListOutbox(t.Context())
	if current.State != shopifyconnector.InstallationStateInstalled || len(events) != 1 {
		t.Fatal("legacy recorded delivery revoked new installation or duplicated outbox")
	}
}

func TestUninstallReceiptStoredValidationAndSliceIsolation(t *testing.T) {
	repository := NewMemoryRepository()
	handler, _ := uninstallHandlerForRepository(t, repository, &fakeEffects{})
	if w := sendUninstallFixture(t, handler, "restore-delivery", "restore-event"); w.Code != 204 {
		t.Fatal("fixture uninstall failed")
	}
	state := snapshotMemoryRepository(repository)
	original := state.UninstallReceipts[0]
	for _, mutate := range []func(*UninstallWebhookReceipt){
		func(r *UninstallWebhookReceipt) { r.ID = "bad" },
		func(r *UninstallWebhookReceipt) { r.ShopDomain = "not-a-shop" },
		func(r *UninstallWebhookReceipt) { r.PayloadHash = "bad" },
		func(r *UninstallWebhookReceipt) { r.Status = uninstallEffectsPending },
		func(r *UninstallWebhookReceipt) { r.Keys = append(r.Keys, r.Keys[0]) },
		func(r *UninstallWebhookReceipt) { r.ReceivedAt = time.Time{} },
		func(r *UninstallWebhookReceipt) { r.EventKey = r.ID },
	} {
		receipt := cloneUninstallReceipt(original)
		mutate(&receipt)
		if err := NewMemoryRepository().restoreUninstallReceipt(receipt); err == nil {
			t.Fatal("invalid encrypted receipt was accepted")
		}
	}
	cloned := cloneMemoryRepository(repository)
	receipt := cloned.uninstallReceipts[original.ID]
	receipt.Keys[0] = "modified"
	if repository.uninstallReceipts[original.ID].Keys[0] != original.ID {
		t.Fatal("candidate receipt aliases mutated live state")
	}
	encoded, err := json.Marshal(state.UninstallReceipts)
	if err != nil || bytes.Contains(encoded, []byte("myshopify_domain")) || bytes.Contains(encoded, []byte("restore-delivery")) {
		t.Fatal("receipt persisted raw webhook data instead of scoped digests")
	}
}

func TestUninstallWebhookSerializesConcurrentReinstallAndReplay(t *testing.T) {
	repository := NewMemoryRepository()
	seedUninstallInstallation(t, repository)
	effects := &blockingEffects{started: make(chan struct{}), release: make(chan struct{})}
	var release sync.Once
	t.Cleanup(func() { release.Do(func() { close(effects.release) }) })
	handler, service := uninstallHandlerForRepository(t, repository, effects)
	service.exchanger = &recordingExchanger{result: OAuthExchangeResult{AccessToken: "synthetic-reinstalled", Scopes: []string{"read_orders"}}}
	uninstallDone := make(chan int, 1)
	go func() { uninstallDone <- sendUninstallFixture(t, handler, "parallel-first", "parallel-event").Code }()
	select {
	case <-effects.started:
	case <-time.After(2 * time.Second):
		t.Fatal("uninstall did not reach controlled effects boundary")
	}
	reinstallDone := make(chan error, 1)
	go func() {
		_, err := service.CompleteOAuth(t.Context(), shopifyconnector.CompleteOAuthRequest{
			Identity: identity(), Context: requestContext("parallel-reinstall"), ShopDomain: "demo.myshopify.com",
			LegacyShopID: "legacy-shop", AuthorizationCode: "synthetic-code",
		})
		reinstallDone <- err
	}()
	select {
	case <-reinstallDone:
		t.Fatal("reinstall crossed in-flight revocation effects")
	case <-time.After(50 * time.Millisecond):
	}
	release.Do(func() { close(effects.release) })
	select {
	case code := <-uninstallDone:
		if code != 204 {
			t.Fatalf("uninstall status=%d", code)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("uninstall never completed")
	}
	select {
	case err := <-reinstallDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("serialized reinstall never completed")
	}
	if w := sendUninstallFixture(t, handler, "parallel-retry", "parallel-event"); w.Code != 204 {
		t.Fatal("parallel replay did not acknowledge saved receipt")
	}
	current, _ := repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled || current.AccessToken != "synthetic-reinstalled" || current.EffectsApplied {
		t.Fatal("parallel replay damaged new installation")
	}
}

func TestUninstallPendingDeletionAndReceiptCommitAreAtomic(t *testing.T) {
	file := filepath.Join(t.TempDir(), "pending-atomic.enc")
	key := bytes.Repeat([]byte{8}, 32)
	repository, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	_, handler, _, _ := pendingFixture(t, repository)
	if w := pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com"); w.Code != 409 {
		t.Fatal("pending fixture setup failed")
	}
	_, before, _ := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	repository.path = filepath.Join(file, "cannot-write.enc")
	if w := sendUninstallFixture(t, handler, "pending-atomic", "pending-atomic-event"); w.Code != 503 {
		t.Fatal("failed pending deletion was acknowledged")
	}
	_, after, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil || before != after || len(repository.inner.uninstallReceipts) != 0 {
		t.Fatal("failed pending commit changed live credentials, fence or receipt")
	}
	repository.path = file
	reopened, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	_, after, err = reopened.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil || before != after || len(reopened.inner.uninstallReceipts) != 0 {
		t.Fatal("failed pending commit changed durable state")
	}
	if w := sendUninstallFixture(t, handler, "pending-atomic", "pending-atomic-event"); w.Code != 204 {
		t.Fatal("pending uninstall retry failed")
	}
	_, after, err = repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if !errors.Is(err, ErrNotFound) || after != before+1 || len(repository.inner.uninstallReceipts) != 1 {
		t.Fatal("pending deletion and receipt did not commit together")
	}
}

func TestUninstallDeliveryValidationPrecedesReceiptMutation(t *testing.T) {
	repository := NewMemoryRepository()
	seedUninstallInstallation(t, repository)
	handler, _ := uninstallHandlerForRepository(t, repository, &fakeEffects{})
	changedShop := []byte(`{"id":999,"myshopify_domain":"other.myshopify.com"}`)
	if w := sendUninstallPayload(t, handler, changedShop, "demo.myshopify.com", "signed-mismatch", "signed-mismatch-event"); w.Code != 400 {
		t.Fatal("header overrode signed shop identity")
	}
	digest := sha256.Sum256([]byte("synthetic"))
	delivery := UninstallWebhook{ShopDomain: "demo.myshopify.com", DeliveryID: "cancelled", PayloadHash: hex.EncodeToString(digest[:])}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, _, err := repository.RecordUninstallWebhook(ctx, delivery, identity(), time.Now()); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled delivery was recorded")
	}
	current, _ := repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled || len(repository.uninstallReceipts) != 0 || repository.pendingRevision != 0 {
		t.Fatal("invalid delivery changed receipt or credentials")
	}
}
