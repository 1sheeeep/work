package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cn.xzkj.ai/ks01-agent/internal/agent"
)

func main() {
	configPath := flag.String("config", "config.json", "path to agent config JSON")
	flag.Parse()

	config, err := loadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	store, err := agent.OpenStore(config.DataDir)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()
	logger := log.New(os.Stdout, "ks01-agent ", log.LstdFlags|log.Lmicroseconds)
	server := agent.NewServer(config, store, logger)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	httpServer := &http.Server{Addr: config.HTTPListen, Handler: server.HTTPHandler()}
	go func() {
		logger.Printf("HTTP receiver listening on %s", config.HTTPListen)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Printf("HTTP receiver stopped: %v", err)
			stop()
		}
	}()

	go func() {
		if err := server.ServeUDP(ctx); err != nil {
			logger.Printf("UDP receiver stopped: %v", err)
			stop()
		}
	}()

	if err := server.ServeTCP(ctx); err != nil {
		logger.Printf("TCP receiver stopped: %v", err)
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(shutdownCtx)
}

func loadConfig(path string) (agent.Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return agent.Config{}, fmt.Errorf("read config %s: %w", path, err)
	}
	var config agent.Config
	if err := json.Unmarshal(data, &config); err != nil {
		return agent.Config{}, fmt.Errorf("parse config %s: %w", path, err)
	}
	config.ApplyDefaults()
	return config, nil
}
