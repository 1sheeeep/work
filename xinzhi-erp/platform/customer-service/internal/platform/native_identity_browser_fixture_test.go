//go:build nativeidentityfixture

package platform

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"
)

// Explicit, in-memory browser fixture. No database, provider workers, shop or
// real account is opened. Run only with -tags nativeidentityfixture -run this test.
func TestNativeIdentityBrowserFixture(t *testing.T) {
	factory := NewMemoryERPTenantStoreFactory()
	store, err := factory.StoreForTenant(context.Background(), "native-demo")
	if err != nil {
		t.Fatal(err)
	}
	seed := NewServer(store)
	for _, input := range []createUserRequest{
		{Email: "admin@example.test", DisplayName: "Synthetic Admin", Password: "FixtureOnly!2026", Role: UserRoleAdmin, SystemAdmin: true},
		{Email: "agent@example.test", DisplayName: "Synthetic Agent", Password: "FixtureOnly!2026", Role: UserRoleAgent},
	} {
		if _, err := seed.createUserFromRequest(context.Background(), input); err != nil {
			t.Fatal(err)
		}
	}
	mux, err := NewNativeTenantMux(NewServer(NewMemoryStore()), factory, []string{"http://127.0.0.1:18574"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(mux)
	defer server.Close()
	t.Logf("SYNTHETIC_NATIVE_FIXTURE=%s", server.URL)
	<-time.After(10 * time.Minute)
}
