package platform

import (
	"context"
	"log"
	"os"
	"strings"
	"time"
)

const chatAttachmentRetention = 90 * 24 * time.Hour

func (s *Server) StartMaintenance(ctx context.Context) {
	go func() {
		s.runMaintenance(ctx)
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runMaintenance(ctx)
			}
		}
	}()
}

func (s *Server) runMaintenance(ctx context.Context) {
	now := time.Now().UTC()
	if store, ok := s.store.(externalCacheStore); ok {
		if _, err := store.DeleteExpiredExternalCache(ctx, now); err != nil {
			log.Printf("maintenance: external cache cleanup failed: %v", err)
		}
	}
	if err := cleanupChatAttachments(s.uploadDir, now.Add(-chatAttachmentRetention)); err != nil {
		log.Printf("maintenance: attachment cleanup failed: %v", err)
	}
}

func cleanupChatAttachments(directory string, before time.Time) error {
	entries, err := os.ReadDir(directory)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "att_") {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(before) {
			_ = os.Remove(directory + string(os.PathSeparator) + entry.Name())
		}
	}
	return nil
}
