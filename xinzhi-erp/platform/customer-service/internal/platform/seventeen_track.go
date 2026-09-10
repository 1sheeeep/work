package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const seventeenTrackCacheNamespace = "17track_tracking"
const seventeenTrackSnapshotTTL = 90 * 24 * time.Hour
const seventeenTrackPendingTTL = time.Hour

type seventeenTrackService struct {
	server      *Server
	client      *http.Client
	mu          sync.Mutex
	lastRequest time.Time
}

func (s *Server) seventeenTrack() *seventeenTrackService {
	if tracker, ok := s.logisticsTracker.(*seventeenTrackService); ok && tracker != nil {
		return tracker
	}
	tracker := &seventeenTrackService{server: s, client: &http.Client{Timeout: 35 * time.Second}}
	s.logisticsTracker = tracker
	return tracker
}

func (t *seventeenTrackService) Provider() string { return "17TRACK" }

func (t *seventeenTrackService) Track(ctx context.Context, input LogisticsTrackingRequest) (LogisticsTrackingResult, error) {
	number := strings.TrimSpace(input.TrackingNumber)
	if number == "" {
		return LogisticsTrackingResult{}, fmt.Errorf("%w: tracking number is required", ErrInvalid)
	}
	if cached, ok := t.cached(ctx, number); ok {
		return cached, nil
	}
	config, err := t.server.resolveLogisticsConfig(ctx)
	if err != nil {
		return LogisticsTrackingResult{}, err
	}
	if !config.Enabled || config.APIKey == "" {
		return LogisticsTrackingResult{Configured: false, TrackingNumber: number, Events: []LogisticsTrackingEvent{}}, nil
	}
	value, err, _ := t.server.logisticsTrackingRun.Do(strings.ToLower(number), func() (any, error) {
		if cached, ok := t.cached(ctx, number); ok {
			return cached, nil
		}
		return t.lookupOrRegister(ctx, config, number, input.Carrier)
	})
	if err != nil {
		return LogisticsTrackingResult{}, err
	}
	return value.(LogisticsTrackingResult), nil
}

func seventeenTrackRequest(number, carrier string) map[string]any {
	item := map[string]any{"number": strings.TrimSpace(number)}
	if code, err := strconv.Atoi(strings.TrimSpace(carrier)); err == nil && code > 0 {
		item["carrier"] = code
	}
	return item
}

func (t *seventeenTrackService) test(ctx context.Context, config resolvedLogisticsConfig) error {
	raw, err := t.call(ctx, config, "/getquota", []any{})
	if err != nil {
		return err
	}
	var payload map[string]any
	if json.Unmarshal(raw, &payload) != nil || intValue(payload["code"]) != 0 {
		return fmt.Errorf("17TRACK connection test failed")
	}
	return nil
}

func (t *seventeenTrackService) call(ctx context.Context, config resolvedLogisticsConfig, path string, payload any) ([]byte, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	t.mu.Lock()
	wait := 350*time.Millisecond - time.Since(t.lastRequest)
	if wait > 0 {
		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			t.mu.Unlock()
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
	t.lastRequest = time.Now()
	t.mu.Unlock()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(config.BaseURL, "/")+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("17token", config.APIKey)
	response, err := t.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if err != nil {
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("17TRACK returned HTTP %d", response.StatusCode)
	}
	var envelope map[string]any
	if json.Unmarshal(raw, &envelope) != nil || intValue(envelope["code"]) != 0 {
		return nil, fmt.Errorf("17TRACK rejected the request")
	}
	return raw, nil
}

func (t *seventeenTrackService) cached(ctx context.Context, number string) (LogisticsTrackingResult, bool) {
	var result LogisticsTrackingResult
	ok := t.server.loadExternalCache(ctx, externalCacheKey(seventeenTrackCacheNamespace, "", number), &result)
	if ok {
		normalizeSeventeenTrackResult(&result)
	}
	return result, ok
}

func (t *seventeenTrackService) save(ctx context.Context, result LogisticsTrackingResult) {
	result.Configured = true
	result.Provider = t.Provider()
	normalizeSeventeenTrackResult(&result)
	ttl := seventeenTrackSnapshotTTL
	if strings.EqualFold(strings.TrimSpace(result.Status), "pending") && len(result.Events) == 0 {
		ttl = seventeenTrackPendingTTL
	}
	t.server.saveExternalCache(ctx, seventeenTrackCacheNamespace, "", externalCacheKey(seventeenTrackCacheNamespace, "", result.TrackingNumber), result, ttl)
}

func (t *seventeenTrackService) lookupOrRegister(ctx context.Context, config resolvedLogisticsConfig, number string, carrier string) (LogisticsTrackingResult, error) {
	payload := []map[string]any{seventeenTrackRequest(number, carrier)}
	raw, lookupErr := t.call(ctx, config, "/gettrackinfo", payload)
	if lookupErr == nil {
		if result, ok := parseSeventeenTrackResult(raw, number, carrier); ok {
			t.save(ctx, result)
			return result, nil
		}
	}

	_, registerErr := t.call(ctx, config, "/register", payload)
	raw, followupErr := t.call(ctx, config, "/gettrackinfo", payload)
	if followupErr == nil {
		if result, ok := parseSeventeenTrackResult(raw, number, carrier); ok {
			t.save(ctx, result)
			return result, nil
		}
	}
	if registerErr != nil && lookupErr != nil && followupErr != nil {
		return LogisticsTrackingResult{}, fmt.Errorf("logistics lookup temporarily unavailable")
	}
	result := LogisticsTrackingResult{
		Configured:     true,
		Provider:       t.Provider(),
		Carrier:        strings.TrimSpace(carrier),
		TrackingNumber: number,
		Status:         "pending",
		Message:        "Logistics information is syncing",
		UpdatedAt:      time.Now().UTC().Format(time.RFC3339),
		Events:         []LogisticsTrackingEvent{},
	}
	t.save(ctx, result)
	return result, nil
}

func normalizeSeventeenTrackResult(result *LogisticsTrackingResult) {
	if result == nil {
		return
	}
	result.Events = dedupeEvents(result.Events)
	if len(result.Events) > 0 {
		if result.Message == "" {
			result.Message = firstNonEmpty(result.Events[0].Description, result.Events[0].Status)
		}
		if result.UpdatedAt == "" {
			result.UpdatedAt = result.Events[0].Time
		}
	}
	if result.Events == nil {
		result.Events = []LogisticsTrackingEvent{}
	}
	if result.UpdatedAt == "" {
		result.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
}

func parseSeventeenTrackResult(raw []byte, fallbackNumber, fallbackCarrier string) (LogisticsTrackingResult, bool) {
	var root any
	if json.Unmarshal(raw, &root) != nil {
		return LogisticsTrackingResult{}, false
	}
	objects := collectMaps(root)
	var selected map[string]any
	for _, object := range objects {
		number := stringValue(object, "number", "tracking_number", "trackingNumber")
		if number != "" && (fallbackNumber == "" || strings.EqualFold(number, fallbackNumber)) && hasTrackInfo(object) {
			selected = object
			break
		}
	}
	if selected == nil {
		return LogisticsTrackingResult{}, false
	}
	trackInfo := mapValue(selected, "track_info", "trackInfo")
	if trackInfo == nil {
		trackInfo = selected
	}
	result := LogisticsTrackingResult{Configured: true, Provider: "17TRACK", Carrier: firstNonEmpty(stringValue(selected, "carrier", "carrier_code", "carrierCode"), fallbackCarrier), TrackingNumber: firstNonEmpty(stringValue(selected, "number", "tracking_number", "trackingNumber"), fallbackNumber), Events: []LogisticsTrackingEvent{}}
	latestStatus := mapValue(trackInfo, "latest_status", "latestStatus")
	result.Status = firstNonEmpty(stringValue(latestStatus, "status", "sub_status", "subStatus"), stringValue(trackInfo, "status"))
	latestEvent := mapValue(trackInfo, "latest_event", "latestEvent")
	if latestEvent != nil {
		result.Events = append(result.Events, logisticsEvent(latestEvent))
	}
	for _, object := range collectMaps(valueFor(trackInfo, "tracking", "providers", "events")) {
		if looksLikeEvent(object) {
			result.Events = append(result.Events, logisticsEvent(object))
		}
	}
	normalizeSeventeenTrackResult(&result)
	return result, result.TrackingNumber != ""
}

func (s *Server) handleSeventeenTrackWebhook(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	config, err := s.resolveLogisticsConfig(r.Context())
	if err != nil || config.APIKey == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 4<<20))
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	signature := firstNonEmpty(r.Header.Get("sign"), r.Header.Get("17sign"), r.Header.Get("17-signature"), r.Header.Get("X-17Track-Signature"))
	signed := make([]byte, 0, len(raw)+1+len(config.APIKey))
	signed = append(signed, raw...)
	signed = append(signed, '/')
	signed = append(signed, config.APIKey...)
	expectedSum := sha256.Sum256(signed)
	expected := hex.EncodeToString(expectedSum[:])
	if signature == "" || subtle.ConstantTimeCompare([]byte(strings.ToLower(strings.TrimSpace(signature))), []byte(expected)) != 1 {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	for _, object := range collectMaps(jsonValue(raw)) {
		number := stringValue(object, "number", "tracking_number", "trackingNumber")
		if number == "" || !hasTrackInfo(object) {
			continue
		}
		item, ok := parseSeventeenTrackResult(mustJSON(object), number, "")
		if ok {
			s.seventeenTrack().save(r.Context(), item)
		}
	}
	w.WriteHeader(http.StatusOK)
}

func jsonValue(raw []byte) any  { var value any; _ = json.Unmarshal(raw, &value); return value }
func mustJSON(value any) []byte { raw, _ := json.Marshal(value); return raw }
func intValue(value any) int {
	switch v := value.(type) {
	case float64:
		return int(v)
	case json.Number:
		n, _ := v.Int64()
		return int(n)
	case int:
		return v
	}
	return -1
}
func valueFor(m map[string]any, keys ...string) any {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return nil
}
func mapValue(m map[string]any, keys ...string) map[string]any {
	if m == nil {
		return nil
	}
	for _, key := range keys {
		if v, ok := m[key].(map[string]any); ok {
			return v
		}
	}
	return nil
}
func stringValue(m map[string]any, keys ...string) string {
	if m == nil {
		return ""
	}
	for _, key := range keys {
		if v, ok := m[key]; ok {
			if s, ok := v.(string); ok {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}
func collectMaps(value any) []map[string]any {
	out := []map[string]any{}
	var walk func(any)
	walk = func(v any) {
		switch item := v.(type) {
		case map[string]any:
			out = append(out, item)
			for _, child := range item {
				walk(child)
			}
		case []any:
			for _, child := range item {
				walk(child)
			}
		}
	}
	walk(value)
	return out
}
func hasTrackInfo(m map[string]any) bool {
	return mapValue(m, "track_info", "trackInfo") != nil || valueFor(m, "latest_event", "latestEvent", "providers", "events") != nil
}
func looksLikeEvent(m map[string]any) bool {
	return stringValue(m, "time_iso", "timeIso", "time", "date", "description", "description_translation", "location") != ""
}
func logisticsEvent(m map[string]any) LogisticsTrackingEvent {
	return LogisticsTrackingEvent{Time: firstNonEmpty(stringValue(m, "time_iso", "timeIso", "time", "date"), stringValue(m, "time_utc", "timeUtc")), Status: stringValue(m, "stage", "status", "sub_status", "subStatus"), Description: firstNonEmpty(stringValue(m, "description_translation", "descriptionTranslation"), stringValue(m, "description")), Location: stringValue(m, "location", "address")}
}
func dedupeEvents(events []LogisticsTrackingEvent) []LogisticsTrackingEvent {
	seen := map[string]bool{}
	out := make([]LogisticsTrackingEvent, 0, len(events))
	for _, event := range events {
		if strings.TrimSpace(event.Status) == "" && strings.TrimSpace(event.Description) == "" && strings.TrimSpace(event.Location) == "" {
			continue
		}
		key := event.Time + "|" + event.Status + "|" + event.Description + "|" + event.Location
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, event)
	}
	sort.SliceStable(out, func(i, j int) bool {
		left, leftOK := parseLogisticsEventTime(out[i].Time)
		right, rightOK := parseLogisticsEventTime(out[j].Time)
		if leftOK && rightOK && !left.Equal(right) {
			return left.After(right)
		}
		if leftOK != rightOK {
			return leftOK
		}
		return out[i].Time > out[j].Time
	})
	return out
}

var _ LogisticsTracker = (*seventeenTrackService)(nil)
