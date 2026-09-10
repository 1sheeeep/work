package email

import (
	"context"
	"fmt"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/browserread"
)

type logger interface {
	Append(event string, details any)
}

func Probe(openResult appcore.OpenResult, ignoredEmailFingerprints []string, emailScanCutoff string, activateTarget bool, log logger) (appcore.InboxResult, error) {
	return ProbeWithContext(context.Background(), openResult, "", false, ignoredEmailFingerprints, emailScanCutoff, activateTarget, log)
}

func ProbeWithContext(ctx context.Context, openResult appcore.OpenResult, mailAccount string, mailAccountManual bool, ignoredEmailFingerprints []string, emailScanCutoff string, activateTarget bool, log logger) (appcore.InboxResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 180*time.Second)
	defer cancel()

	result, err := browserread.ProbeEmail(ctx, openResult, mailAccount, mailAccountManual, ignoredEmailFingerprints, emailScanCutoff, activateTarget, log)
	if err != nil {
		if log != nil {
			log.Append("email.probe.playwright.failed", map[string]any{"error": err.Error()})
		}
		return appcore.InboxResult{}, fmt.Errorf("playwright email reader failed: %w", err)
	}
	if result.Status == "" {
		result.Status = "ready"
	}
	if log != nil {
		log.Append("email.probe.playwright.ok", map[string]any{
			"count":           len(result.Conversations),
			"status":          result.Status,
			"warnings":        len(result.Warnings),
			"provider_errors": len(result.ProviderErrors),
			"cutoff":          emailScanCutoff,
		})
	}
	return result, nil
}
