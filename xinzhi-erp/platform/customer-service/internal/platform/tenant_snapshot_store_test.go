package platform

import (
	"context"
	"errors"
	"sync"
	"testing"
)

type revisionSnapshotBackend struct {
	mu       sync.Mutex
	raw      []byte
	revision int64
	failNext error
}

func (b *revisionSnapshotBackend) Load(context.Context) ([]byte, int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]byte(nil), b.raw...), b.revision, nil
}

func (b *revisionSnapshotBackend) Save(
	_ context.Context,
	raw []byte,
	expectedRevision int64,
) (int64, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.failNext != nil {
		err := b.failNext
		b.failNext = nil
		return expectedRevision, err
	}
	if expectedRevision != b.revision {
		return expectedRevision, ErrConflict
	}
	b.revision++
	b.raw = append([]byte(nil), raw...)
	return b.revision, nil
}

func (b *revisionSnapshotBackend) Health(context.Context) HealthStatus {
	return HealthStatus{Name: "revision-test", OK: true}
}

func TestTenantSnapshotStoreDoesNotPublishFailedSave(t *testing.T) {
	backend := &revisionSnapshotBackend{}
	store, err := openTenantSnapshotStore(backend)
	if err != nil {
		t.Fatalf("open tenant snapshot store: %v", err)
	}
	if err := store.BindERPTenant(t.Context(), "tenant-atomic"); err != nil {
		t.Fatalf("bind tenant: %v", err)
	}

	backend.mu.Lock()
	backend.failNext = errors.New("injected snapshot save failure")
	backend.mu.Unlock()
	created, err := store.CreateShop(t.Context(), Shop{
		ID: "failed-shop", DisplayName: "Must Not Publish",
	})
	if err == nil || created.ID != "failed-shop" {
		t.Fatalf("expected injected persistence failure, shop=%#v err=%v", created, err)
	}
	if _, err := store.GetShop(t.Context(), "failed-shop"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed write became visible in memory: %v", err)
	}

	reopened, err := openTenantSnapshotStore(backend)
	if err != nil {
		t.Fatalf("reopen tenant snapshot store: %v", err)
	}
	if _, err := reopened.GetShop(t.Context(), "failed-shop"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("failed write reached durable snapshot: %v", err)
	}
}

func TestTenantSnapshotStoreCASRejectsConcurrentStaleOverwrite(t *testing.T) {
	backend := &revisionSnapshotBackend{}
	initial, err := openTenantSnapshotStore(backend)
	if err != nil {
		t.Fatalf("open initial tenant snapshot store: %v", err)
	}
	if err := initial.BindERPTenant(t.Context(), "tenant-cas"); err != nil {
		t.Fatalf("bind tenant: %v", err)
	}
	first, err := openTenantSnapshotStore(backend)
	if err != nil {
		t.Fatalf("open first writer: %v", err)
	}
	second, err := openTenantSnapshotStore(backend)
	if err != nil {
		t.Fatalf("open second writer: %v", err)
	}

	type writeResult struct {
		shopID string
		err    error
	}
	start := make(chan struct{})
	results := make(chan writeResult, 2)
	for _, writer := range []struct {
		store  *FileStore
		shopID string
	}{
		{store: first, shopID: "shop-first"},
		{store: second, shopID: "shop-second"},
	} {
		writer := writer
		go func() {
			<-start
			_, writeErr := writer.store.CreateShop(t.Context(), Shop{
				ID: writer.shopID, DisplayName: writer.shopID,
			})
			results <- writeResult{shopID: writer.shopID, err: writeErr}
		}()
	}
	close(start)

	var winner, loser writeResult
	for range 2 {
		result := <-results
		if result.err == nil {
			winner = result
		} else {
			loser = result
		}
	}
	if winner.shopID == "" || loser.shopID == "" || !errors.Is(loser.err, ErrConflict) {
		t.Fatalf("expected one success and one explicit CAS conflict: winner=%#v loser=%#v", winner, loser)
	}
	loserStore := first
	if loser.shopID == "shop-second" {
		loserStore = second
	}
	if _, err := loserStore.GetShop(t.Context(), loser.shopID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("conflicting stale write was published in memory: %v", err)
	}

	reopened, err := openTenantSnapshotStore(backend)
	if err != nil {
		t.Fatalf("reopen committed tenant snapshot: %v", err)
	}
	shops, err := reopened.ListShops(t.Context())
	if err != nil || len(shops) != 1 || shops[0].ID != winner.shopID {
		t.Fatalf("durable CAS winner mismatch: shops=%#v err=%v", shops, err)
	}
}
