package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
)

func TestOAuthGatewayForwardsOnlyOAuthBrowserRoutes(t *testing.T) {
	var hits atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("X-Upstream-Path", r.URL.Path)
		w.Header().Set("X-Upstream-Query", r.URL.RawQuery)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(upstream.Close)
	upstreamURL, err := url.Parse(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	gateway := newOAuthGateway(upstreamURL)

	for _, path := range []string{oauthAuthorizePath, oauthCallbackPath} {
		t.Run(path, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, path+"?state=opaque", nil)
			response := httptest.NewRecorder()
			gateway.ServeHTTP(response, request)

			if response.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusNoContent)
			}
			if got := response.Header().Get("X-Upstream-Path"); got != path {
				t.Fatalf("forwarded path = %q, want %q", got, path)
			}
			if got := response.Header().Get("X-Upstream-Query"); got != "state=opaque" {
				t.Fatalf("forwarded query = %q", got)
			}
		})
	}

	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	response := httptest.NewRecorder()
	gateway.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("private route status = %d, want %d", response.Code, http.StatusNotFound)
	}
	if got := hits.Load(); got != 2 {
		t.Fatalf("upstream hits = %d, want 2", got)
	}
}

func TestOAuthGatewayRejectsNonGetRequests(t *testing.T) {
	upstream, _ := url.Parse("http://127.0.0.1:8790")
	request := httptest.NewRequest(http.MethodPost, oauthCallbackPath, nil)
	response := httptest.NewRecorder()

	newOAuthGateway(upstream).ServeHTTP(response, request)

	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	if got := response.Header().Get("Allow"); got != http.MethodGet {
		t.Fatalf("Allow = %q, want GET", got)
	}
}

func TestValidLoopbackUpstream(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{value: "http://127.0.0.1:8790", want: true},
		{value: "http://[::1]:8790", want: true},
		{value: "http://localhost:8790", want: true},
		{value: "https://127.0.0.1:8790", want: false},
		{value: "http://127.0.0.1", want: false},
		{value: "http://10.0.0.8:8790", want: false},
		{value: "http://127.0.0.1:8790/private", want: false},
	}

	for _, test := range tests {
		t.Run(test.value, func(t *testing.T) {
			parsed, err := url.Parse(test.value)
			if err != nil {
				t.Fatal(err)
			}
			if got := validLoopbackUpstream(parsed); got != test.want {
				t.Fatalf("validLoopbackUpstream(%q) = %v, want %v", test.value, got, test.want)
			}
		})
	}
}
