package platform

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestGmailReauthorizationClearsStaleSyncError(t *testing.T) {
	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Reauthorized Gmail"})
	if err != nil {
		t.Fatal(err)
	}
	source, err := store.CreateShopSource(context.Background(), ShopSource{
		ShopID:   shop.ID,
		Type:     SourceTypeEmail,
		Provider: "gmail",
		Address:  "support@example.com",
		Metadata: map[string]string{
			"email_sync_status":       "error",
			"email_last_error":        "invalid_grant",
			"email_last_success_at":   "2026-07-20T00:00:00Z",
			emailRetryStateKey:        emailRetryStateReauthorizationNeeded,
			emailRetryFailureCountKey: "12",
			emailRetryPausedAtKey:     "2026-08-19T00:00:00Z",
		},
	})
	if err != nil {
		t.Fatal(err)
	}

	_, updated, _, err := NewServer(store).ensureGmailInstallation(context.Background(), shop.ID, source.Address, gmailOAuthTokenResponse{
		AccessToken:  "new-access-token",
		RefreshToken: "new-refresh-token",
		Scope:        defaultGmailScopes,
		ExpiresIn:    3600,
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata["email_sync_status"] != "pending" {
		t.Fatalf("reauthorized source status = %q, want pending", updated.Metadata["email_sync_status"])
	}
	if updated.Metadata["email_last_error"] != "" {
		t.Fatalf("reauthorized source retained stale error: %q", updated.Metadata["email_last_error"])
	}
	if updated.Metadata[emailRetryStateKey] != "" || updated.Metadata[emailRetryFailureCountKey] != "" || updated.Metadata[emailRetryPausedAtKey] != "" {
		t.Fatalf("reauthorized source retained retry circuit-breaker state: %#v", updated.Metadata)
	}
	if updated.Metadata["email_authorization_at"] == "" {
		t.Fatal("reauthorized source is missing authorization timestamp")
	}
	if updated.Metadata["email_last_success_at"] != "2026-07-20T00:00:00Z" {
		t.Fatal("reauthorization should preserve the last successful sync checkpoint")
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, source.Address)
	if err != nil {
		t.Fatal(err)
	}
	if installation.ExpiresAt.Before(time.Now().UTC().Add(55 * time.Minute)) {
		t.Fatalf("new authorization expiry was not stored: %s", installation.ExpiresAt)
	}
}

func TestGmailAuthorizationRejectsMailboxBoundToAnotherBusinessAccount(t *testing.T) {
	store := NewMemoryStore()
	existingAccount, err := store.CreateShop(context.Background(), Shop{DisplayName: "Existing Mail Account"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:      existingAccount.ID,
		Mailbox:     "support@example.com",
		Provider:    "gmail",
		AccessToken: "existing-access-token",
	}); err != nil {
		t.Fatal(err)
	}
	targetAccount, err := store.CreateShop(context.Background(), Shop{DisplayName: "New Business Account"})
	if err != nil {
		t.Fatal(err)
	}

	_, _, _, err = NewServer(store).ensureGmailInstallation(context.Background(), targetAccount.ID, "SUPPORT@example.com", gmailOAuthTokenResponse{
		AccessToken:  "new-access-token",
		RefreshToken: "new-refresh-token",
		Scope:        defaultGmailScopes,
		ExpiresIn:    3600,
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate mailbox error = %v, want conflict", err)
	}
	var conflict *emailMailboxBindingConflict
	if !errors.As(err, &conflict) || conflict.BoundShopID != existingAccount.ID || conflict.BoundShopName != existingAccount.DisplayName {
		t.Fatalf("duplicate mailbox conflict is missing the bound account: %#v", conflict)
	}
	sources, err := store.ListShopSources(context.Background(), targetAccount.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 0 {
		t.Fatalf("duplicate mailbox created a partial email source: %#v", sources)
	}
}

func TestOutlookAuthorizationRejectsMailboxBoundToAnotherBusinessAccount(t *testing.T) {
	store := NewMemoryStore()
	existingAccount, err := store.CreateShop(context.Background(), Shop{DisplayName: "floravyne"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID:      existingAccount.ID,
		Mailbox:     "support@example.com",
		Provider:    "outlook",
		AccessToken: "existing-access-token",
	}); err != nil {
		t.Fatal(err)
	}
	targetAccount, err := store.CreateShop(context.Background(), Shop{DisplayName: "Wrong Business Account"})
	if err != nil {
		t.Fatal(err)
	}

	_, _, _, err = NewServer(store).ensureOutlookInstallation(context.Background(), targetAccount.ID, "SUPPORT@example.com", outlookOAuthTokenResponse{
		AccessToken:  "new-access-token",
		RefreshToken: "new-refresh-token",
		Scope:        defaultOutlookScopes,
		ExpiresIn:    3600,
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("duplicate mailbox error = %v, want conflict", err)
	}
	var conflict *emailMailboxBindingConflict
	if !errors.As(err, &conflict) || conflict.BoundShopID != existingAccount.ID || conflict.BoundShopName != "floravyne" {
		t.Fatalf("duplicate mailbox conflict is missing the bound account: %#v", conflict)
	}
	sources, err := store.ListShopSources(context.Background(), targetAccount.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(sources) != 0 {
		t.Fatalf("duplicate Outlook mailbox created a partial email source: %#v", sources)
	}
}
