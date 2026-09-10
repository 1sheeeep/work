package platform

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestEventWebSocketTicketRejectsReplayCrossOriginAndExpiry(t *testing.T) {
	const (
		originA = "https://erp-a.example.test"
		originB = "https://erp-b.example.test"
	)
	app := NewServer(NewMemoryStore())
	app.ConfigureAllowedOrigins([]string{originA, originB})
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	token := bootstrapAdmin(t, server.URL)

	ticket := issueWSTicketForOrigin(t, server.URL, token, originA)
	conn, response, err := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticket),
		http.Header{"Origin": []string{originA}},
	)
	if err != nil {
		t.Fatalf("first websocket ticket use failed: response=%#v err=%v", response, err)
	}
	_ = conn.Close()
	_, replayResponse, replayErr := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticket),
		http.Header{"Origin": []string{originA}},
	)
	if replayErr == nil || replayResponse == nil || replayResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replayed websocket ticket was not rejected: response=%#v err=%v", replayResponse, replayErr)
	}

	crossOriginTicket := issueWSTicketForOrigin(t, server.URL, token, originA)
	_, crossOriginResponse, crossOriginErr := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(crossOriginTicket),
		http.Header{"Origin": []string{originB}},
	)
	if crossOriginErr == nil || crossOriginResponse == nil || crossOriginResponse.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin websocket ticket was not rejected: response=%#v err=%v", crossOriginResponse, crossOriginErr)
	}

	expiredTicket := issueWSTicketForOrigin(t, server.URL, token, originA)
	expiredHash := hashSessionToken(expiredTicket)
	app.wsTicketsMu.Lock()
	grant := app.wsTickets[expiredHash]
	grant.ExpiresAt = time.Now().UTC().Add(-time.Second)
	app.wsTickets[expiredHash] = grant
	app.wsTicketsMu.Unlock()
	_, expiredResponse, expiredErr := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(expiredTicket),
		http.Header{"Origin": []string{originA}},
	)
	if expiredErr == nil || expiredResponse == nil || expiredResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired websocket ticket was not rejected: response=%#v err=%v", expiredResponse, expiredErr)
	}

	_, URLTokenResponse, URLTokenErr := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?token="+url.QueryEscape(token),
		http.Header{"Origin": []string{originA}},
	)
	if URLTokenErr == nil || URLTokenResponse == nil || URLTokenResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("URL credential was not rejected: response=%#v err=%v", URLTokenResponse, URLTokenErr)
	}
}

func TestEventWebSocketTicketRejectsExpiredERPEntrySession(t *testing.T) {
	const origin = "https://erp.example.test"
	verifier := &fixedERPIdentityVerifier{identity: testFullERPIdentity("ticket-tenant")}
	app := NewServer(NewMemoryStore())
	app.ConfigureAllowedOrigins([]string{origin})
	app.ConfigureERPIdentity(verifier, true)
	server := httptest.NewServer(app.Routes())
	defer server.Close()

	login, err := enterERP(server.URL, "erp-token", "ticket-tenant", "user-1")
	if err != nil {
		t.Fatal(err)
	}
	ticket := issueWSTicketForOrigin(t, server.URL, login.Token, origin)
	app.erpSessionMu.Lock()
	identity := app.erpSessionIdentities[hashSessionToken(login.Token)]
	identity.ExpiresAt = time.Now().UTC().Add(-time.Second)
	app.erpSessionIdentities[hashSessionToken(login.Token)] = identity
	app.erpSessionMu.Unlock()

	_, response, err := websocket.DefaultDialer.Dial(
		wsURL(server.URL)+"/ws/events?ticket="+url.QueryEscape(ticket),
		http.Header{"Origin": []string{origin}},
	)
	if err == nil || response == nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ERP-revoked websocket ticket was not rejected: response=%#v err=%v", response, err)
	}
}

func issueWSTicketForOrigin(t *testing.T, baseURL string, token string, origin string) string {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, baseURL+"/api/v1/auth/ws-ticket", nil)
	if err != nil {
		t.Fatalf("create websocket ticket request: %v", err)
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Origin", origin)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("issue websocket ticket: %v", err)
	}
	defer response.Body.Close()
	var result struct {
		Ticket string `json:"ticket"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatalf("decode websocket ticket: %v", err)
	}
	if response.StatusCode != http.StatusCreated || result.Ticket == "" {
		t.Fatalf("issue websocket ticket: status=%d result=%#v", response.StatusCode, result)
	}
	return result.Ticket
}
