//go:build sharedidentityfixture

package platform

import (
	"context"
	"net"
	"net/http"
	"testing"
	"time"
)

// Explicit synthetic UI fixture: no database, environment credentials, provider
// workers or production endpoint. The fake ERP on 19181 owns fixture identity.
func TestSharedIdentityBrowserFixture(t *testing.T) {
	factory := NewMemoryERPTenantStoreFactory()
	if _, err := factory.StoreForTenant(context.Background(), "11111111-1111-4111-8111-111111111111"); err != nil {
		t.Fatal(err)
	}
	verifier, err := NewHTTPERPIdentityVerifier("http://127.0.0.1:19181", "fixture-only-internal", "http://127.0.0.1:19182", nil)
	if err != nil {
		t.Fatal(err)
	}
	mux, err := NewERPSharedIdentityMux(NewServer(NewMemoryStore()), verifier, factory, []string{"http://127.0.0.1:19181", "http://127.0.0.1:19182"})
	if err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:18581")
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	defer server.Close()
	go server.Serve(listener)
	t.Log("SYNTHETIC SHARED IDENTITY: http://127.0.0.1:18581; no production services")
	<-time.After(10 * time.Minute)
}
