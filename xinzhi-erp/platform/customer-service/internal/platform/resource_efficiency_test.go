package platform

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAIConcurrencyReservesInteractiveCapacity(t *testing.T) {
	server := NewServer(NewMemoryStore())
	if got := cap(server.aiLimit); got != aiTotalConcurrency {
		t.Fatalf("AI concurrency capacity = %d, want %d", got, aiTotalConcurrency)
	}
	if aiBackgroundWorkerCount >= aiTotalConcurrency {
		t.Fatalf("background workers must leave interactive capacity: workers=%d total=%d", aiBackgroundWorkerCount, aiTotalConcurrency)
	}
	if reserved := aiTotalConcurrency - aiBackgroundWorkerCount; reserved < 16 {
		t.Fatalf("interactive AI reserve = %d, want at least 16", reserved)
	}
}

func TestEmailSourcePollDueUsesIndependentDailyReconciliation(t *testing.T) {
	now := time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC)
	recent := ShopSource{Metadata: map[string]string{
		emailLastReconcileAtKey: now.Add(-23*time.Hour - 59*time.Minute).Format(time.RFC3339),
		"email_last_sync_at":    now.Add(-48 * time.Hour).Format(time.RFC3339),
	}}
	if emailSourcePollDue(recent, now, 24*time.Hour) {
		t.Fatal("source should wait for the daily reconciliation")
	}
	recent.Metadata[emailLastReconcileAtKey] = now.Add(-24 * time.Hour).Format(time.RFC3339)
	recent.Metadata["email_last_sync_at"] = now.Add(-time.Minute).Format(time.RFC3339)
	if !emailSourcePollDue(recent, now, 24*time.Hour) {
		t.Fatal("source should be due after 24 hours regardless of recent push activity")
	}
	unscheduled := ShopSource{ID: "source-without-checkpoint", Metadata: map[string]string{}}
	slot := emailSourceInitialReconcileHour(unscheduled)
	slotTime := time.Date(now.Year(), now.Month(), now.Day(), slot, 0, 0, 0, time.UTC)
	if !emailSourcePollDue(unscheduled, slotTime, 24*time.Hour) {
		t.Fatal("source without a prior reconciliation should be due in its assigned hourly slot")
	}
	if emailSourcePollDue(unscheduled, slotTime.Add(time.Hour), 24*time.Hour) {
		t.Fatal("source without a prior reconciliation should wait outside its assigned hourly slot")
	}
	unscheduled.Provider = cuiqiuProvider
	if emailSourcePollDue(unscheduled, slotTime.Add(time.Hour), 24*time.Hour) {
		t.Fatal("Cuiqiu source without a checkpoint should wait for its assigned daily slot")
	}
}

func TestCleanupChatAttachmentsHonorsRetentionAndPrefix(t *testing.T) {
	directory := t.TempDir()
	oldAttachment := filepath.Join(directory, "att_old.png")
	recentAttachment := filepath.Join(directory, "att_recent.png")
	unrelated := filepath.Join(directory, "keep.txt")
	for _, path := range []string{oldAttachment, recentAttachment, unrelated} {
		if err := os.WriteFile(path, []byte("test"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	old := time.Now().Add(-91 * 24 * time.Hour)
	if err := os.Chtimes(oldAttachment, old, old); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(unrelated, old, old); err != nil {
		t.Fatal(err)
	}
	if err := cleanupChatAttachments(directory, time.Now().Add(-90*24*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(oldAttachment); !os.IsNotExist(err) {
		t.Fatalf("old attachment was not removed: %v", err)
	}
	for _, path := range []string{recentAttachment, unrelated} {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected file to remain: %s: %v", path, err)
		}
	}
}
