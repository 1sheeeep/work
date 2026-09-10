package inbox

import (
	"context"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/browserread"
)

type logger interface {
	Append(event string, details any)
}

type ReadOptions struct {
	OpenResult     appcore.OpenResult
	Shop           appcore.Shop
	Cache          []appcore.Conversation
	Logger         logger
	PauseFunc      func(context.Context) error
	ActivateTarget bool
	ForceRefresh   bool
}

func ReadShopInbox(ctx context.Context, options ReadOptions) (appcore.InboxResult, error) {
	result, err := browserread.ReadInbox(ctx, options.OpenResult, options.Shop, options.ActivateTarget, options.ForceRefresh, options.Logger)
	if err != nil {
		logInbox(options.Logger, "inbox.read.playwright.failed", map[string]any{"shop": options.Shop.DisplayName, "error": err.Error()})
		return appcore.InboxResult{}, err
	}
	if result.Status == "" {
		result.Status = "ready"
	}
	details := map[string]any{"shop": options.Shop.DisplayName, "conversations": len(result.Conversations), "status": result.Status, "warnings": len(result.Warnings), "url": result.URL}
	if diagnostics := result.Diagnostics; len(diagnostics) > 0 {
		details["diagnostics"] = diagnostics
	}
	logInbox(options.Logger, "inbox.read.playwright.ok", details)
	return result, nil
}

func logInbox(log logger, event string, details any) {
	if log != nil {
		log.Append(event, details)
	}
}
