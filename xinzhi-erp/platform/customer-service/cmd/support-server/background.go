package main

import (
	"context"
	"errors"
	"log"
	"os"
	"strings"
	"time"
)

const defaultBackgroundRoleCheckInterval = 2 * time.Second

type backgroundRoleConfig struct {
	Color         string
	ActiveFile    string
	CheckInterval time.Duration
}

func backgroundRoleConfigFromEnv() backgroundRoleConfig {
	return backgroundRoleConfig{
		Color:         strings.TrimSpace(os.Getenv("XZDESK_DEPLOY_COLOR")),
		ActiveFile:    strings.TrimSpace(os.Getenv("XZDESK_ACTIVE_COLOR_FILE")),
		CheckInterval: defaultBackgroundRoleCheckInterval,
	}
}

func manageBackgroundRole(ctx context.Context, cfg backgroundRoleConfig, start func(context.Context)) {
	if start == nil {
		return
	}
	if cfg.Color == "" || cfg.ActiveFile == "" {
		child, cancel := context.WithCancel(ctx)
		defer cancel()
		start(child)
		<-ctx.Done()
		return
	}
	if cfg.CheckInterval <= 0 {
		cfg.CheckInterval = defaultBackgroundRoleCheckInterval
	}

	var activeCancel context.CancelFunc
	var lastState string
	reconcile := func() {
		active, err := backgroundRoleActive(cfg)
		state := "standby"
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			state = "error"
		}
		if active {
			state = "active"
		}
		if state != lastState {
			switch state {
			case "active":
				log.Printf("background role active for deploy color %s", cfg.Color)
			case "error":
				log.Printf("background role state read failed for deploy color %s: %v", cfg.Color, err)
			default:
				log.Printf("background role standby for deploy color %s", cfg.Color)
			}
			lastState = state
		}
		if active && activeCancel == nil {
			var child context.Context
			child, activeCancel = context.WithCancel(ctx)
			start(child)
			return
		}
		if !active && activeCancel != nil {
			activeCancel()
			activeCancel = nil
		}
	}

	reconcile()
	ticker := time.NewTicker(cfg.CheckInterval)
	defer ticker.Stop()
	defer func() {
		if activeCancel != nil {
			activeCancel()
		}
	}()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			reconcile()
		}
	}
}

func backgroundRoleActive(cfg backgroundRoleConfig) (bool, error) {
	raw, err := os.ReadFile(cfg.ActiveFile)
	if err != nil {
		return false, err
	}
	activeColor := strings.TrimSpace(string(raw))
	return activeColor != "" && strings.EqualFold(activeColor, cfg.Color), nil
}
