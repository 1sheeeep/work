// Fixed synthetic fixture only. Never load user configuration or credentials.
package main

import (
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"shopify-support-platform/internal/preparation/identity"
)

func main() {
	if len(os.Args) != 1 && !(len(os.Args) == 2 && os.Args[1] == "--owned-postgres") {
		fmt.Fprintln(os.Stderr, "synthetic rehearsal takes no arguments")
		os.Exit(2)
	}
	var h http.Handler
	var err error
	if len(os.Args) == 2 {
		var input struct {
			Port int `json:"port"`
		}
		d := json.NewDecoder(os.Stdin)
		d.DisallowUnknownFields()
		if d.Decode(&input) != nil {
			fmt.Fprintln(os.Stderr, "invalid owned rehearsal input")
			os.Exit(2)
		}
		h, err = identity.NewPostgresSyntheticHandler(input.Port)
	} else {
		h, err = identity.NewSyntheticHandler()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "synthetic setup failed")
		os.Exit(1)
	}
	l, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		fmt.Fprintln(os.Stderr, "synthetic listener failed")
		os.Exit(1)
	}
	s := &http.Server{Handler: h, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 8 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 15 * time.Second}
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{"synthetic": true, "url": "http://" + l.Addr().String()})
	if err := s.Serve(l); err != nil && err != http.ErrServerClosed {
		fmt.Fprintln(os.Stderr, "synthetic rehearsal stopped")
		os.Exit(1)
	}
}
