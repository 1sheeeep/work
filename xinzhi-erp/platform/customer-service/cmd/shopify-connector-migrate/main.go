package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	shopifyinstallations "shopify-support-platform/internal/connectors/shopify/installations"
	shopifymigration "shopify-support-platform/internal/connectors/shopify/installations/migration"
)

type migrationConfig struct {
	ConnectorDataFile      string `json:"-"`
	ConnectorEncryptionKey []byte `json:"-"`
	LegacyDataFile         string `json:"-"`
	LegacyDatabaseURL      string `json:"-"`
	LegacyCredentialSecret string `json:"-"`
}

func (migrationConfig) String() string {
	return "migrationConfig{connector=[REDACTED] source=[REDACTED] keys=[REDACTED]}"
}

func (c migrationConfig) GoString() string { return c.String() }

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Stdout); err != nil {
		_, _ = io.WriteString(os.Stderr, "status=failed\n")
		os.Exit(1)
	}
}

func run(ctx context.Context, output io.Writer) error {
	config, err := configFromEnvironment()
	if err != nil {
		return err
	}
	defer clearBytes(config.ConnectorEncryptionKey)
	repository, err := shopifyinstallations.OpenFileRepository(config.ConnectorDataFile, config.ConnectorEncryptionKey)
	if err != nil {
		return errors.New("connector installation repository is unavailable")
	}
	decoder := shopifymigration.NewCredentialDecoder(config.LegacyCredentialSecret)
	var snapshot shopifymigration.Snapshot
	if config.LegacyDataFile != "" {
		snapshot, err = shopifymigration.ReadFileSnapshot(config.LegacyDataFile, decoder)
	} else {
		pool, poolErr := pgxpool.New(ctx, config.LegacyDatabaseURL)
		if poolErr != nil {
			return errors.New("legacy Shopify installation snapshot is unavailable")
		}
		defer pool.Close()
		snapshot, err = shopifymigration.ReadPostgresSnapshot(ctx, shopifymigration.NewPGXSnapshotDatabase(pool), decoder)
	}
	if err != nil {
		return errors.New("legacy Shopify installation snapshot is unavailable")
	}
	defer snapshot.Destroy()
	result, err := repository.ImportLegacyInstallations(ctx, snapshot.Records)
	if err != nil {
		return errors.New("legacy Shopify installation import failed")
	}
	return writeMigrationResult(output, result)
}

func clearBytes(value []byte) {
	for index := range value {
		value[index] = 0
	}
}

func configFromEnvironment() (migrationConfig, error) {
	connectorDataFile := strings.TrimSpace(os.Getenv("SHOPIFY_CONNECTOR_DATA_FILE"))
	connectorKey, err := decodeConnectorEncryptionKey(os.Getenv("SHOPIFY_CONNECTOR_ENCRYPTION_KEY"))
	if err != nil || connectorDataFile == "" {
		return migrationConfig{}, errors.New("connector migration target is not configured")
	}
	legacyDataFile := strings.TrimSpace(os.Getenv("SHOPIFY_LEGACY_DATA_FILE"))
	legacyDatabaseURL := strings.TrimSpace(os.Getenv("SHOPIFY_LEGACY_DATABASE_URL"))
	if (legacyDataFile == "") == (legacyDatabaseURL == "") {
		return migrationConfig{}, errors.New("exactly one legacy migration source must be configured")
	}
	return migrationConfig{
		ConnectorDataFile: connectorDataFile, ConnectorEncryptionKey: connectorKey,
		LegacyDataFile: legacyDataFile, LegacyDatabaseURL: legacyDatabaseURL,
		LegacyCredentialSecret: strings.TrimSpace(os.Getenv("SHOPIFY_LEGACY_CREDENTIALS_ENCRYPTION_KEY")),
	}, nil
}

func decodeConnectorEncryptionKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	for _, encoding := range []*base64.Encoding{
		base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding,
	} {
		if decoded, err := encoding.DecodeString(value); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	return nil, errors.New("connector repository encryption key is invalid")
}

func writeMigrationResult(output io.Writer, result shopifyinstallations.LegacyImportResult) error {
	return json.NewEncoder(output).Encode(struct {
		Status          string `json:"status"`
		Total           int    `json:"total"`
		Imported        int    `json:"imported"`
		AlreadyImported int    `json:"alreadyImported"`
	}{Status: "complete", Total: result.Total, Imported: result.Imported, AlreadyImported: result.AlreadyImported})
}
