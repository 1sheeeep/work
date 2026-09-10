package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type emailExportJobStore interface {
	CreateEmailExportJob(context.Context, EmailExportJob) (EmailExportJob, error)
	GetEmailExportJob(context.Context, string) (EmailExportJob, error)
	ClaimEmailExportJob(context.Context) (EmailExportJob, error)
	UpdateEmailExportProgress(context.Context, string, string, int, int, int, int) (EmailExportJob, error)
	FinishEmailExportJob(context.Context, string, string, string, string, int, string) (EmailExportJob, error)
	RecoverEmailExportJobs(context.Context, time.Time) (int, error)
	DeleteExpiredEmailExportJobs(context.Context, time.Time) ([]string, error)
}

func emailExportJobColumns() string {
	return `id, requested_by, filter::text, status, filename, file_path, row_count,
		progress_stage, attachment_total, attachment_processed, attachment_succeeded, attachment_failed,
		last_error, created_at, updated_at, started_at, completed_at, expires_at`
}

func (s *PostgresStore) CreateEmailExportJob(ctx context.Context, input EmailExportJob) (EmailExportJob, error) {
	input.RequestedBy = strings.TrimSpace(input.RequestedBy)
	if input.RequestedBy == "" || strings.TrimSpace(input.Filter) == "" {
		return EmailExportJob{}, fmt.Errorf("%w: export requester and filter are required", ErrInvalid)
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("email_export")
	}
	if input.ExpiresAt.IsZero() {
		input.ExpiresAt = now.Add(24 * time.Hour)
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO email_export_jobs (
		  id, requested_by, filter, status, filename, file_path, row_count, last_error,
		  created_at, updated_at, started_at, completed_at, expires_at
		) VALUES ($1,$2,$3::jsonb,'queued','','',0,'',$4,$4,NULL,NULL,$5)
		RETURNING `+emailExportJobColumns()+`
	`, input.ID, input.RequestedBy, input.Filter, now, input.ExpiresAt.UTC())
	job, err := scanEmailExportJob(row)
	if isForeignKeyError(err) {
		return EmailExportJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) GetEmailExportJob(ctx context.Context, id string) (EmailExportJob, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT `+emailExportJobColumns()+`
		FROM email_export_jobs WHERE id=$1
	`, strings.TrimSpace(id))
	job, err := scanEmailExportJob(row)
	if err == sql.ErrNoRows {
		return EmailExportJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) ClaimEmailExportJob(ctx context.Context) (EmailExportJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return EmailExportJob{}, err
	}
	defer func() { _ = tx.Rollback() }()
	row := tx.QueryRowContext(ctx, `
		SELECT `+emailExportJobColumns()+`
		FROM email_export_jobs
		WHERE status='queued' AND expires_at > $1
		ORDER BY created_at ASC
		FOR UPDATE SKIP LOCKED LIMIT 1
	`, time.Now().UTC())
	job, err := scanEmailExportJob(row)
	if err == sql.ErrNoRows {
		return EmailExportJob{}, ErrNotFound
	}
	if err != nil {
		return EmailExportJob{}, err
	}
	now := time.Now().UTC()
	row = tx.QueryRowContext(ctx, `
		UPDATE email_export_jobs SET status='running', started_at=$2, updated_at=$2, last_error=''
		WHERE id=$1
		RETURNING `+emailExportJobColumns()+`
	`, job.ID, now)
	job, err = scanEmailExportJob(row)
	if err != nil {
		return EmailExportJob{}, err
	}
	if err := tx.Commit(); err != nil {
		return EmailExportJob{}, err
	}
	return job, nil
}

func (s *PostgresStore) FinishEmailExportJob(ctx context.Context, id string, status string, filename string, filePath string, rowCount int, lastError string) (EmailExportJob, error) {
	now := time.Now().UTC()
	filename = strings.TrimSpace(filename)
	if filename == "" && filePath != "" {
		filename = filepath.Base(filePath)
	}
	row := s.db.QueryRowContext(ctx, `
		UPDATE email_export_jobs
		SET status=$2, filename=$3, file_path=$4, row_count=$5, last_error=$6,
		    started_at=CASE WHEN $2='queued' THEN NULL ELSE started_at END,
		    completed_at=CASE WHEN $2='completed' THEN $7::timestamptz ELSE NULL END, updated_at=$7::timestamptz
		WHERE id=$1
		RETURNING `+emailExportJobColumns()+`
	`, strings.TrimSpace(id), strings.TrimSpace(status), filename, filePath, rowCount, truncateEmailPreview(lastError, 500), now)
	job, err := scanEmailExportJob(row)
	if err == sql.ErrNoRows {
		return EmailExportJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) UpdateEmailExportProgress(ctx context.Context, id string, stage string, total int, processed int, succeeded int, failed int) (EmailExportJob, error) {
	row := s.db.QueryRowContext(ctx, `UPDATE email_export_jobs
		SET progress_stage=$2, attachment_total=$3, attachment_processed=$4,
		    attachment_succeeded=$5, attachment_failed=$6, updated_at=$7
		WHERE id=$1 RETURNING `+emailExportJobColumns(), strings.TrimSpace(id), strings.TrimSpace(stage),
		total, processed, succeeded, failed, time.Now().UTC())
	job, err := scanEmailExportJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return EmailExportJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) RecoverEmailExportJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	result, err := s.db.ExecContext(ctx, `UPDATE email_export_jobs SET status='queued', started_at=NULL, updated_at=$2 WHERE status='running' AND started_at < $1`, staleBefore.UTC(), time.Now().UTC())
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

func (s *PostgresStore) DeleteExpiredEmailExportJobs(ctx context.Context, before time.Time) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `DELETE FROM email_export_jobs WHERE expires_at < $1 RETURNING file_path`, before.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	paths := []string{}
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, err
		}
		if path != "" {
			paths = append(paths, path)
		}
	}
	return paths, rows.Err()
}

type emailExportJobScanner interface{ Scan(...any) error }

func scanEmailExportJob(row emailExportJobScanner) (EmailExportJob, error) {
	var job EmailExportJob
	var startedAt, completedAt sql.NullTime
	err := row.Scan(&job.ID, &job.RequestedBy, &job.Filter, &job.Status, &job.Filename,
		&job.FilePath, &job.RowCount, &job.ProgressStage, &job.AttachmentTotal,
		&job.AttachmentProcessed, &job.AttachmentSucceeded, &job.AttachmentFailed,
		&job.LastError, &job.CreatedAt, &job.UpdatedAt,
		&startedAt, &completedAt, &job.ExpiresAt)
	if startedAt.Valid {
		job.StartedAt = startedAt.Time
	}
	if completedAt.Valid {
		job.CompletedAt = completedAt.Time
	}
	return job, err
}

func (s *MemoryStore) UpdateEmailExportProgress(ctx context.Context, id string, stage string, total int, processed int, succeeded int, failed int) (EmailExportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailExportJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.emailExportJobs[strings.TrimSpace(id)]
	if !ok {
		return EmailExportJob{}, ErrNotFound
	}
	job.ProgressStage = strings.TrimSpace(stage)
	job.AttachmentTotal = total
	job.AttachmentProcessed = processed
	job.AttachmentSucceeded = succeeded
	job.AttachmentFailed = failed
	job.UpdatedAt = time.Now().UTC()
	s.emailExportJobs[job.ID] = job
	return job, nil
}

func (s *MemoryStore) CreateEmailExportJob(ctx context.Context, input EmailExportJob) (EmailExportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailExportJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.users[input.RequestedBy]; !ok {
		return EmailExportJob{}, ErrNotFound
	}
	input.ID = s.newIDLocked("email_export")
	input.Status = "queued"
	input.CreatedAt = time.Now().UTC()
	input.UpdatedAt = input.CreatedAt
	if input.ExpiresAt.IsZero() {
		input.ExpiresAt = input.CreatedAt.Add(24 * time.Hour)
	}
	s.emailExportJobs[input.ID] = input
	return input, nil
}

func (s *MemoryStore) GetEmailExportJob(ctx context.Context, id string) (EmailExportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailExportJob{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	job, ok := s.emailExportJobs[strings.TrimSpace(id)]
	if !ok {
		return EmailExportJob{}, ErrNotFound
	}
	return job, nil
}

func (s *MemoryStore) ClaimEmailExportJob(ctx context.Context) (EmailExportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailExportJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	jobs := []EmailExportJob{}
	for _, job := range s.emailExportJobs {
		if job.Status == "queued" && job.ExpiresAt.After(time.Now().UTC()) {
			jobs = append(jobs, job)
		}
	}
	if len(jobs) == 0 {
		return EmailExportJob{}, ErrNotFound
	}
	sort.Slice(jobs, func(i, j int) bool { return jobs[i].CreatedAt.Before(jobs[j].CreatedAt) })
	job := jobs[0]
	job.Status = "running"
	job.StartedAt = time.Now().UTC()
	job.UpdatedAt = job.StartedAt
	s.emailExportJobs[job.ID] = job
	return job, nil
}

func (s *MemoryStore) FinishEmailExportJob(ctx context.Context, id string, status string, filename string, filePath string, rowCount int, lastError string) (EmailExportJob, error) {
	if err := ctx.Err(); err != nil {
		return EmailExportJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.emailExportJobs[strings.TrimSpace(id)]
	if !ok {
		return EmailExportJob{}, ErrNotFound
	}
	job.Status = status
	job.FilePath = filePath
	job.Filename = strings.TrimSpace(filename)
	if job.Filename == "" && filePath != "" {
		job.Filename = filepath.Base(filePath)
	}
	job.RowCount = rowCount
	job.LastError = lastError
	job.UpdatedAt = time.Now().UTC()
	if status == "queued" {
		job.StartedAt = time.Time{}
	}
	if status == "completed" {
		job.CompletedAt = job.UpdatedAt
	}
	s.emailExportJobs[job.ID] = job
	return job, nil
}

func (s *MemoryStore) RecoverEmailExportJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for id, job := range s.emailExportJobs {
		if job.Status == "running" && job.StartedAt.Before(staleBefore) {
			job.Status = "queued"
			job.StartedAt = time.Time{}
			job.UpdatedAt = time.Now().UTC()
			s.emailExportJobs[id] = job
			count++
		}
	}
	return count, nil
}

func (s *MemoryStore) DeleteExpiredEmailExportJobs(ctx context.Context, before time.Time) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	paths := []string{}
	for id, job := range s.emailExportJobs {
		if job.ExpiresAt.Before(before) {
			if job.FilePath != "" {
				paths = append(paths, job.FilePath)
			}
			delete(s.emailExportJobs, id)
		}
	}
	return paths, nil
}
