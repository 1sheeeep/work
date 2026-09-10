// Synthetic-only, loopback-only fixture for Java/Go/browser rehearsals. There is
// no production configuration, environment credential reader, or Shopify socket.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"time"

	"shopify-support-platform/internal/preparation/storeappread"
)

func main() {
	if len(os.Args) != 1 {
		fmt.Fprintln(os.Stderr, "rehearsal takes no arguments")
		os.Exit(2)
	}
	handler, err := storeappread.NewSyntheticHandler()
	if err != nil {
		fmt.Fprintln(os.Stderr, "synthetic rehearsal setup failed")
		os.Exit(1)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, "synthetic rehearsal listener failed")
		os.Exit(1)
	}
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 12 * time.Second, IdleTimeout: 15 * time.Second}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"synthetic": true, "url": "http://" + listener.Addr().String()})
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "synthetic rehearsal stopped")
		os.Exit(1)
	}
}
