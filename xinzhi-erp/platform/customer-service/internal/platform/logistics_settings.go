package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

const defaultLogisticsBaseURL = "https://api.17track.net/track/v2.4"
const defaultLogisticsReplyCooldownHours = 24

type logisticsSettingsRequest struct {
	Enabled            bool   `json:"enabled"`
	APIKey             string `json:"apiKey"`
	AutoDraftEnabled   bool   `json:"autoDraftEnabled"`
	AutoSendEnabled    bool   `json:"autoSendEnabled"`
	ChatEnabled        bool   `json:"chatEnabled"`
	GmailEnabled       bool   `json:"gmailEnabled"`
	OutlookEnabled     bool   `json:"outlookEnabled"`
	ReplyCooldownHours int    `json:"replyCooldownHours"`
}

type resolvedLogisticsConfig struct {
	Enabled bool
	BaseURL string
	APIKey  string
}

func (s *Server) handleLogisticsSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionLogisticsManage); !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := s.publicLogisticsSettings(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	case http.MethodPut:
		var input logisticsSettingsRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		settings, err := s.saveLogisticsSettings(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleLogisticsSettingsTest(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionLogisticsManage); !ok {
		return
	}
	var input logisticsSettingsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	config, err := s.resolveLogisticsConfig(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if value := strings.TrimSpace(input.APIKey); value != "" {
		config.APIKey = value
	}
	if config.APIKey == "" {
		writeError(w, fmt.Errorf("%w: 请填写 API Key 或先保存配置", ErrInvalid))
		return
	}
	err = s.seventeenTrack().test(r.Context(), config)
	s.recordLogisticsTest(r.Context(), err)
	if err != nil {
		writeJSONResponse(w, http.StatusBadGateway, map[string]any{"ok": false, "error": "17TRACK 连接失败，请检查 API Key 和网络"})
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"ok": true, "message": "17TRACK 连接正常"})
}

func (s *Server) publicLogisticsSettings(ctx context.Context) (LogisticsSettings, error) {
	settings, err := s.store.GetLogisticsSettings(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return LogisticsSettings{}, err
	}
	if errors.Is(err, ErrNotFound) {
		settings = defaultLogisticsSettings()
	}
	settings.BaseURL = logisticsBaseURL()
	settings.ReplyCooldownHours = normalizeLogisticsReplyCooldown(settings.ReplyCooldownHours)
	settings.HasAPIKey = settings.EncryptedKey != "" || strings.TrimSpace(os.Getenv("SEVENTEENTRACK_API_KEY")) != ""
	settings.EncryptionOK = strings.TrimSpace(os.Getenv("AI_SETTINGS_ENCRYPTION_KEY")) != ""
	settings.WebhookURL = strings.TrimRight(strings.TrimSpace(os.Getenv("PUBLIC_BASE_URL")), "/") + "/webhooks/17track"
	if strings.HasPrefix(settings.WebhookURL, "/") {
		settings.WebhookURL = ""
	}
	settings.EncryptedKey = ""
	return settings, nil
}

func (s *Server) saveLogisticsSettings(ctx context.Context, input logisticsSettingsRequest) (LogisticsSettings, error) {
	current, err := s.store.GetLogisticsSettings(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return LogisticsSettings{}, err
	}
	if errors.Is(err, ErrNotFound) {
		current = defaultLogisticsSettings()
	}
	current.Enabled = input.Enabled
	current.BaseURL = logisticsBaseURL()
	current.AutoDraftEnabled = input.AutoDraftEnabled
	current.AutoSendEnabled = input.AutoDraftEnabled && input.AutoSendEnabled
	current.ChatEnabled = input.ChatEnabled
	current.GmailEnabled = input.GmailEnabled
	current.OutlookEnabled = input.OutlookEnabled
	current.ReplyCooldownHours = normalizeLogisticsReplyCooldown(input.ReplyCooldownHours)
	if key := strings.TrimSpace(input.APIKey); key != "" {
		current.EncryptedKey, err = encryptAIKey(key)
		if err != nil {
			return LogisticsSettings{}, err
		}
	}
	if input.Enabled && current.EncryptedKey == "" && strings.TrimSpace(os.Getenv("SEVENTEENTRACK_API_KEY")) == "" {
		return LogisticsSettings{}, fmt.Errorf("%w: 启用物流查询前请填写 API Key", ErrInvalid)
	}
	if _, err := s.store.SaveLogisticsSettings(ctx, current); err != nil {
		return LogisticsSettings{}, err
	}
	return s.publicLogisticsSettings(ctx)
}

func (s *Server) resolveLogisticsConfig(ctx context.Context) (resolvedLogisticsConfig, error) {
	config := resolvedLogisticsConfig{BaseURL: logisticsBaseURL(), APIKey: strings.TrimSpace(os.Getenv("SEVENTEENTRACK_API_KEY"))}
	settings, err := s.store.GetLogisticsSettings(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return resolvedLogisticsConfig{}, err
	}
	if err == nil {
		config.Enabled = settings.Enabled
		if settings.EncryptedKey != "" {
			key, decryptErr := decryptAIKey(settings.EncryptedKey)
			if decryptErr != nil {
				return resolvedLogisticsConfig{}, decryptErr
			}
			config.APIKey = key
		}
	}
	return config, nil
}

func (s *Server) recordLogisticsTest(ctx context.Context, testErr error) {
	settings, err := s.store.GetLogisticsSettings(ctx)
	if err != nil {
		return
	}
	settings.LastTestedAt = time.Now().UTC()
	settings.LastTestOK = testErr == nil
	settings.LastTestError = ""
	if testErr != nil {
		settings.LastTestError = "连接失败"
	}
	_, _ = s.store.SaveLogisticsSettings(ctx, settings)
}

func logisticsBaseURL() string {
	return strings.TrimRight(defaultString(strings.TrimSpace(os.Getenv("SEVENTEENTRACK_BASE_URL")), defaultLogisticsBaseURL), "/")
}

func defaultLogisticsSettings() LogisticsSettings {
	return LogisticsSettings{
		BaseURL:            logisticsBaseURL(),
		AutoDraftEnabled:   true,
		ChatEnabled:        true,
		GmailEnabled:       true,
		OutlookEnabled:     true,
		ReplyCooldownHours: defaultLogisticsReplyCooldownHours,
	}
}

func normalizeLogisticsReplyCooldown(hours int) int {
	if hours < 1 || hours > 168 {
		return defaultLogisticsReplyCooldownHours
	}
	return hours
}
