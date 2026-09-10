package platform

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

type emailQuarantineStore interface {
	SaveEmailQuarantine(context.Context, EmailQuarantineRecord) (EmailQuarantineRecord, error)
	ListEmailQuarantine(context.Context, string, string, int) ([]EmailQuarantineRecord, error)
	CountEmailQuarantine(context.Context, string, string) (int, error)
	ResolveEmailQuarantine(context.Context, string) error
}

func normalizeEmailQuarantine(input EmailQuarantineRecord) (EmailQuarantineRecord, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.SourceMessageID = strings.TrimSpace(input.SourceMessageID)
	input.Stage = strings.ToLower(strings.TrimSpace(input.Stage))
	input.ErrorMessage = strings.TrimSpace(input.ErrorMessage)
	if input.ShopID == "" || input.SourceID == "" || input.Provider == "" || input.SourceMessageID == "" || input.Stage == "" || input.ErrorMessage == "" {
		return EmailQuarantineRecord{}, fmt.Errorf("%w: complete email quarantine identity is required", ErrInvalid)
	}
	if strings.TrimSpace(input.Payload) == "" {
		input.Payload = "{}"
	}
	return input, nil
}

func (s *PostgresStore) SaveEmailQuarantine(ctx context.Context, input EmailQuarantineRecord) (EmailQuarantineRecord, error) {
	input, err := normalizeEmailQuarantine(input)
	if err != nil {
		return EmailQuarantineRecord{}, err
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("email_quarantine")
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_ingress_quarantine (
		  id, shop_id, source_id, provider, source_message_id, stage, error_message,
		  payload, status, attempts, first_failed_at, last_failed_at, resolved_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'quarantined',1,$9,$9,NULL,$9,$9)
		ON CONFLICT (source_id, source_message_id, stage) DO UPDATE SET
		  provider=EXCLUDED.provider, error_message=EXCLUDED.error_message, payload=EXCLUDED.payload,
		  status='quarantined', attempts=email_ingress_quarantine.attempts+1,
		  last_failed_at=EXCLUDED.last_failed_at, resolved_at=NULL, updated_at=EXCLUDED.updated_at
		RETURNING id, shop_id, source_id, provider, source_message_id, stage, error_message,
		  payload::text, status, attempts, first_failed_at, last_failed_at, resolved_at, created_at, updated_at
	`, input.ID, input.ShopID, input.SourceID, input.Provider, input.SourceMessageID, input.Stage, input.ErrorMessage, input.Payload, now)
	record, err := scanEmailQuarantine(row)
	if isForeignKeyError(err) {
		return EmailQuarantineRecord{}, ErrNotFound
	}
	return record, err
}

func (s *PostgresStore) ListEmailQuarantine(ctx context.Context, sourceID string, status string, limit int) ([]EmailQuarantineRecord, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, shop_id, source_id, provider, source_message_id, stage, error_message,
		  payload::text, status, attempts, first_failed_at, last_failed_at, resolved_at, created_at, updated_at
		FROM email_ingress_quarantine
		WHERE source_id=$1 AND ($2='' OR status=$2)
		ORDER BY last_failed_at DESC, id ASC
		LIMIT $3
	`, strings.TrimSpace(sourceID), strings.TrimSpace(status), limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []EmailQuarantineRecord{}
	for rows.Next() {
		record, scanErr := scanEmailQuarantine(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, record)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ResolveEmailQuarantine(ctx context.Context, id string) error {
	result, err := s.db.ExecContext(ctx, `
		UPDATE email_ingress_quarantine
		SET status='resolved', resolved_at=$2, updated_at=$2
		WHERE id=$1
	`, strings.TrimSpace(id), time.Now().UTC())
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) CountEmailQuarantine(ctx context.Context, sourceID string, status string) (int, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM email_ingress_quarantine
		WHERE source_id=$1 AND ($2='' OR status=$2)
	`, strings.TrimSpace(sourceID), strings.TrimSpace(status)).Scan(&count)
	return count, err
}

type emailQuarantineScanner interface{ Scan(...any) error }

func scanEmailQuarantine(row emailQuarantineScanner) (EmailQuarantineRecord, error) {
	var record EmailQuarantineRecord
	var resolvedAt sql.NullTime
	err := row.Scan(&record.ID, &record.ShopID, &record.SourceID, &record.Provider, &record.SourceMessageID,
		&record.Stage, &record.ErrorMessage, &record.Payload, &record.Status, &record.Attempts,
		&record.FirstFailedAt, &record.LastFailedAt, &resolvedAt, &record.CreatedAt, &record.UpdatedAt)
	if resolvedAt.Valid {
		record.ResolvedAt = resolvedAt.Time
	}
	return record, err
}

func emailQuarantineKey(sourceID string, sourceMessageID string, stage string) string {
	return strings.TrimSpace(sourceID) + "\x00" + strings.TrimSpace(sourceMessageID) + "\x00" + strings.ToLower(strings.TrimSpace(stage))
}

func (s *MemoryStore) SaveEmailQuarantine(ctx context.Context, input EmailQuarantineRecord) (EmailQuarantineRecord, error) {
	if err := ctx.Err(); err != nil {
		return EmailQuarantineRecord{}, err
	}
	input, err := normalizeEmailQuarantine(input)
	if err != nil {
		return EmailQuarantineRecord{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[input.SourceID]
	if !ok || source.ShopID != input.ShopID {
		return EmailQuarantineRecord{}, ErrNotFound
	}
	key := emailQuarantineKey(input.SourceID, input.SourceMessageID, input.Stage)
	now := time.Now().UTC()
	if existing, ok := s.emailQuarantine[key]; ok {
		input.ID = existing.ID
		input.Attempts = existing.Attempts + 1
		input.FirstFailedAt = existing.FirstFailedAt
		input.CreatedAt = existing.CreatedAt
	} else {
		input.ID = s.newIDLocked("email_quarantine")
		input.Attempts = 1
		input.FirstFailedAt = now
		input.CreatedAt = now
	}
	input.Status = "quarantined"
	input.LastFailedAt = now
	input.ResolvedAt = time.Time{}
	input.UpdatedAt = now
	s.emailQuarantine[key] = input
	return input, nil
}

func (s *MemoryStore) ListEmailQuarantine(ctx context.Context, sourceID string, status string, limit int) ([]EmailQuarantineRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []EmailQuarantineRecord{}
	for _, record := range s.emailQuarantine {
		if record.SourceID == strings.TrimSpace(sourceID) && (strings.TrimSpace(status) == "" || record.Status == strings.TrimSpace(status)) {
			out = append(out, record)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastFailedAt.After(out[j].LastFailedAt) })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *MemoryStore) ResolveEmailQuarantine(ctx context.Context, id string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, record := range s.emailQuarantine {
		if record.ID == strings.TrimSpace(id) {
			record.Status = "resolved"
			record.ResolvedAt = time.Now().UTC()
			record.UpdatedAt = record.ResolvedAt
			s.emailQuarantine[key] = record
			return nil
		}
	}
	return ErrNotFound
}

func (s *MemoryStore) CountEmailQuarantine(ctx context.Context, sourceID string, status string) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	count := 0
	for _, record := range s.emailQuarantine {
		if record.SourceID == strings.TrimSpace(sourceID) && (strings.TrimSpace(status) == "" || record.Status == strings.TrimSpace(status)) {
			count++
		}
	}
	return count, nil
}
