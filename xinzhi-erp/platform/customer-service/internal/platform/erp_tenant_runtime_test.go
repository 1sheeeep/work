package platform

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type tokenERPIdentityVerifier struct {
	mu         sync.RWMutex
	identities map[string]ERPIdentity
}

func (v *tokenERPIdentityVerifier) Redeem(_ context.Context, request ERPEntryGrantRequest) (ERPIdentity, error) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	for token, identity := range v.identities {
		if normalizedTestGrant(token) != request.Grant {
			continue
		}
		if identity.TenantID != request.TenantID || identity.SubjectID != request.SubjectID {
			return ERPIdentity{}, errERPIdentityUnauthorized
		}
		return identity, nil
	}
	return ERPIdentity{}, errERPIdentityUnauthorized
}

func (v *tokenERPIdentityVerifier) set(token string, identity ERPIdentity) {
	v.mu.Lock()
	v.identities[token] = identity
	v.mu.Unlock()
}

func TestERPTenantMuxIsolatesConcurrentTenantsAndSameIDs(t *testing.T) {
	verifier := newTwoTenantVerifier()
	app := NewServer(NewMemoryStore())
	mux, err := NewERPTenantMux(app, verifier, NewMemoryERPTenantStoreFactory(), true, []string{testERPOrigin})
	if err != nil {
		t.Fatalf("NewERPTenantMux: %v", err)
	}
	server := httptest.NewServer(mux)
	defer server.Close()

	type exchangeResult struct {
		login AuthResult
		err   error
	}
	results := make(chan exchangeResult, 2)
	for _, token := range []string{"token-a", "token-b"} {
		token := token
		go func() {
			login, requestErr := exchangeERP(server.URL, token)
			results <- exchangeResult{login: login, err: requestErr}
		}()
	}
	logins := map[string]AuthResult{}
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatalf("concurrent exchange failed: %v", result.err)
		}
		logins[result.login.TenantID] = result.login
	}
	if len(logins) != 2 {
		t.Fatalf("expected both tenants to exchange in one runtime: %#v", logins)
	}

	conversationsA := tenantConversations(t, server.URL, "tenant-a", logins["tenant-a"].Token, http.StatusOK)
	conversationsB := tenantConversations(t, server.URL, "tenant-b", logins["tenant-b"].Token, http.StatusOK)
	if len(conversationsA) != 1 || len(conversationsB) != 1 ||
		conversationsA[0].ID != conversationsB[0].ID ||
		conversationsA[0].ShopID != conversationsB[0].ShopID {
		t.Fatalf("expected isolated same-shape facts: A=%#v B=%#v", conversationsA, conversationsB)
	}

	headersA := http.Header{erpTenantHeader: []string{"tenant-a"}}
	requestJSONWithHeaders(
		t,
		http.MethodPost,
		server.URL+"/api/v1/conversations/"+conversationsA[0].ID+"/claim",
		logins["tenant-a"].Token,
		headersA,
		nil,
		http.StatusOK,
		nil,
	)
	conversationsB = tenantConversations(t, server.URL, "tenant-b", logins["tenant-b"].Token, http.StatusOK)
	if conversationsB[0].Status != ConversationStatusOpen || conversationsB[0].AssignedAgentID != "" {
		t.Fatalf("tenant A write leaked into tenant B: %#v", conversationsB[0])
	}

	tenantConversations(t, server.URL, "tenant-b", logins["tenant-a"].Token, http.StatusUnauthorized)
	tenantConversations(t, server.URL, "tenant-a", logins["tenant-b"].Token, http.StatusUnauthorized)
}

func TestERPTenantMuxRejectsDefaultAccountAndBusinessRoutes(t *testing.T) {
	defaultStore := NewMemoryStore()
	verifier := newTwoTenantVerifier()
	mux, err := NewERPTenantMux(
		NewServer(defaultStore),
		verifier,
		NewMemoryERPTenantStoreFactory(),
		true,
		[]string{"https://erp.example.test"},
	)
	if err != nil {
		t.Fatalf("NewERPTenantMux: %v", err)
	}
	server := httptest.NewServer(mux)
	defer server.Close()

	for _, request := range []struct {
		method string
		path   string
		input  any
	}{
		{
			method: http.MethodPost,
			path:   "/api/v1/bootstrap/admin",
			input: createUserRequest{
				Email: "bypass@example.test", Password: "password-123",
			},
		},
		{
			method: http.MethodPost,
			path:   "/api/v1/auth/login",
			input: loginRequest{
				Email: "bypass@example.test", Password: "password-123",
			},
		},
		{method: http.MethodGet, path: "/api/v1/shops"},
		{method: http.MethodPost, path: "/api/v1/auth/ws-ticket"},
	} {
		requestJSON(
			t,
			request.method,
			server.URL+request.path,
			"",
			request.input,
			http.StatusForbidden,
			nil,
		)
	}
	count, err := defaultStore.CountUsers(t.Context())
	if err != nil || count != 0 {
		t.Fatalf("default store created a bypass identity: count=%d err=%v", count, err)
	}
	requestJSON(t, http.MethodGet, server.URL+"/healthz", "", nil, http.StatusOK, nil)

	t.Setenv("XZ_ERP_LEGAL_NAME", "XZ Technology Ltd.")
	t.Setenv("XZ_ERP_SUPPORT_EMAIL", "support@example.test")
	t.Setenv("XZ_ERP_PRIVACY_EFFECTIVE_DATE", "2026-08-22")
	publicResponse, err := http.Get(server.URL + "/shopify/xz-erp/guide")
	if err != nil {
		t.Fatalf("public Xinzhi ERP guide: %v", err)
	}
	defer publicResponse.Body.Close()
	if publicResponse.StatusCode != http.StatusOK {
		t.Fatalf("public Xinzhi ERP guide status = %d, want %d", publicResponse.StatusCode, http.StatusOK)
	}

	t.Setenv("XZ_ERP_CONNECTOR_TOKEN", "tenant-mux-workload-token")
	t.Setenv("XZ_SHOPIFY_CONNECTOR_INTERNAL_BASE_URL", "")
	connectorHeaders := http.Header{
		"X-XZ-ERP-Connector-Token": []string{"tenant-mux-workload-token"},
	}
	requestJSONWithHeaders(
		t,
		http.MethodPost,
		server.URL+"/api/v1/erp-connector/shopify/connection",
		"",
		connectorHeaders,
		map[string]any{
			"identity": map[string]string{
				"tenantId": "10000000-0000-0000-0000-000000000001",
				"shopId":   "20000000-0000-0000-0000-000000000001",
			},
			"context": map[string]string{
				"correlationId": "tenant-mux-connector",
				"requestId":     "tenant-mux-connector",
			},
		},
		http.StatusBadGateway,
		nil,
	)
}

func TestERPTenantMuxRoutesOnlyPublicStorefrontSupportToExistingTenant(t *testing.T) {
	verifier := newTwoTenantVerifier()
	factory := NewMemoryERPTenantStoreFactory()
	store, err := factory.StoreForTenant(t.Context(), "tenant-a")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.CreateShop(t.Context(), Shop{
		DisplayName: "Tenant A Review Store",
		ExternalID:  "review-store.myshopify.com",
		Status:      ShopStatusActive,
	}); err != nil {
		t.Fatal(err)
	}
	mux, err := NewERPTenantMux(NewServer(NewMemoryStore()), verifier, factory, true, nil)
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mux)
	defer server.Close()

	var config publicChatConfigResponse
	requestJSON(
		t,
		http.MethodGet,
		server.URL+"/api/v1/public/chat/config?tenant=tenant-a&shop=review-store.myshopify.com",
		"",
		nil,
		http.StatusOK,
		&config,
	)
	if config.Shop.DisplayName != "Tenant A Review Store" {
		t.Fatalf("public chat routed to the wrong tenant: %#v", config.Shop)
	}

	requestJSON(
		t,
		http.MethodGet,
		server.URL+"/api/v1/public/chat/config?tenant=tenant-missing&shop=review-store.myshopify.com",
		"",
		nil,
		http.StatusNotFound,
		nil,
	)
	factory.mu.Lock()
	_, createdMissingTenant := factory.stores["tenant-missing"]
	factory.mu.Unlock()
	if createdMissingTenant {
		t.Fatal("an untrusted public tenant route created a tenant store")
	}

	preflight, _ := http.NewRequest(
		http.MethodOptions,
		server.URL+"/api/v1/public/chat/config?tenant=tenant-a&shop=review-store.myshopify.com",
		nil,
	)
	preflight.Header.Set("Origin", "https://merchant-store.example")
	preflightResponse, err := http.DefaultClient.Do(preflight)
	if err != nil {
		t.Fatal(err)
	}
	defer preflightResponse.Body.Close()
	if preflightResponse.StatusCode != http.StatusNoContent ||
		preflightResponse.Header.Get("Access-Control-Allow-Origin") != "https://merchant-store.example" {
		t.Fatalf("storefront preflight failed: status=%d origin=%q",
			preflightResponse.StatusCode,
			preflightResponse.Header.Get("Access-Control-Allow-Origin"))
	}

	widgetResponse, err := http.Get(server.URL + "/chat/widget.js")
	if err != nil {
		t.Fatal(err)
	}
	defer widgetResponse.Body.Close()
	if widgetResponse.StatusCode != http.StatusOK {
		t.Fatalf("public widget asset status=%d", widgetResponse.StatusCode)
	}
}

func TestERPTenantMuxBackgroundLifecycleStartsEachTenantExactlyOnce(t *testing.T) {
	verifier := newTwoTenantVerifier()
	mux, err := NewERPTenantMux(
		NewServer(NewMemoryStore()),
		verifier,
		NewMemoryERPTenantStoreFactory(),
		true,
		[]string{testERPOrigin},
	)
	if err != nil {
		t.Fatalf("NewERPTenantMux: %v", err)
	}
	server := httptest.NewServer(mux)
	defer server.Close()

	var lifecycleMu sync.Mutex
	starts := map[string]int{}
	stops := map[string]int{}
	starter := func(ctx context.Context, server *Server) {
		tenantID, bindingErr := server.store.(ERPTenantBoundStore).
			GetERPTenantBinding(context.Background())
		if bindingErr != nil {
			t.Errorf("read tenant binding in background starter: %v", bindingErr)
			return
		}
		lifecycleMu.Lock()
		starts[tenantID]++
		lifecycleMu.Unlock()
		go func() {
			<-ctx.Done()
			lifecycleMu.Lock()
			stops[tenantID]++
			lifecycleMu.Unlock()
		}()
	}

	firstContext, cancelFirst := context.WithCancel(t.Context())
	mux.ActivateTenantBackground(firstContext, starter)
	if _, err := exchangeERP(server.URL, "token-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := exchangeERP(server.URL, "token-b"); err != nil {
		t.Fatal(err)
	}
	waitForTenantLifecycle(t, &lifecycleMu, starts, "tenant-a", 1)
	waitForTenantLifecycle(t, &lifecycleMu, starts, "tenant-b", 1)
	if _, err := exchangeERP(server.URL, "token-a"); err != nil {
		t.Fatal(err)
	}
	assertTenantLifecycleCount(t, &lifecycleMu, starts, "tenant-a", 1)

	cancelFirst()
	waitForTenantLifecycle(t, &lifecycleMu, stops, "tenant-a", 1)
	waitForTenantLifecycle(t, &lifecycleMu, stops, "tenant-b", 1)

	secondContext, cancelSecond := context.WithCancel(t.Context())
	mux.ActivateTenantBackground(secondContext, starter)
	waitForTenantLifecycle(t, &lifecycleMu, starts, "tenant-a", 2)
	waitForTenantLifecycle(t, &lifecycleMu, starts, "tenant-b", 2)
	cancelSecond()
	waitForTenantLifecycle(t, &lifecycleMu, stops, "tenant-a", 2)
	waitForTenantLifecycle(t, &lifecycleMu, stops, "tenant-b", 2)
}

func TestERPTenantMuxWSTicketRoutesAreConsumedAndExpired(t *testing.T) {
	const allowedOrigin = testERPOrigin
	verifier := newTwoTenantVerifier()
	mux, err := NewERPTenantMux(
		NewServer(NewMemoryStore()),
		verifier,
		NewMemoryERPTenantStoreFactory(),
		true,
		[]string{allowedOrigin},
	)
	if err != nil {
		t.Fatalf("NewERPTenantMux: %v", err)
	}
	mux.wsTicketRouteTTL = 40 * time.Millisecond
	server := httptest.NewServer(mux)
	defer server.Close()

	loginA, err := exchangeERP(server.URL, "token-a")
	if err != nil {
		t.Fatal(err)
	}
	loginB, err := exchangeERP(server.URL, "token-b")
	if err != nil {
		t.Fatal(err)
	}
	ticketA := issueTenantWSTicket(
		t, server.URL, "tenant-a", loginA.Token, allowedOrigin,
	)
	ticketB := issueTenantWSTicket(
		t, server.URL, "tenant-b", loginB.Token, allowedOrigin,
	)
	assertERPTenantMuxRouteCount(t, mux, 2)

	connection, response, err := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticketA),
		http.Header{"Origin": []string{allowedOrigin}},
	)
	if err != nil {
		t.Fatalf("tenant A ticket did not route to its server: response=%#v err=%v", response, err)
	}
	_ = connection.Close()
	assertERPTenantMuxRouteCount(t, mux, 1)

	_, replayResponse, replayErr := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticketA),
		http.Header{"Origin": []string{allowedOrigin}},
	)
	if replayErr == nil || replayResponse == nil ||
		replayResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf(
			"consumed mux ticket route was replayed: response=%#v err=%v",
			replayResponse,
			replayErr,
		)
	}
	assertERPTenantMuxRouteCount(t, mux, 1)

	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		mux.mu.RLock()
		remaining := len(mux.wsTickets)
		mux.mu.RUnlock()
		if remaining == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	assertERPTenantMuxRouteCount(t, mux, 0)
	_, expiredResponse, expiredErr := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticketB),
		http.Header{"Origin": []string{allowedOrigin}},
	)
	if expiredErr == nil || expiredResponse == nil ||
		expiredResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf(
			"expired mux ticket route remained usable: response=%#v err=%v",
			expiredResponse,
			expiredErr,
		)
	}
}

func TestFileERPTenantMuxRestartPreservesIsolationAndFailsOldSessionsClosed(t *testing.T) {
	verifier := newTwoTenantVerifier()
	dataFile := filepath.Join(t.TempDir(), "customer-service.json")
	firstMux, err := NewERPTenantMux(
		NewServer(NewMemoryStore()),
		verifier,
		NewFileERPTenantStoreFactory(dataFile),
		true,
		[]string{testERPOrigin},
	)
	if err != nil {
		t.Fatalf("first NewERPTenantMux: %v", err)
	}
	firstServer := httptest.NewServer(firstMux)
	loginA, err := exchangeERP(firstServer.URL, "token-a")
	if err != nil {
		t.Fatal(err)
	}
	loginB, err := exchangeERP(firstServer.URL, "token-b")
	if err != nil {
		t.Fatal(err)
	}
	conversationA := tenantConversations(t, firstServer.URL, "tenant-a", loginA.Token, http.StatusOK)[0]
	requestJSONWithHeaders(
		t,
		http.MethodPost,
		firstServer.URL+"/api/v1/conversations/"+conversationA.ID+"/claim",
		loginA.Token,
		http.Header{erpTenantHeader: []string{"tenant-a"}},
		nil,
		http.StatusOK,
		nil,
	)
	firstServer.Close()

	restartedMux, err := NewERPTenantMux(
		NewServer(NewMemoryStore()),
		verifier,
		NewFileERPTenantStoreFactory(dataFile),
		true,
		[]string{testERPOrigin},
	)
	if err != nil {
		t.Fatalf("restarted NewERPTenantMux: %v", err)
	}
	restartedServer := httptest.NewServer(restartedMux)
	defer restartedServer.Close()

	tenantConversations(t, restartedServer.URL, "tenant-a", loginA.Token, http.StatusUnauthorized)
	tenantConversations(t, restartedServer.URL, "tenant-b", loginB.Token, http.StatusUnauthorized)
	restartedA, err := exchangeERP(restartedServer.URL, "token-a")
	if err != nil {
		t.Fatal(err)
	}
	restartedB, err := exchangeERP(restartedServer.URL, "token-b")
	if err != nil {
		t.Fatal(err)
	}
	conversationsA := tenantConversations(t, restartedServer.URL, "tenant-a", restartedA.Token, http.StatusOK)
	conversationsB := tenantConversations(t, restartedServer.URL, "tenant-b", restartedB.Token, http.StatusOK)
	if conversationsA[0].Status != ConversationStatusAssigned {
		t.Fatalf("tenant A state did not survive restart: %#v", conversationsA[0])
	}
	if conversationsB[0].Status != ConversationStatusOpen || conversationsB[0].AssignedAgentID != "" {
		t.Fatalf("tenant B state was contaminated across restart: %#v", conversationsB[0])
	}
}

func newTwoTenantVerifier() *tokenERPIdentityVerifier {
	tenantA := testFullERPIdentity("tenant-a")
	tenantA.Shops[0].DisplayName = "Tenant A Shop"
	tenantB := testFullERPIdentity("tenant-b")
	tenantB.Shops[0].DisplayName = "Tenant B Shop"
	return &tokenERPIdentityVerifier{identities: map[string]ERPIdentity{
		"token-a": tenantA,
		"token-b": tenantB,
	}}
}

func exchangeERP(baseURL string, token string) (AuthResult, error) {
	tenantID := strings.Replace(token, "token-", "tenant-", 1)
	return enterERP(baseURL, token, tenantID, "user-1")
}

func normalizedTestGrant(seed string) string {
	if seed == "" {
		seed = "grant"
	}
	return strings.Repeat(seed, 43/len(seed)+1)[:43]
}

func enterERP(baseURL string, grantSeed string, tenantID string, userID string) (AuthResult, error) {
	form := url.Values{
		"grant":    {normalizedTestGrant(grantSeed)},
		"tenantId": {tenantID},
		"userId":   {userID},
	}
	req, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/auth/erp/entry", strings.NewReader(form.Encode()))
	if err != nil {
		return AuthResult{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Origin", testERPOrigin)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return AuthResult{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		var body bytes.Buffer
		_, _ = body.ReadFrom(resp.Body)
		return AuthResult{}, fmt.Errorf("exchange status=%d body=%s", resp.StatusCode, body.String())
	}
	var body bytes.Buffer
	_, _ = body.ReadFrom(resp.Body)
	const prefix = "JSON.stringify("
	const suffix = "));location.replace('/')"
	start := strings.Index(body.String(), prefix)
	end := strings.Index(body.String(), suffix)
	if start < 0 || end <= start+len(prefix) {
		return AuthResult{}, fmt.Errorf("entry response did not contain a customer-service session")
	}
	var result AuthResult
	if err := json.Unmarshal([]byte(body.String()[start+len(prefix):end]), &result); err != nil {
		return AuthResult{}, err
	}
	return result, nil
}

func tenantConversations(
	t *testing.T,
	baseURL string,
	tenantID string,
	token string,
	wantStatus int,
) []Conversation {
	t.Helper()
	var conversations []Conversation
	var output any
	if wantStatus == http.StatusOK {
		output = &conversations
	}
	requestJSONWithHeaders(
		t,
		http.MethodGet,
		baseURL+"/api/v1/conversations?scope=all",
		token,
		http.Header{erpTenantHeader: []string{tenantID}},
		nil,
		wantStatus,
		output,
	)
	return conversations
}

func issueTenantWSTicket(
	t *testing.T,
	baseURL string,
	tenantID string,
	token string,
	origin string,
) string {
	t.Helper()
	var ticket struct {
		Ticket string `json:"ticket"`
	}
	requestJSONWithHeaders(
		t,
		http.MethodPost,
		baseURL+"/api/v1/auth/ws-ticket",
		token,
		http.Header{
			erpTenantHeader: []string{tenantID},
			"Origin":        []string{origin},
		},
		nil,
		http.StatusCreated,
		&ticket,
	)
	if ticket.Ticket == "" {
		t.Fatal("tenant websocket ticket was empty")
	}
	return ticket.Ticket
}

func assertERPTenantMuxRouteCount(t *testing.T, mux *ERPTenantMux, want int) {
	t.Helper()
	mux.mu.RLock()
	got := len(mux.wsTickets)
	mux.mu.RUnlock()
	if got != want {
		t.Fatalf("ERP tenant mux route count=%d want=%d", got, want)
	}
}

func waitForTenantLifecycle(
	t *testing.T,
	mu *sync.Mutex,
	counts map[string]int,
	tenantID string,
	want int,
) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		got := counts[tenantID]
		mu.Unlock()
		if got == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	assertTenantLifecycleCount(t, mu, counts, tenantID, want)
}

func assertTenantLifecycleCount(
	t *testing.T,
	mu *sync.Mutex,
	counts map[string]int,
	tenantID string,
	want int,
) {
	t.Helper()
	mu.Lock()
	got := counts[tenantID]
	mu.Unlock()
	if got != want {
		t.Fatalf("tenant %s lifecycle count=%d want=%d", tenantID, got, want)
	}
}
