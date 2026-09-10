package mailapi

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestExplicitProviderTransportCannotBypassStrictOfflineRuntime(t *testing.T) {
	var proxyCalls atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		proxyCalls.Add(1)
	}))
	defer proxy.Close()
	t.Setenv("XZDESK_STRICT_OFFLINE_LOCAL", "1")

	client, err := httpClientForNetwork(networkConfig{ProxyURL: proxy.URL})
	if err != nil {
		t.Fatalf("construct explicit provider client: %v", err)
	}
	request, err := http.NewRequest(http.MethodGet, graphBaseURL+"/me/messages", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Do(request); err == nil {
		t.Fatal("explicit Outlook/Gmail network transport bypassed strict offline runtime")
	}
	if got := proxyCalls.Load(); got != 0 {
		t.Fatalf("provider request reached explicit proxy/dial transport: calls=%d", got)
	}
}
