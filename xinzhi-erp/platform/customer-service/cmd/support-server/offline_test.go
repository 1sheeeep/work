package main

import (
	"context"
	"testing"
	"time"
)

func TestStrictOfflineRuntimeDoesNotRegisterBackgroundProviders(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := make(chan struct{}, 1)
	startBackgroundRuntime(ctx, true, func(context.Context) { started <- struct{}{} })
	select {
	case <-started:
		t.Fatal("strict offline runtime registered provider background work")
	case <-time.After(25 * time.Millisecond):
	}
}
