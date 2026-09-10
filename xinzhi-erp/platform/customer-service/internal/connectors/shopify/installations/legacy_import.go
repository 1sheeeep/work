package installations

import (
	"context"
	"crypto/subtle"
	"errors"
	"regexp"
	"sort"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

var (
	ErrInvalidLegacyImport  = errors.New("legacy Shopify installation import is invalid")
	ErrLegacyImportConflict = errors.New("legacy Shopify installation import conflicts with connector state")
	legacyScopePattern      = regexp.MustCompile(`^(?:read|write)_[a-z0-9_]+$`)
	legacyTokenPattern      = regexp.MustCompile(`^(?:shpat|shpca|shppa|shpua|shpss)_[A-Za-z0-9_-]+$`)
)

// LegacyInstallationImport is process-internal migration material. It must
// never be added to connector HTTP DTOs or structured logs.
type LegacyInstallationImport struct {
	Identity     shopifyconnector.CanonicalShopIdentity `json:"-"`
	LegacyShopID string                                 `json:"-"`
	ShopDomain   string                                 `json:"-"`
	AccessToken  string                                 `json:"-"`
	Scopes       []string                               `json:"-"`
	InstalledAt  time.Time                              `json:"-"`
	UpdatedAt    time.Time                              `json:"-"`
}

func (LegacyInstallationImport) String() string {
	return "legacyInstallationImport{identity=[REDACTED] legacy=[REDACTED] domain=[REDACTED] token=[REDACTED]}"
}

func (r LegacyInstallationImport) GoString() string { return r.String() }

type LegacyImportResult struct {
	Total           int `json:"total"`
	Imported        int `json:"imported"`
	AlreadyImported int `json:"alreadyImported"`
}

type LegacyInstallationImporter interface {
	ImportLegacyInstallations(context.Context, []LegacyInstallationImport) (LegacyImportResult, error)
}

func (r *MemoryRepository) ImportLegacyInstallations(ctx context.Context, records []LegacyInstallationImport) (LegacyImportResult, error) {
	if err := ctx.Err(); err != nil {
		return LegacyImportResult{}, err
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	candidate := cloneMemoryRepositoryLocked(r)
	result, err := importLegacyInstallations(ctx, candidate, records)
	if err != nil {
		return LegacyImportResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return LegacyImportResult{}, err
	}
	r.bindings = candidate.bindings
	r.legacyIndex = candidate.legacyIndex
	r.domainIndex = candidate.domainIndex
	r.installations = candidate.installations
	r.oauthGrants = candidate.oauthGrants
	return result, nil
}

func importLegacyInstallations(ctx context.Context, candidate *MemoryRepository, records []LegacyInstallationImport) (LegacyImportResult, error) {
	if len(records) == 0 {
		return LegacyImportResult{}, ErrInvalidLegacyImport
	}
	result := LegacyImportResult{Total: len(records)}
	normalized := make([]LegacyInstallationImport, 0, len(records))
	identities := make(map[string]struct{}, len(records))
	legacyIDs := make(map[string]struct{}, len(records))
	domains := make(map[string]struct{}, len(records))

	for _, record := range records {
		if err := ctx.Err(); err != nil {
			return LegacyImportResult{}, err
		}
		clean, err := validateLegacyInstallationImport(record)
		if err != nil {
			return LegacyImportResult{}, err
		}
		key := identityKey(clean.Identity)
		if _, duplicate := identities[key]; duplicate {
			return LegacyImportResult{}, ErrLegacyImportConflict
		}
		if _, duplicate := legacyIDs[clean.LegacyShopID]; duplicate {
			return LegacyImportResult{}, ErrLegacyImportConflict
		}
		if _, duplicate := domains[clean.ShopDomain]; duplicate {
			return LegacyImportResult{}, ErrLegacyImportConflict
		}
		identities[key] = struct{}{}
		legacyIDs[clean.LegacyShopID] = struct{}{}
		domains[clean.ShopDomain] = struct{}{}
		normalized = append(normalized, clean)
	}

	for _, record := range normalized {
		binding := Binding{Identity: record.Identity, LegacyShopID: record.LegacyShopID, ShopDomain: record.ShopDomain}
		if err := candidate.checkBindingLocked(binding); err != nil {
			return LegacyImportResult{}, ErrLegacyImportConflict
		}
		key := identityKey(record.Identity)
		if existing, ok := candidate.installations[key]; ok {
			if !sameLegacyInstallation(existing, record) {
				return LegacyImportResult{}, ErrLegacyImportConflict
			}
			result.AlreadyImported++
			continue
		}
		if err := candidate.saveBindingLocked(binding); err != nil {
			return LegacyImportResult{}, ErrLegacyImportConflict
		}
		candidate.installations[key] = InstallationRecord{
			Binding: binding, AccessToken: record.AccessToken, Scopes: append([]string(nil), record.Scopes...),
			State: shopifyconnector.InstallationStateInstalled, InstalledAt: record.InstalledAt, UpdatedAt: record.UpdatedAt,
		}
		result.Imported++
	}
	return result, nil
}

func validateLegacyInstallationImport(record LegacyInstallationImport) (LegacyInstallationImport, error) {
	binding, err := validateAndNormalizeBinding(Binding{
		Identity: record.Identity, LegacyShopID: record.LegacyShopID, ShopDomain: record.ShopDomain,
	})
	if err != nil || len(record.AccessToken) < 14 || len(record.AccessToken) > 4096 ||
		!legacyTokenPattern.MatchString(record.AccessToken) || record.AccessToken != strings.TrimSpace(record.AccessToken) {
		return LegacyInstallationImport{}, ErrInvalidLegacyImport
	}
	scopes := normalizeLegacyImportScopes(record.Scopes)
	if len(scopes) == 0 || record.InstalledAt.IsZero() || record.UpdatedAt.IsZero() || record.UpdatedAt.Before(record.InstalledAt) {
		return LegacyInstallationImport{}, ErrInvalidLegacyImport
	}
	for _, scope := range scopes {
		if !legacyScopePattern.MatchString(scope) {
			return LegacyInstallationImport{}, ErrInvalidLegacyImport
		}
	}
	record.Identity = binding.Identity
	record.LegacyShopID = binding.LegacyShopID
	record.ShopDomain = binding.ShopDomain
	record.Scopes = scopes
	record.InstalledAt = record.InstalledAt.UTC()
	record.UpdatedAt = record.UpdatedAt.UTC()
	return record, nil
}

func normalizeLegacyImportScopes(scopes []string) []string {
	unique := make(map[string]struct{}, len(scopes))
	for _, scope := range scopes {
		scope = strings.TrimSpace(scope)
		if scope != "" {
			unique[scope] = struct{}{}
		}
	}
	result := make([]string, 0, len(unique))
	for scope := range unique {
		result = append(result, scope)
	}
	sort.Strings(result)
	return result
}

func sameLegacyInstallation(existing InstallationRecord, imported LegacyInstallationImport) bool {
	if existing.Identity != imported.Identity || existing.LegacyShopID != imported.LegacyShopID ||
		existing.ShopDomain != imported.ShopDomain || existing.State != shopifyconnector.InstallationStateInstalled ||
		!existing.RevokedAt.IsZero() || existing.EffectsApplied ||
		!existing.InstalledAt.Equal(imported.InstalledAt) || !existing.UpdatedAt.Equal(imported.UpdatedAt) ||
		len(existing.AccessToken) != len(imported.AccessToken) ||
		subtle.ConstantTimeCompare([]byte(existing.AccessToken), []byte(imported.AccessToken)) != 1 {
		return false
	}
	existingScopes := normalizeLegacyImportScopes(existing.Scopes)
	if len(existingScopes) != len(imported.Scopes) {
		return false
	}
	for index := range existingScopes {
		if existingScopes[index] != imported.Scopes[index] {
			return false
		}
	}
	return true
}

var _ LegacyInstallationImporter = (*MemoryRepository)(nil)
