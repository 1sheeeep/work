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

type emailSyncJobStore interface {
	EnqueueEmailSyncJob(context.Context, EmailSyncJob) (EmailSyncJob, error)
	ClaimEmailSyncJob(context.Context, string, time.Time) (EmailSyncJob, error)
	NextEmailSyncJobAvailableAt(context.Context, string) (time.Time, error)
	FinishEmailSyncJob(context.Context, string, bool, time.Time, string) error
	RecoverEmailSyncJobs(context.Context, time.Time) (int, error)
}

func normalizeEmailSyncJob(input EmailSyncJob) (EmailSyncJob, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.SourceID = strings.TrimSpace(input.SourceID)
	input.Provider = strings.ToLower(strings.TrimSpace(input.Provider))
	input.Reason = strings.TrimSpace(input.Reason)
	if input.ShopID == "" || input.SourceID == "" || input.Provider == "" {
		return EmailSyncJob{}, fmt.Errorf("%w: email sync job identity is required", ErrInvalid)
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

func (s *PostgresStore) EnqueueEmailSyncJob(ctx context.Context, input EmailSyncJob) (EmailSyncJob, error) {
	input, err := normalizeEmailSyncJob(input)
	if err != nil {
		return EmailSyncJob{}, err
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("email_sync")
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_sync_jobs (
		  source_id, id, shop_id, provider, priority, reason, status,
		  rerun_requested, available_at, attempts, last_error, started_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,'queued',FALSE,$7,0,'',NULL,$8,$8)
		ON CONFLICT (source_id) DO UPDATE SET
		  shop_id = EXCLUDED.shop_id,
		  provider = EXCLUDED.provider,
		  priority = GREATEST(email_sync_jobs.priority, EXCLUDED.priority),
		  reason = CASE WHEN EXCLUDED.priority >= email_sync_jobs.priority THEN EXCLUDED.reason ELSE email_sync_jobs.reason END,
		  status = CASE WHEN email_sync_jobs.status = 'running' THEN email_sync_jobs.status ELSE 'queued' END,
		  rerun_requested = email_sync_jobs.rerun_requested OR email_sync_jobs.status = 'running',
		  available_at = LEAST(email_sync_jobs.available_at, EXCLUDED.available_at),
		  updated_at = EXCLUDED.updated_at
		RETURNING id, shop_id, source_id, provider, priority, reason, status,
		  rerun_requested, available_at, attempts, last_error, started_at, created_at, updated_at
	`, input.SourceID, input.ID, input.ShopID, input.Provider, input.Priority, input.Reason, input.AvailableAt, now)
	job, err := scanEmailSyncJob(row)
	if isForeignKeyError(err) {
		return EmailSyncJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) ClaimEmailSyncJob(ctx context.Context, provider string, now time.Time) (EmailSyncJob, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EmailSyncJob{}, err
	}
	defer func() { _ = tx.Rollback() }()
	row := tx.QueryRowContext(ctx, `
		SELECT id, shop_id, source_id, provider, priority, reason, status,
		  rerun_requested, available_at, attempts, last_error, started_at, created_at, updated_at
		FROM email_sync_jobs
		WHERE provider = $1 AND status = 'queued' AND available_at <= $2
		ORDER BY priority DESC, available_at ASC, created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`, provider, now.UTC())
	job, err := scanEmailSyncJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailSyncJob{}, ErrNotFound
	}
	if err != nil {
		return EmailSyncJob{}, err
	}
	startedAt := time.Now().UTC()
	row = tx.QueryRowContext(ctx, `
		UPDATE email_sync_jobs
		SET status='running', rerun_requested=FALSE, attempts=attempts+1,
		    started_at=$2, updated_at=$2
		WHERE source_id=$1
		RETURNING id, shop_id, source_id, provider, priority, reason, status,
		  rerun_requested, available_at, attempts, last_error, started_at, created_at, updated_at
	`, job.SourceID, startedAt)
	job, err = scanEmailSyncJob(row)
	if err != nil {
		return EmailSyncJob{}, err
	}
	if err := tx.Commit(); err != nil {
		return EmailSyncJob{}, err
	}
	return job, nil
}

func (s *PostgresStore) NextEmailSyncJobAvailableAt(ctx context.Context, provider string) (time.Time, error) {
	provider = strings.ToLower(strings.TrimSpace(provider))
	var availableAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT available_at
		FROM email_sync_jobs
		WHERE provider = $1 AND status = 'queued'
		ORDER BY available_at ASC
		LIMIT 1
	`, provider).Scan(&availableAt)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	return availableAt.UTC(), err
}

func (s *PostgresStore) FinishEmailSyncJob(ctx context.Context, sourceID string, rerun bool, availableAt time.Time, lastError string) error {
	sourceID = strings.TrimSpace(sourceID)
	if sourceID == "" {
		return fmt.Errorf("%w: sourceId is required", ErrInvalid)
	}
	if rerun {
		if availableAt.IsZero() {
			availableAt = time.Now().UTC()
		}
		_, err := s.db.ExecContext(ctx, `
			UPDATE email_sync_jobs
			SET status='queued', rerun_requested=FALSE, available_at=$2,
			    last_error=$3, started_at=NULL, updated_at=$4
			WHERE source_id=$1
		`, sourceID, availableAt.UTC(), strings.TrimSpace(lastError), time.Now().UTC())
		return err
	}
	result, err := s.db.ExecContext(ctx, `
		DELETE FROM email_sync_jobs
		WHERE source_id=$1 AND rerun_requested=FALSE
	`, sourceID)
	if err != nil {
		return err
	}
	deleted, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if deleted > 0 {
		return nil
	}
	_, err = s.db.ExecContext(ctx, `
		UPDATE email_sync_jobs
		SET status='queued', rerun_requested=FALSE, available_at=$2,
		    last_error='', started_at=NULL, updated_at=$2
		WHERE source_id=$1
	`, sourceID, time.Now().UTC())
	return err
}

func (s *PostgresStore) RecoverEmailSyncJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	result, err := s.db.ExecContext(ctx, `
		UPDATE email_sync_jobs
		SET status='queued', rerun_requested=FALSE, available_at=$2,
		    last_error='worker interrupted before completion', started_at=NULL, updated_at=$2
		WHERE status='running' AND started_at < $1
	`, staleBefore.UTC(), time.Now().UTC())
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

type emailSyncJobScanner interface{ Scan(...any) error }

func scanEmailSyncJob(row emailSyncJobScanner) (EmailSyncJob, error) {
	var job EmailSyncJob
	var startedAt sql.NullTime
	err := row.Scan(&job.ID, &job.ShopID, &job.SourceID, &job.Provider, &job.Priority,
		&job.Reason, &job.Status, &job.RerunRequested, &job.AvailableAt, &job.Attempts,
		&job.LastError, &startedAt, &job.CreatedAt, &job.UpdatedAt)
	if startedAt.Valid {
		job.StartedAt = startedAt.Time
	}
	return job, err
}

func (s *MemoryStore) EnqueueEmailSyncJob(ctx context.Context, input EmailSyncJob) (EmailSyncJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailSyncJob{}, err
	}
	input, err := normalizeEmailSyncJob(input)
	if err != nil {
		return EmailSyncJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, ok := s.sources[input.SourceID]
	if !ok || source.ShopID != input.ShopID {
		return EmailSyncJob{}, ErrNotFound
	}
	now := time.Now().UTC()
	if existing, ok := s.emailSyncJobs[input.SourceID]; ok {
		if input.Priority >= existing.Priority {
			existing.Priority = input.Priority
			existing.Reason = input.Reason
		}
		if input.AvailableAt.Before(existing.AvailableAt) {
			existing.AvailableAt = input.AvailableAt
		}
		if existing.Status == "running" {
			existing.RerunRequested = true
		} else {
			existing.Status = "queued"
		}
		existing.UpdatedAt = now
		s.emailSyncJobs[input.SourceID] = existing
		return existing, nil
	}
	input.ID = s.newIDLocked("email_sync")
	input.Status = "queued"
	input.CreatedAt = now
	input.UpdatedAt = now
	s.emailSyncJobs[input.SourceID] = input
	return input, nil
}

func (s *MemoryStore) ClaimEmailSyncJob(ctx context.Context, provider string, now time.Time) (EmailSyncJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailSyncJob{}, err
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.mu.Lock()
	defer s.mu.Unlock()
	candidates := make([]EmailSyncJob, 0)
	for _, job := range s.emailSyncJobs {
		if job.Provider == provider && job.Status == "queued" && !job.AvailableAt.After(now) {
			candidates = append(candidates, job)
		}
	}
	if len(candidates) == 0 {
		return EmailSyncJob{}, ErrNotFound
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
	job.RerunRequested = false
	job.Attempts++
	job.StartedAt = time.Now().UTC()
	job.UpdatedAt = job.StartedAt
	s.emailSyncJobs[job.SourceID] = job
	return job, nil
}

func (s *MemoryStore) NextEmailSyncJobAvailableAt(ctx context.Context, provider string) (time.Time, error) {
	if err := ctx.Err(); err != nil {
		return time.Time{}, err
	}
	provider = strings.ToLower(strings.TrimSpace(provider))
	s.mu.RLock()
	defer s.mu.RUnlock()
	var next time.Time
	for _, job := range s.emailSyncJobs {
		if job.Provider != provider || job.Status != "queued" {
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

func (s *MemoryStore) FinishEmailSyncJob(ctx context.Context, sourceID string, rerun bool, availableAt time.Time, lastError string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.emailSyncJobs[strings.TrimSpace(sourceID)]
	if !ok {
		return ErrNotFound
	}
	if !rerun && !job.RerunRequested {
		delete(s.emailSyncJobs, job.SourceID)
		return nil
	}
	if availableAt.IsZero() {
		availableAt = time.Now().UTC()
	}
	job.Status = "queued"
	job.RerunRequested = false
	job.AvailableAt = availableAt.UTC()
	job.LastError = strings.TrimSpace(lastError)
	job.StartedAt = time.Time{}
	job.UpdatedAt = time.Now().UTC()
	s.emailSyncJobs[job.SourceID] = job
	return nil
}

func (s *MemoryStore) RecoverEmailSyncJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	now := time.Now().UTC()
	for sourceID, job := range s.emailSyncJobs {
		if job.Status == "running" && job.StartedAt.Before(staleBefore) {
			job.Status = "queued"
			job.RerunRequested = false
			job.AvailableAt = now
			job.StartedAt = time.Time{}
			job.LastError = "worker interrupted before completion"
			job.UpdatedAt = now
			s.emailSyncJobs[sourceID] = job
			count++
		}
	}
	return count, nil
}
