package main

import (
	"context"
	"errors"
	"testing"
	"time"

	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

type cleanupRecordingRepository struct {
	shopifyinstallations.Repository
	calls chan time.Time
}

func (r *cleanupRecordingRepository) PrunePendingInstallations(_ context.Context, now time.Time) (int, error) {
	r.calls <- now
	return 0, errors.New("synthetic cleanup failure")
}

func TestPendingCleanupRetriesAfterFailureAndStopsWithRuntime(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	ticks := make(chan time.Time)
	repository := &cleanupRecordingRepository{calls: make(chan time.Time, 2)}
	done := make(chan struct{})
	go func() { defer close(done); runPendingInstallationCleanup(ctx, repository, ticks) }()
	for i := 0; i < 2; i++ {
		now := time.Date(2026, 9, 4, 12, i, 0, 0, time.FixedZone("fixture", 8*60*60))
		select {
		case ticks <- now:
		case <-time.After(time.Second):
			t.Fatal("cleanup stopped retrying")
		}
		select {
		case got := <-repository.calls:
			if !got.Equal(now) || got.Location() != time.UTC {
				t.Fatal("cleanup did not use UTC tick time")
			}
		case <-time.After(time.Second):
			t.Fatal("cleanup did not execute")
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cleanup survived runtime shutdown")
	}
}

func TestPendingCleanupStopsWhenTickerChannelCloses(t *testing.T) {
	ticks := make(chan time.Time)
	close(ticks)
	runPendingInstallationCleanup(t.Context(), &cleanupRecordingRepository{}, ticks)
}
