// Owned-loopback-only, synthetic Shopify transport; no environment credentials.
package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"shopify-support-platform/internal/preparation/inventory"
	"time"
)

func main() {
	if len(os.Args) != 2 || os.Args[1] != "--owned-claim-port" {
		fmt.Fprintln(os.Stderr, "owned inventory rehearsal input required")
		os.Exit(2)
	}
	var input struct {
		Port int `json:"port"`
	}
	decoder := json.NewDecoder(io.LimitReader(os.Stdin, 1024))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		os.Exit(2)
	}
	handler, err := inventory.NewSyntheticHandler(input.Port)
	if err != nil {
		os.Exit(2)
	}
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		os.Exit(1)
	}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"synthetic": true, "url": "http://" + listener.Addr().String()})
	server := &http.Server{Handler: handler, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 12 * time.Second}
	go func() { <-time.After(10 * time.Minute); _ = server.Close() }()
	if err = server.Serve(listener); err != nil && err != http.ErrServerClosed {
		os.Exit(1)
	}
}
