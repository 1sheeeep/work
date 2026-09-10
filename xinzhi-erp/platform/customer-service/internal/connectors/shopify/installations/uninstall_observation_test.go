package installations

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

// Older lifecycle fixtures model a provider-confirmed unusable token.
type fixtureInstallationRejected struct{}

func (fixtureInstallationRejected) CheckCurrentInstallation(context.Context, string, string) error {
	return shopifyconnector.ErrProviderTokenRejected
}

type installationCheckerFunc func(context.Context, string, string) error

func (f installationCheckerFunc) CheckCurrentInstallation(ctx context.Context, domain, token string) error {
	return f(ctx, domain, token)
}

func TestUnseenUninstallPreservesProviderConfirmedCurrentInstallation(t *testing.T) {
	repository := NewMemoryRepository()
	seedUninstallInstallation(t, repository)
	effects := &fakeEffects{}
	handler, service := uninstallHandlerForRepository(t, repository, effects)
	calls := 0
	service.installationChecker = installationCheckerFunc(func(context.Context, string, string) error { calls++; return nil })
	if w := sendUninstallFixture(t, handler, "first-late-delivery", "first-late-event"); w.Code != 204 {
		t.Fatalf("status=%d", w.Code)
	}
	current, _ := repository.GetInstallation(t.Context(), identity())
	events, _ := repository.ListOutbox(t.Context())
	if current.State != shopifyconnector.InstallationStateInstalled || current.AccessToken != "synthetic-installed" || effects.calls != 0 || len(events) != 0 {
		t.Fatal("first delayed event revoked current authenticated installation")
	}
	service.installationChecker = installationCheckerFunc(func(context.Context, string, string) error { t.Fatal("duplicate reached provider"); return nil })
	if w := sendUninstallFixture(t, handler, "late-second-delivery", "first-late-event"); w.Code != 204 || calls != 1 {
		t.Fatal("receipt retry failed")
	}
	service.installationChecker = fixtureInstallationRejected{}
	if w := sendUninstallFixture(t, handler, "real-new-delivery", "real-new-event"); w.Code != 204 {
		t.Fatal("new uninstall failed")
	}
	current, _ = repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateRevoked || effects.calls != 1 {
		t.Fatal("new uninstall did not revoke")
	}
}

func TestUnseenUninstallUnknownProviderNeverDestroysCredential(t *testing.T) {
	for _, failure := range []error{errors.New("synthetic network failure"), shopifyconnector.ErrProviderAuthorization, context.DeadlineExceeded} {
		repository := NewMemoryRepository()
		seedUninstallInstallation(t, repository)
		handler, service := uninstallHandlerForRepository(t, repository, &fakeEffects{})
		service.installationChecker = installationCheckerFunc(func(context.Context, string, string) error { return failure })
		if w := sendUninstallFixture(t, handler, "unknown-delivery", "unknown-event"); w.Code != 503 {
			t.Fatal("unknown state acknowledged")
		}
		current, _ := repository.GetInstallation(t.Context(), identity())
		if current.State != shopifyconnector.InstallationStateInstalled || len(repository.uninstallReceipts) != 0 {
			t.Fatal("unknown status changed credential or swallowed event")
		}
	}
}

func TestUnseenUninstallPreservesNewPendingAuthorizationAndRestartReceipt(t *testing.T) {
	file := filepath.Join(t.TempDir(), "active-pending.enc")
	key := bytes.Repeat([]byte{5}, 32)
	repository, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	service, handler, _, _ := pendingFixture(t, repository)
	if w := pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com"); w.Code != 409 {
		t.Fatal("fixture did not create pending authorization")
	}
	before, revision, err := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
	if err != nil {
		t.Fatal(err)
	}
	service.installationChecker = installationCheckerFunc(func(_ context.Context, domain, token string) error {
		if domain != before.ShopDomain || token != before.AccessToken {
			t.Fatal("wrong pending credential probed")
		}
		return nil
	})
	if w := sendUninstallFixture(t, handler, "pending-late", "pending-late-event"); w.Code != 204 {
		t.Fatal("active pending check failed")
	}
	current, after, err := repository.GetPendingInstallation(t.Context(), before.ShopDomain)
	if err != nil || current.AccessToken != before.AccessToken || after != revision {
		t.Fatal("active pending authorization or fence changed")
	}
	reopened, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	_, handler, _, _ = pendingFixture(t, reopened)
	if w := sendUninstallFixture(t, handler, "pending-late-other", "pending-late-event"); w.Code != 204 {
		t.Fatal("active receipt did not survive restart")
	}
	if _, _, err := reopened.GetPendingInstallation(t.Context(), before.ShopDomain); err != nil {
		t.Fatal("restarted retry discarded pending credential")
	}
}

func TestUnseenUninstallFencesChangesDuringProviderCheck(t *testing.T) {
	for _, active := range []bool{false, true} {
		repository := NewMemoryRepository()
		seedUninstallInstallation(t, repository)
		handler, service := uninstallHandlerForRepository(t, repository, &fakeEffects{})
		service.installationChecker = installationCheckerFunc(func(context.Context, string, string) error {
			record, _ := repository.GetInstallation(t.Context(), identity())
			record.AccessToken = "synthetic-concurrent-new"
			if err := repository.CompleteInstallation(t.Context(), record.Binding, record); err != nil {
				t.Fatal(err)
			}
			if active {
				return nil
			}
			return shopifyconnector.ErrProviderTokenRejected
		})
		if w := sendUninstallFixture(t, handler, "concurrent-check", "concurrent-event"); w.Code != 503 {
			t.Fatal("stale observation was acknowledged")
		}
		current, _ := repository.GetInstallation(t.Context(), identity())
		if current.AccessToken != "synthetic-concurrent-new" || current.State != shopifyconnector.InstallationStateInstalled || len(repository.uninstallReceipts) != 0 {
			t.Fatal("stale probe acted on new authorization")
		}
	}
	for _, active := range []bool{false, true} {
		repository := NewMemoryRepository()
		service, handler, _, _ := pendingFixture(t, repository)
		pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com")
		service.installationChecker = installationCheckerFunc(func(context.Context, string, string) error {
			record, revision, _ := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
			record.AccessToken = "synthetic-new-pending"
			if err := repository.SavePendingInstallation(t.Context(), record, revision, service.now()); err != nil {
				t.Fatal(err)
			}
			if active {
				return nil
			}
			return shopifyconnector.ErrProviderTokenRejected
		})
		if w := sendUninstallFixture(t, handler, "pending-check-race", "pending-check-event"); w.Code != 503 {
			t.Fatal("pending revision race was acknowledged")
		}
		current, _, _ := repository.GetPendingInstallation(t.Context(), "demo.myshopify.com")
		if current.AccessToken != "synthetic-new-pending" || len(repository.uninstallReceipts) != 0 {
			t.Fatal("stale probe changed pending authorization")
		}
	}
}

type uninstallRefreshFixture struct {
	calls  int
	result OAuthExchangeResult
	err    error
}

func (f *uninstallRefreshFixture) RefreshOfflineToken(context.Context, string, string) (OAuthExchangeResult, error) {
	f.calls++
	return f.result, f.err
}

func TestUnseenUninstallExpiredTokenDoesNotMeanUninstalled(t *testing.T) {
	for _, scenario := range []string{"refresh-active", "refresh-terminal", "refresh-transient", "expired-refresh", "rotated-rejected", "rotated-unknown", "rotation-commit-failed"} {
		t.Run(scenario, func(t *testing.T) {
			inner := NewMemoryRepository()
			var repository Repository = inner
			if scenario == "rotation-commit-failed" {
				repository = uninstallRotationFailure{Repository: inner}
			}
			seedUninstallInstallation(t, repository)
			record, _ := repository.GetInstallation(t.Context(), identity())
			now := time.Now().UTC()
			record.AccessTokenExpiresAt = now.Add(-time.Minute)
			record.RefreshTokenExpiresAt = now.Add(time.Hour)
			if scenario == "expired-refresh" {
				record.RefreshTokenExpiresAt = now.Add(-time.Second)
			}
			if err := repository.CompleteInstallation(t.Context(), record.Binding, record); err != nil {
				t.Fatal(err)
			}
			effects := &fakeEffects{}
			handler, service := uninstallHandlerForRepository(t, repository, effects)
			refresher := &uninstallRefreshFixture{result: OAuthExchangeResult{AccessToken: "synthetic-rotated", RefreshToken: "synthetic-rotated-refresh", AccessTokenTTL: time.Hour, RefreshTokenTTL: 24 * time.Hour, Scopes: record.Scopes}}
			if scenario == "refresh-terminal" {
				refresher.err = ErrOfflineRefreshInactive
			}
			if scenario == "refresh-transient" {
				refresher.err = errors.New("synthetic network error")
			}
			if err := service.RequireExpiringOfflineTokens(refresher, "fixture-v1", 5*time.Minute); err != nil {
				t.Fatal(err)
			}
			checks := 0
			service.installationChecker = installationCheckerFunc(func(_ context.Context, _, token string) error {
				checks++
				if token == "synthetic-rotated" && scenario == "rotated-unknown" {
					return context.DeadlineExceeded
				}
				if token == "synthetic-rotated" && scenario != "rotated-rejected" {
					return nil
				}
				return shopifyconnector.ErrProviderTokenRejected
			})
			w := sendUninstallFixture(t, handler, "expiry-delivery", "expiry-event")
			current, _ := repository.GetInstallation(t.Context(), identity())
			switch scenario {
			case "refresh-active":
				if w.Code != 204 || checks != 2 || current.AccessToken != "synthetic-rotated" || current.State != shopifyconnector.InstallationStateInstalled || effects.calls != 0 {
					t.Fatal("expired new installation was revoked")
				}
			case "refresh-transient", "rotation-commit-failed":
				if w.Code != 503 || current.AccessToken != record.AccessToken || len(inner.uninstallReceipts) != 0 || effects.calls != 0 {
					t.Fatal("uncertain refresh destroyed old usable recovery record")
				}
			case "rotated-unknown":
				if w.Code != 503 || current.AccessToken != "synthetic-rotated" || current.State != shopifyconnector.InstallationStateInstalled || len(inner.uninstallReceipts) != 0 || effects.calls != 0 {
					t.Fatal("uncertain follow-up check lost the committed rotation")
				}
			default:
				if w.Code != 204 || current.State != shopifyconnector.InstallationStateRevoked || current.RefreshToken != "" || effects.calls != 1 {
					t.Fatal("terminal credentials prevented legitimate uninstall cleanup")
				}
			}
		})
	}
}

type uninstallRotationFailure struct{ Repository }

func (r uninstallRotationFailure) RotateCredential(context.Context, shopifyconnector.CanonicalShopIdentity, string, OAuthExchangeResult, string, time.Time) (InstallationRecord, error) {
	return InstallationRecord{}, errors.New("synthetic rotation commit failure")
}

func TestOfflineRefreshClassifiesOnlyDocumentedTerminalResponse(t *testing.T) {
	terminal := `{"error":"invalid_request","error_description":"This request requires an active refresh_token"}`
	for _, tc := range []struct {
		status   int
		body     string
		terminal bool
	}{
		{401, terminal, true}, {400, terminal, false}, {403, terminal, false}, {429, terminal, false}, {503, terminal, false},
		{401, `{"error":"invalid_client","error_description":"synthetic secret"}`, false},
		{401, `{"error":"invalid_request","error_description":"synthetic unknown"}`, false},
		{401, `invalid JSON synthetic secret`, false},
	} {
		exchanger := NewShopifyOAuthExchanger("fixture-app", "fixture-secret", &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: tc.status, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(tc.body))}, nil
		})})
		_, err := exchanger.RefreshOfflineToken(t.Context(), "demo.myshopify.com", "synthetic-refresh")
		if err == nil || errors.Is(err, ErrOfflineRefreshInactive) != tc.terminal || strings.Contains(err.Error(), "synthetic") {
			t.Fatal("refresh response misclassified or leaked")
		}
	}
}

func TestActiveUninstallReceiptRequiresDurableSaveAndRestoresBoundIdentity(t *testing.T) {
	file := filepath.Join(t.TempDir(), "active-bound.enc")
	key := bytes.Repeat([]byte{0x6b}, 32)
	repository, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	seedUninstallInstallation(t, repository)
	handler, service := uninstallHandlerForRepository(t, repository, &fakeEffects{})
	checks := 0
	service.installationChecker = installationCheckerFunc(func(ctx context.Context, _, _ string) error {
		deadline, ok := ctx.Deadline()
		if !ok || time.Until(deadline) > uninstallObservationTimeout {
			t.Error("probe lacked bounded deadline")
		}
		checks++
		return nil
	})
	repository.path = filepath.Join(file, "cannot-write.enc")
	if w := sendUninstallFixture(t, handler, "active-save", "active-event"); w.Code != 503 || len(repository.inner.uninstallReceipts) != 0 {
		t.Fatal("active observation acknowledged without durable receipt")
	}
	repository.path = file
	if w := sendUninstallFixture(t, handler, "active-save", "active-event"); w.Code != 204 || checks != 2 {
		t.Fatal("failed active observation could not retry")
	}
	reopened, err := OpenFileRepository(file, key)
	if err != nil {
		t.Fatal(err)
	}
	handler, _ = uninstallHandlerForRepository(t, reopened, &fakeEffects{})
	if w := sendUninstallFixture(t, handler, "active-restart", "active-event"); w.Code != 204 {
		t.Fatal("active bound receipt did not restore")
	}
	current, _ := reopened.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled || current.Identity != identity() || current.LegacyShopID != "legacy-shop" {
		t.Fatal("restarted active observation changed canonical ownership")
	}
}

func TestMissingInstallationCheckerDoesNotFallBackToDestructiveHandling(t *testing.T) {
	repository := NewMemoryRepository()
	seedUninstallInstallation(t, repository)
	handler, service := uninstallHandlerForRepository(t, repository, &fakeEffects{})
	service.installationChecker = nil
	if w := sendUninstallFixture(t, handler, "missing-checker", "missing-checker-event"); w.Code != 503 {
		t.Fatal("missing checker bypassed current-installation check")
	}
	current, _ := repository.GetInstallation(t.Context(), identity())
	if current.State != shopifyconnector.InstallationStateInstalled {
		t.Fatal("missing checker revoked installation")
	}
}

func TestOAuthClientDoesNotFollowCredentialBearingRedirects(t *testing.T) {
	calls := 0
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 307, Header: http.Header{"Location": {"https://elsewhere.invalid/collect"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})}
	exchanger := NewShopifyOAuthExchanger("fixture-app", "fixture-secret", client)
	_, err := exchanger.RefreshOfflineToken(t.Context(), "demo.myshopify.com", "synthetic-refresh")
	if err == nil || calls != 1 || client.CheckRedirect != nil {
		t.Fatal("redirect forwarded credentials or mutated shared client policy")
	}
}
