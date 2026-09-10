package platform

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	defaultAIBaseURL = "https://api.deepseek.com/chat/completions"
	defaultAIModel   = "deepseek-v4-flash"
)

var defaultAIModels = []string{"deepseek-v4-flash", "deepseek-v4-pro"}

type aiSettingsRequest struct {
	Enabled  bool     `json:"enabled"`
	BaseURL  string   `json:"baseUrl"`
	Model    string   `json:"model"`
	Models   []string `json:"models"`
	Thinking bool     `json:"thinking"`
	APIKey   string   `json:"apiKey"`
}

type resolvedAIConfig struct {
	Enabled  bool
	BaseURL  string
	Model    string
	Thinking bool
	APIKey   string
}

func (s *Server) handleAIModelsSync(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionAIManage); !ok {
		return
	}
	var input aiSettingsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	config, err := s.resolveAIConfig(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if value := strings.TrimSpace(input.BaseURL); value != "" {
		config.BaseURL = value
	}
	if value := strings.TrimSpace(input.APIKey); value != "" {
		config.APIKey = value
	}
	if config.APIKey == "" {
		writeError(w, fmt.Errorf("%w: 请填写 API Key 或先保存密钥", ErrInvalid))
		return
	}
	models, err := fetchAIModels(r.Context(), config)
	if err != nil {
		writeJSONResponse(w, http.StatusBadGateway, map[string]any{"error": err.Error()})
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"models": models})
}

func (s *Server) handleAISettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionAIManage); !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := s.publicAISettings(r.Context())
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	case http.MethodPut:
		var input aiSettingsRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		settings, err := s.saveAISettings(r.Context(), input)
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleAISettingsTest(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionAIManage); !ok {
		return
	}
	var input aiSettingsRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	config, err := s.resolveAIConfig(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	if value := strings.TrimSpace(input.BaseURL); value != "" {
		config.BaseURL = value
	}
	if value := strings.TrimSpace(input.Model); value != "" {
		config.Model = value
	}
	config.Thinking = input.Thinking
	if value := strings.TrimSpace(input.APIKey); value != "" {
		config.APIKey = value
	}
	if config.APIKey == "" {
		writeError(w, fmt.Errorf("%w: 请填写 API Key 或先保存密钥", ErrInvalid))
		return
	}
	if _, err := callAIWithConfig(r.Context(), config, "Reply with exactly: OK"); err != nil {
		writeJSONResponse(w, http.StatusBadGateway, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"ok": true, "message": "DeepSeek 连接正常"})
}

func (s *Server) publicAISettings(ctx context.Context) (AISettings, error) {
	settings, err := s.store.GetAISettings(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return AISettings{}, err
	}
	if errors.Is(err, ErrNotFound) {
		settings = AISettings{
			Enabled: true,
			BaseURL: defaultString(strings.TrimSpace(os.Getenv("AI_BASE_URL")), defaultAIBaseURL),
			Model:   defaultString(strings.TrimSpace(os.Getenv("AI_MODEL")), defaultAIModel),
		}
	}
	if len(settings.Models) == 0 {
		settings.Models = append([]string(nil), defaultAIModels...)
	}
	settings.Models = normalizeAIModels(settings.Models, settings.Model)
	settings.EncryptionOK = strings.TrimSpace(os.Getenv("AI_SETTINGS_ENCRYPTION_KEY")) != ""
	settings.HasAPIKey = settings.EncryptedKey != "" || firstEnv("AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY") != ""
	if settings.EncryptedKey != "" {
		settings.KeySource = "saved"
	} else if settings.HasAPIKey {
		settings.KeySource = "environment"
	} else {
		settings.KeySource = "none"
	}
	settings.EncryptedKey = ""
	return settings, nil
}

func (s *Server) saveAISettings(ctx context.Context, input aiSettingsRequest) (AISettings, error) {
	baseURL := strings.TrimSpace(input.BaseURL)
	model := strings.TrimSpace(input.Model)
	if baseURL == "" || model == "" {
		return AISettings{}, fmt.Errorf("%w: API 地址和模型不能为空", ErrInvalid)
	}
	current, err := s.store.GetAISettings(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return AISettings{}, err
	}
	if errors.Is(err, ErrNotFound) {
		current = AISettings{}
	}
	current.Enabled = input.Enabled
	current.BaseURL = baseURL
	current.Model = model
	current.Models = normalizeAIModels(input.Models, model)
	current.Thinking = input.Thinking
	if apiKey := strings.TrimSpace(input.APIKey); apiKey != "" {
		current.EncryptedKey, err = encryptAIKey(apiKey)
		if err != nil {
			return AISettings{}, err
		}
	}
	if _, err := s.store.SaveAISettings(ctx, current); err != nil {
		return AISettings{}, err
	}
	return s.publicAISettings(ctx)
}

func fetchAIModels(ctx context.Context, config resolvedAIConfig) ([]string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, aiModelsURL(config.BaseURL), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Authorization", "Bearer "+config.APIKey)
	response, err := (&http.Client{Timeout: 20 * time.Second}).Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("AI model service returned %d", response.StatusCode)
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		models = append(models, item.ID)
	}
	models = normalizeAIModels(models, "")
	if len(models) == 0 {
		return nil, fmt.Errorf("AI model service returned no models")
	}
	return models, nil
}

func aiModelsURL(baseURL string) string {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return strings.TrimRight(baseURL, "/") + "/models"
	}
	path := strings.TrimRight(parsed.Path, "/")
	for _, suffix := range []string{"/chat/completions", "/completions"} {
		if strings.HasSuffix(path, suffix) {
			path = strings.TrimSuffix(path, suffix)
			break
		}
	}
	parsed.Path = strings.TrimRight(path, "/") + "/models"
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func normalizeAIModels(values []string, selected string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range append(values, selected) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

func (s *Server) resolveAIConfig(ctx context.Context) (resolvedAIConfig, error) {
	settings, err := s.store.GetAISettings(ctx)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return resolvedAIConfig{}, err
	}
	config := resolvedAIConfig{
		Enabled: true,
		BaseURL: defaultString(strings.TrimSpace(os.Getenv("AI_BASE_URL")), defaultAIBaseURL),
		Model:   defaultString(strings.TrimSpace(os.Getenv("AI_MODEL")), defaultAIModel),
		APIKey:  firstEnv("AI_API_KEY", "DEEPSEEK_API_KEY", "OPENAI_API_KEY"),
	}
	if err == nil {
		config.Enabled = settings.Enabled
		config.BaseURL = defaultString(settings.BaseURL, config.BaseURL)
		config.Model = defaultString(settings.Model, config.Model)
		config.Thinking = settings.Thinking
		if settings.EncryptedKey != "" {
			key, decryptErr := decryptAIKey(settings.EncryptedKey)
			if decryptErr != nil {
				return resolvedAIConfig{}, decryptErr
			}
			config.APIKey = key
		}
	}
	return config, nil
}

func encryptAIKey(value string) (string, error) {
	aead, err := aiKeyCipher()
	if err != nil {
		return "", err
	}
	nonce := make([]byte, aead.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := aead.Seal(nonce, nonce, []byte(value), nil)
	return base64.RawStdEncoding.EncodeToString(sealed), nil
}

func decryptAIKey(value string) (string, error) {
	aead, err := aiKeyCipher()
	if err != nil {
		return "", err
	}
	raw, err := base64.RawStdEncoding.DecodeString(value)
	if err != nil || len(raw) < aead.NonceSize() {
		return "", fmt.Errorf("%w: AI 密钥数据无效", ErrInvalid)
	}
	plain, err := aead.Open(nil, raw[:aead.NonceSize()], raw[aead.NonceSize():], nil)
	if err != nil {
		return "", fmt.Errorf("%w: 无法解密 AI 密钥，请检查 AI_SETTINGS_ENCRYPTION_KEY", ErrInvalid)
	}
	return string(plain), nil
}

func aiKeyCipher() (cipher.AEAD, error) {
	secret := strings.TrimSpace(os.Getenv("AI_SETTINGS_ENCRYPTION_KEY"))
	if secret == "" {
		return nil, fmt.Errorf("%w: 服务器未配置 AI_SETTINGS_ENCRYPTION_KEY，不能安全保存 API Key", ErrInvalid)
	}
	key := sha256.Sum256([]byte(secret))
	block, err := aes.NewCipher(key[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}
