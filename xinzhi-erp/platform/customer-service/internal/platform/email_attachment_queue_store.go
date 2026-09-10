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

type emailAttachmentJobStore interface {
	EnqueueEmailAttachmentJob(context.Context, EmailAttachmentJob) (EmailAttachmentJob, error)
	ClaimEmailAttachmentJob(context.Context, []string, time.Time) (EmailAttachmentJob, error)
	NextEmailAttachmentJobAvailableAt(context.Context) (time.Time, error)
	FinishEmailAttachmentJob(context.Context, string, time.Time, string) error
	RecoverEmailAttachmentJobs(context.Context, time.Time) (int, error)
}

func normalizeEmailAttachmentJob(input EmailAttachmentJob) (EmailAttachmentJob, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.ConversationID = strings.TrimSpace(input.ConversationID)
	input.MessageID = strings.TrimSpace(input.MessageID)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.ProviderMessageID = strings.TrimSpace(input.ProviderMessageID)
	if input.ShopID == "" || input.SourceID == "" || input.ConversationID == "" || input.MessageID == "" || input.Provider == "" || input.ProviderMessageID == "" {
		return EmailAttachmentJob{}, fmt.Errorf("%w: email attachment job identity is required", ErrInvalid)
	}
	if input.Priority < 0 {
		input.Priority = 0
	}
	if input.AvailableAt.IsZero() {
		input.AvailableAt = time.Now().UTC()
	} else {
		input.AvailableAt = input.AvailableAt.UTC()
	}
	return input, nil
}

func emailAttachmentJobColumns() string {
	return `id, shop_id, source_id, conversation_id, message_id, provider, provider_message_id,
		priority, status, available_at, attempts, last_error, started_at, created_at, updated_at`
}

func (s *PostgresStore) EnqueueEmailAttachmentJob(ctx context.Context, input EmailAttachmentJob) (EmailAttachmentJob, error) {
	input, err := normalizeEmailAttachmentJob(input)
	if err != nil {
		return EmailAttachmentJob{}, err
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("email_attachment")
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_attachment_jobs (
		  message_id, id, shop_id, source_id, conversation_id, provider, provider_message_id,
		  priority, status, available_at, attempts, last_error, started_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',$9,0,'',NULL,$10,$10)
		ON CONFLICT (message_id) DO UPDATE SET
		  shop_id=EXCLUDED.shop_id, source_id=EXCLUDED.source_id, conversation_id=EXCLUDED.conversation_id,
		  provider=EXCLUDED.provider, provider_message_id=EXCLUDED.provider_message_id,
		  priority=GREATEST(email_attachment_jobs.priority, EXCLUDED.priority),
		  status=CASE WHEN email_attachment_jobs.status='running' THEN 'running' ELSE 'queued' END,
		  available_at=LEAST(email_attachment_jobs.available_at, EXCLUDED.available_at), updated_at=EXCLUDED.updated_at
		RETURNING `+emailAttachmentJobColumns(), input.MessageID, input.ID, input.ShopID, input.SourceID,
		input.ConversationID, input.Provider, input.ProviderMessageID, input.Priority, input.AvailableAt, now)
	job, err := scanEmailAttachmentJob(row)
	if isForeignKeyError(err) {
		return EmailAttachmentJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) ClaimEmailAttachmentJob(ctx context.Context, excludedSourceIDs []string, now time.Time) (EmailAttachmentJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EmailAttachmentJob{}, err
	}
	defer func() { _ = tx.Rollback() }()
	args := []any{now.UTC()}
	exclusion := ""
	if len(excludedSourceIDs) > 0 {
		placeholders := make([]string, 0, len(excludedSourceIDs))
		for _, sourceID := range excludedSourceIDs {
			sourceID = strings.TrimSpace(sourceID)
			if sourceID == "" {
				continue
			}
			args = append(args, sourceID)
			placeholders = append(placeholders, fmt.Sprintf("$%d", len(args)))
		}
		if len(placeholders) > 0 {
			exclusion = " AND source_id NOT IN (" + strings.Join(placeholders, ",") + ")"
		}
	}
	row := tx.QueryRowContext(ctx, `SELECT `+emailAttachmentJobColumns()+`
		FROM email_attachment_jobs
		WHERE status='queued' AND available_at <= $1`+exclusion+`
		ORDER BY priority DESC, available_at ASC, created_at ASC
		FOR UPDATE SKIP LOCKED LIMIT 1`, args...)
	job, err := scanEmailAttachmentJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailAttachmentJob{}, ErrNotFound
	}
	if err != nil {
		return EmailAttachmentJob{}, err
	}
	startedAt := time.Now().UTC()
	row = tx.QueryRowContext(ctx, `UPDATE email_attachment_jobs
		SET status='running', attempts=attempts+1, started_at=$2, updated_at=$2
		WHERE message_id=$1 RETURNING `+emailAttachmentJobColumns(), job.MessageID, startedAt)
	job, err = scanEmailAttachmentJob(row)
	if err != nil {
		return EmailAttachmentJob{}, err
	}
	if err := tx.Commit(); err != nil {
		return EmailAttachmentJob{}, err
	}
	return job, nil
}

func (s *PostgresStore) NextEmailAttachmentJobAvailableAt(ctx context.Context) (time.Time, error) {
	var value time.Time
	err := s.db.QueryRowContext(ctx, `SELECT available_at FROM email_attachment_jobs WHERE status='queued' ORDER BY available_at ASC LIMIT 1`).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	return value.UTC(), err
}

func (s *PostgresStore) FinishEmailAttachmentJob(ctx context.Context, messageID string, retryAt time.Time, lastError string) error {
	messageID = strings.TrimSpace(messageID)
	if messageID == "" {
		return fmt.Errorf("%w: attachment messageId is required", ErrInvalid)
	}
	if retryAt.IsZero() {
		_, err := s.db.ExecContext(ctx, `DELETE FROM email_attachment_jobs WHERE message_id=$1`, messageID)
		return err
	}
	_, err := s.db.ExecContext(ctx, `UPDATE email_attachment_jobs
		SET status='queued', available_at=$2, last_error=$3, started_at=NULL, updated_at=$4
		WHERE message_id=$1`, messageID, retryAt.UTC(), strings.TrimSpace(lastError), time.Now().UTC())
	return err
}

func (s *PostgresStore) RecoverEmailAttachmentJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `UPDATE email_attachment_jobs
		SET status='queued', available_at=$2, last_error='worker interrupted before completion', started_at=NULL, updated_at=$2
		WHERE status='running' AND started_at < $1`, staleBefore.UTC(), now)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

type emailAttachmentJobScanner interface{ Scan(...any) error }

func scanEmailAttachmentJob(row emailAttachmentJobScanner) (EmailAttachmentJob, error) {
	var job EmailAttachmentJob
	var startedAt sql.NullTime
	err := row.Scan(&job.ID, &job.ShopID, &job.SourceID, &job.ConversationID, &job.MessageID,
		&job.Provider, &job.ProviderMessageID, &job.Priority, &job.Status, &job.AvailableAt,
		&job.Attempts, &job.LastError, &startedAt, &job.CreatedAt, &job.UpdatedAt)
	if startedAt.Valid {
		job.StartedAt = startedAt.Time
	}
	return job, err
}

func (s *MemoryStore) EnqueueEmailAttachmentJob(ctx context.Context, input EmailAttachmentJob) (EmailAttachmentJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailAttachmentJob{}, err
	}
	input, err := normalizeEmailAttachmentJob(input)
	if err != nil {
		return EmailAttachmentJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[input.SourceID]
	if !ok || source.ShopID != input.ShopID {
		return EmailAttachmentJob{}, ErrNotFound
	}
	found := false
	for _, message := range s.messages[input.ConversationID] {
		if message.ID == input.MessageID {
			found = true
			break
		}
	}
	if !found {
		return EmailAttachmentJob{}, ErrNotFound
	}
	now := time.Now().UTC()
	if existing, ok := s.emailAttachmentJobs[input.MessageID]; ok {
		if input.Priority > existing.Priority {
			existing.Priority = input.Priority
		}
		if input.AvailableAt.Before(existing.AvailableAt) {
			existing.AvailableAt = input.AvailableAt
		}
		if existing.Status != "running" {
			existing.Status = "queued"
		}
		existing.UpdatedAt = now
		s.emailAttachmentJobs[input.MessageID] = existing
		return existing, nil
	}
	input.ID = s.newIDLocked("email_attachment")
	input.Status = "queued"
	input.CreatedAt = now
	input.UpdatedAt = now
	s.emailAttachmentJobs[input.MessageID] = input
	return input, nil
}

func (s *MemoryStore) ClaimEmailAttachmentJob(ctx context.Context, excludedSourceIDs []string, now time.Time) (EmailAttachmentJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailAttachmentJob{}, err
	}
	excluded := map[string]bool{}
	for _, sourceID := range excludedSourceIDs {
		excluded[strings.TrimSpace(sourceID)] = true
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	candidates := make([]EmailAttachmentJob, 0)
	for _, job := range s.emailAttachmentJobs {
		if job.Status == "queued" && !job.AvailableAt.After(now) && !excluded[job.SourceID] {
			candidates = append(candidates, job)
		}
	}
	if len(candidates) == 0 {
		return EmailAttachmentJob{}, ErrNotFound
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Priority != candidates[j].Priority {
			return candidates[i].Priority > candidates[j].Priority
		}
		if !candidates[i].AvailableAt.Equal(candidates[j].AvailableAt) {
			return candidates[i].AvailableAt.Before(candidates[j].AvailableAt)
		}
		return candidates[i].CreatedAt.Before(candidates[j].CreatedAt)
	})
	job := candidates[0]
	job.Status = "running"
	job.Attempts++
	job.StartedAt = time.Now().UTC()
	job.UpdatedAt = job.StartedAt
	s.emailAttachmentJobs[job.MessageID] = job
	return job, nil
}

func (s *MemoryStore) NextEmailAttachmentJobAvailableAt(ctx context.Context) (time.Time, error) {
	if err := ctx.Err(); err != nil {
		return time.Time{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var next time.Time
	for _, job := range s.emailAttachmentJobs {
		if job.Status != "queued" {
			continue
		}
		if next.IsZero() || job.AvailableAt.Before(next) {
			next = job.AvailableAt
		}
	}
	if next.IsZero() {
		return time.Time{}, ErrNotFound
	}
	return next.UTC(), nil
}

func (s *MemoryStore) FinishEmailAttachmentJob(ctx context.Context, messageID string, retryAt time.Time, lastError string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.emailAttachmentJobs[strings.TrimSpace(messageID)]
	if !ok {
		return ErrNotFound
	}
	if retryAt.IsZero() {
		delete(s.emailAttachmentJobs, job.MessageID)
		return nil
	}
	job.Status = "queued"
	job.AvailableAt = retryAt.UTC()
	job.LastError = strings.TrimSpace(lastError)
	job.StartedAt = time.Time{}
	job.UpdatedAt = time.Now().UTC()
	s.emailAttachmentJobs[job.MessageID] = job
	return nil
}

func (s *MemoryStore) RecoverEmailAttachmentJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	now := time.Now().UTC()
	for id, job := range s.emailAttachmentJobs {
		if job.Status == "running" && job.StartedAt.Before(staleBefore) {
			job.Status = "queued"
			job.AvailableAt = now
			job.StartedAt = time.Time{}
			job.LastError = "worker interrupted before completion"
			job.UpdatedAt = now
			s.emailAttachmentJobs[id] = job
			count++
		}
	}
	return count, nil
}
