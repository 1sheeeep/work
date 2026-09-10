package platform

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"
)

func TestEmailRetryClassifiesPermanentFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want string
	}{
		{name: "Gmail revoked authorization", err: errors.New(`Gmail token refresh failed: {"error":"invalid_grant"}`), want: emailRetryStateReauthorizationNeeded},
		{name: "Outlook service abuse takes precedence", err: errors.New(`invalid_grant: account is found to be in service abuse mode`), want: emailRetryStateRiskBlocked},
		{name: "Outlook locked account", err: errors.New(`AADSTS50053: The account is locked`), want: emailRetryStateRiskBlocked},
		{name: "temporary provider error", err: &emailProviderHTTPError{StatusCode: http.StatusServiceUnavailable}, want: emailRetryStateWaiting},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := emailRetryStateForError(test.err); got != test.want {
				t.Fatalf("emailRetryStateForError() = %q, want %q", got, test.want)
			}
		})
	}
}

func TestEmailRetryBackoffAndRetryAfter(t *testing.T) {
	now := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	wants := []time.Duration{time.Minute, 5 * time.Minute, 15 * time.Minute, time.Hour, 6 * time.Hour, 6 * time.Hour}
	for failureCount, want := range wants {
		if got := emailRetryDelay(errors.New("temporary"), failureCount+1, now); got != want {
			t.Fatalf("failure %d delay = %s, want %s", failureCount+1, got, want)
		}
	}
	retryAfter := &emailProviderHTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: "7200"}
	if got := emailRetryDelay(retryAfter, 1, now); got != 2*time.Hour {
		t.Fatalf("Retry-After delay = %s, want 2h", got)
	}
}

func TestEmailSourcePollDueHonorsRetryCircuitBreaker(t *testing.T) {
	now := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	source := ShopSource{Metadata: map[string]string{
		emailLastReconcileAtKey: now.Add(-48 * time.Hour).Format(time.RFC3339),
		emailRetryStateKey:      emailRetryStateWaiting,
		emailRetryNextAtKey:     now.Add(time.Minute).Format(time.RFC3339),
	}}
	if emailSourcePollDue(source, now, 24*time.Hour) {
		t.Fatal("temporary failure should wait until its next retry time")
	}
	if !emailSourcePollDue(source, now.Add(time.Minute), 24*time.Hour) {
		t.Fatal("temporary failure should become due at its next retry time")
	}
	source.Metadata[emailRetryStateKey] = emailRetryStateReauthorizationNeeded
	delete(source.Metadata, emailRetryNextAtKey)
	if emailSourcePollDue(source, now.Add(7*24*time.Hour), 24*time.Hour) {
		t.Fatal("invalid authorization should remain paused until reauthorization")
	}
	source.Metadata[emailRetryStateKey] = emailRetryStateRiskBlocked
	if emailSourceAutomaticSyncDue(source, now.Add(30*24*time.Hour)) {
		t.Fatal("risk-blocked account should not resume on a timer")
	}
}

func TestEmailSourceAutomaticSyncDueHonorsManualPause(t *testing.T) {
	now := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	source := ShopSource{Metadata: map[string]string{emailManualPausedAtKey: now.Format(time.RFC3339)}}
	if emailSourceAutomaticSyncDue(source, now.Add(30*24*time.Hour)) {
		t.Fatal("manually paused mailbox must not resume on a timer")
	}
}

func TestEmailRetryJitterIsStableAndKeepsRetryAfterExact(t *testing.T) {
	now := time.Date(2026, 8, 19, 10, 0, 0, 0, time.UTC)
	first := emailRetryDelayWithJitter(errors.New("temporary"), 2, now, "one@example.com")
	if first != emailRetryDelayWithJitter(errors.New("temporary"), 2, now, "one@example.com") {
		t.Fatal("retry jitter must be deterministic for one mailbox and attempt")
	}
	if first == emailRetryDelayWithJitter(errors.New("temporary"), 2, now, "two@example.com") {
		t.Fatal("different mailboxes should not retry in lockstep")
	}
	retryAfter := &emailProviderHTTPError{StatusCode: http.StatusTooManyRequests, RetryAfter: "7200"}
	if got := emailRetryDelayWithJitter(retryAfter, 1, now, "one@example.com"); got != 2*time.Hour {
		t.Fatalf("Retry-After jittered to %s, want exact 2h", got)
	}
}

func TestEmailSyncFailurePersistsAndSuccessClearsRetryState(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	shop, err := store.CreateShop(ctx, Shop{DisplayName: "Retry state"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(ctx, ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	if err := server.updateEmailSourceSyncState(ctx, source, false, errors.New("invalid_grant")); err != nil {
		t.Fatal(err)
	}
	paused, err := store.GetShopSource(ctx, shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if paused.Metadata[emailRetryStateKey] != emailRetryStateReauthorizationNeeded || paused.Metadata[emailRetryPausedAtKey] == "" {
		t.Fatalf("invalid authorization did not pause automatic retry: %#v", paused.Metadata)
	}
	if paused.Metadata[emailRetryNextAtKey] != "" {
		t.Fatalf("permanent failure should not have a timed retry: %#v", paused.Metadata)
	}
	if err := server.updateEmailSourceSyncState(ctx, paused, true, nil); err != nil {
		t.Fatal(err)
	}
	recovered, err := store.GetShopSource(ctx, shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recovered.Metadata[emailRetryStateKey] != "" || recovered.Metadata[emailRetryFailureCountKey] != "" || recovered.Metadata[emailRetryPausedAtKey] != "" {
		t.Fatalf("successful synchronization retained retry state: %#v", recovered.Metadata)
	}
}
