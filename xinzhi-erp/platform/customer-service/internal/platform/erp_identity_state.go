package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"
)

// Only credential fingerprints (not hashes/passwords), opaque token hashes and
// reviewed bindings are persisted here. Raw leases are returned once to ERP.
type persistedIdentityGrant struct {
	Binding    ERPIdentityBinding `json:"binding"`
	Attempt    string             `json:"attempt"`
	Credential [32]byte           `json:"credential"`
	Revision   int64              `json:"revision"`
	Expires    time.Time          `json:"expires"`
}

func (h *erpIdentityPreparationHandler) saveToken(ctx context.Context, kind, hash string, g identityPreparationGrant) error {
	if h.persistent == nil {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.prune(h.now())
		if len(h.grants)+len(h.leases) >= h.tokenCapacity {
			return ErrRateLimited
		}
		if kind == "grant" {
			h.grants[hash] = g
		} else {
			h.leases[hash] = g
		}
		return nil
	}
	tx, err := h.persistent.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(814927163)`); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM customer_service.identity_preparation_tokens WHERE expires_at<=now()`); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FROM customer_service.identity_preparation_tokens`).Scan(&count); err != nil {
		return err
	}
	if count >= h.tokenCapacity {
		return ErrRateLimited
	}
	data, err := json.Marshal(persistedIdentityGrant{g.binding, g.attempt, g.credentialRevision, g.identityRevision, g.expires})
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO customer_service.identity_preparation_tokens(token_hash,kind,payload,expires_at) VALUES($1,$2,$3,$4)`, hash, kind, string(data), g.expires)
	if err != nil {
		return err
	}
	return tx.Commit()
}

func (h *erpIdentityPreparationHandler) loadToken(ctx context.Context, kind, hash string) (identityPreparationGrant, bool, error) {
	if h.persistent == nil {
		h.mu.Lock()
		defer h.mu.Unlock()
		h.prune(h.now())
		if kind == "grant" {
			g, ok := h.grants[hash]
			delete(h.grants, hash)
			return g, ok, nil
		}
		g, ok := h.leases[hash]
		return g, ok, nil
	}
	query := `SELECT payload FROM customer_service.identity_preparation_tokens WHERE token_hash=$1 AND kind='lease' AND expires_at>now()`
	if kind == "grant" {
		query = `DELETE FROM customer_service.identity_preparation_tokens WHERE token_hash=$1 AND kind='grant' RETURNING payload`
	}
	var data []byte
	err := h.persistent.db.QueryRowContext(ctx, query, hash).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return identityPreparationGrant{}, false, nil
	}
	if err != nil {
		return identityPreparationGrant{}, false, err
	}
	var p persistedIdentityGrant
	if json.Unmarshal(data, &p) != nil {
		return identityPreparationGrant{}, false, ErrInvalid
	}
	g := identityPreparationGrant{binding: p.Binding, attempt: p.Attempt, credentialRevision: p.Credential, identityRevision: p.Revision, expires: p.Expires}
	return g, h.now().Before(g.expires), nil
}

func (h *erpIdentityPreparationHandler) dropToken(ctx context.Context, hash string) {
	if h.persistent != nil {
		_, _ = h.persistent.db.ExecContext(ctx, `DELETE FROM customer_service.identity_preparation_tokens WHERE token_hash=$1`, hash)
		return
	}
	h.mu.Lock()
	delete(h.leases, hash)
	h.mu.Unlock()
}

func (h *erpIdentityPreparationHandler) durableAttempt(ctx context.Context, scope string, limit int) error {
	if h.persistent == nil {
		return nil
	}
	var attempts int
	err := h.persistent.db.QueryRowContext(ctx, `INSERT INTO customer_service.identity_preparation_login_windows(scope,window_start,attempts)
	VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(scope) DO UPDATE SET
	attempts=CASE WHEN customer_service.identity_preparation_login_windows.window_start=date_trunc('minute',now()) THEN customer_service.identity_preparation_login_windows.attempts+1 ELSE 1 END,
	window_start=date_trunc('minute',now()) RETURNING attempts`, h.tenant+":"+scope).Scan(&attempts)
	if err != nil {
		return err
	}
	if attempts > limit {
		return ErrRateLimited
	}
	return nil
}
