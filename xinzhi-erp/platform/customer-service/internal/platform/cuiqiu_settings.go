package platform

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type cuiqiuDomainSettingsRequest struct {
	Domain   string `json:"domain"`
	APIBase  string `json:"apiBase"`
	Token    string `json:"token"`
	DomainID string `json:"domainId"`
	SMTPHost string `json:"smtpHost"`
	SMTPPort int    `json:"smtpPort"`
	SMTPMode string `json:"smtpMode"`
}

type cuiqiuDomainTestRequest struct {
	Domain string `json:"domain"`
}

func (s *Server) handleCuiqiuDomainSettings(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionEmailProvidersManage); !ok {
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := s.publicCuiqiuDomainSettings(r.Context(), requestBaseURL(r))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	case http.MethodPut:
		var input cuiqiuDomainSettingsRequest
		if !decodeJSON(w, r, &input) {
			return
		}
		settings, err := s.saveCuiqiuDomainSettings(r.Context(), input, requestBaseURL(r))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, settings)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleCuiqiuDomainSettingsTest(w http.ResponseWriter, r *http.Request) {
	if _, ok := s.requirePermission(w, r, PermissionEmailProvidersManage); !ok {
		return
	}
	var input cuiqiuDomainTestRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	settings, token, err := s.resolveCuiqiuDomainSettings(r.Context(), input.Domain)
	if err != nil {
		writeError(w, err)
		return
	}
	testErr := testCuiqiuDomainReceiveAPI(r.Context(), settings, token)
	settings.LastTestedAt = time.Now().UTC()
	settings.LastTestOK = testErr == nil
	settings.LastTestError = ""
	if testErr != nil {
		settings.LastTestError = "脆球收件 API 验证失败；实际错误：" + testErr.Error()
	}
	_, _ = s.store.SaveCuiqiuDomainSettings(r.Context(), settings)
	if testErr != nil {
		writeJSONResponse(w, http.StatusBadGateway, map[string]any{"ok": false, "error": settings.LastTestError})
		return
	}
	writeJSONResponse(w, http.StatusOK, map[string]any{"ok": true, "message": "脆球接收 API 连接正常"})
}

func testCuiqiuDomainReceiveAPI(ctx context.Context, settings CuiqiuDomainSettings, token string) error {
	config := cuiqiuConfig{APIBase: settings.APIBase, Token: token, DomainID: settings.DomainID}
	fields := map[string]string{"limit": strconv.Itoa(cuiqiuMessagePageSize), "sort_value": "created_at", "sort_type": "desc"}
	if settings.DomainID != "" {
		fields["domain_id"] = settings.DomainID
	}
	var mailboxes cuiqiuMailListData
	if err := postCuiqiu(ctx, config, "/v2/mail/list", fields, &mailboxes); err != nil {
		return err
	}
	if len(mailboxes.List) == 0 || strings.TrimSpace(mailboxes.List[0].ID) == "" {
		return errors.New("Cuiqiu API returned no mailbox for receive validation")
	}
	config.MailID = strings.TrimSpace(mailboxes.List[0].ID)
	return verifyCuiqiuReceiveConnection(ctx, config)
}

func (s *Server) publicCuiqiuDomainSettings(ctx context.Context, baseURL string) ([]CuiqiuDomainSettings, error) {
	settings, err := s.store.ListCuiqiuDomainSettings(ctx)
	if err != nil {
		return nil, err
	}
	for index := range settings {
		settings[index] = publicCuiqiuDomainSetting(settings[index], baseURL)
	}
	return settings, nil
}

func publicCuiqiuDomainSetting(settings CuiqiuDomainSettings, baseURL string) CuiqiuDomainSettings {
	settings.HasToken = settings.EncryptedToken != ""
	settings.EncryptionOK = strings.TrimSpace(os.Getenv("AI_SETTINGS_ENCRYPTION_KEY")) != ""
	if settings.HasToken {
		if token, err := decryptAIKey(settings.EncryptedToken); err == nil {
			settings.WebhookURL = cuiqiuDomainWebhookURL(baseURL, settings.Domain, token)
		}
	}
	settings.EncryptedToken = ""
	return settings
}

func (s *Server) saveCuiqiuDomainSettings(ctx context.Context, input cuiqiuDomainSettingsRequest, baseURL string) (CuiqiuDomainSettings, error) {
	domain := normalizeEmailDomain(input.Domain)
	current, err := s.store.GetCuiqiuDomainSettings(ctx, domain)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return CuiqiuDomainSettings{}, err
	}
	if errors.Is(err, ErrNotFound) {
		current = CuiqiuDomainSettings{Domain: domain}
	}
	current.APIBase = input.APIBase
	current.DomainID = input.DomainID
	current.SMTPHost = input.SMTPHost
	current.SMTPPort = input.SMTPPort
	current.SMTPMode = input.SMTPMode
	if token := strings.TrimSpace(input.Token); token != "" {
		previousToken := ""
		if current.EncryptedToken != "" {
			previousToken, _ = decryptAIKey(current.EncryptedToken)
		}
		current.EncryptedToken, err = encryptAIKey(token)
		if err != nil {
			return CuiqiuDomainSettings{}, err
		}
		if previousToken != token {
			current.WebhookVerifiedAt = time.Time{}
		}
	}
	current, err = normalizeCuiqiuDomainSettingsRecord(current)
	if err != nil {
		return CuiqiuDomainSettings{}, err
	}
	if current.EncryptedToken == "" {
		return CuiqiuDomainSettings{}, fmt.Errorf("%w: 请填写 Open API Token", ErrInvalid)
	}
	saved, err := s.store.SaveCuiqiuDomainSettings(ctx, current)
	if err != nil {
		return CuiqiuDomainSettings{}, err
	}
	token, err := decryptAIKey(saved.EncryptedToken)
	if err != nil {
		return CuiqiuDomainSettings{}, err
	}
	s.propagateCuiqiuDomainSettings(ctx, saved, token)
	return publicCuiqiuDomainSetting(saved, baseURL), nil
}

func (s *Server) resolveCuiqiuDomainSettings(ctx context.Context, domain string) (CuiqiuDomainSettings, string, error) {
	domain = normalizeEmailDomain(domain)
	settings, err := s.store.GetCuiqiuDomainSettings(ctx, domain)
	if errors.Is(err, ErrNotFound) {
		return CuiqiuDomainSettings{}, "", fmt.Errorf("%w: 尚未配置 @%s 的脆球邮箱服务，请联系管理员先在“邮箱服务”中完成配置", ErrInvalid, domain)
	}
	if err != nil {
		return CuiqiuDomainSettings{}, "", err
	}
	token, err := decryptAIKey(settings.EncryptedToken)
	if err != nil {
		return CuiqiuDomainSettings{}, "", err
	}
	return settings, token, nil
}

func normalizeCuiqiuDomainSettingsRecord(input CuiqiuDomainSettings) (CuiqiuDomainSettings, error) {
	input.Domain = normalizeEmailDomain(input.Domain)
	input.APIBase = strings.TrimRight(strings.TrimSpace(input.APIBase), "/")
	input.DomainID = strings.TrimSpace(input.DomainID)
	input.SMTPHost = strings.ToLower(strings.TrimSpace(input.SMTPHost))
	input.SMTPMode = strings.ToLower(strings.TrimSpace(input.SMTPMode))
	if !validEmailDomain(input.Domain) {
		return CuiqiuDomainSettings{}, fmt.Errorf("%w: 请输入有效的邮箱域名，例如 fastmo.cn", ErrInvalid)
	}
	parsed, err := url.Parse(input.APIBase)
	if err != nil || !strings.EqualFold(parsed.Scheme, "https") || parsed.Hostname() == "" || parsed.User != nil {
		return CuiqiuDomainSettings{}, fmt.Errorf("%w: Open API 地址必须是有效的 HTTPS 地址", ErrInvalid)
	}
	if input.SMTPHost == "" || strings.Contains(input.SMTPHost, "://") {
		return CuiqiuDomainSettings{}, fmt.Errorf("%w: SMTP 主机不能为空，且不要包含协议", ErrInvalid)
	}
	if input.SMTPMode == "" {
		input.SMTPMode = "tls"
	}
	if input.SMTPMode != "tls" && input.SMTPMode != "starttls" {
		return CuiqiuDomainSettings{}, fmt.Errorf("%w: SMTP 加密方式只能是 TLS 或 STARTTLS", ErrInvalid)
	}
	if input.SMTPPort == 0 {
		if input.SMTPMode == "starttls" {
			input.SMTPPort = 587
		} else {
			input.SMTPPort = 465
		}
	}
	if input.SMTPPort < 1 || input.SMTPPort > 65535 {
		return CuiqiuDomainSettings{}, fmt.Errorf("%w: SMTP 端口无效", ErrInvalid)
	}
	return input, nil
}

func normalizeEmailDomain(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.TrimPrefix(value, "@")
	if index := strings.LastIndex(value, "@"); index >= 0 {
		value = value[index+1:]
	}
	return strings.TrimSuffix(value, ".")
}

func validEmailDomain(value string) bool {
	if value == "" || len(value) > 253 || !strings.Contains(value, ".") {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func emailDomain(mailbox string) string {
	return normalizeEmailDomain(mailbox)
}

func applyCuiqiuDomainSettings(metadata map[string]string, settings CuiqiuDomainSettings) map[string]string {
	metadata = cloneStringMap(metadata)
	metadata[cuiqiuAPIBaseKey] = settings.APIBase
	metadata[cuiqiuDomainIDKey] = settings.DomainID
	metadata[cuiqiuSMTPHostKey] = settings.SMTPHost
	metadata[cuiqiuSMTPPortKey] = strconv.Itoa(settings.SMTPPort)
	metadata[cuiqiuSMTPModeKey] = settings.SMTPMode
	metadata[cuiqiuProfileDomainKey] = settings.Domain
	return metadata
}

func (s *Server) propagateCuiqiuDomainSettings(ctx context.Context, settings CuiqiuDomainSettings, token string) {
	sources, err := s.store.ListShopSources(ctx, "")
	if err != nil {
		return
	}
	for _, source := range sources {
		if source.Type != SourceTypeEmail || !strings.EqualFold(source.Provider, cuiqiuProvider) || emailDomain(sourceEmailAddress(source)) != settings.Domain {
			continue
		}
		_, _ = s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
			return applyCuiqiuDomainSettings(metadata, settings)
		})
		installation, installErr := s.store.GetEmailInstallation(ctx, source.ShopID, sourceEmailAddress(source))
		if installErr != nil {
			continue
		}
		installation.AccessToken = token
		_, _ = s.store.SaveEmailInstallation(ctx, installation)
	}
}
