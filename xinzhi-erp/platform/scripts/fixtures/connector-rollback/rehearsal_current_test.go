package installations

import (
	"bytes"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

func TestConnectorCurrentRehearsal(t *testing.T) {
	repository, err := OpenFileRepository(os.Getenv("ERP_SYNTHETIC_REHEARSAL_FILE"), bytes.Repeat([]byte{7}, 32))
	if err != nil {
		t.Fatal("synthetic current repository open failed")
	}
	phase := os.Getenv("ERP_SYNTHETIC_REHEARSAL_PHASE")
	if phase == "lifecycle" || phase == "verify-lifecycle" {
		now := time.Date(2026, 9, 7, 12, 0, 0, 0, time.UTC)
		delivery := UninstallWebhook{ShopDomain: "legacy-fixture.myshopify.com", DeliveryID: "recovery-uninstall", PayloadHash: strings.Repeat("b", 64)}
		if phase == "lifecycle" {
			stale, openErr := OpenFileRepository(os.Getenv("ERP_SYNTHETIC_REHEARSAL_FILE"), bytes.Repeat([]byte{7}, 32))
			if openErr != nil {
				t.Fatal("stale fixture open failed")
			}
			if _, fresh, e := repository.RecordUninstallWebhook(t.Context(), delivery, identity(), now); e != nil || !fresh {
				t.Fatal("uninstall did not commit")
			}
			if e := stale.SaveBinding(t.Context(), Binding{Identity: identity(), LegacyShopID: "rollback-synthetic", ShopDomain: delivery.ShopDomain}); !errors.Is(e, ErrRepositoryStale) {
				t.Fatal("stale writer was not rejected")
			}
			if count, e := repository.PrunePendingInstallations(t.Context(), now); e != nil || count != 1 {
				t.Fatal("expiry not preserved")
			}
		}
		before := snapshotMemoryRepository(repository.inner)
		if _, fresh, e := repository.RecordUninstallWebhook(t.Context(), delivery, identity(), now); e != nil || fresh {
			t.Fatal("uninstall replay not deduplicated")
		}
		after := snapshotMemoryRepository(repository.inner)
		record, e := repository.GetInstallation(t.Context(), identity())
		if e != nil || record.State != shopifyconnector.InstallationStateRevoked || record.AccessToken != "" || record.RefreshToken != "" || len(after.PendingInstallations) != 0 || len(after.UninstallReceipts) != 2 || len(after.Outbox) != len(before.Outbox) || after.PendingRevision != before.PendingRevision {
			t.Fatal("revocation, expiry or replay state changed")
		}
		return
	}
	if phase == "public-pages" {
		handler := newTestHandler(t, &recordingExchanger{})
		handler.config = readyPublicPageConfig()
		for _, route := range []string{"/shopify/app", "/shopify/privacy", "/shopify/terms", "/shopify/data-processing-terms", "/shopify/data-deletion", "/shopify/support", "/shopify/guide"} {
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, route, nil))
			if response.Code != 200 || !strings.Contains(response.Header().Get("Content-Security-Policy"), "frame-ancestors 'none'") || response.Header().Get("Referrer-Policy") != "no-referrer" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("isolated public page failed: %s", route)
			}
			if route == "/shopify/app" || route == "/shopify/terms" || route == "/shopify/support" || route == "/shopify/guide" {
				for _, marker := range []string{"Access requires an account provisioned and authorized by Xinzhi staff", "Self-service registration is not available", "Installing or authorizing the Shopify app does not grant system access"} {
					if !strings.Contains(response.Body.String(), marker) {
						t.Fatalf("staff boundary missing: %s", route)
					}
				}
			}
		}
		return
	}
	if phase == "seed-new" {
		service, handler, _, _ := pendingFixture(t, repository)
		if pendingRequest(t, handler, EmbeddedSessionPath, "demo.myshopify.com").Code != 409 {
			t.Fatal("pending fixture failed")
		}
		_, _, err = repository.RecordUninstallWebhook(t.Context(), UninstallWebhook{
			ShopDomain: "unbound-fixture.myshopify.com", DeliveryID: "synthetic-delivery", PayloadHash: strings.Repeat("a", 64),
		}, shopifyconnector.CanonicalShopIdentity{}, service.now())
		if err != nil {
			t.Fatal("uninstall fixture failed")
		}
	}
	state := snapshotMemoryRepository(repository.inner)
	if len(state.Installations) != 1 {
		t.Fatal("legacy installation lost")
	}
	switch phase {
	case "seed-new", "verify-preserved":
		if len(state.PendingInstallations) != 1 || len(state.UninstallReceipts) != 1 || state.PendingRevision == 0 {
			t.Fatal("new fields were not preserved")
		}
	case "verify-loss":
		if len(state.PendingInstallations) != 0 || len(state.UninstallReceipts) != 0 || state.PendingRevision != 0 {
			t.Fatal("expected historical downgrade data-loss hazard not reproduced")
		}
	default:
		t.Fatal("unexpected rehearsal phase")
	}
}
