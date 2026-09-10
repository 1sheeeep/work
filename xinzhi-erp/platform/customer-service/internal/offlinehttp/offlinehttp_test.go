package offlinehttp

import (
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"
)

type recordingTransport struct {
	calls atomic.Int32
}

func (t *recordingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	t.calls.Add(1)
	return &http.Response{
		StatusCode: http.StatusOK,
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader("ok")),
	}, nil
}

func TestGuardBlocksProviderBeforeBaseTransport(t *testing.T) {
	base := &recordingTransport{}
	request, _ := http.NewRequest(http.MethodGet, "https://admin.shopify.com/api", nil)
	if _, err := Guard(base).RoundTrip(request); err == nil {
		t.Fatal("strict offline guard allowed an external provider request")
	}
	if got := base.calls.Load(); got != 0 {
		t.Fatalf("external provider reached base transport: calls=%d", got)
	}
}

func TestGuardAllowsApprovedLoopback(t *testing.T) {
	base := &recordingTransport{}
	request, _ := http.NewRequest(http.MethodGet, "http://127.0.0.1:8790/healthz", nil)
	response, err := Guard(base).RoundTrip(request)
	if err != nil {
		t.Fatalf("approved loopback was blocked: %v", err)
	}
	response.Body.Close()
	if got := base.calls.Load(); got != 1 {
		t.Fatalf("approved loopback calls=%d, want 1", got)
	}
}

func TestWrapLeavesNormalRuntimeTransportUnchanged(t *testing.T) {
	t.Setenv(environmentName, "")
	base := &recordingTransport{}
	if got := Wrap(base); got != base {
		t.Fatal("normal runtime transport was changed")
	}
}
