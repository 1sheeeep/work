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

type shopifyOrderSyncJobStore interface {
	EnqueueShopifyOrderSyncJob(context.Context, ShopifyOrderSyncJob) (ShopifyOrderSyncJob, error)
	EnqueueShopifyWebhookJob(context.Context, string, string, string, time.Time, ShopifyOrderSyncJob) (ShopifyOrderSyncJob, bool, error)
	ClaimShopifyOrderSyncJob(context.Context, time.Time, bool) (ShopifyOrderSyncJob, error)
	NextShopifyOrderSyncJobAvailableAt(context.Context, bool) (time.Time, error)
	FinishShopifyOrderSyncJob(context.Context, string, bool, time.Time, string) error
	RecoverShopifyOrderSyncJobs(context.Context, time.Time) (int, error)
	CleanupShopifyWebhookReceipts(context.Context, time.Time) (int, error)
}

func normalizeShopifyOrderSyncJob(input ShopifyOrderSyncJob) (ShopifyOrderSyncJob, error) {
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.Reason = strings.TrimSpace(input.Reason)
	input.TargetOrderID = strings.TrimSpace(input.TargetOrderID)
	if input.ShopID == "" {
		return ShopifyOrderSyncJob{}, fmt.Errorf("%w: Shopify order sync shop is required", ErrInvalid)
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

func mergeShopifyOrderSyncJob(existing ShopifyOrderSyncJob, input ShopifyOrderSyncJob, now time.Time) ShopifyOrderSyncJob {
	previousPriority := existing.Priority
	previousTarget := existing.TargetOrderID
	if input.Priority >= existing.Priority {
		existing.Priority = input.Priority
		existing.Reason = input.Reason
	}
	switch {
	case existing.Status == "running" && previousTarget == "" && input.TargetOrderID != "":
		existing.TargetOrderID = input.TargetOrderID
	case existing.Status == "queued" && previousPriority <= shopifyOrderSyncPriorityReconcile && input.Priority > previousPriority && previousTarget == "" && input.TargetOrderID != "":
		existing.TargetOrderID = input.TargetOrderID
		existing.ReconciliationRequested = true
	case previousTarget == "" || input.TargetOrderID == "":
		existing.TargetOrderID = ""
	case previousTarget != input.TargetOrderID:
		existing.TargetOrderID = ""
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
	return existing
}

func (s *PostgresStore) EnqueueShopifyOrderSyncJob(ctx context.Context, input ShopifyOrderSyncJob) (ShopifyOrderSyncJob, error) {
	input, err := normalizeShopifyOrderSyncJob(input)
	if err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	now := time.Now().UTC()
	if input.ID == "" {
		input.ID = prefixedID("shopify_order_sync")
	}
	row := s.db.QueryRowContext(ctx, `
		INSERT INTO shopify_order_sync_jobs (
		  shop_id, id, priority, reason, target_order_id, status,
		  rerun_requested, reconciliation_requested, available_at, attempts, last_error, started_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,'queued',FALSE,FALSE,$6,0,'',NULL,$7,$7)
		ON CONFLICT (shop_id) DO UPDATE SET
		  priority = GREATEST(shopify_order_sync_jobs.priority, EXCLUDED.priority),
		  reason = CASE WHEN EXCLUDED.priority >= shopify_order_sync_jobs.priority THEN EXCLUDED.reason ELSE shopify_order_sync_jobs.reason END,
		  target_order_id = CASE
		    WHEN shopify_order_sync_jobs.status = 'running' AND shopify_order_sync_jobs.target_order_id = '' AND EXCLUDED.target_order_id <> '' THEN EXCLUDED.target_order_id
		    WHEN shopify_order_sync_jobs.status = 'queued' AND shopify_order_sync_jobs.priority <= $8 AND EXCLUDED.priority > shopify_order_sync_jobs.priority AND EXCLUDED.target_order_id <> '' THEN EXCLUDED.target_order_id
		    WHEN shopify_order_sync_jobs.target_order_id = '' OR EXCLUDED.target_order_id = '' THEN ''
		    WHEN shopify_order_sync_jobs.target_order_id = EXCLUDED.target_order_id THEN shopify_order_sync_jobs.target_order_id
		    ELSE ''
		  END,
		  status = CASE WHEN shopify_order_sync_jobs.status = 'running' THEN 'running' ELSE 'queued' END,
		  rerun_requested = shopify_order_sync_jobs.rerun_requested OR shopify_order_sync_jobs.status = 'running',
		  reconciliation_requested = shopify_order_sync_jobs.reconciliation_requested OR (
		    shopify_order_sync_jobs.status = 'queued' AND shopify_order_sync_jobs.priority <= $8
		    AND shopify_order_sync_jobs.target_order_id = '' AND EXCLUDED.target_order_id <> ''
		    AND EXCLUDED.priority > shopify_order_sync_jobs.priority
		  ),
		  available_at = LEAST(shopify_order_sync_jobs.available_at, EXCLUDED.available_at),
		  updated_at = EXCLUDED.updated_at
		RETURNING id, shop_id, priority, reason, target_order_id, status,
		  rerun_requested, reconciliation_requested, available_at, attempts, last_error, started_at, created_at, updated_at
	`, input.ShopID, input.ID, input.Priority, input.Reason, input.TargetOrderID, input.AvailableAt, now, shopifyOrderSyncPriorityReconcile)
	job, err := scanShopifyOrderSyncJob(row)
	if isForeignKeyError(err) {
		return ShopifyOrderSyncJob{}, ErrNotFound
	}
	return job, err
}

func (s *PostgresStore) EnqueueShopifyWebhookJob(ctx context.Context, webhookID string, shopDomain string, topic string, receivedAt time.Time, input ShopifyOrderSyncJob) (ShopifyOrderSyncJob, bool, error) {
	input, err := normalizeShopifyOrderSyncJob(input)
	if err != nil {
		return ShopifyOrderSyncJob{}, false, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ShopifyOrderSyncJob{}, false, err
	}
	defer func() { _ = tx.Rollback() }()
	webhookID = strings.TrimSpace(webhookID)
	if webhookID != "" {
		result, insertErr := tx.ExecContext(ctx, `
			INSERT INTO shopify_webhook_receipts (webhook_id, shop_domain, topic, received_at)
			VALUES ($1,$2,$3,$4)
			ON CONFLICT (webhook_id) DO NOTHING
		`, webhookID, normalizeShopifyDomain(shopDomain), strings.TrimSpace(topic), receivedAt.UTC())
		if insertErr != nil {
			return ShopifyOrderSyncJob{}, false, insertErr
		}
		inserted, rowsErr := result.RowsAffected()
		if rowsErr != nil {
			return ShopifyOrderSyncJob{}, false, rowsErr
		}
		if inserted == 0 {
			if err := tx.Commit(); err != nil {
				return ShopifyOrderSyncJob{}, false, err
			}
			return ShopifyOrderSyncJob{}, false, nil
		}
	}
	if input.ID == "" {
		input.ID = prefixedID("shopify_order_sync")
	}
	now := time.Now().UTC()
	row := tx.QueryRowContext(ctx, `
		INSERT INTO shopify_order_sync_jobs (
		  shop_id, id, priority, reason, target_order_id, status,
		  rerun_requested, reconciliation_requested, available_at, attempts, last_error, started_at, created_at, updated_at
		) VALUES ($1,$2,$3,$4,$5,'queued',FALSE,FALSE,$6,0,'',NULL,$7,$7)
		ON CONFLICT (shop_id) DO UPDATE SET
		  priority = GREATEST(shopify_order_sync_jobs.priority, EXCLUDED.priority),
		  reason = CASE WHEN EXCLUDED.priority >= shopify_order_sync_jobs.priority THEN EXCLUDED.reason ELSE shopify_order_sync_jobs.reason END,
		  target_order_id = CASE
		    WHEN shopify_order_sync_jobs.status = 'running' AND shopify_order_sync_jobs.target_order_id = '' AND EXCLUDED.target_order_id <> '' THEN EXCLUDED.target_order_id
		    WHEN shopify_order_sync_jobs.status = 'queued' AND shopify_order_sync_jobs.priority <= $8 AND EXCLUDED.priority > shopify_order_sync_jobs.priority AND EXCLUDED.target_order_id <> '' THEN EXCLUDED.target_order_id
		    WHEN shopify_order_sync_jobs.target_order_id = '' OR EXCLUDED.target_order_id = '' THEN ''
		    WHEN shopify_order_sync_jobs.target_order_id = EXCLUDED.target_order_id THEN shopify_order_sync_jobs.target_order_id
		    ELSE ''
		  END,
		  status = CASE WHEN shopify_order_sync_jobs.status = 'running' THEN 'running' ELSE 'queued' END,
		  rerun_requested = shopify_order_sync_jobs.rerun_requested OR shopify_order_sync_jobs.status = 'running',
		  reconciliation_requested = shopify_order_sync_jobs.reconciliation_requested OR (
		    shopify_order_sync_jobs.status = 'queued' AND shopify_order_sync_jobs.priority <= $8
		    AND shopify_order_sync_jobs.target_order_id = '' AND EXCLUDED.target_order_id <> ''
		    AND EXCLUDED.priority > shopify_order_sync_jobs.priority
		  ),
		  available_at = LEAST(shopify_order_sync_jobs.available_at, EXCLUDED.available_at),
		  updated_at = EXCLUDED.updated_at
		RETURNING id, shop_id, priority, reason, target_order_id, status,
		  rerun_requested, reconciliation_requested, available_at, attempts, last_error, started_at, created_at, updated_at
	`, input.ShopID, input.ID, input.Priority, input.Reason, input.TargetOrderID, input.AvailableAt, now, shopifyOrderSyncPriorityReconcile)
	job, err := scanShopifyOrderSyncJob(row)
	if isForeignKeyError(err) {
		return ShopifyOrderSyncJob{}, false, ErrNotFound
	}
	if err != nil {
		return ShopifyOrderSyncJob{}, false, err
	}
	if err := tx.Commit(); err != nil {
		return ShopifyOrderSyncJob{}, false, err
	}
	return job, true, nil
}

func (s *PostgresStore) ClaimShopifyOrderSyncJob(ctx context.Context, now time.Time, allowReconciliation bool) (ShopifyOrderSyncJob, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	defer func() { _ = tx.Rollback() }()
	row := tx.QueryRowContext(ctx, `
		SELECT id, shop_id, priority, reason, target_order_id, status,
		  rerun_requested, reconciliation_requested, available_at, attempts, last_error, started_at, created_at, updated_at
		FROM shopify_order_sync_jobs
		WHERE status='queued' AND available_at <= $1
		  AND ($2 OR priority > $3)
		ORDER BY priority DESC, available_at ASC, created_at ASC
		FOR UPDATE SKIP LOCKED
		LIMIT 1
	`, now.UTC(), allowReconciliation, shopifyOrderSyncPriorityReconcile)
	job, err := scanShopifyOrderSyncJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return ShopifyOrderSyncJob{}, ErrNotFound
	}
	if err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	startedAt := time.Now().UTC()
	row = tx.QueryRowContext(ctx, `
		UPDATE shopify_order_sync_jobs
		SET status='running', rerun_requested=FALSE, attempts=attempts+1,
		    started_at=$2, updated_at=$2
		WHERE shop_id=$1
		RETURNING id, shop_id, priority, reason, target_order_id, status,
		  rerun_requested, reconciliation_requested, available_at, attempts, last_error, started_at, created_at, updated_at
	`, job.ShopID, startedAt)
	job, err = scanShopifyOrderSyncJob(row)
	if err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	if err := tx.Commit(); err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	return job, nil
}

func (s *PostgresStore) NextShopifyOrderSyncJobAvailableAt(ctx context.Context, allowReconciliation bool) (time.Time, error) {
	var availableAt time.Time
	err := s.db.QueryRowContext(ctx, `
		SELECT available_at
		FROM shopify_order_sync_jobs
		WHERE status='queued' AND ($1 OR priority > $2)
		ORDER BY available_at ASC
		LIMIT 1
	`, allowReconciliation, shopifyOrderSyncPriorityReconcile).Scan(&availableAt)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, ErrNotFound
	}
	return availableAt.UTC(), err
}

func (s *PostgresStore) FinishShopifyOrderSyncJob(ctx context.Context, shopID string, retry bool, availableAt time.Time, lastError string) error {
	shopID = strings.TrimSpace(shopID)
	if shopID == "" {
		return fmt.Errorf("%w: Shopify order sync shop is required", ErrInvalid)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var rerunRequested bool
	var reconciliationRequested bool
	err = tx.QueryRowContext(ctx, `
		SELECT rerun_requested, reconciliation_requested
		FROM shopify_order_sync_jobs
		WHERE shop_id=$1
		FOR UPDATE
	`, shopID).Scan(&rerunRequested, &reconciliationRequested)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if rerunRequested {
		_, err = tx.ExecContext(ctx, `
			UPDATE shopify_order_sync_jobs
			SET status='queued', rerun_requested=FALSE, available_at=LEAST(available_at,$2),
			    last_error=$3, started_at=NULL, updated_at=$2
			WHERE shop_id=$1
		`, shopID, now, strings.TrimSpace(lastError))
	} else if retry {
		if availableAt.IsZero() {
			availableAt = now
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE shopify_order_sync_jobs
			SET status='queued', rerun_requested=FALSE, available_at=$2,
			    last_error=$3, started_at=NULL, updated_at=$4
			WHERE shop_id=$1
		`, shopID, availableAt.UTC(), strings.TrimSpace(lastError), now)
	} else if reconciliationRequested {
		_, err = tx.ExecContext(ctx, `
			UPDATE shopify_order_sync_jobs
			SET priority=$2, reason='daily reconciliation', target_order_id='',
			    status='queued', rerun_requested=FALSE, reconciliation_requested=FALSE,
			    available_at=$3, last_error='', started_at=NULL, updated_at=$3
			WHERE shop_id=$1
		`, shopID, shopifyOrderSyncPriorityReconcile, now)
	} else {
		_, err = tx.ExecContext(ctx, `DELETE FROM shopify_order_sync_jobs WHERE shop_id=$1`, shopID)
	}
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (s *PostgresStore) RecoverShopifyOrderSyncJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	now := time.Now().UTC()
	result, err := s.db.ExecContext(ctx, `
		UPDATE shopify_order_sync_jobs
		SET status='queued', rerun_requested=FALSE, available_at=$2,
		    last_error='worker interrupted before completion', started_at=NULL, updated_at=$2
		WHERE status='running' AND started_at < $1
	`, staleBefore.UTC(), now)
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

func (s *PostgresStore) CleanupShopifyWebhookReceipts(ctx context.Context, before time.Time) (int, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM shopify_webhook_receipts WHERE received_at < $1`, before.UTC())
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

type shopifyOrderSyncJobScanner interface{ Scan(...any) error }

func scanShopifyOrderSyncJob(row shopifyOrderSyncJobScanner) (ShopifyOrderSyncJob, error) {
	var job ShopifyOrderSyncJob
	var startedAt sql.NullTime
	err := row.Scan(&job.ID, &job.ShopID, &job.Priority, &job.Reason, &job.TargetOrderID,
		&job.Status, &job.RerunRequested, &job.ReconciliationRequested, &job.AvailableAt, &job.Attempts, &job.LastError,
		&startedAt, &job.CreatedAt, &job.UpdatedAt)
	if startedAt.Valid {
		job.StartedAt = startedAt.Time
	}
	return job, err
}

func (s *MemoryStore) EnqueueShopifyOrderSyncJob(ctx context.Context, input ShopifyOrderSyncJob) (ShopifyOrderSyncJob, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	input, err := normalizeShopifyOrderSyncJob(input)
	if err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.shops[input.ShopID]; !ok {
		return ShopifyOrderSyncJob{}, ErrNotFound
	}
	now := time.Now().UTC()
	if existing, ok := s.shopifyOrderSyncJobs[input.ShopID]; ok {
		existing = mergeShopifyOrderSyncJob(existing, input, now)
		s.shopifyOrderSyncJobs[input.ShopID] = existing
		return existing, nil
	}
	input.ID = s.newIDLocked("shopify_order_sync")
	input.Status = "queued"
	input.CreatedAt = now
	input.UpdatedAt = now
	s.shopifyOrderSyncJobs[input.ShopID] = input
	return input, nil
}

func (s *MemoryStore) EnqueueShopifyWebhookJob(ctx context.Context, webhookID string, _ string, _ string, receivedAt time.Time, input ShopifyOrderSyncJob) (ShopifyOrderSyncJob, bool, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyOrderSyncJob{}, false, err
	}
	input, err := normalizeShopifyOrderSyncJob(input)
	if err != nil {
		return ShopifyOrderSyncJob{}, false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	webhookID = strings.TrimSpace(webhookID)
	if webhookID != "" {
		if _, exists := s.shopifyWebhookIDs[webhookID]; exists {
			return ShopifyOrderSyncJob{}, false, nil
		}
	}
	if _, ok := s.shops[input.ShopID]; !ok {
		return ShopifyOrderSyncJob{}, false, ErrNotFound
	}
	now := time.Now().UTC()
	if existing, ok := s.shopifyOrderSyncJobs[input.ShopID]; ok {
		existing = mergeShopifyOrderSyncJob(existing, input, now)
		s.shopifyOrderSyncJobs[input.ShopID] = existing
		if webhookID != "" {
			s.shopifyWebhookIDs[webhookID] = receivedAt.UTC()
		}
		return existing, true, nil
	}
	input.ID = s.newIDLocked("shopify_order_sync")
	input.Status = "queued"
	input.CreatedAt = now
	input.UpdatedAt = now
	s.shopifyOrderSyncJobs[input.ShopID] = input
	if webhookID != "" {
		s.shopifyWebhookIDs[webhookID] = receivedAt.UTC()
	}
	return input, true, nil
}

func (s *MemoryStore) ClaimShopifyOrderSyncJob(ctx context.Context, now time.Time, allowReconciliation bool) (ShopifyOrderSyncJob, error) {
	if err := ctx.Err(); err != nil {
		return ShopifyOrderSyncJob{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	candidates := make([]ShopifyOrderSyncJob, 0)
	for _, job := range s.shopifyOrderSyncJobs {
		if job.Status != "queued" || job.AvailableAt.After(now) || (!allowReconciliation && job.Priority <= shopifyOrderSyncPriorityReconcile) {
			continue
		}
		candidates = append(candidates, job)
	}
	if len(candidates) == 0 {
		return ShopifyOrderSyncJob{}, ErrNotFound
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
	s.shopifyOrderSyncJobs[job.ShopID] = job
	return job, nil
}

func (s *MemoryStore) NextShopifyOrderSyncJobAvailableAt(ctx context.Context, allowReconciliation bool) (time.Time, error) {
	if err := ctx.Err(); err != nil {
		return time.Time{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	var next time.Time
	for _, job := range s.shopifyOrderSyncJobs {
		if job.Status != "queued" || (!allowReconciliation && job.Priority <= shopifyOrderSyncPriorityReconcile) {
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

func (s *MemoryStore) FinishShopifyOrderSyncJob(ctx context.Context, shopID string, retry bool, availableAt time.Time, lastError string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.shopifyOrderSyncJobs[strings.TrimSpace(shopID)]
	if !ok {
		return ErrNotFound
	}
	now := time.Now().UTC()
	if job.RerunRequested {
		job.Status = "queued"
		job.RerunRequested = false
		if now.Before(job.AvailableAt) {
			job.AvailableAt = now
		}
		job.LastError = strings.TrimSpace(lastError)
		job.StartedAt = time.Time{}
		job.UpdatedAt = now
		s.shopifyOrderSyncJobs[job.ShopID] = job
		return nil
	}
	if retry {
		if availableAt.IsZero() {
			availableAt = now
		}
		job.Status = "queued"
		job.AvailableAt = availableAt.UTC()
		job.LastError = strings.TrimSpace(lastError)
		job.StartedAt = time.Time{}
		job.UpdatedAt = now
		s.shopifyOrderSyncJobs[job.ShopID] = job
		return nil
	}
	if job.ReconciliationRequested {
		job.Priority = shopifyOrderSyncPriorityReconcile
		job.Reason = "daily reconciliation"
		job.TargetOrderID = ""
		job.Status = "queued"
		job.RerunRequested = false
		job.ReconciliationRequested = false
		job.AvailableAt = now
		job.LastError = ""
		job.StartedAt = time.Time{}
		job.UpdatedAt = now
		s.shopifyOrderSyncJobs[job.ShopID] = job
		return nil
	}
	delete(s.shopifyOrderSyncJobs, job.ShopID)
	return nil
}

func (s *MemoryStore) RecoverShopifyOrderSyncJobs(ctx context.Context, staleBefore time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now().UTC()
	count := 0
	for shopID, job := range s.shopifyOrderSyncJobs {
		if job.Status == "running" && job.StartedAt.Before(staleBefore) {
			job.Status = "queued"
			job.RerunRequested = false
			job.AvailableAt = now
			job.StartedAt = time.Time{}
			job.LastError = "worker interrupted before completion"
			job.UpdatedAt = now
			s.shopifyOrderSyncJobs[shopID] = job
			count++
		}
	}
	return count, nil
}

func (s *MemoryStore) CleanupShopifyWebhookReceipts(ctx context.Context, before time.Time) (int, error) {
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := 0
	for webhookID, receivedAt := range s.shopifyWebhookIDs {
		if receivedAt.Before(before) {
			delete(s.shopifyWebhookIDs, webhookID)
			count++
		}
	}
	return count, nil
}
