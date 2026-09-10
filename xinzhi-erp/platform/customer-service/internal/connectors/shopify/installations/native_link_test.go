package installations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
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

const nativeActor = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"

func nativeLinkFixture(t *testing.T, repo Repository) (*Service, *Handler, NativeLinkRequest) {
	t.Helper()
	s, h, _, _ := pendingFixture(t, repo)
	s.appDataConfigurer = &fakeInstallationAppDataConfigurer{}
	if pendingRequest(t, h, EmbeddedSessionPath, "demo.myshopify.com").Code != http.StatusConflict {
		t.Fatal("pending preparation failed")
	}
	grant, err := s.IssueNativeLink(t.Context(), "demo.myshopify.com")
	if err != nil {
		t.Fatal(err)
	}
	return s, h, NativeLinkRequest{Identity: identity(), Context: requestContext("native-link"), LegacyShopID: testShopID, ShopDomain: "demo.myshopify.com", ActorID: nativeActor, Proof: grant.Proof}
}

func nativeHTTP(t *testing.T, h *Handler, path string, payload any, serviceToken bool) *httptest.ResponseRecorder {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	if serviceToken {
		req.Header.Set(ServiceTokenHeader, "service-token")
	}
	res := httptest.NewRecorder()
	h.ServeHTTP(res, req)
	return res
}

func TestNativeLinkConfirmationPromotesOnceAndKeepsCredentialsInConnector(t *testing.T) {
	repo := NewMemoryRepository()
	s, h, req := nativeLinkFixture(t, repo)
	preview := nativeHTTP(t, h, NativeLinkPreviewPath, nativeLinkPreviewRequest{Proof: req.Proof}, true)
	if preview.Code != 200 || !strings.Contains(preview.Body.String(), "Synthetic pending store") {
		t.Fatal("verified preview missing")
	}
	for _, secret := range []string{req.Proof, req.Identity.TenantID, req.Identity.ShopID, "shpat_", "shprt_", "actorId"} {
		if strings.Contains(preview.Body.String(), secret) {
			t.Fatal("preview leaked private data")
		}
	}
	res := nativeHTTP(t, h, NativeLinkConfirmPath, req, true)
	if res.Code != 200 || res.Header().Get("Cache-Control") != "no-store" || !strings.Contains(res.Body.String(), `"state":"INSTALLED"`) {
		t.Fatalf("confirmation failed: %d", res.Code)
	}
	for _, forbidden := range []string{req.Proof, "shpat_", "shprt_", "ProofHash", nativeActor, "app-secret", "service-token"} {
		if strings.Contains(res.Body.String(), forbidden) {
			t.Fatal("confirmation response leaked private data")
		}
	}
	record, err := repo.GetInstallation(t.Context(), identity())
	if err != nil || record.NativeLinkPending || record.AccessToken != "shpat_pending_synthetic" || record.NativeLinkActorID != nativeActor {
		t.Fatal("installation or receipt invalid")
	}
	if _, _, err := repo.GetPendingInstallation(t.Context(), req.ShopDomain); !errors.Is(err, ErrNotFound) {
		t.Fatal("pending credential was not consumed")
	}
	if _, err := repo.InspectNativeLink(t.Context(), req.Proof, s.now()); !errors.Is(err, ErrNativeLinkUnavailable) {
		t.Fatal("consumed proof can still be previewed")
	}
	if got, err := repo.ResolveCanonicalIdentity(t.Context(), testShopID); err != nil || got != identity() {
		t.Fatal("legacy mapping changed")
	}
	req.Context = requestContext("retry-new-http-request")
	retry := nativeHTTP(t, h, NativeLinkConfirmPath, req, true)
	if retry.Code != 200 || retry.Body.String() != res.Body.String() {
		t.Fatal("same confirmation did not return original receipt")
	}
	if s.exchanger.(*embeddedSessionExchanger).calls != 1 {
		t.Fatal("linking repeated Shopify OAuth/exchange")
	}
	for _, value := range []any{req, NativeLinkGrant{Proof: req.Proof}, nativeLinkPreviewRequest{Proof: req.Proof}, record} {
		if strings.Contains(fmt.Sprintf("%v %#v", value, value), req.Proof) || strings.Contains(fmt.Sprintf("%+v", value), "shpat_") {
			t.Fatal("debug formatting leaked a capability")
		}
	}
}

func TestNativeLinkAuthorityBoundaries(t *testing.T) {
	repo := NewMemoryRepository()
	_, h, req := nativeLinkFixture(t, repo)
	for _, path := range []string{NativeLinkPreviewPath, NativeLinkConfirmPath} {
		if res := nativeHTTP(t, h, path, req, false); res.Code != 403 {
			t.Fatal("native route accepted no service authority")
		}
		raw, _ := json.Marshal(req)
		r := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(raw))
		r.Header.Set("Authorization", "Bearer "+signEmbeddedSessionToken(t, "app-key", "app-secret", req.ShopDomain, h.now()))
		res := httptest.NewRecorder()
		h.ServeHTTP(res, r)
		if res.Code != 403 {
			t.Fatal("Shopify session was accepted as native service authority")
		}
	}
	for _, kind := range []string{"missing", "expired", "wrong-audience", "cross-shop", "query", "body"} {
		t.Run(kind, func(t *testing.T) {
			token := signEmbeddedSessionToken(t, "app-key", "app-secret", req.ShopDomain, h.now())
			path := NativeLinkGrantPath
			body := ""
			switch kind {
			case "missing":
				token = ""
			case "expired":
				token = signEmbeddedSessionToken(t, "app-key", "app-secret", req.ShopDomain, h.now().Add(-time.Hour))
			case "wrong-audience":
				token = signEmbeddedSessionToken(t, "other-app", "app-secret", req.ShopDomain, h.now())
			case "cross-shop":
				token = signEmbeddedSessionToken(t, "app-key", "app-secret", "other.myshopify.com", h.now())
			case "query":
				path += "?shop=other.myshopify.com"
			case "body":
				body = `{"shop":"other.myshopify.com"}`
			}
			r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			r.Header.Set("Authorization", "Bearer "+token)
			res := httptest.NewRecorder()
			h.ServeHTTP(res, r)
			if res.Code < 400 {
				t.Fatal("invalid grant request accepted")
			}
			if strings.Contains(res.Body.String(), req.Proof) || strings.Contains(res.Body.String(), "shpat_") {
				t.Fatal("error leaked proof or credential")
			}
		})
	}
	if _, err := repo.ResolveIdentityByDomain(t.Context(), req.ShopDomain); !errors.Is(err, ErrNotFound) {
		t.Fatal("authority rejection mutated ownership")
	}
}

func TestNativeLinkGrantIssuanceIsSessionBoundAndDoesNotExtendTTL(t *testing.T) {
	repo := NewMemoryRepository()
	s, h, req := nativeLinkFixture(t, repo)
	old, _, err := repo.GetPendingInstallation(t.Context(), req.ShopDomain)
	if err != nil {
		t.Fatal(err)
	}
	now := s.now().Add(time.Minute)
	s.now = func() time.Time { return now }
	h.now = s.now
	res := pendingRequest(t, h, NativeLinkGrantPath, req.ShopDomain)
	var grant NativeLinkGrant
	if res.Code != 200 || json.Unmarshal(res.Body.Bytes(), &grant) != nil || grant.Proof == req.Proof || grant.ContractVersion != NativeLinkContractVersion || grant.Pending.ExpiresAt != old.ExpiresAt {
		t.Fatal("grant issuance or expiry invalid")
	}
	if _, err := repo.InspectNativeLink(t.Context(), req.Proof, s.now()); !errors.Is(err, ErrNativeLinkUnavailable) {
		t.Fatal("old grant not invalidated")
	}
	if _, err := repo.InspectNativeLink(t.Context(), grant.Proof, s.now()); err != nil {
		t.Fatal("new grant not usable")
	}
	stored, _, _ := repo.GetPendingInstallation(t.Context(), req.ShopDomain)
	if stored.LinkProofHash == grant.Proof || !validNonceHash(stored.LinkProofHash) {
		t.Fatal("raw proof persisted")
	}
	if _, err := repo.ResolveIdentityByDomain(t.Context(), req.ShopDomain); !errors.Is(err, ErrNotFound) {
		t.Fatal("issuance created ownership")
	}
}

func TestNativeLinkConfigurationCommitFailureRemainsLockedAfterRestart(t *testing.T) {
	key := bytes.Repeat([]byte{5}, 32)
	path := filepath.Join(t.TempDir(), "native-link.enc")
	repo, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	s, h, req := nativeLinkFixture(t, repo)
	s.appDataConfigurer = nativeLinkConfigurerFunc(func(ctx context.Context, _, _ string, _ shopifyconnector.CanonicalShopIdentity) error {
		other, err := OpenFileRepository(path, key)
		if err != nil {
			return err
		}
		return other.DiscardPendingInstallation(ctx, "other.myshopify.com")
	})
	if res := nativeHTTP(t, h, NativeLinkConfirmPath, req, true); res.Code != 503 {
		t.Fatal("failed final commit reported success")
	}
	record, err := repo.GetInstallation(t.Context(), identity())
	if err != nil || !record.NativeLinkPending {
		t.Fatal("failed final commit opened live access")
	}
	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	s.repository = reopened
	record, err = reopened.GetInstallation(t.Context(), identity())
	if err != nil || !record.NativeLinkPending {
		t.Fatal("failed final commit opened persisted access")
	}
	s.appDataConfigurer = &fakeInstallationAppDataConfigurer{}
	if _, err := s.ConfirmNativeLink(t.Context(), req); err != nil {
		t.Fatal("retry could not resume same owner")
	}
}

func TestNativeLinkCancelledContextAndLegacyConflictDoNotConsumeProof(t *testing.T) {
	repo := NewMemoryRepository()
	s, _, req := nativeLinkFixture(t, repo)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := repo.ConsumeNativeLink(ctx, req, s.requiredScopes, s.now()); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled confirmation accepted")
	}
	other := Binding{Identity: shopifyconnector.CanonicalShopIdentity{TenantID: testTenantID, ShopID: "dddddddd-dddd-4ddd-8ddd-dddddddddddd"}, LegacyShopID: testShopID, ShopDomain: "other.myshopify.com"}
	if err := repo.SaveBinding(t.Context(), other); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ConsumeNativeLink(t.Context(), req, s.requiredScopes, s.now()); !errors.Is(err, ErrBindingConflict) {
		t.Fatal("legacy mapping was overwritten")
	}
	if _, err := repo.InspectNativeLink(t.Context(), req.Proof, s.now()); err != nil {
		t.Fatal("conflict consumed proof")
	}
	if got, err := repo.ResolveCanonicalIdentity(t.Context(), testShopID); err != nil || got != other.Identity {
		t.Fatal("original legacy owner lost")
	}
}

func TestNativeLinkRejectsTamperingExpiryReplacementAndReplay(t *testing.T) {
	for _, scenario := range []string{"wrong-proof", "wrong-domain", "invalid-actor", "invalid-context", "expired", "reissued", "discarded", "missing-scopes", "already-bound", "wrong-actor-replay", "wrong-tenant-replay", "revoked-replay"} {
		t.Run(scenario, func(t *testing.T) {
			repo := NewMemoryRepository()
			s, _, req := nativeLinkFixture(t, repo)
			confirmed := strings.HasSuffix(scenario, "replay")
			if confirmed {
				if _, err := s.ConfirmNativeLink(t.Context(), req); err != nil {
					t.Fatal(err)
				}
			}
			switch scenario {
			case "wrong-proof":
				req.Proof = strings.Repeat("a", 43)
			case "wrong-domain":
				req.ShopDomain = "other.myshopify.com"
			case "invalid-actor":
				req.ActorID = ""
			case "invalid-context":
				req.Context.RequestID = ""
			case "expired":
				now := s.now().Add(pendingInstallationLifetime)
				s.now = func() time.Time { return now }
			case "reissued":
				if _, err := s.IssueNativeLink(t.Context(), req.ShopDomain); err != nil {
					t.Fatal(err)
				}
			case "discarded":
				if err := repo.DiscardPendingInstallation(t.Context(), req.ShopDomain); err != nil {
					t.Fatal(err)
				}
			case "missing-scopes":
				s.requiredScopes = append(s.requiredScopes, "read_customers")
			case "already-bound":
				if err := repo.SaveBinding(t.Context(), Binding{Identity: identity(), LegacyShopID: testShopID, ShopDomain: req.ShopDomain}); err != nil {
					t.Fatal(err)
				}
			case "wrong-actor-replay":
				req.ActorID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
			case "wrong-tenant-replay":
				req.Identity.TenantID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
			case "revoked-replay":
				if _, _, err := repo.MarkRevoked(t.Context(), identity(), s.now()); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.ConfirmNativeLink(t.Context(), req); err == nil {
				t.Fatal("invalid confirmation accepted")
			}
			if !confirmed {
				if _, err := repo.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
					t.Fatal("rejected confirmation saved installation")
				}
			}
		})
	}
}

func TestNativeLinkConcurrentOwnersHaveExactlyOneWinner(t *testing.T) {
	repo := NewMemoryRepository()
	s, _, request := nativeLinkFixture(t, repo)
	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		req := request
		if i == 1 {
			req.Identity.ShopID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
			req.LegacyShopID = req.Identity.ShopID
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := repo.ConsumeNativeLink(t.Context(), req, s.requiredScopes, s.now())
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	winners := 0
	for err := range results {
		if err == nil {
			winners++
		}
	}
	if winners != 1 || len(repo.installations) != 1 || len(repo.bindings) != 1 || len(repo.pendingInstallations) != 0 {
		t.Fatal("concurrent confirmation was not atomic")
	}
}

func TestNativeLinkConfigurationFailureLocksBusinessAndCanResume(t *testing.T) {
	repo := NewMemoryRepository()
	s, h, req := nativeLinkFixture(t, repo)
	configurer := &fakeInstallationAppDataConfigurer{err: errors.New("synthetic secret provider error")}
	s.appDataConfigurer = configurer
	res := nativeHTTP(t, h, NativeLinkConfirmPath, req, true)
	if res.Code != 503 || strings.Contains(res.Body.String(), "synthetic secret") {
		t.Fatal("configuration failure incorrectly reported")
	}
	stored, err := repo.GetInstallation(t.Context(), identity())
	if err != nil || !stored.NativeLinkPending {
		t.Fatal("ownership reservation not retained")
	}
	probe, err := s.ProbeConnection(t.Context(), shopifyconnector.ConnectionProbeRequest{Identity: identity(), Context: requestContext("blocked-probe")})
	if err != nil || string(probe.State) == "CONNECTED" {
		t.Fatal("incomplete installation reported connected")
	}
	if _, _, _, _, err := s.installedReadRecord(t.Context(), identity()); err == nil {
		t.Fatal("shared business read unlocked")
	}
	products, err := s.FetchProductCatalogPage(t.Context(), shopifyconnector.ProductCatalogPageRequest{Identity: identity(), Context: requestContext("blocked-products"), Limit: 10})
	if err != nil || products.State == shopifyconnector.ProductCatalogStateConnected {
		t.Fatal("product read unlocked")
	}
	orders, err := s.FetchOrderCatalogPage(t.Context(), shopifyconnector.OrderCatalogPageRequest{Identity: identity(), Context: requestContext("blocked-orders"), Limit: 10})
	if err != nil || orders.State == shopifyconnector.OrderCatalogStateConnected {
		t.Fatal("order read unlocked")
	}
	if summary(stored).State == shopifyconnector.InstallationStateInstalled {
		t.Fatal("probe summary bypassed configuration gate")
	}
	if _, err := repo.ResolveIdentityByDomain(t.Context(), req.ShopDomain); err != nil {
		t.Fatal("failed configuration lost original ownership")
	}
	// A verified Admin launch repairs the same assignment even after the handoff
	// proof expires, without resurrecting the proof or re-exchanging credentials.
	now := s.now().Add(16 * time.Minute)
	s.now = func() time.Time { return now }
	h.now = s.now
	configurer.err = nil
	connected := pendingRequest(t, h, EmbeddedSessionPath, req.ShopDomain)
	if connected.Code != 200 || !strings.Contains(connected.Body.String(), `"state":"CONNECTED"`) {
		t.Fatal("Admin resume did not finish configuration")
	}
	if s.exchanger.(*embeddedSessionExchanger).calls != 1 {
		t.Fatal("repair exchanged credentials again")
	}
	if _, err := s.ConfirmNativeLink(t.Context(), req); !errors.Is(err, ErrNativeLinkUnavailable) {
		t.Fatal("expired proof replay accepted")
	}
}

type nativeLinkConfigurerFunc func(context.Context, string, string, shopifyconnector.CanonicalShopIdentity) error

func (f nativeLinkConfigurerFunc) ConfigureInstallationAppData(ctx context.Context, d, a string, i shopifyconnector.CanonicalShopIdentity) error {
	return f(ctx, d, a, i)
}

func TestNativeLinkUninstallDuringConfigurationCannotReviveAccess(t *testing.T) {
	repo := NewMemoryRepository()
	s, _, req := nativeLinkFixture(t, repo)
	s.appDataConfigurer = nativeLinkConfigurerFunc(func(ctx context.Context, _, _ string, i shopifyconnector.CanonicalShopIdentity) error {
		_, _, err := repo.MarkRevoked(ctx, i, s.now())
		return err
	})
	if _, err := s.ConfirmNativeLink(t.Context(), req); !errors.Is(err, ErrRepositoryStale) {
		t.Fatal("uninstall did not fence configuration completion")
	}
	record, err := repo.GetInstallation(t.Context(), identity())
	if err != nil || record.State != shopifyconnector.InstallationStateRevoked || record.AccessToken != "" || record.RefreshToken != "" {
		t.Fatal("uninstall credential state revived")
	}
}

func TestNativeLinkEncryptedRestartStaleWriteAndReceiptRecovery(t *testing.T) {
	key := bytes.Repeat([]byte{7}, 32)
	path := filepath.Join(t.TempDir(), "native-link.enc")
	repo, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	s, _, req := nativeLinkFixture(t, repo)
	current, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := current.ConsumeNativeLink(t.Context(), req, s.requiredScopes, s.now()); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.ConsumeNativeLink(t.Context(), req, s.requiredScopes, s.now()); !errors.Is(err, ErrRepositoryStale) {
		t.Fatal("stale writer changed ownership")
	}
	if _, err := repo.GetInstallation(t.Context(), identity()); !errors.Is(err, ErrNotFound) {
		t.Fatal("failed commit mutated live state")
	}
	if _, _, err := repo.GetPendingInstallation(t.Context(), req.ShopDomain); err != nil {
		t.Fatal("failed commit consumed pending live state")
	}
	reopened, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	s.repository = reopened
	if _, err := s.ConfirmNativeLink(t.Context(), req); err != nil {
		t.Fatal("restart could not resume committed confirmation")
	}
	final, err := OpenFileRepository(path, key)
	if err != nil {
		t.Fatal(err)
	}
	record, err := final.GetInstallation(t.Context(), identity())
	if err != nil || record.NativeLinkPending || record.NativeLinkActorID != nativeActor {
		t.Fatal("configured receipt missing after restart")
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{req.Proof, record.NativeLinkProofHash, record.AccessToken, record.RefreshToken, nativeActor, req.ShopDomain} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatal("persistent file contains plaintext capability or identity")
		}
	}
}

func TestNativeLinkHTTPRejectsInvalidBodiesAndQueries(t *testing.T) {
	repo := NewMemoryRepository()
	_, h, req := nativeLinkFixture(t, repo)
	for _, path := range []string{NativeLinkConfirmPath, NativeLinkPreviewPath} {
		for _, body := range []string{`{}`, `{"proof":"bad"}`, `{"proof":"x","unknown":true}`, `{} {}`, strings.Repeat("x", installationRequestLimit+1)} {
			r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
			r.Header.Set(ServiceTokenHeader, "service-token")
			res := httptest.NewRecorder()
			h.ServeHTTP(res, r)
			if res.Code < 400 || res.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("invalid body accepted")
			}
		}
		if res := nativeHTTP(t, h, path+"?proof=forbidden", req, true); res.Code != 400 {
			t.Fatal("query capability accepted")
		}
	}
}
