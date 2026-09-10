package platform

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type externalCacheEntry struct {
	Payload   []byte
	FetchedAt time.Time
	ExpiresAt time.Time
}

type externalCacheStore interface {
	GetExternalCache(context.Context, string) (externalCacheEntry, error)
	SaveExternalCache(context.Context, string, string, string, []byte, time.Time, time.Time) error
	DeleteExpiredExternalCache(context.Context, time.Time) (int, error)
}

type externalCacheInvalidator interface {
	DeleteExternalCacheNamespace(context.Context, string, string) (int, error)
}

func externalCacheKey(namespace string, shopID string, identity string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(identity))))
	return namespace + ":" + strings.TrimSpace(shopID) + ":" + hex.EncodeToString(sum[:])
}

func (s *Server) loadExternalCache(ctx context.Context, key string, target any) bool {
	store, ok := s.store.(externalCacheStore)
	if !ok {
		return false
	}
	entry, err := store.GetExternalCache(ctx, key)
	if err != nil || time.Now().UTC().After(entry.ExpiresAt) {
		return false
	}
	return json.Unmarshal(entry.Payload, target) == nil
}

func (s *Server) saveExternalCache(ctx context.Context, namespace string, shopID string, key string, value any, ttl time.Duration) {
	store, ok := s.store.(externalCacheStore)
	if !ok {
		return
	}
	payload, err := json.Marshal(value)
	if err != nil {
		return
	}
	now := time.Now().UTC()
	_ = store.SaveExternalCache(ctx, key, namespace, shopID, payload, now, now.Add(ttl))
}

func (s *Server) invalidateExternalCacheNamespace(ctx context.Context, namespace string, shopID string) {
	store, ok := s.store.(externalCacheInvalidator)
	if !ok {
		return
	}
	_, _ = store.DeleteExternalCacheNamespace(ctx, namespace, shopID)
}

func (s *PostgresStore) GetExternalCache(ctx context.Context, key string) (externalCacheEntry, error) {
	var entry externalCacheEntry
	err := s.db.QueryRowContext(ctx, `
		SELECT payload, fetched_at, expires_at
		FROM external_cache WHERE cache_key = $1
	`, strings.TrimSpace(key)).Scan(&entry.Payload, &entry.FetchedAt, &entry.ExpiresAt)
	if errors.Is(err, sql.ErrNoRows) {
		return externalCacheEntry{}, ErrNotFound
	}
	return entry, err
}

func (s *PostgresStore) SaveExternalCache(ctx context.Context, key string, namespace string, shopID string, payload []byte, fetchedAt time.Time, expiresAt time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO external_cache (cache_key, namespace, shop_id, payload, fetched_at, expires_at, updated_at)
		VALUES ($1, $2, $3, $4::jsonb, $5, $6, $5)
		ON CONFLICT (cache_key) DO UPDATE SET
			namespace = EXCLUDED.namespace,
			shop_id = EXCLUDED.shop_id,
			payload = EXCLUDED.payload,
			fetched_at = EXCLUDED.fetched_at,
			expires_at = EXCLUDED.expires_at,
			updated_at = EXCLUDED.updated_at
	`, strings.TrimSpace(key), strings.TrimSpace(namespace), strings.TrimSpace(shopID), string(payload), fetchedAt.UTC(), expiresAt.UTC())
	return err
}

func (s *PostgresStore) DeleteExpiredExternalCache(ctx context.Context, before time.Time) (int, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM external_cache WHERE expires_at < $1`, before.UTC())
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}

func (s *PostgresStore) DeleteExternalCacheNamespace(ctx context.Context, namespace string, shopID string) (int, error) {
	result, err := s.db.ExecContext(ctx, `DELETE FROM external_cache WHERE namespace = $1 AND shop_id = $2`, strings.TrimSpace(namespace), strings.TrimSpace(shopID))
	if err != nil {
		return 0, err
	}
	count, err := result.RowsAffected()
	return int(count), err
}
