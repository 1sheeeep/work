package migration

import (
	"context"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

type SnapshotIsolation string

const SnapshotIsolationRepeatableRead SnapshotIsolation = "repeatable-read"

type SnapshotOptions struct {
	ReadOnly  bool
	Isolation SnapshotIsolation
}

type SnapshotDatabase interface {
	BeginSnapshot(context.Context, SnapshotOptions) (SnapshotTransaction, error)
}

type SnapshotTransaction interface {
	Query(context.Context, string) (SnapshotRows, error)
	Commit(context.Context) error
	Rollback(context.Context) error
}

type SnapshotRows interface {
	Next() bool
	Scan(...any) error
	Err() error
	Close()
}

const legacyPostgresSnapshotQuery = `
SELECT i.shop_domain, i.shop_id, i.access_token, i.scope, i.installed_at, i.updated_at,
       s.metadata->>'erpTenantId', s.metadata->>'erpCanonicalShopId'
FROM shopify_installations AS i
JOIN shops AS s ON s.id = i.shop_id
ORDER BY i.shop_domain, i.shop_id`

func ReadPostgresSnapshot(ctx context.Context, database SnapshotDatabase, decoder CredentialDecoder) (Snapshot, error) {
	transaction, err := database.BeginSnapshot(ctx, SnapshotOptions{ReadOnly: true, Isolation: SnapshotIsolationRepeatableRead})
	if err != nil {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	defer transaction.Rollback(ctx)
	rows, err := transaction.Query(ctx, legacyPostgresSnapshotQuery)
	if err != nil {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	defer rows.Close()
	result := Snapshot{}
	for rows.Next() {
		var domain, legacyShopID, storedToken, scope, tenantID, canonicalShopID string
		var installedAt, updatedAt time.Time
		if err := rows.Scan(&domain, &legacyShopID, &storedToken, &scope, &installedAt, &updatedAt, &tenantID, &canonicalShopID); err != nil {
			result.Destroy()
			return Snapshot{}, ErrLegacySnapshotUnavailable
		}
		token, err := decoder.Decode(storedToken)
		storedToken = ""
		if err != nil || strings.TrimSpace(tenantID) == "" || strings.TrimSpace(canonicalShopID) == "" {
			result.Destroy()
			return Snapshot{}, ErrLegacySnapshotUnavailable
		}
		result.Records = append(result.Records, shopifyinstallations.LegacyInstallationImport{
			Identity:     shopifyconnector.CanonicalShopIdentity{TenantID: strings.TrimSpace(tenantID), ShopID: strings.TrimSpace(canonicalShopID)},
			LegacyShopID: strings.TrimSpace(legacyShopID), ShopDomain: domain, AccessToken: token,
			Scopes: splitLegacyScopes(scope), InstalledAt: installedAt, UpdatedAt: updatedAt,
		})
	}
	rowErr := rows.Err()
	rows.Close()
	if rowErr != nil || len(result.Records) == 0 {
		result.Destroy()
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	if transaction.Commit(ctx) != nil {
		result.Destroy()
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	return result, nil
}
