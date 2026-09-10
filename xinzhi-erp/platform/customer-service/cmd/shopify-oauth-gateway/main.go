package main

import (
	"context"
	"errors"
	"flag"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
)

const (
	oauthAuthorizePath = "/shopify/oauth/authorize"
	oauthCallbackPath  = "/shopify/oauth/callback"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8791", "OAuth-only gateway listen address")
	upstreamValue := flag.String("upstream", "http://127.0.0.1:8790", "Loopback Shopify connector URL")
	flag.Parse()

	upstream, err := url.Parse(strings.TrimSpace(*upstreamValue))
	if err != nil || !validLoopbackUpstream(upstream) {
		log.Fatal("OAuth gateway upstream must be an http loopback URL")
	}

	server := &http.Server{
		Addr:              *addr,
		Handler:           newOAuthGateway(upstream),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Printf("Shopify OAuth-only gateway listening on http://%s", *addr)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Shopify OAuth-only gateway failed: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		log.Fatalf("Shopify OAuth-only gateway shutdown failed: %v", err)
	}
}

func validLoopbackUpstream(upstream *url.URL) bool {
	if upstream == nil || upstream.Scheme != "http" || upstream.User != nil || upstream.RawQuery != "" || upstream.Fragment != "" {
		return false
	}
	if upstream.Path != "" && upstream.Path != "/" {
		return false
	}
	hostname := strings.TrimSpace(strings.ToLower(upstream.Hostname()))
	if hostname == "localhost" {
		return upstream.Port() != ""
	}
	ip := net.ParseIP(hostname)
	return ip != nil && ip.IsLoopback() && upstream.Port() != ""
}

func newOAuthGateway(upstream *url.URL) http.Handler {
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	proxy.ErrorHandler = func(w http.ResponseWriter, _ *http.Request, _ error) {
		http.Error(w, "OAuth service temporarily unavailable", http.StatusBadGateway)
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Content-Type-Options", "nosniff")

		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path != oauthAuthorizePath && r.URL.Path != oauthCallbackPath {
			http.NotFound(w, r)
			return
		}
		proxy.ServeHTTP(w, r)
	})
}
