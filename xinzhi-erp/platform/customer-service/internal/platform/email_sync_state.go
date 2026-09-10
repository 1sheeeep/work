package platform

import (
	"strings"
	"time"
)

const (
	emailSyncVersionKey        = "email_sync_version"
	emailSyncVersionCurrent    = "5"
	emailSyncStartedAtKey      = "email_sync_started_at"
	emailInitialImportKey      = "email_initial_import"
	emailInitialImportNow      = "from_now"
	emailInitialImportRecent   = "recent_unread"
	emailInitialImportMigrated = "legacy_recent_unread"
	gmailHistoryIDKey          = "gmail_history_id"
	gmailSpamBootstrapAtKey    = "gmail_spam_bootstrap_at"
	outlookDeltaLinkKey        = "outlook_delta_link"
	outlookJunkDeltaLinkKey    = "outlook_junk_delta_link"
	emailLastReconcileAtKey    = "email_last_reconcile_at"
	emailSyncBacklogPendingKey = "email_sync_backlog_pending"
	emailSyncBacklogSinceKey   = "email_sync_backlog_since"
	emailManualPausedAtKey     = "email_manual_paused_at"
	emailManualPausedByKey     = "email_manual_paused_by"
)

func requestedEmailInitialImport(importRecentUnread bool) string {
	if importRecentUnread {
		return emailInitialImportRecent
	}
	return emailInitialImportNow
}

func normalizeEmailInitialImport(value string) string {
	if strings.EqualFold(strings.TrimSpace(value), emailInitialImportRecent) {
		return emailInitialImportRecent
	}
	return emailInitialImportNow
}

func newEmailSyncMetadata(mailbox string, auth string, initialImport string) map[string]string {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	return map[string]string{
		"mailbox":             normalizeEmail(mailbox),
		"auth":                strings.TrimSpace(auth),
		emailSyncVersionKey:   emailSyncVersionCurrent,
		emailSyncStartedAtKey: now,
		emailInitialImportKey: normalizeEmailInitialImport(initialImport),
		"email_sync_mode":     "incremental",
		"email_sync_interval": "push+24h_reconcile",
		"email_sync_status":   "pending",
	}
}

func markEmailAuthorizationPending(metadata map[string]string, mailbox string, auth string) map[string]string {
	updated := mergeStringMaps(metadata, map[string]string{
		"mailbox":                normalizeEmail(mailbox),
		"auth":                   strings.TrimSpace(auth),
		"email_sync_status":      "pending",
		"email_authorization_at": time.Now().UTC().Format(time.RFC3339Nano),
		"email_sync_interval":    "push+24h_reconcile",
	})
	delete(updated, "email_last_error")
	updated = clearEmailRetryState(updated)
	delete(updated, emailDisconnectedAtKey)
	delete(updated, emailDisconnectedReasonKey)
	return updated
}

func parseEmailSyncTime(value string) (time.Time, bool) {
	parsed, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(value))
	if err != nil {
		parsed, err = time.Parse(time.RFC3339, strings.TrimSpace(value))
	}
	if err != nil {
		return time.Time{}, false
	}
	return parsed.UTC(), true
}
