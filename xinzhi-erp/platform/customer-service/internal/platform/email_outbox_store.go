package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

type emailOutboxStore interface {
	BeginEmailOutbox(context.Context, EmailOutboxRecord) (EmailOutboxRecord, error)
	ClaimPendingEmailOutbox(context.Context) (EmailOutboxRecord, error)
	SetEmailOutboxState(context.Context, string, string, string, string, string) (EmailOutboxRecord, error)
	RecoverEmailOutbox(context.Context, time.Time) ([]EmailOutboxRecord, error)
	ListAmbiguousEmailOutbox(context.Context, int) ([]EmailOutboxRecord, error)
}

func normalizeEmailOutbox(input EmailOutboxRecord) (EmailOutboxRecord, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.ConversationID = strings.TrimSpace(input.ConversationID)
	input.ClientRequestID = strings.TrimSpace(input.ClientRequestID)
	input.RequestedBy = strings.TrimSpace(input.RequestedBy)
	if input.ShopID == "" || input.SourceID == "" || input.ConversationID == "" || input.ClientRequestID == "" || input.RequestedBy == "" {
		return EmailOutboxRecord{}, fmt.Errorf("%w: complete email outbox identity is required", ErrInvalid)
	}
	if strings.TrimSpace(input.RequestMetadata) == "" {
		input.RequestMetadata = "{}"
	}
	return input, nil
}

func (s *PostgresStore) BeginEmailOutbox(ctx context.Context, input EmailOutboxRecord) (EmailOutboxRecord, error) {
	input, err := normalizeEmailOutbox(input)
	if err != nil {
		return EmailOutboxRecord{}, err
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("email_outbox")
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_outbox (
		  id, shop_id, source_id, conversation_id, client_request_id, requested_by,
		  body, request_metadata, provider_metadata, status, attempts, last_error,
		  message_id, created_at, updated_at, completed_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'{}'::jsonb,'pending',1,'','',$9,$9,NULL)
		ON CONFLICT (conversation_id, client_request_id) DO UPDATE SET
		  status=CASE WHEN email_outbox.status='failed' THEN 'pending' ELSE email_outbox.status END,
		  attempts=CASE WHEN email_outbox.status='failed' THEN email_outbox.attempts+1 ELSE email_outbox.attempts END,
		  body=CASE WHEN email_outbox.status='failed' THEN EXCLUDED.body ELSE email_outbox.body END,
		  request_metadata=CASE WHEN email_outbox.status='failed' THEN EXCLUDED.request_metadata ELSE email_outbox.request_metadata END,
		  provider_metadata=CASE WHEN email_outbox.status='failed' THEN '{}'::jsonb ELSE email_outbox.provider_metadata END,
		  last_error=CASE WHEN email_outbox.status='failed' THEN '' ELSE email_outbox.last_error END,
		  updated_at=CASE WHEN email_outbox.status='failed' THEN EXCLUDED.updated_at ELSE email_outbox.updated_at END
		RETURNING id, shop_id, source_id, conversation_id, client_request_id, requested_by,
		  body, request_metadata::text, provider_metadata::text, status, attempts,
		  last_error, message_id, created_at, updated_at, completed_at
	`, input.ID, input.ShopID, input.SourceID, input.ConversationID, input.ClientRequestID,
		input.RequestedBy, input.Body, input.RequestMetadata, now)
	record, err := scanEmailOutbox(row)
	if isForeignKeyError(err) {
		return EmailOutboxRecord{}, ErrNotFound
	}
	return record, err
}

func (s *PostgresStore) SetEmailOutboxState(ctx context.Context, id string, status string, providerMetadata string, lastError string, messageID string) (EmailOutboxRecord, error) {
	status = strings.ToLower(strings.TrimSpace(status))
	if strings.TrimSpace(providerMetadata) == "" {
		providerMetadata = "{}"
	}
	now := time.Now().UTC()
	row := s.db.QueryRowContext(ctx, `
		UPDATE email_outbox
		SET status=$2, provider_metadata=$3::jsonb, last_error=$4, message_id=$5,
		    completed_at=CASE WHEN $2='completed' THEN $6 ELSE completed_at END,
		    updated_at=$6
		WHERE id=$1
		RETURNING id, shop_id, source_id, conversation_id, client_request_id, requested_by,
		  body, request_metadata::text, provider_metadata::text, status, attempts,
		  last_error, message_id, created_at, updated_at, completed_at
	`, strings.TrimSpace(id), status, providerMetadata, truncateEmailPreview(lastError, 500), strings.TrimSpace(messageID), now)
	record, err := scanEmailOutbox(row)
	if err == sql.ErrNoRows {
		return EmailOutboxRecord{}, ErrNotFound
	}
	return record, err
}

func (s *PostgresStore) ClaimPendingEmailOutbox(ctx context.Context) (EmailOutboxRecord, error) {
	row := s.db.QueryRowContext(ctx, `
		WITH candidate AS (
			SELECT current.id
			FROM email_outbox current
			WHERE current.status = 'pending' AND current.message_id <> ''
			  AND NOT EXISTS (
				SELECT 1
				FROM email_outbox earlier
				WHERE earlier.source_id = current.source_id
				  AND earlier.status IN ('pending', 'sending')
				  AND (earlier.created_at, earlier.id) < (current.created_at, current.id)
			  )
			ORDER BY current.created_at, current.id
			LIMIT 1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE email_outbox outbox
		SET status='sending', last_error='', updated_at=$1
		FROM candidate
		WHERE outbox.id = candidate.id
		RETURNING outbox.id, outbox.shop_id, outbox.source_id, outbox.conversation_id,
		  outbox.client_request_id, outbox.requested_by, outbox.body,
		  outbox.request_metadata::text, outbox.provider_metadata::text, outbox.status,
		  outbox.attempts, outbox.last_error, outbox.message_id, outbox.created_at,
		  outbox.updated_at, outbox.completed_at
	`, time.Now().UTC())
	record, err := scanEmailOutbox(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailOutboxRecord{}, ErrNotFound
	}
	return record, err
}

func (s *PostgresStore) RecoverEmailOutbox(ctx context.Context, staleBefore time.Time) ([]EmailOutboxRecord, error) {
	rows, err := s.db.QueryContext(ctx, `
		UPDATE email_outbox
		SET status='ambiguous', last_error='send interrupted before a durable provider result was saved', updated_at=$2
		WHERE status='sending' AND updated_at < $1
		RETURNING id, shop_id, source_id, conversation_id, client_request_id, requested_by,
		  body, request_metadata::text, provider_metadata::text, status, attempts,
		  last_error, message_id, created_at, updated_at, completed_at
	`, staleBefore.UTC(), time.Now().UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []EmailOutboxRecord{}
	for rows.Next() {
		record, scanErr := scanEmailOutbox(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

func (s *PostgresStore) ListAmbiguousEmailOutbox(ctx context.Context, limit int) ([]EmailOutboxRecord, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT id, shop_id, source_id, conversation_id, client_request_id, requested_by,
		  body, request_metadata::text, provider_metadata::text, status, attempts,
		  last_error, message_id, created_at, updated_at, completed_at
		FROM email_outbox
		WHERE status = 'ambiguous' AND message_id <> ''
		ORDER BY updated_at, id
		LIMIT $1
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	records := []EmailOutboxRecord{}
	for rows.Next() {
		record, scanErr := scanEmailOutbox(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		records = append(records, record)
	}
	return records, rows.Err()
}

type emailOutboxScanner interface{ Scan(...any) error }

func scanEmailOutbox(row emailOutboxScanner) (EmailOutboxRecord, error) {
	var record EmailOutboxRecord
	var completedAt sql.NullTime
	err := row.Scan(&record.ID, &record.ShopID, &record.SourceID, &record.ConversationID,
		&record.ClientRequestID, &record.RequestedBy, &record.Body, &record.RequestMetadata,
		&record.ProviderMetadata, &record.Status, &record.Attempts, &record.LastError,
		&record.MessageID, &record.CreatedAt, &record.UpdatedAt, &completedAt)
	if completedAt.Valid {
		record.CompletedAt = completedAt.Time
	}
	return record, err
}

func emailOutboxKey(conversationID string, requestID string) string {
	return strings.TrimSpace(conversationID) + "\x00" + strings.TrimSpace(requestID)
}

func (s *MemoryStore) BeginEmailOutbox(ctx context.Context, input EmailOutboxRecord) (EmailOutboxRecord, error) {
	if err := ctx.Err(); err != nil {
		return EmailOutboxRecord{}, err
	}
	input, err := normalizeEmailOutbox(input)
	if err != nil {
		return EmailOutboxRecord{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	key := emailOutboxKey(input.ConversationID, input.ClientRequestID)
	if existing, ok := s.emailOutbox[key]; ok {
		if existing.Status == "failed" {
			existing.Status = "pending"
			existing.Attempts++
			existing.Body = input.Body
			existing.RequestMetadata = input.RequestMetadata
			existing.ProviderMetadata = "{}"
			existing.LastError = ""
			existing.UpdatedAt = time.Now().UTC()
			s.emailOutbox[key] = existing
		}
		return existing, nil
	}
	input.ID = s.newIDLocked("email_outbox")
	input.Status = "pending"
	input.Attempts = 1
	input.ProviderMetadata = "{}"
	input.CreatedAt = time.Now().UTC()
	input.UpdatedAt = input.CreatedAt
	s.emailOutbox[key] = input
	return input, nil
}

func (s *MemoryStore) SetEmailOutboxState(ctx context.Context, id string, status string, providerMetadata string, lastError string, messageID string) (EmailOutboxRecord, error) {
	if err := ctx.Err(); err != nil {
		return EmailOutboxRecord{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for key, record := range s.emailOutbox {
		if record.ID != strings.TrimSpace(id) {
			continue
		}
		record.Status = strings.ToLower(strings.TrimSpace(status))
		if strings.TrimSpace(providerMetadata) != "" {
			record.ProviderMetadata = providerMetadata
		}
		record.LastError = truncateEmailPreview(lastError, 500)
		record.MessageID = strings.TrimSpace(messageID)
		record.UpdatedAt = time.Now().UTC()
		if record.Status == "completed" {
			record.CompletedAt = record.UpdatedAt
		}
		s.emailOutbox[key] = record
		return record, nil
	}
	return EmailOutboxRecord{}, ErrNotFound
}

func (s *MemoryStore) ClaimPendingEmailOutbox(ctx context.Context) (EmailOutboxRecord, error) {
	if err := ctx.Err(); err != nil {
		return EmailOutboxRecord{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	var selectedKey string
	var selected EmailOutboxRecord
	for key, record := range s.emailOutbox {
		if record.Status != "pending" || record.MessageID == "" {
			continue
		}
		blocked := false
		for _, earlier := range s.emailOutbox {
			if earlier.SourceID != record.SourceID || (earlier.Status != "pending" && earlier.Status != "sending") {
				continue
			}
			if earlier.CreatedAt.Before(record.CreatedAt) || (earlier.CreatedAt.Equal(record.CreatedAt) && earlier.ID < record.ID) {
				blocked = true
				break
			}
		}
		if blocked {
			continue
		}
		if selectedKey == "" || record.CreatedAt.Before(selected.CreatedAt) || (record.CreatedAt.Equal(selected.CreatedAt) && record.ID < selected.ID) {
			selectedKey = key
			selected = record
		}
	}
	if selectedKey == "" {
		return EmailOutboxRecord{}, ErrNotFound
	}
	selected.Status = "sending"
	selected.LastError = ""
	selected.UpdatedAt = time.Now().UTC()
	s.emailOutbox[selectedKey] = selected
	return selected, nil
}

func (s *MemoryStore) RecoverEmailOutbox(ctx context.Context, staleBefore time.Time) ([]EmailOutboxRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	recovered := []EmailOutboxRecord{}
	for key, record := range s.emailOutbox {
		if record.Status != "sending" || !record.UpdatedAt.Before(staleBefore) {
			continue
		}
		record.Status = "ambiguous"
		record.LastError = "send interrupted before a durable provider result was saved"
		record.UpdatedAt = time.Now().UTC()
		s.emailOutbox[key] = record
		recovered = append(recovered, record)
	}
	return recovered, nil
}

func (s *MemoryStore) ListAmbiguousEmailOutbox(ctx context.Context, limit int) ([]EmailOutboxRecord, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	records := make([]EmailOutboxRecord, 0, limit)
	for _, record := range s.emailOutbox {
		if record.Status == "ambiguous" && record.MessageID != "" {
			records = append(records, record)
		}
	}
	sort.Slice(records, func(i, j int) bool {
		if records[i].UpdatedAt.Equal(records[j].UpdatedAt) {
			return records[i].ID < records[j].ID
		}
		return records[i].UpdatedAt.Before(records[j].UpdatedAt)
	})
	if len(records) > limit {
		records = records[:limit]
	}
	return records, nil
}
