package main

import (
	"context"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestManageBackgroundRoleFollowsActiveColorFile(t *testing.T) {
	activeFile := filepath.Join(t.TempDir(), "active-color")
	if err := os.WriteFile(activeFile, []byte("green\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan context.Context, 2)
	go manageBackgroundRole(ctx, backgroundRoleConfig{
		Color:         "blue",
		ActiveFile:    activeFile,
		CheckInterval: 10 * time.Millisecond,
	}, func(child context.Context) {
		started <- child
	})

	select {
	case <-started:
		t.Fatal("standby color started background work")
	case <-time.After(30 * time.Millisecond):
	}

	if err := os.WriteFile(activeFile, []byte("blue\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	var first context.Context
	select {
	case first = <-started:
	case <-time.After(time.Second):
		t.Fatal("active color did not start background work")
	}

	if err := os.WriteFile(activeFile, []byte("green\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-first.Done():
	case <-time.After(time.Second):
		t.Fatal("background work was not stopped after losing active role")
	}

	if err := os.WriteFile(activeFile, []byte("blue\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("background work did not restart after regaining active role")
	}
}

func TestManageBackgroundRoleStartsImmediatelyWithoutDeployState(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var starts atomic.Int32
	started := make(chan struct{}, 1)
	go manageBackgroundRole(ctx, backgroundRoleConfig{}, func(context.Context) {
		starts.Add(1)
		started <- struct{}{}
	})
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("standalone background work did not start")
	}
	if got := starts.Load(); got != 1 {
		t.Fatalf("background starts = %d, want 1", got)
	}
}
