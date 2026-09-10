package platform

import (
	"errors"
	"hash/fnv"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	emailRetryStateKey                    = "email_retry_state"
	emailRetryStateWaiting                = "retry_wait"
	emailRetryStateReauthorizationNeeded  = "reauthorization_required"
	emailRetryStateRiskBlocked            = "risk_blocked"
	emailRetryStateManualRecoveryRequired = "manual_recovery_required"
	emailRetryFailureCountKey             = "email_retry_failure_count"
	emailRetryNextAtKey                   = "email_retry_next_at"
	emailRetryPausedAtKey                 = "email_retry_paused_at"
	emailRetryErrorCodeKey                = "email_retry_error_code"
)

var emailRetryBackoff = [...]time.Duration{
	time.Minute,
	5 * time.Minute,
	15 * time.Minute,
	time.Hour,
	6 * time.Hour,
}

func emailRetryStateForError(syncErr error) string {
	if syncErr == nil {
		return ""
	}
	message := strings.ToLower(syncErr.Error())
	for _, marker := range []string{
		"service abuse mode",
		"aadsts50053",
		"account is locked",
		"account has been locked",
		"temporarily locked",
		"aadsts50057",
		"user account is disabled",
	} {
		if strings.Contains(message, marker) {
			return emailRetryStateRiskBlocked
		}
	}
	for _, marker := range []string{
		"invalid_grant",
		"interaction_required",
		"consent_required",
		"reauthorizationrequired",
		"reauthorize the email channel",
		"refresh token is missing",
		"authorization expired",
		"token has been expired or revoked",
		"token expired or revoked",
		"email installation missing",
		"authentication failed",
		"invalid credentials",
		"login failed",
		"535 5.7.8",
		"imap configuration invalid",
	} {
		if strings.Contains(message, marker) {
			return emailRetryStateReauthorizationNeeded
		}
	}
	return emailRetryStateWaiting
}

func emailRetryStateIsPermanent(state string) bool {
	state = strings.TrimSpace(state)
	return state == emailRetryStateReauthorizationNeeded || state == emailRetryStateRiskBlocked || state == emailRetryStateManualRecoveryRequired
}

func emailRetryFailureCount(metadata map[string]string) int {
	count, err := strconv.Atoi(strings.TrimSpace(metadata[emailRetryFailureCountKey]))
	if err != nil || count < 0 {
		return 0
	}
	return count
}

func emailRetryDelay(syncErr error, failureCount int, now time.Time) time.Duration {
	var providerErr *emailProviderHTTPError
	if errors.As(syncErr, &providerErr) {
		if delay, ok := parseEmailRetryAfter(providerErr.RetryAfter, now); ok {
			return delay
		}
	}
	index := failureCount - 1
	if index < 0 {
		index = 0
	}
	if index >= len(emailRetryBackoff) {
		index = len(emailRetryBackoff) - 1
	}
	return emailRetryBackoff[index]
}

func parseEmailRetryAfter(value string, now time.Time) (time.Duration, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	if seconds, err := strconv.Atoi(value); err == nil {
		if seconds < 0 {
			return 0, false
		}
		return time.Duration(seconds) * time.Second, true
	}
	when, err := http.ParseTime(value)
	if err != nil {
		return 0, false
	}
	delay := when.Sub(now)
	if delay < 0 {
		delay = 0
	}
	return delay, true
}

func emailRetryErrorCode(state string, syncErr error) string {
	switch state {
	case emailRetryStateRiskBlocked:
		return "account_risk"
	case emailRetryStateReauthorizationNeeded:
		return "authorization_invalid"
	case emailRetryStateManualRecoveryRequired:
		return "manual_recovery_required"
	}
	var providerErr *emailProviderHTTPError
	if errors.As(syncErr, &providerErr) {
		if providerErr.StatusCode == http.StatusTooManyRequests {
			return "rate_limited"
		}
		if providerErr.StatusCode >= 500 {
			return "provider_unavailable"
		}
	}
	message := ""
	if syncErr != nil {
		message = strings.ToLower(syncErr.Error())
	}
	if strings.Contains(message, "timeout") || strings.Contains(message, "deadline exceeded") {
		return "timeout"
	}
	return "temporary_failure"
}

func applyEmailRetryFailure(metadata map[string]string, syncErr error, now time.Time, permanentOnly bool) map[string]string {
	state := emailRetryStateForError(syncErr)
	if permanentOnly && !emailRetryStateIsPermanent(state) {
		return metadata
	}
	previousState := strings.TrimSpace(metadata[emailRetryStateKey])
	failureCount := emailRetryFailureCount(metadata) + 1
	metadata[emailRetryStateKey] = state
	metadata[emailRetryFailureCountKey] = strconv.Itoa(failureCount)
	metadata[emailRetryErrorCodeKey] = emailRetryErrorCode(state, syncErr)
	if emailRetryStateIsPermanent(state) {
		if previousState != state || strings.TrimSpace(metadata[emailRetryPausedAtKey]) == "" {
			metadata[emailRetryPausedAtKey] = now.UTC().Format(time.RFC3339Nano)
		}
		delete(metadata, emailRetryNextAtKey)
		return metadata
	}
	metadata[emailRetryNextAtKey] = now.UTC().Add(emailRetryDelayWithJitter(syncErr, failureCount, now, metadata["mailbox"])).Format(time.RFC3339Nano)
	delete(metadata, emailRetryPausedAtKey)
	return metadata
}

func emailRetryDelayWithJitter(syncErr error, failureCount int, now time.Time, key string) time.Duration {
	base := emailRetryDelay(syncErr, failureCount, now)
	var providerErr *emailProviderHTTPError
	if errors.As(syncErr, &providerErr) {
		if _, ok := parseEmailRetryAfter(providerErr.RetryAfter, now); ok {
			return base
		}
	}
	if base < time.Second {
		return base
	}
	hash := fnv.New32a()
	_, _ = hash.Write([]byte(strings.TrimSpace(key) + "|" + strconv.Itoa(failureCount)))
	span := base / 5
	if span < time.Second {
		span = time.Second
	}
	offset := time.Duration(hash.Sum32()%uint32(2*span/time.Millisecond+1))*time.Millisecond - span
	return max(time.Second, base+offset)
}

func clearEmailRetryState(metadata map[string]string) map[string]string {
	delete(metadata, emailRetryStateKey)
	delete(metadata, emailRetryFailureCountKey)
	delete(metadata, emailRetryNextAtKey)
	delete(metadata, emailRetryPausedAtKey)
	delete(metadata, emailRetryErrorCodeKey)
	return metadata
}

func emailSourceAutomaticSyncDue(source ShopSource, now time.Time) bool {
	if strings.TrimSpace(source.Metadata[emailManualPausedAtKey]) != "" {
		return false
	}
	state := strings.TrimSpace(source.Metadata[emailRetryStateKey])
	if emailRetryStateIsPermanent(state) {
		return false
	}
	if state != emailRetryStateWaiting {
		return true
	}
	nextAttempt, ok := parseEmailSyncTime(source.Metadata[emailRetryNextAtKey])
	return !ok || !now.UTC().Before(nextAttempt)
}
