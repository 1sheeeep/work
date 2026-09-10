package platform

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sort"
	"strings"
	"time"
)

const emailRuntimeEventRetention = 30 * 24 * time.Hour

type emailRuntimeEventStore interface {
	SaveEmailRuntimeEvent(context.Context, EmailRuntimeEvent) (EmailRuntimeEvent, error)
	ListEmailRuntimeEvents(context.Context, int) ([]EmailRuntimeEvent, error)
	DeleteEmailRuntimeEventsBefore(context.Context, time.Time) (int, error)
}

func (s *Server) recordEmailRuntimeEvent(ctx context.Context, event EmailRuntimeEvent) {
	store, ok := s.store.(emailRuntimeEventStore)
	if !ok {
		return
	}
	writeCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
	defer cancel()
	if event.Severity == "" {
		event.Severity = "warning"
	}
	event.Message = truncateEmailPreview(strings.Join(strings.Fields(event.Message), " "), 500)
	if _, err := store.SaveEmailRuntimeEvent(writeCtx, event); err != nil && ctx.Err() == nil {
		log.Printf("email operations: save %s event failed: %v", event.Category, err)
	}
}

func (s *Server) handleEmailRuntimeEvents(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionShopChannelsManage); !ok {
		return
	}
	store, ok := s.store.(emailRuntimeEventStore)
	if !ok {
		writeError(w, errors.New("email operations storage is unavailable"))
		return
	}
	limit := positiveQueryInt(r.URL.Query().Get("limit"), 100)
	if limit > 500 {
		limit = 500
	}
	events, err := store.ListEmailRuntimeEvents(r.Context(), limit)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(events))
}

func (s *Server) StartEmailRuntimeEventMaintenance(ctx context.Context) {
	store, ok := s.store.(emailRuntimeEventStore)
	if !ok {
		return
	}
	go func() {
		ticker := time.NewTicker(24 * time.Hour)
		defer ticker.Stop()
		cleanup := func() {
			if _, err := store.DeleteEmailRuntimeEventsBefore(ctx, time.Now().UTC().Add(-emailRuntimeEventRetention)); err != nil && ctx.Err() == nil {
				log.Printf("email operations: cleanup failed: %v", err)
			}
		}
		cleanup()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				cleanup()
			}
		}
	}()
}

func (s *PostgresStore) SaveEmailRuntimeEvent(ctx context.Context, input EmailRuntimeEvent) (EmailRuntimeEvent, error) {
	if input.ID == "" {
		input.ID = prefixedID("email_event")
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_runtime_events (id, category, severity, shop_id, source_id, entity_id, message, created_at)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING id, category, severity, shop_id, source_id, entity_id, message, created_at
	`, input.ID, strings.TrimSpace(input.Category), strings.TrimSpace(input.Severity), strings.TrimSpace(input.ShopID),
		strings.TrimSpace(input.SourceID), strings.TrimSpace(input.EntityID), input.Message, input.CreatedAt.UTC())
	if err := row.Scan(&input.ID, &input.Category, &input.Severity, &input.ShopID, &input.SourceID, &input.EntityID, &input.Message, &input.CreatedAt); err != nil {
		return EmailRuntimeEvent{}, err
	}
	return input, nil
}

func (s *PostgresStore) ListEmailRuntimeEvents(ctx context.Context, limit int) ([]EmailRuntimeEvent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, category, severity, shop_id, source_id, entity_id, message, created_at
		FROM email_runtime_events ORDER BY created_at DESC LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []EmailRuntimeEvent{}
	for rows.Next() {
		var event EmailRuntimeEvent
		if err := rows.Scan(&event.ID, &event.Category, &event.Severity, &event.ShopID, &event.SourceID, &event.EntityID, &event.Message, &event.CreatedAt); err != nil {
			return nil, err
		}
		events = append(events, event)
	}
	return events, rows.Err()
}

func (s *PostgresStore) DeleteEmailRuntimeEventsBefore(ctx context.Context, before time.Time) (int, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM email_runtime_events WHERE created_at < $1`, before.UTC())
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

func (s *MemoryStore) SaveEmailRuntimeEvent(ctx context.Context, input EmailRuntimeEvent) (EmailRuntimeEvent, error) {
	if err := ctx.Err(); err != nil {
		return EmailRuntimeEvent{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if input.ID == "" {
		input.ID = s.newIDLocked("email_event")
	}
	if input.CreatedAt.IsZero() {
		input.CreatedAt = time.Now().UTC()
	}
	s.emailRuntimeEvents = append(s.emailRuntimeEvents, input)
	return input, nil
}

func (s *MemoryStore) ListEmailRuntimeEvents(ctx context.Context, limit int) ([]EmailRuntimeEvent, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	events := append([]EmailRuntimeEvent(nil), s.emailRuntimeEvents...)
	sort.Slice(events, func(i, j int) bool { return events[i].CreatedAt.After(events[j].CreatedAt) })
	if limit < len(events) {
		events = events[:limit]
	}
	return events, nil
}

func (s *MemoryStore) DeleteEmailRuntimeEventsBefore(ctx context.Context, before time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	kept := s.emailRuntimeEvents[:0]
	deleted := 0
	for _, event := range s.emailRuntimeEvents {
		if event.CreatedAt.Before(before) {
			deleted++
			continue
		}
		kept = append(kept, event)
	}
	s.emailRuntimeEvents = kept
	return deleted, nil
}
