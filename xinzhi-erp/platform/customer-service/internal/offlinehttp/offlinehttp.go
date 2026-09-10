package offlinehttp

import (
	"errors"
	"net"
	"net/http"
	"os"
	"strings"
)

const environmentName = "XZDESK_STRICT_OFFLINE_LOCAL"

var ErrExternalProviderBlocked = errors.New("strict offline local runtime blocked a non-loopback provider request")

// Enabled is intentionally process-wide: every HTTP client constructed by the
// imported customer-service runtime, including clients with explicit transports,
// must make the same offline decision.
func Enabled() bool {
	return strings.TrimSpace(os.Getenv(environmentName)) == "1"
}

// Wrap applies the process-wide strict-offline policy without changing normal
// development or production transports.
func Wrap(base http.RoundTripper) http.RoundTripper {
	if !Enabled() {
		return base
	}
	return Guard(base)
}

// Guard always applies the offline policy and is exposed for focused tests.
func Guard(base http.RoundTripper) http.RoundTripper {
	if base == nil {
		base = http.DefaultTransport
	}
	return transport{base: base}
}

type transport struct {
	base http.RoundTripper
}

func (t transport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request == nil || request.URL == nil || !approvedLoopbackTarget(request.URL.Scheme, request.URL.Hostname(), request.URL.Port()) {
		return nil, ErrExternalProviderBlocked
	}
	return t.base.RoundTrip(request)
}

func approvedLoopbackTarget(scheme string, host string, port string) bool {
	if scheme != "http" || port == "" {
		return false
	}
	host = strings.TrimSpace(strings.ToLower(host))
	address := net.ParseIP(host)
	if host != "localhost" && (address == nil || !address.IsLoopback()) {
		return false
	}
	switch port {
	case "8080", "8787", "8790", "18888", "5173":
		return true
	default:
		return false
	}
}
