package platform

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const (
	emailIngressWindowDuration = 10 * time.Minute
	emailFloodSystemPauseActor = "system:flood"
)

type emailIngressRateObservation struct {
	DimensionType string
	DimensionKey  string
	Count         int
}

type emailIngressRateCount struct {
	DimensionType string
	DimensionKey  string
	Count         int
}

type emailIngressRateWindow struct {
	SourceID      string
	DimensionKey  string
	DimensionType string
	WindowStarted time.Time
	Count         int
	UpdatedAt     time.Time
}

type emailIngressRateStore interface {
	AddEmailIngressRateObservations(context.Context, string, []emailIngressRateObservation, time.Time, time.Duration) ([]emailIngressRateCount, error)
}

func emailIngressDimensionKey(dimensionType string, value string) string {
	digest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(dimensionType)) + "\x00" + strings.ToLower(strings.TrimSpace(value))))
	return strings.ToLower(strings.TrimSpace(dimensionType)) + ":" + hex.EncodeToString(digest[:16])
}

func emailIngressThresholds(dimensionType string) (isolate int, pause int) {
	switch strings.ToLower(strings.TrimSpace(dimensionType)) {
	case "sender_subject":
		return 100, 500
	case "sender":
		return 150, 750
	default:
		return 1000, 1000
	}
}

func buildEmailIngressRateObservations(messages []incomingEmailMessage) []emailIngressRateObservation {
	counts := map[string]emailIngressRateObservation{}
	add := func(dimensionType string, value string) {
		key := emailIngressDimensionKey(dimensionType, value)
		observation := counts[key]
		observation.DimensionType = dimensionType
		observation.DimensionKey = key
		observation.Count++
		counts[key] = observation
	}
	for _, message := range messages {
		if strings.EqualFold(strings.TrimSpace(message.Direction), MessageDirectionAgent) {
			continue
		}
		sender := normalizeEmail(firstNonEmpty(message.SenderEmail, message.CustomerEmail))
		subject := strings.ToLower(strings.Join(strings.Fields(message.Subject), " "))
		add("mailbox", "all")
		if sender != "" {
			add("sender", sender)
			add("sender_subject", sender+"\x00"+subject)
		}
	}
	out := make([]emailIngressRateObservation, 0, len(counts))
	for _, observation := range counts {
		out = append(out, observation)
	}
	return out
}

func (s *Server) applyRollingEmailIngressProtection(ctx context.Context, source ShopSource, messages []incomingEmailMessage, metadata map[string]string) (map[string]string, int, bool, error) {
	observations := buildEmailIngressRateObservations(messages)
	if len(observations) == 0 {
		return metadata, 0, false, nil
	}
	store, ok := s.store.(emailIngressRateStore)
	if !ok {
		return metadata, 0, false, fmt.Errorf("email ingress rate storage is unavailable")
	}
	counts, err := store.AddEmailIngressRateObservations(ctx, source.ID, observations, time.Now().UTC(), emailIngressWindowDuration)
	if err != nil {
		return metadata, 0, false, err
	}
	isolate := false
	pause := false
	triggered := map[string]bool{}
	triggerType := ""
	triggerCount := 0
	for _, count := range counts {
		isolateAt, pauseAt := emailIngressThresholds(count.DimensionType)
		if count.Count >= isolateAt {
			triggered[count.DimensionKey] = true
		}
		if count.Count >= pauseAt && (!pause || count.Count > triggerCount) {
			pause = true
			isolate = true
			triggerType = count.DimensionType
			triggerCount = count.Count
			continue
		}
		if count.Count >= isolateAt && !pause && (!isolate || count.Count > triggerCount) {
			isolate = true
			triggerType = count.DimensionType
			triggerCount = count.Count
		}
	}
	if !isolate {
		return metadata, 0, false, nil
	}
	if metadata == nil {
		metadata = map[string]string{}
	}
	isolated := 0
	lastSender := ""
	for index := range messages {
		message := &messages[index]
		if strings.EqualFold(strings.TrimSpace(message.Direction), MessageDirectionAgent) {
			continue
		}
		sender := normalizeEmail(firstNonEmpty(message.SenderEmail, message.CustomerEmail))
		subject := strings.ToLower(strings.Join(strings.Fields(message.Subject), " "))
		matched := triggered[emailIngressDimensionKey("mailbox", "all")]
		if sender != "" {
			matched = matched || triggered[emailIngressDimensionKey("sender", sender)] || triggered[emailIngressDimensionKey("sender_subject", sender+"\x00"+subject)]
		}
		if !matched {
			continue
		}
		message.Classification = ConversationKindSystem
		message.ClassificationReason = highFrequencyEmailIsolation
		message.Metadata = mergeStringMaps(message.Metadata, map[string]string{
			"email_ingress_isolation": "rolling_rate_limit",
		})
		isolated++
		if lastSender == "" {
			lastSender = normalizeEmail(firstNonEmpty(message.SenderEmail, message.CustomerEmail))
		}
	}
	previousRaw := metadata["email_high_frequency_isolated_count"]
	if strings.TrimSpace(previousRaw) == "" {
		previousRaw = source.Metadata["email_high_frequency_isolated_count"]
	}
	previous, _ := parseNonNegativeInt(previousRaw)
	metadata["email_high_frequency_isolated_count"] = fmt.Sprintf("%d", previous+isolated)
	metadata["email_high_frequency_last_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	metadata["email_high_frequency_last_sender"] = lastSender
	metadata["email_high_frequency_window_dimension"] = triggerType
	metadata["email_high_frequency_window_count"] = fmt.Sprintf("%d", triggerCount)
	if pause {
		metadata[emailManualPausedAtKey] = time.Now().UTC().Format(time.RFC3339Nano)
		metadata[emailManualPausedByKey] = emailFloodSystemPauseActor
		metadata["email_sync_status"] = "paused"
		metadata["email_flood_pause_reason"] = triggerType
		metadata["email_flood_pause_count"] = fmt.Sprintf("%d", triggerCount)
	}
	return metadata, isolated, pause, nil
}

func parseNonNegativeInt(value string) (int, error) {
	var parsed int
	_, err := fmt.Sscanf(strings.TrimSpace(value), "%d", &parsed)
	if err != nil || parsed < 0 {
		return 0, err
	}
	return parsed, nil
}

func (s *PostgresStore) AddEmailIngressRateObservations(ctx context.Context, sourceID string, observations []emailIngressRateObservation, now time.Time, window time.Duration) ([]emailIngressRateCount, error) {
	if strings.TrimSpace(sourceID) == "" || window <= 0 {
		return nil, fmt.Errorf("%w: source and positive window are required", ErrInvalid)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	_, _ = tx.ExecContext(ctx, `DELETE FROM email_ingress_rate_windows WHERE source_id=$1 AND updated_at < $2`, sourceID, now.Add(-24*time.Hour))
	out := make([]emailIngressRateCount, 0, len(observations))
	for _, observation := range observations {
		if observation.Count <= 0 {
			continue
		}
		row := tx.QueryRowContext(ctx, `
			INSERT INTO email_ingress_rate_windows (
			  source_id, dimension_key, dimension_type, window_started_at, message_count, updated_at
			) VALUES ($1,$2,$3,$4,$5,$4)
			ON CONFLICT (source_id, dimension_key) DO UPDATE SET
			  dimension_type=EXCLUDED.dimension_type,
			  window_started_at=CASE
			    WHEN email_ingress_rate_windows.window_started_at <= $6 THEN EXCLUDED.window_started_at
			    ELSE email_ingress_rate_windows.window_started_at END,
			  message_count=CASE
			    WHEN email_ingress_rate_windows.window_started_at <= $6 THEN EXCLUDED.message_count
			    ELSE email_ingress_rate_windows.message_count + EXCLUDED.message_count END,
			  updated_at=EXCLUDED.updated_at
			RETURNING dimension_type, dimension_key, message_count
		`, sourceID, observation.DimensionKey, observation.DimensionType, now.UTC(), observation.Count, now.Add(-window))
		var count emailIngressRateCount
		if err := row.Scan(&count.DimensionType, &count.DimensionKey, &count.Count); err != nil {
			if isForeignKeyError(err) {
				return nil, ErrNotFound
			}
			return nil, err
		}
		out = append(out, count)
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *MemoryStore) AddEmailIngressRateObservations(ctx context.Context, sourceID string, observations []emailIngressRateObservation, now time.Time, window time.Duration) ([]emailIngressRateCount, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(sourceID) == "" || window <= 0 {
		return nil, fmt.Errorf("%w: source and positive window are required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.sources[sourceID]; !ok {
		return nil, ErrNotFound
	}
	out := make([]emailIngressRateCount, 0, len(observations))
	for _, observation := range observations {
		key := sourceID + "\x00" + observation.DimensionKey
		state := s.emailIngressWindows[key]
		if state.WindowStarted.IsZero() || !state.WindowStarted.After(now.Add(-window)) {
			state = emailIngressRateWindow{SourceID: sourceID, DimensionKey: observation.DimensionKey, DimensionType: observation.DimensionType, WindowStarted: now.UTC()}
		}
		state.Count += observation.Count
		state.UpdatedAt = now.UTC()
		s.emailIngressWindows[key] = state
		out = append(out, emailIngressRateCount{DimensionType: state.DimensionType, DimensionKey: state.DimensionKey, Count: state.Count})
	}
	return out, nil
}
