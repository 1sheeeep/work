package migration

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"sort"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
)

const maximumLegacyFileSnapshotBytes = 64 << 20

var ErrLegacySnapshotUnavailable = errors.New("legacy Shopify installation snapshot is unavailable")

type legacyFileSnapshot struct {
	Shops         map[string]legacyFileShop         `json:"shops"`
	Installations map[string]legacyFileInstallation `json:"installations"`
}

type legacyFileShop struct {
	ID       string            `json:"id"`
	Metadata map[string]string `json:"metadata"`
}

type legacyFileInstallation struct {
	ShopID      string    `json:"shopId"`
	ShopDomain  string    `json:"shopDomain"`
	AccessToken string    `json:"accessToken"`
	Scope       string    `json:"scope"`
	InstalledAt time.Time `json:"installedAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

func ReadFileSnapshot(path string, decoder CredentialDecoder) (Snapshot, error) {
	file, err := os.Open(path)
	if err != nil {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() > maximumLegacyFileSnapshotBytes {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	raw, err := io.ReadAll(io.LimitReader(file, maximumLegacyFileSnapshotBytes+1))
	if err != nil || len(raw) > maximumLegacyFileSnapshotBytes {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	defer zeroBytes(raw)
	after, err := file.Stat()
	if err != nil || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	return decodeLegacyFileSnapshot(raw, decoder)
}

func decodeLegacyFileSnapshot(raw []byte, decoder CredentialDecoder) (Snapshot, error) {
	var source legacyFileSnapshot
	if err := json.Unmarshal(raw, &source); err != nil || source.Shops == nil || source.Installations == nil {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	defer destroyLegacyFileSource(&source)
	if len(source.Installations) == 0 {
		return Snapshot{}, ErrLegacySnapshotUnavailable
	}
	domains := make([]string, 0, len(source.Installations))
	for domain := range source.Installations {
		domains = append(domains, domain)
	}
	sort.Strings(domains)
	result := Snapshot{Records: make([]shopifyinstallations.LegacyInstallationImport, 0, len(domains))}
	for _, mapDomain := range domains {
		installation := source.Installations[mapDomain]
		shop, ok := source.Shops[installation.ShopID]
		if !ok || strings.TrimSpace(shop.ID) != strings.TrimSpace(installation.ShopID) ||
			strings.TrimSpace(shop.Metadata["erpTenantId"]) == "" || strings.TrimSpace(shop.Metadata["erpCanonicalShopId"]) == "" {
			result.Destroy()
			return Snapshot{}, ErrLegacySnapshotUnavailable
		}
		normalizedMapDomain, mapDomainOK := shopifyconnector.NormalizeShopDomain(mapDomain)
		normalizedDomain, domainOK := shopifyconnector.NormalizeShopDomain(installation.ShopDomain)
		if !mapDomainOK || !domainOK || normalizedMapDomain != normalizedDomain {
			result.Destroy()
			return Snapshot{}, ErrLegacySnapshotUnavailable
		}
		token, err := decoder.Decode(installation.AccessToken)
		installation.AccessToken = ""
		if err != nil {
			result.Destroy()
			return Snapshot{}, ErrLegacySnapshotUnavailable
		}
		result.Records = append(result.Records, shopifyinstallations.LegacyInstallationImport{
			Identity: shopifyconnector.CanonicalShopIdentity{
				TenantID: strings.TrimSpace(shop.Metadata["erpTenantId"]),
				ShopID:   strings.TrimSpace(shop.Metadata["erpCanonicalShopId"]),
			},
			LegacyShopID: strings.TrimSpace(installation.ShopID), ShopDomain: normalizedDomain,
			AccessToken: token, Scopes: splitLegacyScopes(installation.Scope),
			InstalledAt: installation.InstalledAt, UpdatedAt: installation.UpdatedAt,
		})
	}
	return result, nil
}

func destroyLegacyFileSource(source *legacyFileSnapshot) {
	if source == nil {
		return
	}
	for domain, installation := range source.Installations {
		installation.AccessToken = ""
		source.Installations[domain] = installation
	}
	source.Installations = nil
	source.Shops = nil
}

func zeroBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

func splitLegacyScopes(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\r' || r == '\t'
	})
}
