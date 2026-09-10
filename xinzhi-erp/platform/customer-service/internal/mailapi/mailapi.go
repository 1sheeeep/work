package mailapi

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"shopify-support-platform/internal/appcore"
	"shopify-support-platform/internal/offlinehttp"
)

const (
	providerOutlook = "outlook"
	providerGmail   = "gmail"
	providerCuiqiu  = "cuiqiu"
	tokenEndpoint   = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
	authEndpoint    = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
	graphBaseURL    = "https://graph.microsoft.com/v1.0"
	defaultScope    = "offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send"
	ipCheckURL      = "https://api.ipify.org?format=json"
)

type Provider interface {
	AuthorizationURL(settings appcore.Settings, shop appcore.Shop) (appcore.Settings, appcore.MailAuthStartResult, error)
	CompleteAuthorization(ctx context.Context, settings appcore.Settings, codeOrURL string) (appcore.Settings, appcore.MailProxyTestResult, error)
	ReadMessages(ctx context.Context, settings appcore.Settings, shop appcore.Shop, options map[string]any) (appcore.Settings, appcore.InboxResult, error)
}

type OutlookGraphProvider struct{}

type networkConfig struct {
	Mode        string
	ProxyURL    string
	ProxySource string
	ExpectedIP  string
}

type microsoftErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

func SyncAdapterProxyBindings(settings appcore.Settings, shops []appcore.Shop) (appcore.Settings, []appcore.Shop) {
	settings.Mail = cloneMap(settings.Mail)
	for _, shop := range shops {
		binding := ensureBinding(&settings, shop)
		network := resolveNetwork(settings, shop, binding)
		applyNetwork(binding, network)
	}
	return settings, AnnotateShops(settings, shops)
}

func AutoTestProxyBindings(ctx context.Context, settings appcore.Settings, shops []appcore.Shop) appcore.Settings {
	settings.Mail = cloneMap(settings.Mail)
	type job struct {
		shop    appcore.Shop
		binding map[string]any
		network networkConfig
	}
	var jobs []job
	for _, shop := range shops {
		binding := ensureBinding(&settings, shop)
		network := resolveNetwork(settings, shop, binding)
		applyNetwork(binding, network)
		if network.Mode != "proxy" || network.ProxyURL == "" {
			if network.Mode == "direct" {
				binding["proxy_last_error"] = ""
			}
			continue
		}
		jobs = append(jobs, job{shop: shop, binding: binding, network: network})
	}
	if len(jobs) == 0 {
		return settings
	}
	sem := make(chan struct{}, 6)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, item := range jobs {
		item := item
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				return
			}
			testCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
			defer cancel()
			result, err := testNetwork(testCtx, item.binding, item.shop, item.network)
			mu.Lock()
			item.binding["proxy_ip"] = result.ProxyIP
			item.binding["expected_ip"] = result.ExpectedIP
			item.binding["proxy_ip_matched"] = result.Matched
			item.binding["proxy_last_tested_at"] = result.TestedAt
			if err != nil {
				item.binding["proxy_last_error"] = err.Error()
			} else {
				item.binding["proxy_last_error"] = ""
			}
			mu.Unlock()
		}()
	}
	wg.Wait()
	return settings
}

func AnnotateShops(settings appcore.Settings, shops []appcore.Shop) []appcore.Shop {
	out := make([]appcore.Shop, 0, len(shops))
	for _, shop := range shops {
		out = append(out, AnnotateShop(settings, shop))
	}
	return out
}

func AnnotateShop(settings appcore.Settings, shop appcore.Shop) appcore.Shop {
	binding := findBinding(settings, shop)
	autoAccount := autoMailAccount(shop)
	account := effectiveMailAccount(shop, binding)
	if account == "" && binding != nil {
		account = stringFromMap(binding, "email")
	}
	network := resolveNetwork(settings, shop, binding)
	shop.EnvironmentID = environmentID(shop)
	shop.EnvironmentIP = expectedIP(shop, binding)
	shop.MailProvider = providerForShop(settings, shop, binding)
	shop.MailAccount = account
	shop.ServiceEmail = serviceEmailFromBinding(binding)
	if shop.ServiceEmail != "" {
		shop.MailAccountSource = "manual"
	} else if autoAccount != "" {
		shop.MailAccountSource = "auto"
	}
	shop.MailNetworkMode = network.Mode
	shop.MailProxySource = network.ProxySource
	shop.ProxyConfigured = network.ProxyURL != ""
	shop.APIToggleable = apiToggleable(settings, shop)
	shop.APIAllowed = apiAllowed(settings, shop)
	if !shop.APIAllowed {
		shop.APIDisabled = true
		shop.APIDisabledReason = apiDisabledReason(settings, shop)
	} else {
		shop.APIDisabled = false
		shop.APIDisabledReason = ""
	}
	if binding != nil {
		shop.ProxyIPMatched = boolFromMap(binding, "proxy_ip_matched")
		shop.ProxyLastTestedAt = stringFromMap(binding, "proxy_last_tested_at")
		shop.ProxyLastError = stringFromMap(binding, "proxy_last_error")
		shop.APIAuthorized = bindingAuthorizedForAccount(binding, account)
		shop.APILastReadAt = stringFromMap(binding, "api_last_read_at")
		shop.APILastError = stringFromMap(binding, "api_last_error")
	}
	shop.Raw = sanitizeRaw(shop.Raw)
	return shop
}

func ImportProxyBindings(settings appcore.Settings, csvPath string) (appcore.Settings, appcore.MailProxyImportResult, error) {
	file, err := os.Open(csvPath)
	if err != nil {
		return settings, appcore.MailProxyImportResult{}, err
	}
	defer file.Close()
	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return settings, appcore.MailProxyImportResult{}, err
	}
	if len(rows) == 0 {
		return settings, appcore.MailProxyImportResult{}, errors.New("CSV is empty")
	}
	header := indexHeader(rows[0])
	start := 1
	if len(header) == 0 {
		header = map[string]int{"mall_id": 0, "email": 1, "proxy_url": 2}
		start = 0
	}
	bindings := bindingList(settings.Mail)
	result := appcore.MailProxyImportResult{}
	for rowIndex := start; rowIndex < len(rows); rowIndex++ {
		row := rows[rowIndex]
		mallID := valueAt(row, header, "mall_id", "mallId", "browser_id")
		email := strings.ToLower(valueAt(row, header, "email", "mail", "mail_account", "mall_account"))
		proxyURL := valueAt(row, header, "proxy_url", "proxy", "proxyUrl")
		provider := normalizeProvider(valueAt(row, header, "provider"))
		if provider == providerOutlook && strings.HasSuffix(email, "@fastmo.cn") {
			provider = providerCuiqiu
		}
		token := valueAt(row, header, "cuiqiu_token", "token")
		mailID := valueAt(row, header, "cuiqiu_mail_id", "mail_id")
		domainID := valueAt(row, header, "cuiqiu_domain_id", "domain_id")
		apiBase := valueAt(row, header, "cuiqiu_api_base", "api_base")
		if provider == providerOutlook {
			provider = providerForEmail(email)
		}
		if (mallID == "" && email == "") || (proxyURL == "" && token == "" && mailID == "" && domainID == "" && apiBase == "") {
			result.Skipped++
			result.Errors = append(result.Errors, fmt.Sprintf("row %d is missing mall_id/email or API/proxy fields", rowIndex+1))
			continue
		}
		if proxyURL != "" {
			if _, err := parseProxyURL(proxyURL); err != nil {
				result.Skipped++
				result.Errors = append(result.Errors, fmt.Sprintf("row %d has invalid proxy: %v", rowIndex+1, err))
				continue
			}
		}
		binding := findBindingByIdentity(bindings, mallID, email)
		if binding == nil {
			binding = map[string]any{}
			bindings = append(bindings, binding)
		}
		if mallID != "" {
			binding["mall_id"] = mallID
		}
		if email != "" {
			binding["email"] = email
		}
		binding["provider"] = provider
		if proxyURL != "" {
			binding["network_mode"] = "proxy"
			binding["proxy_source"] = "csv"
			binding["proxy_url"] = proxyURL
			binding["proxy_ip_matched"] = false
		}
		if token != "" {
			binding["cuiqiu_token"] = token
		}
		if mailID != "" {
			binding["cuiqiu_mail_id"] = mailID
		}
		if domainID != "" {
			binding["cuiqiu_domain_id"] = domainID
		}
		if apiBase != "" {
			binding["cuiqiu_api_base"] = apiBase
		}
		binding["updated_at"] = time.Now().Format(time.RFC3339)
		result.Imported++
	}
	settings.Mail = cloneMap(settings.Mail)
	settings.Mail["proxy_bindings"] = bindings
	return settings, result, nil
}

func TestShopProxy(ctx context.Context, settings appcore.Settings, shop appcore.Shop) (appcore.Settings, appcore.MailProxyTestResult, error) {
	binding := ensureBinding(&settings, shop)
	network := resolveNetwork(settings, shop, binding)
	applyNetwork(binding, network)
	result, err := testNetwork(ctx, binding, shop, network)
	binding["proxy_ip"] = result.ProxyIP
	binding["expected_ip"] = result.ExpectedIP
	binding["proxy_ip_matched"] = result.Matched
	binding["proxy_last_tested_at"] = result.TestedAt
	if err != nil {
		binding["proxy_last_error"] = err.Error()
	} else {
		binding["proxy_last_error"] = ""
	}
	return settings, result, err
}

func SetShopAPIDisabled(settings appcore.Settings, mallID string, disabled bool) appcore.Settings {
	settings.Mail = cloneMap(settings.Mail)
	mallID = strings.TrimSpace(mallID)
	if mallID == "" {
		return settings
	}
	ids := disabledShopIDs(settings.Mail)
	if disabled {
		ids[mallID] = true
	} else {
		delete(ids, mallID)
	}
	out := make([]any, 0, len(ids))
	for id := range ids {
		out = append(out, id)
	}
	settings.Mail["disabled_api_shop_ids"] = out
	return settings
}

func SaveShopServiceEmail(settings appcore.Settings, shop appcore.Shop, email string) (appcore.Settings, error) {
	email = normalizeEmailAddress(email)
	settings.Mail = cloneMap(settings.Mail)
	if settings.Mail == nil {
		settings.Mail = map[string]any{}
	}
	binding := ensureBinding(&settings, shop)
	previousServiceEmail := serviceEmailFromBinding(binding)
	previousEmail := normalizeEmailAddress(stringFromMap(binding, "email"))
	if email == "" {
		delete(binding, "service_email")
		autoAccount := autoMailAccount(shop)
		if autoAccount != "" {
			binding["email"] = autoAccount
			binding["provider"] = providerForEmail(autoAccount)
		}
		if previousServiceEmail != "" && previousEmail != autoAccount {
			clearBindingAuthorization(binding)
		}
	} else {
		binding["service_email"] = email
		binding["email"] = email
		binding["provider"] = providerForEmail(email)
		if previousEmail != "" && previousEmail != email {
			clearBindingAuthorization(binding)
		}
	}
	binding["updated_at"] = time.Now().Format(time.RFC3339)
	return settings, nil
}

func SaveCuiqiuAuthorization(ctx context.Context, settings appcore.Settings, shop appcore.Shop, token string, mailID string, domainID string) (appcore.Settings, string, error) {
	token = strings.TrimSpace(token)
	mailID = strings.TrimSpace(mailID)
	domainID = strings.TrimSpace(domainID)
	if token == "" {
		return settings, "", errors.New("脆球 API Token 不能为空")
	}
	binding := ensureBinding(&settings, shop)
	account := effectiveMailAccount(shop, binding)
	if strings.TrimSpace(account) == "" && mailID == "" {
		return settings, "", errors.New("该店铺没有识别到 fastmo 邮箱，请填写 Mail ID 或先检查店铺邮箱")
	}
	binding["provider"] = providerCuiqiu
	binding["cuiqiu_token"] = token
	if domainID != "" {
		binding["cuiqiu_domain_id"] = domainID
	} else {
		delete(binding, "cuiqiu_domain_id")
	}
	if mailID != "" {
		binding["cuiqiu_mail_id"] = mailID
	}
	config := cuiqiuConfigForShop(settings, shop, binding)
	provider := CuiqiuProvider{}
	if config.MailID == "" {
		foundMailID, err := provider.lookupMailID(ctx, config, account)
		if err != nil {
			return settings, "", err
		}
		config.MailID = foundMailID
		binding["cuiqiu_mail_id"] = foundMailID
	} else {
		start := time.Now().AddDate(0, 0, -7).Format("2006-01-02")
		end := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
		if _, err := provider.listMessages(ctx, config, "Inbox", start, end, 1); err != nil {
			return settings, "", err
		}
	}
	binding["api_last_error"] = ""
	binding["authorized_at"] = time.Now().Format(time.RFC3339)
	binding["updated_at"] = time.Now().Format(time.RFC3339)
	return settings, config.MailID, nil
}

func (OutlookGraphProvider) AuthorizationURL(settings appcore.Settings, shop appcore.Shop) (appcore.Settings, appcore.MailAuthStartResult, error) {
	clientID := stringFromMap(settings.Mail, "outlook_client_id")
	redirectURI := stringFromMap(settings.Mail, "redirect_uri")
	if clientID == "" {
		return settings, appcore.MailAuthStartResult{}, errors.New("Outlook Client ID 未配置")
	}
	if redirectURI == "" {
		return settings, appcore.MailAuthStartResult{}, errors.New("Outlook 回调地址未配置")
	}
	binding := ensureBinding(&settings, shop)
	network := resolveNetwork(settings, shop, binding)
	applyNetwork(binding, network)
	state := randomState()
	binding["pending_state"] = state
	binding["pending_started_at"] = time.Now().Format(time.RFC3339)
	values := url.Values{}
	values.Set("client_id", clientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", redirectURI)
	values.Set("response_mode", "query")
	values.Set("scope", defaultScope)
	values.Set("state", state)
	return settings, appcore.MailAuthStartResult{
		MallID:      shop.MallID,
		MailAccount: effectiveMailAccount(shop, binding),
		AuthURL:     authEndpoint + "?" + values.Encode(),
		RedirectURI: redirectURI,
		State:       state,
	}, nil
}

func (p OutlookGraphProvider) CompleteAuthorization(ctx context.Context, settings appcore.Settings, codeOrURL string) (appcore.Settings, appcore.MailProxyTestResult, error) {
	code, state, err := parseCallbackCode(codeOrURL)
	if err != nil {
		return settings, appcore.MailProxyTestResult{}, err
	}
	binding := findPendingBinding(settings, state)
	if binding == nil {
		return settings, appcore.MailProxyTestResult{}, errors.New("没有找到这次 Outlook 授权记录，请重新点击“API授权”")
	}
	shop := shopFromBinding(binding)
	network := networkFromBinding(binding)
	tested, err := testNetwork(ctx, binding, shop, network)
	binding["proxy_ip"] = tested.ProxyIP
	binding["expected_ip"] = tested.ExpectedIP
	binding["proxy_ip_matched"] = tested.Matched
	binding["proxy_last_tested_at"] = tested.TestedAt
	if err != nil {
		binding["proxy_last_error"] = err.Error()
		return settings, tested, err
	}
	token, err := p.exchangeCode(ctx, settings, network, code)
	if err != nil {
		binding["api_last_error"] = err.Error()
		return settings, tested, err
	}
	saveToken(binding, token)
	if stringFromMap(binding, "scopes") == "" {
		binding["scopes"] = defaultScope
	}
	binding["pending_state"] = ""
	binding["api_last_error"] = ""
	binding["authorized_at"] = time.Now().Format(time.RFC3339)
	return settings, tested, nil
}

func (p OutlookGraphProvider) ReadMessages(ctx context.Context, settings appcore.Settings, shop appcore.Shop, options map[string]any) (appcore.Settings, appcore.InboxResult, error) {
	if !apiAllowed(settings, shop) {
		return settings, emptyInbox(shop), errors.New(apiDisabledReason(settings, shop))
	}
	binding := ensureBinding(&settings, shop)
	if !bindingHasAnyScope(binding, "Mail.Read", "Mail.ReadWrite") {
		err := errors.New("Outlook API 缺少邮件读取权限，请重新点击“API授权”完成授权")
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	network := resolveNetwork(settings, shop, binding)
	applyNetwork(binding, network)
	tested, err := testNetwork(ctx, binding, shop, network)
	binding["proxy_ip"] = tested.ProxyIP
	binding["expected_ip"] = tested.ExpectedIP
	binding["proxy_ip_matched"] = tested.Matched
	binding["proxy_last_tested_at"] = tested.TestedAt
	if err != nil {
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	accessToken, err := p.accessToken(ctx, settings, network, binding)
	if err != nil {
		err = annotateZhanfuDirectRisk(shop, network, err)
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	messages, err := p.graphMessages(ctx, network, accessToken, options)
	if err != nil {
		err = annotateZhanfuDirectRisk(shop, network, err)
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	filtered, ignoredCount, ignoredFingerprints := filterGraphMessagesLikeWebProvider(options, messages, providerOutlook)
	now := time.Now().Format(time.RFC3339)
	binding["api_last_error"] = ""
	binding["api_last_read_at"] = now
	result := emptyInbox(shop)
	result.ProviderErrors = nil
	result.Status = "ok"
	result.IgnoredEmailCount = ignoredCount
	result.IgnoredEmailFingerprints = ignoredFingerprints
	threads, incompleteThreads, historyWarnings := p.graphConversationThreads(ctx, network, accessToken, filtered)
	result.Warnings = append(result.Warnings, historyWarnings...)
	result.Conversations = graphMessagesToConversations(shop, filtered, threads, incompleteThreads, now, stringFromMap(binding, "email"))
	return settings, result, nil
}

func (p OutlookGraphProvider) SendReply(ctx context.Context, settings appcore.Settings, shop appcore.Shop, conversation appcore.Conversation, replyText string) (appcore.Settings, appcore.SendResult, error) {
	text := strings.TrimSpace(replyText)
	if text == "" {
		return settings, appcore.SendResult{}, errors.New("回复内容为空")
	}
	if !apiAllowed(settings, shop) {
		return settings, appcore.SendResult{}, errors.New(apiDisabledReason(settings, shop))
	}
	if !isOutlookConversation(conversation) {
		return settings, appcore.SendResult{}, errors.New("当前邮箱暂未接入 API 发送，请将该店铺开启“禁止API”后使用网页邮箱发送")
	}
	binding := ensureBinding(&settings, shop)
	if !bindingHasScope(binding, "Mail.Send") {
		err := errors.New("Outlook API 缺少发送权限，请重新点击“API授权”完成授权")
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	if !bindingHasScope(binding, "Mail.ReadWrite") {
		err := errors.New("Outlook API 缺少邮件读写权限，请重新点击“API授权”完成授权")
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	network := resolveNetwork(settings, shop, binding)
	applyNetwork(binding, network)
	tested, err := testNetwork(ctx, binding, shop, network)
	binding["proxy_ip"] = tested.ProxyIP
	binding["expected_ip"] = tested.ExpectedIP
	binding["proxy_ip_matched"] = tested.Matched
	binding["proxy_last_tested_at"] = tested.TestedAt
	if err != nil {
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	accessToken, err := p.accessToken(ctx, settings, network, binding)
	if err != nil {
		err = annotateZhanfuDirectRisk(shop, network, err)
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	messageID, err := p.replyMessageID(ctx, network, accessToken, conversation)
	if err != nil {
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	if err := graphReply(ctx, network, accessToken, messageID, text); err != nil {
		err = annotateZhanfuDirectRisk(shop, network, err)
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	if err := graphMarkMessageRead(ctx, network, accessToken, messageID); err != nil {
		err = annotateZhanfuDirectRisk(shop, network, err)
		binding["api_last_send_error"] = err.Error()
		binding["api_last_error"] = err.Error()
		return settings, appcore.SendResult{}, err
	}
	now := time.Now().Format(time.RFC3339)
	binding["api_last_send_error"] = ""
	binding["api_last_error"] = ""
	binding["api_last_send_at"] = now
	return settings, appcore.SendResult{OK: true, Source: conversation.Source, Message: "Outlook API 发送完成", SentAt: now}, nil
}

type CuiqiuProvider struct{}

func (CuiqiuProvider) AuthorizationURL(settings appcore.Settings, shop appcore.Shop) (appcore.Settings, appcore.MailAuthStartResult, error) {
	binding := ensureBinding(&settings, shop)
	if stringFromMap(binding, "provider") == "" {
		binding["provider"] = providerCuiqiu
	}
	return settings, appcore.MailAuthStartResult{}, errors.New("脆球 API 不使用网页 OAuth 授权；请在设置或导入表中配置 token、mail_id、domain_id、api_base")
}

func (CuiqiuProvider) CompleteAuthorization(ctx context.Context, settings appcore.Settings, codeOrURL string) (appcore.Settings, appcore.MailProxyTestResult, error) {
	return settings, appcore.MailProxyTestResult{}, errors.New("脆球 API 不使用回调授权；请配置 token、mail_id、domain_id、api_base")
}

func (p CuiqiuProvider) ReadMessages(ctx context.Context, settings appcore.Settings, shop appcore.Shop, options map[string]any) (appcore.Settings, appcore.InboxResult, error) {
	binding := ensureBinding(&settings, shop)
	binding["provider"] = providerCuiqiu
	config := cuiqiuConfigForShop(settings, shop, binding)
	if config.Token == "" {
		err := errors.New("脆球 API 缺少 token，请在域名邮箱管理后台开放平台生成 token 后填入设置或导入表")
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	if config.MailID == "" {
		mailID, err := p.lookupMailID(ctx, config, effectiveMailAccount(shop, binding))
		if err != nil {
			binding["api_last_error"] = err.Error()
			return settings, emptyInbox(shop), err
		}
		config.MailID = mailID
		binding["cuiqiu_mail_id"] = mailID
	}
	cutoff := parseRFC3339Option(stringOption(options, "cutoff"))
	if cutoff.IsZero() {
		cutoff = time.Now().AddDate(0, 0, -7)
	}
	start := cutoff.Format("2006-01-02")
	end := time.Now().AddDate(0, 0, 1).Format("2006-01-02")
	limit := intOption(options, "limit", 50)
	if limit <= 0 {
		limit = 50
	}
	messages, err := p.listMessages(ctx, config, "Inbox", start, end, limit)
	if err != nil {
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	details := make([]cuiqiuMessageDetail, 0, len(messages))
	for _, message := range messages {
		if strings.TrimSpace(message.ID) == "" {
			continue
		}
		detail, err := p.messageDetail(ctx, config, "Inbox", message.ID)
		if err != nil {
			detail = cuiqiuMessageDetail{
				ID:        message.ID,
				From:      message.From,
				To:        message.To,
				Subject:   message.Subject,
				Time:      message.Time,
				Timestamp: message.Timestamp,
			}
			detail.NeedsReview = true
		}
		details = append(details, detail)
	}
	now := time.Now().Format(time.RFC3339)
	conversations, ignoredCount, ignoredFingerprints := cuiqiuDetailsToConversations(shop, details, now)
	binding["api_last_error"] = ""
	binding["api_last_read_at"] = now
	result := emptyInbox(shop)
	result.ProviderErrors = nil
	result.Status = "ok"
	result.IgnoredEmailCount = ignoredCount
	result.IgnoredEmailFingerprints = ignoredFingerprints
	result.Conversations = conversations
	return settings, result, nil
}

type cuiqiuConfig struct {
	Token    string
	MailID   string
	DomainID string
	APIBase  string
}

type cuiqiuResponse struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

type cuiqiuMailListData struct {
	List []cuiqiuMailAccount `json:"list"`
}

type cuiqiuMailAccount struct {
	ID   string `json:"id"`
	Mail string `json:"mail"`
}

type cuiqiuMessageListData struct {
	List  []cuiqiuMessageSummary `json:"list"`
	Total int                    `json:"total"`
}

type cuiqiuMessageSummary struct {
	From      string `json:"from"`
	ID        string `json:"id"`
	Subject   string `json:"subject"`
	Time      string `json:"time"`
	Timestamp int64  `json:"timestamp"`
	To        string `json:"to"`
}

type cuiqiuMessageDetailData struct {
	List []cuiqiuMessageDetail `json:"list"`
}

type cuiqiuMessageDetail struct {
	From        string `json:"from"`
	ID          string `json:"id"`
	Subject     string `json:"subject"`
	Time        string `json:"time"`
	Timestamp   int64  `json:"timestamp"`
	To          string `json:"to"`
	Body        string `json:"body"`
	PlainText   string `json:"plain_text"`
	Attachments string `json:"attachments"`
	NeedsReview bool   `json:"-"`
}

func cuiqiuConfigForShop(settings appcore.Settings, shop appcore.Shop, binding map[string]any) cuiqiuConfig {
	global := mapFromAny(settings.Mail["cuiqiu"])
	token := firstNonEmpty(
		stringFromMap(binding, "cuiqiu_token"),
		stringFromMap(binding, "token"),
		stringFromMap(global, "token"),
		stringFromMap(settings.Mail, "cuiqiu_token"),
		os.Getenv("CUIQIU_TOKEN"),
	)
	mailID := firstNonEmpty(
		stringFromMap(binding, "cuiqiu_mail_id"),
		stringFromMap(binding, "mail_id"),
		stringFromMap(global, "mail_id"),
		stringFromMap(settings.Mail, "cuiqiu_mail_id"),
	)
	domainID := firstNonEmpty(
		stringFromMap(binding, "cuiqiu_domain_id"),
		stringFromMap(binding, "domain_id"),
		stringFromMap(global, "domain_id"),
		stringFromMap(settings.Mail, "cuiqiu_domain_id"),
		os.Getenv("CUIQIU_DOMAIN_ID"),
	)
	apiBase := firstNonEmpty(
		stringFromMap(binding, "cuiqiu_api_base"),
		stringFromMap(binding, "api_base"),
		stringFromMap(global, "api_base"),
		stringFromMap(settings.Mail, "cuiqiu_api_base"),
		"https://domain-open-api.cuiqiu.com",
	)
	return cuiqiuConfig{Token: token, MailID: mailID, DomainID: domainID, APIBase: strings.TrimRight(apiBase, "/")}
}

func (p CuiqiuProvider) lookupMailID(ctx context.Context, config cuiqiuConfig, email string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if email == "" {
		return "", errors.New("脆球 API 缺少店铺邮箱账号，无法自动查询 mail_id")
	}
	var data cuiqiuMailListData
	fields := map[string]string{
		"mail":       email,
		"offset":     "0",
		"limit":      "20",
		"sort_value": "created_at",
		"sort_type":  "desc",
	}
	if strings.TrimSpace(config.DomainID) != "" {
		fields["domain_id"] = strings.TrimSpace(config.DomainID)
	}
	if err := p.post(ctx, config, "/v2/mail/list", fields, &data); err != nil {
		return "", err
	}
	for _, item := range data.List {
		if strings.EqualFold(strings.TrimSpace(item.Mail), email) && strings.TrimSpace(item.ID) != "" {
			return strings.TrimSpace(item.ID), nil
		}
	}
	return "", fmt.Errorf("脆球 API 未找到邮箱 %s 对应的 mail_id，请手动配置 cuiqiu_mail_id", email)
}

func (p CuiqiuProvider) listMessages(ctx context.Context, config cuiqiuConfig, folder string, start string, end string, limit int) ([]cuiqiuMessageSummary, error) {
	if limit <= 0 {
		return []cuiqiuMessageSummary{}, nil
	}
	const pageSize = 20
	out := make([]cuiqiuMessageSummary, 0, limit)
	for page := 1; len(out) < limit; page++ {
		var data cuiqiuMessageListData
		if err := p.post(ctx, config, "/v1/message/list", map[string]string{
			"folder":     folder,
			"mail_id":    config.MailID,
			"start_time": start,
			"end_time":   end,
			"page":       strconv.Itoa(page),
			"limit":      strconv.Itoa(pageSize),
		}, &data); err != nil {
			return out, err
		}
		remaining := limit - len(out)
		if len(data.List) > remaining {
			out = append(out, data.List[:remaining]...)
		} else {
			out = append(out, data.List...)
		}
		if len(data.List) < pageSize || (data.Total > 0 && page*pageSize >= data.Total) {
			break
		}
	}
	return out, nil
}

func (p CuiqiuProvider) messageDetail(ctx context.Context, config cuiqiuConfig, folder string, messageID string) (cuiqiuMessageDetail, error) {
	var data cuiqiuMessageDetailData
	if err := p.post(ctx, config, "/v1/message/detail", map[string]string{
		"folder":         folder,
		"mail_id":        config.MailID,
		"message_id":     messageID,
		"request_header": "-1",
	}, &data); err != nil {
		return cuiqiuMessageDetail{}, err
	}
	if len(data.List) == 0 {
		return cuiqiuMessageDetail{}, fmt.Errorf("脆球 API 邮件详情为空：%s", messageID)
	}
	return data.List[0], nil
}

func (CuiqiuProvider) post(ctx context.Context, config cuiqiuConfig, endpoint string, fields map[string]string, target any) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("token", config.Token)
	for key, value := range fields {
		_ = writer.WriteField(key, value)
	}
	if err := writer.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, config.APIBase+endpoint, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("脆球 API 请求失败 %s：%s", resp.Status, compactBody(respBody))
	}
	var envelope cuiqiuResponse
	if err := json.Unmarshal(respBody, &envelope); err != nil {
		return err
	}
	if envelope.Code != 0 && envelope.Code != 200 {
		return fmt.Errorf("脆球 API 返回错误 code=%d msg=%s", envelope.Code, envelope.Msg)
	}
	if target == nil {
		return nil
	}
	if len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	return json.Unmarshal(envelope.Data, target)
}

func cuiqiuDetailsToConversations(shop appcore.Shop, details []cuiqiuMessageDetail, fetchedAt string) ([]appcore.Conversation, int, []string) {
	out := make([]appcore.Conversation, 0, len(details))
	ignoredFingerprints := map[string]bool{}
	ignoredCount := 0
	seen := map[string]bool{}
	for _, detail := range details {
		body := firstNonEmpty(detail.PlainText, emailReadableText(detail.Body))
		receivedAt := cuiqiuReceivedAt(detail)
		row := emailFilterRow{
			Sender:      detail.From,
			Subject:     detail.Subject,
			Snippet:     truncate(body, 260),
			Lines:       compactStrings([]string{detail.From, detail.Subject, body}),
			FolderLabel: "Inbox",
		}
		row.EmailFingerprint = emailRowFingerprint(providerCuiqiu, row)
		if isHighConfidencePreDetailIgnoredEmail(row) || !shouldKeepEmailConversation(row, emailFilterConversation{
			CustomerEmail: firstEmail(detail.From),
			CustomerName:  senderDisplayFromHeader(detail.From),
			Topic:         detail.Subject,
			Preview:       truncate(body, 180),
			RawLines:      row.Lines,
			Messages: []emailFilterMessage{{
				Role:  "customer",
				Email: firstEmail(detail.From),
				Text:  body,
			}},
		}) {
			ignoredCount++
			ignoredFingerprints[row.EmailFingerprint] = true
			continue
		}
		key := strings.ToLower(strings.TrimSpace(detail.ID))
		if key == "" {
			key = normalizeSenderValue(detail.From + "|" + detail.Subject + "|" + body)
		}
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		customerEmail := firstEmail(detail.From)
		customerName := firstNonEmpty(senderDisplayFromHeader(detail.From), customerEmail, detail.From)
		if body == "" {
			body = detail.Subject
		}
		out = append(out, appcore.Conversation{
			ID:                   "cuiqiu:" + firstNonEmpty(detail.ID, key),
			ConversationID:       firstNonEmpty(detail.ID, key),
			CustomerName:         customerName,
			CustomerFullName:     customerName,
			CustomerEmail:        customerEmail,
			Preview:              truncate(body, 180),
			Topic:                detail.Subject,
			LastSeen:             firstNonEmpty(receivedAt, detail.Time),
			ReceivedAt:           receivedAt,
			Status:               "new",
			SendStatus:           "idle",
			DetailLoaded:         body != "",
			Source:               providerCuiqiu,
			EmailProvider:        providerCuiqiu,
			EmailAccount:         mailAccount(shop),
			EmailMessageID:       detail.ID,
			EmailThreadID:        detail.ID,
			ShopKey:              appcore.ShopKey(shop),
			ShopName:             shop.DisplayName,
			MallID:               shop.MallID,
			SourceURL:            "",
			FetchedAt:            fetchedAt,
			RawLines:             []string{detail.Subject, detail.From, body},
			Messages:             []appcore.MessageItem{{Role: "customer", Text: body, Time: receivedAt, SenderName: customerName, SenderEmail: customerEmail}},
			CustomerProfileLines: []string{},
			OrderCartLines:       []string{},
			OrderLinks:           []appcore.InfoLink{},
			ProductCards:         []appcore.ProductCard{},
			DataSources:          []string{"cuiqiu_api"},
			NeedsReview:          detail.NeedsReview || body == "",
		})
	}
	return out, ignoredCount, sortedKeys(ignoredFingerprints)
}

func cuiqiuReceivedAt(detail cuiqiuMessageDetail) string {
	if detail.Timestamp > 0 {
		return time.Unix(detail.Timestamp, 0).Format(time.RFC3339)
	}
	if strings.TrimSpace(detail.Time) != "" {
		if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(detail.Time)); err == nil {
			return parsed.Format(time.RFC3339)
		}
	}
	return ""
}

func (p OutlookGraphProvider) exchangeCode(ctx context.Context, settings appcore.Settings, network networkConfig, code string) (tokenResponse, error) {
	form := url.Values{}
	form.Set("client_id", stringFromMap(settings.Mail, "outlook_client_id"))
	form.Set("scope", defaultScope)
	form.Set("code", code)
	form.Set("redirect_uri", stringFromMap(settings.Mail, "redirect_uri"))
	form.Set("grant_type", "authorization_code")
	return postToken(ctx, network, form)
}

func (p OutlookGraphProvider) accessToken(ctx context.Context, settings appcore.Settings, network networkConfig, binding map[string]any) (string, error) {
	if token := stringFromMap(binding, "access_token"); token != "" && !tokenExpired(binding) {
		return token, nil
	}
	refreshToken := stringFromMap(binding, "refresh_token")
	if refreshToken == "" {
		return "", errors.New("该店铺还没有完成 Outlook 授权，请先点击“API授权”")
	}
	form := url.Values{}
	form.Set("client_id", stringFromMap(settings.Mail, "outlook_client_id"))
	form.Set("scope", defaultScope)
	form.Set("refresh_token", refreshToken)
	form.Set("grant_type", "refresh_token")
	token, err := postToken(ctx, network, form)
	if err != nil {
		return "", err
	}
	saveToken(binding, token)
	return token.AccessToken, nil
}

func (OutlookGraphProvider) graphMessages(ctx context.Context, network networkConfig, accessToken string, options map[string]any) ([]graphMessage, error) {
	pageSize := intOption(options, "top", 25)
	if pageSize < 1 {
		pageSize = 25
	}
	if pageSize > 25 {
		pageSize = 25
	}
	maxMessages := intOption(options, "max", pageSize)
	if maxMessages < pageSize {
		maxMessages = pageSize
	}
	if maxMessages > 250 {
		maxMessages = 250
	}
	values := url.Values{}
	values.Set("$top", strconv.Itoa(pageSize))
	values.Set("$select", graphMessageSelectFields())
	values.Set("$filter", "isRead eq false")
	endpoint := graphBaseURL + "/me/mailFolders/inbox/messages?" + values.Encode()
	client, err := httpClientForNetwork(network)
	if err != nil {
		return nil, err
	}
	var messages []graphMessage
	for endpoint != "" && len(messages) < maxMessages {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/json")
		req.Header.Set("ConsistencyLevel", "eventual")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, microsoftGraphRequestError(resp.Status, body)
		}
		var parsed graphMessageList
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, err
		}
		remaining := maxMessages - len(messages)
		if len(parsed.Value) > remaining {
			messages = append(messages, parsed.Value[:remaining]...)
		} else {
			messages = append(messages, parsed.Value...)
		}
		endpoint = parsed.NextLink
	}
	return messages, nil
}

func (OutlookGraphProvider) graphConversationThreads(ctx context.Context, network networkConfig, accessToken string, anchors []graphMessage) (map[string][]graphMessage, map[string]bool, []string) {
	threads := map[string][]graphMessage{}
	incomplete := map[string]bool{}
	var warnings []string
	seen := map[string]bool{}
	for _, anchor := range anchors {
		threadID := graphThreadID(anchor)
		if threadID == "" || seen[threadID] {
			continue
		}
		seen[threadID] = true
		messages, threadWarnings, err := graphConversationMessages(ctx, network, accessToken, threadID)
		warnings = append(warnings, threadWarnings...)
		if err != nil {
			warnings = append(warnings, "Outlook API 读取历史往来失败，已先显示最新邮件："+err.Error())
			threads[threadID] = []graphMessage{anchor}
			incomplete[threadID] = true
			continue
		}
		if len(threadWarnings) > 0 || len(messages) >= 50 {
			incomplete[threadID] = true
		}
		if len(messages) == 0 {
			messages = []graphMessage{anchor}
			incomplete[threadID] = true
		}
		threads[threadID] = messages
	}
	return threads, incomplete, warnings
}

func graphConversationMessages(ctx context.Context, network networkConfig, accessToken string, conversationID string) ([]graphMessage, []string, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, nil, nil
	}
	values := url.Values{}
	values.Set("$top", "50")
	values.Set("$select", graphMessageSelectFields())
	values.Set("$filter", "conversationId eq '"+escapeODataString(conversationID)+"'")
	messages, err := graphMessagesAtEndpoint(ctx, network, accessToken, graphBaseURL+"/me/messages?"+values.Encode(), 50)
	if err != nil {
		return nil, nil, err
	}
	var warnings []string
	sentValues := url.Values{}
	sentValues.Set("$top", "50")
	sentValues.Set("$select", graphMessageSelectFields())
	sentValues.Set("$filter", "conversationId eq '"+escapeODataString(conversationID)+"'")
	sentMessages, sentErr := graphMessagesAtEndpoint(ctx, network, accessToken, graphBaseURL+"/me/mailFolders/sentitems/messages?"+sentValues.Encode(), 50)
	if sentErr != nil {
		warnings = append(warnings, "Outlook API Sent Items thread history failed; showing available thread messages first: "+sentErr.Error())
	} else {
		for index := range sentMessages {
			sentMessages[index].FolderRole = "store"
		}
		messages = append(messages, sentMessages...)
	}
	messages = dedupeGraphMessages(messages)
	sortGraphMessagesByReceivedAt(messages)
	return messages, warnings, nil
}

func dedupeGraphMessages(messages []graphMessage) []graphMessage {
	seen := map[string]bool{}
	out := make([]graphMessage, 0, len(messages))
	indexByKey := map[string]int{}
	for _, message := range messages {
		key := firstNonEmpty(message.ID, message.InternetMessageID, message.ConversationID+"|"+message.ReceivedDateTime+"|"+message.BodyPreview)
		key = strings.ToLower(strings.TrimSpace(key))
		if key == "" {
			out = append(out, message)
			continue
		}
		if seen[key] {
			if message.FolderRole != "" {
				out[indexByKey[key]].FolderRole = message.FolderRole
			}
			continue
		}
		seen[key] = true
		indexByKey[key] = len(out)
		out = append(out, message)
	}
	return out
}

func (OutlookGraphProvider) replyMessageID(ctx context.Context, network networkConfig, accessToken string, conversation appcore.Conversation) (string, error) {
	if id := graphMessageIDFromConversation(conversation); id != "" {
		if err := graphMessageExists(ctx, network, accessToken, id); err == nil {
			return id, nil
		}
	}
	matches, err := findReplyMessageCandidates(ctx, network, accessToken, conversation)
	if err != nil {
		return "", err
	}
	if len(matches) == 1 {
		return matches[0].ID, nil
	}
	if len(matches) > 1 {
		return "", errors.New("Outlook API 发送已拦截：找到多封可能的原邮件，请打开“禁止API”后使用网页邮箱发送")
	}
	return "", errors.New("Outlook API 发送已拦截：未找到可确认的原邮件，请重新读取邮箱或打开“禁止API”后使用网页邮箱发送")
}

func graphMessageIDFromConversation(conversation appcore.Conversation) string {
	for _, value := range []string{conversation.EmailMessageID, conversation.ConversationID, conversation.ID} {
		value = strings.TrimSpace(value)
		for _, prefix := range []string{"outlook-api:", "outlook:"} {
			if strings.HasPrefix(strings.ToLower(value), prefix) {
				value = strings.TrimSpace(value[len(prefix):])
				break
			}
		}
		if value != "" && !strings.Contains(value, "|") {
			return value
		}
	}
	if parsed, err := url.Parse(conversation.SourceURL); err == nil {
		parts := strings.Split(parsed.EscapedPath(), "/")
		for index, part := range parts {
			if strings.EqualFold(part, "id") && index+1 < len(parts) {
				if id, err := url.PathUnescape(parts[index+1]); err == nil && strings.TrimSpace(id) != "" {
					return strings.TrimSpace(id)
				}
			}
		}
	}
	return ""
}

func graphMessageExists(ctx context.Context, network networkConfig, accessToken string, messageID string) error {
	client, err := httpClientForNetwork(network)
	if err != nil {
		return err
	}
	endpoint := graphBaseURL + "/me/messages/" + url.PathEscape(messageID) + "?$select=id"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return microsoftGraphRequestError(resp.Status, body)
	}
	return nil
}

func findReplyMessageCandidates(ctx context.Context, network networkConfig, accessToken string, conversation appcore.Conversation) ([]graphMessage, error) {
	email := strings.TrimSpace(conversation.CustomerEmail)
	if email == "" {
		return nil, errors.New("Outlook API 发送已拦截：缺少客户邮箱，无法确认原邮件")
	}
	values := url.Values{}
	values.Set("$top", "10")
	values.Set("$select", graphMessageSelectFields())
	values.Set("$orderby", "receivedDateTime desc")
	values.Set("$filter", "from/emailAddress/address eq '"+strings.ReplaceAll(email, "'", "''")+"'")
	matches, err := graphMessagesAtEndpoint(ctx, network, accessToken, graphBaseURL+"/me/messages?"+values.Encode(), 10)
	if err != nil {
		return nil, err
	}
	subject := normalizedSubject(conversation.Topic)
	if subject == "" {
		if len(matches) == 1 {
			return matches, nil
		}
		return nil, nil
	}
	var filtered []graphMessage
	for _, message := range matches {
		if normalizedSubject(message.Subject) == subject {
			filtered = append(filtered, message)
		}
	}
	return filtered, nil
}

func graphMessagesAtEndpoint(ctx context.Context, network networkConfig, accessToken string, endpoint string, maxMessages int) ([]graphMessage, error) {
	client, err := httpClientForNetwork(network)
	if err != nil {
		return nil, err
	}
	var messages []graphMessage
	for endpoint != "" && len(messages) < maxMessages {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		req.Header.Set("Accept", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
		_ = resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return nil, microsoftGraphRequestError(resp.Status, body)
		}
		var parsed graphMessageList
		if err := json.Unmarshal(body, &parsed); err != nil {
			return nil, err
		}
		remaining := maxMessages - len(messages)
		if len(parsed.Value) > remaining {
			messages = append(messages, parsed.Value[:remaining]...)
		} else {
			messages = append(messages, parsed.Value...)
		}
		endpoint = parsed.NextLink
	}
	return messages, nil
}

func graphMessageSelectFields() string {
	return "id,conversationId,internetMessageId,subject,from,receivedDateTime,bodyPreview,webLink,body,isRead"
}

func escapeODataString(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func graphThreadID(message graphMessage) string {
	return firstNonEmpty(message.ConversationID, message.ID)
}

func sortGraphMessagesByReceivedAt(messages []graphMessage) {
	sort.SliceStable(messages, func(i, j int) bool {
		return strings.TrimSpace(messages[i].ReceivedDateTime) < strings.TrimSpace(messages[j].ReceivedDateTime)
	})
}

func graphReply(ctx context.Context, network networkConfig, accessToken string, messageID string, replyText string) error {
	client, err := httpClientForNetwork(network)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]string{"comment": replyText})
	if err != nil {
		return err
	}
	endpoint := graphBaseURL + "/me/messages/" + url.PathEscape(messageID) + "/reply"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return microsoftGraphSendError(resp.Status, body)
	}
	return nil
}

func graphMarkMessageRead(ctx context.Context, network networkConfig, accessToken string, messageID string) error {
	client, err := httpClientForNetwork(network)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]bool{"isRead": true})
	if err != nil {
		return err
	}
	endpoint := graphBaseURL + "/me/messages/" + url.PathEscape(messageID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return microsoftGraphUpdateError(resp.Status, body)
	}
	return nil
}

func postToken(ctx context.Context, network networkConfig, form url.Values) (tokenResponse, error) {
	client, err := httpClientForNetwork(network)
	if err != nil {
		return tokenResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return tokenResponse{}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return tokenResponse{}, microsoftTokenRequestError(resp.Status, body, form.Get("grant_type"))
	}
	var token tokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return tokenResponse{}, err
	}
	if token.AccessToken == "" {
		return tokenResponse{}, errors.New("Outlook 授权返回异常：没有 access_token")
	}
	return token, nil
}

func testNetwork(ctx context.Context, binding map[string]any, shop appcore.Shop, network networkConfig) (appcore.MailProxyTestResult, error) {
	result := appcore.MailProxyTestResult{
		MallID:      firstNonEmpty(shop.MallID, stringFromMap(binding, "mall_id")),
		MailAccount: firstNonEmpty(effectiveMailAccount(shop, binding), stringFromMap(binding, "email")),
		ExpectedIP:  network.ExpectedIP,
		ProxyURLSet: network.ProxyURL != "",
		TestedAt:    time.Now().Format(time.RFC3339),
	}
	if network.Mode == "direct" {
		result.Matched = true
		return result, nil
	}
	if network.ProxyURL == "" {
		result.Error = "proxy is not configured for this shop"
		return result, errors.New(result.Error)
	}
	client, err := httpClientForNetwork(network)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ipCheckURL, nil)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	resp, err := client.Do(req)
	if err != nil {
		result.Error = err.Error()
		return result, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("proxy IP check failed: %s", resp.Status)
		result.Error = err.Error()
		return result, err
	}
	result.ProxyIP = parseIPCheckBody(body)
	if result.ExpectedIP == "" {
		return result, nil
	}
	result.Matched = normalizeIP(result.ProxyIP) == normalizeIP(result.ExpectedIP)
	if !result.Matched {
		result.Error = fmt.Sprintf("proxy exit IP mismatch: proxy %s, expected %s", result.ProxyIP, result.ExpectedIP)
		return result, errors.New(result.Error)
	}
	return result, nil
}

func httpClientForNetwork(network networkConfig) (*http.Client, error) {
	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   15 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout: 15 * time.Second,
	}
	if network.ProxyURL != "" {
		proxyURL, err := parseProxyURL(network.ProxyURL)
		if err != nil {
			return nil, err
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}
	return &http.Client{Timeout: 45 * time.Second, Transport: offlinehttp.Wrap(transport)}, nil
}

func parseProxyURL(raw string) (*url.URL, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, errors.New("proxy URL is empty")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return nil, err
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("proxy URL must include scheme, host, and port")
	}
	return parsed, nil
}

func resolveNetwork(settings appcore.Settings, shop appcore.Shop, binding map[string]any) networkConfig {
	network := networkConfig{Mode: "direct", ProxySource: "direct", ExpectedIP: expectedIP(shop, binding)}
	if binding != nil && stringFromMap(binding, "proxy_url") != "" {
		network.Mode = "proxy"
		network.ProxyURL = stringFromMap(binding, "proxy_url")
		network.ProxySource = firstNonEmpty(stringFromMap(binding, "proxy_source"), "manual")
		return network
	}
	mode := adapterMode(settings, shop.AdapterName)
	if mode == "api_direct" {
		return network
	}
	if mode == "web_only" || mode == "disabled" {
		network.Mode = "web_only"
		network.ProxySource = "disabled"
		return network
	}
	if proxyURL, source := adapterProxyURL(shop); proxyURL != "" {
		network.Mode = "proxy"
		network.ProxyURL = proxyURL
		network.ProxySource = source
		return network
	}
	if strings.EqualFold(shop.AdapterName, "zhanfu") {
		return network
	}
	network.Mode = "proxy_missing"
	network.ProxySource = "missing"
	return network
}

func networkFromBinding(binding map[string]any) networkConfig {
	return networkConfig{
		Mode:        firstNonEmpty(stringFromMap(binding, "network_mode"), "direct"),
		ProxyURL:    stringFromMap(binding, "proxy_url"),
		ProxySource: firstNonEmpty(stringFromMap(binding, "proxy_source"), "direct"),
		ExpectedIP:  stringFromMap(binding, "expected_ip"),
	}
}

func applyNetwork(binding map[string]any, network networkConfig) {
	if binding == nil {
		return
	}
	binding["network_mode"] = network.Mode
	binding["proxy_source"] = network.ProxySource
	binding["expected_ip"] = network.ExpectedIP
	if network.ProxyURL != "" {
		binding["proxy_url"] = network.ProxyURL
	}
}

func adapterProxyURL(shop appcore.Shop) (string, string) {
	switch strings.ToLower(strings.TrimSpace(shop.AdapterName)) {
	case "bitbrowser":
		scheme := firstNonEmpty(rawString(shop.Raw, "proxyType"), rawString(shop.Raw, "proxy_type"), "http")
		host := rawString(shop.Raw, "host")
		port := rawString(shop.Raw, "port")
		user := firstNonEmpty(rawString(shop.Raw, "proxyUserName"), rawString(shop.Raw, "proxy_user"))
		pass := firstNonEmpty(rawString(shop.Raw, "proxyPassword"), rawString(shop.Raw, "proxy_password"))
		return buildProxyURL(scheme, host, port, user, pass), "bitbrowser"
	case "adspower":
		config := mapFromAny(shop.Raw["user_proxy_config"])
		scheme := firstNonEmpty(rawString(config, "proxy_type"), rawString(shop.Raw, "proxy_type"), "http")
		host := firstNonEmpty(rawString(config, "proxy_host"), rawString(shop.Raw, "proxy_host"))
		port := firstNonEmpty(rawString(config, "proxy_port"), rawString(shop.Raw, "proxy_port"))
		user := firstNonEmpty(rawString(config, "proxy_user"), rawString(shop.Raw, "proxy_user"))
		pass := firstNonEmpty(rawString(config, "proxy_password"), rawString(shop.Raw, "proxy_password"))
		return buildProxyURL(scheme, host, port, user, pass), "adspower"
	default:
		return "", ""
	}
}

func buildProxyURL(scheme string, host string, port string, user string, pass string) string {
	scheme = strings.ToLower(strings.TrimSpace(scheme))
	if scheme == "" || host == "" || port == "" {
		return ""
	}
	if user != "" {
		auth := url.UserPassword(user, pass)
		return fmt.Sprintf("%s://%s@%s:%s", scheme, auth.String(), host, port)
	}
	return fmt.Sprintf("%s://%s:%s", scheme, host, port)
}

func adapterMode(settings appcore.Settings, adapterName string) string {
	defaults := map[string]string{"zhanfu": "api_direct", "bitbrowser": "api_proxy", "adspower": "api_proxy"}
	key := strings.ToLower(strings.TrimSpace(adapterName))
	if key == "" {
		return "api_direct"
	}
	raw := mapFromAny(settings.Mail["adapter_modes"])
	if mode := strings.TrimSpace(fmt.Sprint(raw[key])); mode != "" && mode != "<nil>" {
		return mode
	}
	if mode := defaults[key]; mode != "" {
		return mode
	}
	return "api_direct"
}

func apiAllowed(settings appcore.Settings, shop appcore.Shop) bool {
	if disabledShopIDs(settings.Mail)[shop.MallID] {
		return false
	}
	return apiToggleable(settings, shop)
}

func apiToggleable(settings appcore.Settings, shop appcore.Shop) bool {
	mode := adapterMode(settings, shop.AdapterName)
	return mode != "web_only" && mode != "disabled"
}

func apiDisabledReason(settings appcore.Settings, shop appcore.Shop) string {
	if disabledShopIDs(settings.Mail)[shop.MallID] {
		return "mail API is disabled for this shop"
	}
	mode := adapterMode(settings, shop.AdapterName)
	if mode == "web_only" || mode == "disabled" {
		return "mail API is disabled for this adapter"
	}
	return ""
}

func disabledShopIDs(mail map[string]any) map[string]bool {
	out := map[string]bool{}
	raw := mail["disabled_api_shop_ids"]
	if items, ok := raw.([]any); ok {
		for _, item := range items {
			id := strings.TrimSpace(fmt.Sprint(item))
			if id != "" {
				out[id] = true
			}
		}
	}
	if items, ok := raw.([]string); ok {
		for _, id := range items {
			id = strings.TrimSpace(id)
			if id != "" {
				out[id] = true
			}
		}
	}
	return out
}

func parseCallbackCode(raw string) (string, string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", "", errors.New("授权回调为空，请重新点击“API授权”")
	}
	if strings.Contains(raw, "://") || strings.HasPrefix(raw, "localhost") || strings.HasPrefix(raw, "http") {
		if !strings.Contains(raw, "://") {
			raw = "http://" + raw
		}
		parsed, err := url.Parse(raw)
		if err != nil {
			return "", "", err
		}
		if callbackError := parsed.Query().Get("error"); callbackError != "" {
			return "", "", errors.New(MicrosoftAuthorizationError(callbackError, parsed.Query().Get("error_description")))
		}
		code := parsed.Query().Get("code")
		if code == "" {
			return "", "", errors.New("Microsoft 未返回授权码，请重新点击“API授权”")
		}
		return code, parsed.Query().Get("state"), nil
	}
	return raw, "", nil
}

func indexHeader(row []string) map[string]int {
	out := map[string]int{}
	known := map[string]bool{
		"mall_id": true, "mallid": true, "browser_id": true,
		"email": true, "mail": true, "mall_account": true,
		"proxy_url": true, "proxyurl": true, "proxy": true,
		"provider": true, "token": true, "cuiqiu_token": true,
		"mail_id": true, "cuiqiu_mail_id": true,
		"domain_id": true, "cuiqiu_domain_id": true,
		"api_base": true, "cuiqiu_api_base": true,
	}
	for i, col := range row {
		key := normalizeHeader(col)
		if known[key] {
			out[key] = i
		}
	}
	return out
}

func valueAt(row []string, header map[string]int, keys ...string) string {
	for _, key := range keys {
		if idx, ok := header[normalizeHeader(key)]; ok && idx >= 0 && idx < len(row) {
			return strings.TrimSpace(row[idx])
		}
	}
	return ""
}

func normalizeHeader(value string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "-", "_"))
}

func bindingList(mail map[string]any) []map[string]any {
	raw := mail["proxy_bindings"]
	if typed, ok := raw.([]map[string]any); ok {
		return typed
	}
	items, _ := raw.([]any)
	out := []map[string]any{}
	for _, item := range items {
		if row, ok := item.(map[string]any); ok {
			out = append(out, row)
		}
	}
	return out
}

func findBinding(settings appcore.Settings, shop appcore.Shop) map[string]any {
	return findBindingByIdentity(bindingList(settings.Mail), shop.MallID, autoMailAccount(shop))
}

func findBindingByIdentity(bindings []map[string]any, mallID string, email string) map[string]any {
	email = strings.ToLower(strings.TrimSpace(email))
	for _, binding := range bindings {
		if mallID != "" && stringFromMap(binding, "mall_id") == mallID {
			return binding
		}
		if email != "" && strings.ToLower(stringFromMap(binding, "email")) == email {
			return binding
		}
	}
	return nil
}

func ensureBinding(settings *appcore.Settings, shop appcore.Shop) map[string]any {
	settings.Mail = cloneMap(settings.Mail)
	bindings := bindingList(settings.Mail)
	binding := findBindingByIdentity(bindings, shop.MallID, autoMailAccount(shop))
	account := effectiveMailAccount(shop, binding)
	if binding == nil {
		binding = map[string]any{
			"mall_id":      shop.MallID,
			"email":        account,
			"provider":     providerForShop(*settings, shop, nil),
			"adapter_name": shop.AdapterName,
		}
		bindings = append(bindings, binding)
		settings.Mail["proxy_bindings"] = bindings
	}
	if stringFromMap(binding, "mall_id") == "" {
		binding["mall_id"] = shop.MallID
	}
	if stringFromMap(binding, "email") == "" {
		binding["email"] = account
	}
	if stringFromMap(binding, "provider") == "" || stringFromMap(binding, "provider") == providerOutlook && providerForEmail(stringFromMap(binding, "email")) == providerGmail {
		binding["provider"] = providerForShop(*settings, shop, binding)
	}
	if shop.AdapterName != "" {
		binding["adapter_name"] = shop.AdapterName
	}
	if ip := expectedIP(shop, binding); ip != "" {
		binding["expected_ip"] = ip
	}
	return binding
}

func findPendingBinding(settings appcore.Settings, state string) map[string]any {
	bindings := bindingList(settings.Mail)
	if state != "" {
		for _, binding := range bindings {
			if stringFromMap(binding, "pending_state") == state {
				return binding
			}
		}
		return nil
	}
	for i := len(bindings) - 1; i >= 0; i-- {
		if stringFromMap(bindings[i], "pending_state") != "" {
			return bindings[i]
		}
	}
	return nil
}

func shopFromBinding(binding map[string]any) appcore.Shop {
	return appcore.Shop{
		MallID:      stringFromMap(binding, "mall_id"),
		DisplayName: stringFromMap(binding, "email"),
		AdapterName: stringFromMap(binding, "adapter_name"),
		Raw: map[string]any{
			"ip_address": stringFromMap(binding, "expected_ip"),
		},
	}
}

func environmentID(shop appcore.Shop) string {
	return firstNonEmpty(
		shop.MallID,
		rawString(shop.Raw, "browser_id"),
		rawString(shop.Raw, "browserId"),
		rawString(shop.Raw, "profile_id"),
		rawString(shop.Raw, "profileId"),
		rawString(shop.Raw, "user_id"),
		rawString(shop.Raw, "userId"),
		rawString(shop.Raw, "id"),
	)
}

func mailAccount(shop appcore.Shop) string {
	if value := normalizeEmailAddress(shop.MailAccount); value != "" {
		return value
	}
	return autoMailAccount(shop)
}

func autoMailAccount(shop appcore.Shop) string {
	for _, key := range []string{"mall_account", "mail_account", "email", "mall_name", "name"} {
		if value := normalizeEmailAddress(rawString(shop.Raw, key)); value != "" {
			return value
		}
	}
	if value := normalizeEmailAddress(shop.DisplayName); value != "" {
		return value
	}
	return ""
}

func serviceEmailFromBinding(binding map[string]any) string {
	return normalizeEmailAddress(stringFromMap(binding, "service_email"))
}

func effectiveMailAccount(shop appcore.Shop, binding map[string]any) string {
	if value := serviceEmailFromBinding(binding); value != "" {
		return value
	}
	if value := normalizeEmailAddress(shop.MailAccount); value != "" && shop.MailAccountSource == "manual" {
		return value
	}
	return autoMailAccount(shop)
}

func bindingAuthorizedForAccount(binding map[string]any, account string) bool {
	if binding == nil {
		return false
	}
	serviceEmail := serviceEmailFromBinding(binding)
	if serviceEmail == "" {
		return bindingHasAuthorization(binding)
	}
	account = firstNonEmpty(normalizeEmailAddress(account), serviceEmail)
	bindingEmail := normalizeEmailAddress(stringFromMap(binding, "email"))
	if bindingEmail != "" && !emailAddressMatches(bindingEmail, account) {
		return false
	}
	return bindingHasAuthorization(binding)
}

func bindingHasAuthorization(binding map[string]any) bool {
	if binding == nil {
		return false
	}
	return stringFromMap(binding, "refresh_token") != "" ||
		stringFromMap(binding, "access_token") != "" ||
		stringFromMap(binding, "cuiqiu_token") != "" ||
		stringFromMap(binding, "token") != ""
}

func clearBindingAuthorization(binding map[string]any) {
	for _, key := range []string{
		"access_token",
		"refresh_token",
		"access_token_expires_at",
		"scopes",
		"pending_state",
		"pending_started_at",
		"cuiqiu_token",
		"token",
		"cuiqiu_mail_id",
		"mail_id",
		"api_last_error",
		"api_last_read_at",
		"authorized_at",
	} {
		delete(binding, key)
	}
}

func expectedIP(shop appcore.Shop, binding map[string]any) string {
	return firstNonEmpty(rawString(shop.Raw, "ip_address"), rawString(shop.Raw, "lastIp"), rawString(shop.Raw, "ip"), stringFromMap(binding, "expected_ip"))
}

func rawString(raw map[string]any, key string) string {
	if raw == nil {
		return ""
	}
	value, ok := raw[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func mapFromAny(value any) map[string]any {
	if value == nil {
		return nil
	}
	if typed, ok := value.(map[string]any); ok {
		return typed
	}
	if typed, ok := value.(map[string]interface{}); ok {
		out := map[string]any{}
		for key, item := range typed {
			out[key] = item
		}
		return out
	}
	return nil
}

func sanitizeRaw(raw map[string]any) map[string]any {
	if raw == nil {
		return nil
	}
	out := map[string]any{}
	for key, value := range raw {
		lower := strings.ToLower(key)
		isProxyUser := strings.Contains(lower, "proxy") && (strings.Contains(lower, "user") || strings.Contains(lower, "account") || strings.Contains(lower, "login"))
		if strings.Contains(lower, "password") || strings.Contains(lower, "cookie") || strings.Contains(lower, "token") || strings.Contains(lower, "secret") || isProxyUser {
			out[key] = "***REDACTED***"
			continue
		}
		if key == "user_proxy_config" {
			out[key] = sanitizeRaw(mapFromAny(value))
			continue
		}
		out[key] = value
	}
	return out
}

func looksLikeEmail(value string) bool {
	value = strings.TrimSpace(value)
	return strings.Contains(value, "@") && strings.Contains(value, ".")
}

func normalizeEmailAddress(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return ""
	}
	match := regexp.MustCompile(`[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}`).FindString(value)
	if match != "" {
		return match
	}
	if looksLikeEmail(value) {
		return strings.Trim(value, "<>\"' ")
	}
	return ""
}

func saveToken(binding map[string]any, token tokenResponse) {
	binding["access_token"] = token.AccessToken
	if token.RefreshToken != "" {
		binding["refresh_token"] = token.RefreshToken
	}
	if strings.TrimSpace(token.Scope) != "" {
		binding["scopes"] = token.Scope
	}
	if token.ExpiresIn > 0 {
		binding["access_token_expires_at"] = time.Now().Add(time.Duration(token.ExpiresIn-60) * time.Second).Format(time.RFC3339)
	}
}

func tokenExpired(binding map[string]any) bool {
	expiresAt := stringFromMap(binding, "access_token_expires_at")
	if expiresAt == "" {
		return true
	}
	parsed, err := time.Parse(time.RFC3339, expiresAt)
	return err != nil || time.Now().After(parsed)
}

func emptyInbox(shop appcore.Shop) appcore.InboxResult {
	return appcore.InboxResult{
		StoreSlug:     shop.DisplayName,
		Title:         strings.Title(providerForShop(appcore.Settings{}, shop, nil)) + " API",
		Status:        "partial",
		Conversations: []appcore.Conversation{},
	}
}

func MailProviderForShop(settings appcore.Settings, shop appcore.Shop) string {
	return providerForShop(settings, shop, findBinding(settings, shop))
}

func NewProviderForShop(settings appcore.Settings, shop appcore.Shop) Provider {
	switch providerForShop(settings, shop, findBinding(settings, shop)) {
	case providerGmail:
		return GmailProvider{}
	case providerCuiqiu:
		return CuiqiuProvider{}
	default:
		return OutlookGraphProvider{}
	}
}

func NewProviderForPendingAuthorization(settings appcore.Settings, callbackCode string) Provider {
	_, state, err := parseCallbackCode(callbackCode)
	if err == nil {
		if binding := findPendingBinding(settings, state); binding != nil && normalizeProvider(stringFromMap(binding, "provider")) == providerGmail {
			return GmailProvider{}
		}
	}
	return OutlookGraphProvider{}
}

func providerForShop(settings appcore.Settings, shop appcore.Shop, binding map[string]any) string {
	if provider := providerForEmail(firstNonEmpty(effectiveMailAccount(shop, binding), stringFromMap(binding, "email"))); provider != "" {
		return provider
	}
	if provider := normalizeProvider(stringFromMap(binding, "provider")); provider != "" {
		return provider
	}
	return normalizeProvider(stringFromMap(settings.Mail, "provider"))
}

func providerForEmail(email string) string {
	email = strings.ToLower(strings.TrimSpace(email))
	if strings.HasSuffix(email, "@gmail.com") || strings.HasSuffix(email, "@googlemail.com") {
		return providerGmail
	}
	if strings.HasSuffix(email, "@fastmo.cn") {
		return providerCuiqiu
	}
	return providerOutlook
}

func normalizeProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case providerGmail:
		return providerGmail
	case providerCuiqiu:
		return providerCuiqiu
	case providerOutlook, "":
		return providerOutlook
	default:
		return strings.ToLower(strings.TrimSpace(provider))
	}
}

func graphMessagesToConversations(shop appcore.Shop, messages []graphMessage, threads map[string][]graphMessage, incompleteThreads map[string]bool, fetchedAt string, account string) []appcore.Conversation {
	out := make([]appcore.Conversation, 0, len(messages))
	seenThreads := map[string]bool{}
	for _, message := range messages {
		threadID := graphThreadID(message)
		if threadID == "" {
			threadID = message.ID
		}
		if seenThreads[threadID] {
			continue
		}
		seenThreads[threadID] = true
		threadMessages := threads[threadID]
		if len(threadMessages) == 0 {
			threadMessages = []graphMessage{message}
		}
		threadMessages = ensureGraphThreadContainsAnchor(threadMessages, message)
		sortGraphMessagesByReceivedAt(threadMessages)
		displayMessages := outlookAPIThreadMessageItems(shop, account, threadMessages)
		if len(displayMessages) == 0 {
			displayMessages = outlookAPIMessageItems(firstNonEmpty(emailReadableText(message.Body.Content), message.BodyPreview), message.ReceivedDateTime)
		}
		latestText := outlookAPILatestMessageText(message)
		if latestText == "" && len(displayMessages) > 0 {
			latestText = displayMessages[len(displayMessages)-1].Text
		}
		needsReview := incompleteThreads != nil && incompleteThreads[threadID]
		dataSources := []string{"outlook_api"}
		if needsReview {
			dataSources = append(dataSources, "outlook_api_partial")
		}
		from := message.From.EmailAddress.Address
		id := "outlook:" + message.ID
		out = append(out, appcore.Conversation{
			ID:                   id,
			ConversationID:       threadID,
			CustomerName:         firstNonEmpty(message.From.EmailAddress.Name, from),
			CustomerFullName:     message.From.EmailAddress.Name,
			CustomerEmail:        from,
			Preview:              firstNonEmpty(truncate(latestText, 180), message.BodyPreview),
			Topic:                message.Subject,
			LastSeen:             message.ReceivedDateTime,
			ReceivedAt:           message.ReceivedDateTime,
			Status:               "new",
			SendStatus:           "idle",
			DetailLoaded:         true,
			Source:               providerOutlook,
			EmailProvider:        providerOutlook,
			EmailAccount:         mailAccount(shop),
			EmailMessageID:       message.ID,
			EmailThreadID:        threadID,
			EmailInternetID:      message.InternetMessageID,
			ShopKey:              appcore.ShopKey(shop),
			ShopName:             shop.DisplayName,
			MallID:               shop.MallID,
			SourceURL:            message.WebLink,
			FetchedAt:            fetchedAt,
			RawLines:             []string{message.Subject, from, latestText},
			Messages:             displayMessages,
			CustomerProfileLines: []string{},
			OrderCartLines:       []string{},
			OrderLinks:           []appcore.InfoLink{},
			ProductCards:         []appcore.ProductCard{},
			DataSources:          dataSources,
			NeedsReview:          needsReview,
		})
	}
	return out
}

func ensureGraphThreadContainsAnchor(messages []graphMessage, anchor graphMessage) []graphMessage {
	if anchor.ID == "" {
		return messages
	}
	for _, message := range messages {
		if message.ID == anchor.ID {
			return messages
		}
	}
	return append(messages, anchor)
}

func outlookAPIThreadMessageItems(shop appcore.Shop, account string, messages []graphMessage) []appcore.MessageItem {
	items := make([]appcore.MessageItem, 0, len(messages))
	seen := map[string]bool{}
	for _, message := range messages {
		text := outlookAPILatestMessageText(message)
		if text == "" {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(message.ID + "|" + message.ReceivedDateTime + "|" + text))
		if seen[key] {
			continue
		}
		seen[key] = true
		items = append(items, appcore.MessageItem{
			Role:        graphMessageRole(shop, account, message),
			Text:        text,
			Time:        message.ReceivedDateTime,
			SenderName:  message.From.EmailAddress.Name,
			SenderEmail: normalizeEmailAddress(message.From.EmailAddress.Address),
		})
	}
	return items
}

func outlookAPILatestMessageText(message graphMessage) string {
	body := emailReadableText(message.Body.Content)
	if body == "" {
		body = message.BodyPreview
	}
	body = normalizeEmailWhitespace(body)
	if body == "" {
		return ""
	}
	latest, _ := splitOutlookQuotedHistory(body)
	latest = cleanupOutlookLatestMessage(latest)
	if latest != "" {
		return latest
	}
	return cleanupOutlookLatestMessage(body)
}

func graphMessageRole(shop appcore.Shop, account string, message graphMessage) string {
	if message.FolderRole == "store" {
		return "store"
	}
	from := normalizeEmailAddress(message.From.EmailAddress.Address)
	accounts := []string{account, mailAccount(shop), shop.MailAccount}
	for _, item := range accounts {
		if emailAddressMatches(from, item) {
			return "store"
		}
	}
	name := strings.ToLower(strings.TrimSpace(message.From.EmailAddress.Name))
	if name == "you" || name == "me" || strings.Contains(name, "客服") || strings.Contains(name, "support") {
		return "store"
	}
	return "customer"
}

func emailAddressMatches(left string, right string) bool {
	left = normalizeEmailAddress(left)
	right = normalizeEmailAddress(right)
	if left == "" || right == "" {
		return false
	}
	if left == right {
		return true
	}
	leftLocal, leftDomain, okLeft := splitEmailAddress(left)
	rightLocal, rightDomain, okRight := splitEmailAddress(right)
	if !okLeft || !okRight || leftDomain != rightDomain {
		return false
	}
	return strings.HasSuffix(leftLocal, "-"+rightLocal) || strings.HasSuffix(rightLocal, "-"+leftLocal)
}

func splitEmailAddress(value string) (string, string, bool) {
	value = normalizeEmailAddress(value)
	parts := strings.Split(value, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

func emailReadableText(value string) string {
	value = html.UnescapeString(value)
	value = regexp.MustCompile(`(?is)<script.*?</script>`).ReplaceAllString(value, " ")
	value = regexp.MustCompile(`(?is)<style.*?</style>`).ReplaceAllString(value, " ")
	value = regexp.MustCompile(`(?i)<\s*br\s*/?\s*>`).ReplaceAllString(value, "\n")
	value = regexp.MustCompile(`(?i)</\s*(p|div|li|tr|h[1-6])\s*>`).ReplaceAllString(value, "\n")
	value = regexp.MustCompile(`(?i)<\s*li[^>]*>`).ReplaceAllString(value, "\n- ")
	value = regexp.MustCompile(`(?s)<[^>]+>`).ReplaceAllString(value, " ")
	return normalizeEmailWhitespace(value)
}

func outlookAPIMessageItems(body string, receivedAt string) []appcore.MessageItem {
	body = normalizeEmailWhitespace(body)
	if body == "" {
		return nil
	}
	latest, quoted := splitOutlookQuotedHistory(body)
	_ = quoted
	latest = cleanupOutlookLatestMessage(latest)
	var items []appcore.MessageItem
	if latest != "" {
		items = append(items, appcore.MessageItem{Role: "customer", Text: latest, Time: receivedAt})
	}
	if len(items) == 0 {
		items = append(items, appcore.MessageItem{Role: "customer", Text: body, Time: receivedAt})
	}
	return items
}

func splitOutlookQuotedHistory(value string) (string, string) {
	lines := strings.Split(normalizeEmailWhitespace(value), "\n")
	cut := len(lines)
	patterns := []*regexp.Regexp{
		regexp.MustCompile(`(?i)^\s*On .{0,220} wrote:\s*$`),
		regexp.MustCompile(`(?i)^\s*(?:El|La|Los|Las)\s+.{0,240}\bescribi[oó]:\s*$`),
		regexp.MustCompile(`(?i)^\s*Le\s+.{0,240}\ba\s+[ée]crit\s*:?\s*$`),
		regexp.MustCompile(`(?i)^\s*Am\s+.{0,240}\bschrieb\s*:?\s*$`),
		regexp.MustCompile(`(?i)^\s*Il\s+.{0,240}\bha\s+scritto\s*:?\s*$`),
		regexp.MustCompile(`(?i)^\s*Op\s+.{0,240}\bschreef\s*:?\s*$`),
		regexp.MustCompile(`(?i)^-{2,}\s*Original Message\s*-{2,}$`),
		regexp.MustCompile(`(?i)^From:\s+`),
		regexp.MustCompile(`(?i)^Sent:\s+`),
		regexp.MustCompile(`(?i)^To:\s+`),
		regexp.MustCompile(`(?i)^Subject:\s+`),
		regexp.MustCompile(`(?i)^You replied on\s+`),
		regexp.MustCompile(`^发件人[:：]`),
		regexp.MustCompile(`^发送时间[:：]`),
		regexp.MustCompile(`^收件人[:：]`),
		regexp.MustCompile(`^主题[:：]`),
	}
	for index, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		for _, pattern := range patterns {
			if pattern.MatchString(trimmed) {
				cut = index
				return strings.Join(lines[:cut], "\n"), strings.Join(lines[cut:], "\n")
			}
		}
	}
	return strings.Join(lines[:cut], "\n"), ""
}

func cleanupOutlookLatestMessage(value string) string {
	lines := strings.Split(normalizeEmailWhitespace(value), "\n")
	out := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			out = append(out, "")
			continue
		}
		if regexp.MustCompile(`(?i)^Sent from (?:the )?.*(?:AOL|iPhone|iOS|Android|Outlook).*$`).MatchString(trimmed) {
			continue
		}
		if regexp.MustCompile(`(?i)^Get Outlook for`).MatchString(trimmed) {
			continue
		}
		out = append(out, line)
	}
	return normalizeEmailWhitespace(strings.Join(out, "\n"))
}

func normalizeEmailWhitespace(value string) string {
	value = strings.ReplaceAll(value, "\r\n", "\n")
	value = strings.ReplaceAll(value, "\r", "\n")
	value = strings.ReplaceAll(value, "\u00a0", " ")
	lines := strings.Split(value, "\n")
	out := make([]string, 0, len(lines))
	blank := false
	for _, line := range lines {
		line = strings.TrimSpace(regexp.MustCompile(`[ \t]+`).ReplaceAllString(line, " "))
		if line == "" {
			if !blank && len(out) > 0 {
				out = append(out, "")
			}
			blank = true
			continue
		}
		out = append(out, line)
		blank = false
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

func plainText(value string) string {
	return strings.Join(strings.Fields(emailReadableText(value)), " ")
}

func compactBody(body []byte) string {
	body = bytes.TrimSpace(body)
	if len(body) > 500 {
		body = body[:500]
	}
	return string(body)
}

func microsoftTokenRequestError(status string, body []byte, grantType string) error {
	code, description := parseMicrosoftErrorBody(body)
	if strings.EqualFold(code, "invalid_grant") {
		if grantType == "authorization_code" {
			return errors.New(withMicrosoftCode("Outlook 授权失败：授权码已过期或已被使用，请重新点击“API授权”完成授权", code))
		}
		return errors.New(withMicrosoftCode("Outlook 授权已失效，请重新点击“API授权”", code))
	}
	return errors.New(withMicrosoftCode(classifyMicrosoftError("Outlook 授权失败", code, description, status), code))
}

func microsoftGraphRequestError(status string, body []byte) error {
	code, description := parseMicrosoftErrorBody(body)
	message := withMicrosoftCode(classifyMicrosoftError("Outlook 邮件读取失败", code, description, status), code)
	if code == "" && strings.TrimSpace(status) != "" && len(bytes.TrimSpace(body)) > 0 {
		message += "：" + compactBody(body)
	}
	return errors.New(message)
}

func microsoftGraphSendError(status string, body []byte) error {
	code, description := parseMicrosoftErrorBody(body)
	return errors.New(withMicrosoftCode(classifyMicrosoftError("Outlook API 发送失败", code, description, status), code))
}

func microsoftGraphUpdateError(status string, body []byte) error {
	code, description := parseMicrosoftErrorBody(body)
	return errors.New(withMicrosoftCode(classifyMicrosoftError("Outlook 邮件状态更新失败", code, description, status), code))
}

func parseMicrosoftErrorBody(body []byte) (string, string) {
	var parsed microsoftErrorResponse
	if json.Unmarshal(body, &parsed) == nil {
		return strings.TrimSpace(parsed.Error), strings.TrimSpace(parsed.ErrorDescription)
	}
	return "", compactBody(body)
}

func MicrosoftAuthorizationError(code string, description string) string {
	return withMicrosoftCode(classifyMicrosoftError("Outlook 授权失败", code, description, ""), code)
}

func classifyMicrosoftError(prefix string, code string, description string, status string) string {
	code = strings.ToLower(strings.TrimSpace(code))
	lower := strings.ToLower(strings.TrimSpace(code + " " + description + " " + status))
	switch {
	case code == "invalid_grant":
		return prefix + "：Outlook 授权已失效，请重新点击“API授权”"
	case code == "interaction_required" || strings.Contains(lower, "mfa") || strings.Contains(lower, "verification") || strings.Contains(lower, "verify"):
		return prefix + "：Microsoft 要求重新登录或验证，请在对应账号已登录的浏览器中重新授权"
	case code == "invalid_client":
		return prefix + "：Outlook 应用配置异常，请检查 Client ID"
	case code == "invalid_request":
		return prefix + "：授权请求参数异常，请重新生成授权链接"
	case strings.Contains(lower, "429") || strings.Contains(lower, "too many") || strings.Contains(lower, "throttl") || strings.Contains(lower, "rate limit"):
		return prefix + "：Microsoft 限流或请求过快，请稍后重试；如果是站斧直连，可临时打开“禁用API”改用网页读取"
	case strings.Contains(lower, "401") || strings.Contains(lower, "403") || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "forbidden"):
		return prefix + "：Outlook 授权无效或权限不足，请重新点击“API授权”"
	case strings.Contains(lower, "temporarily_unavailable") || strings.Contains(lower, "server_error"):
		return prefix + "：Microsoft 服务暂时异常，请稍后重新授权"
	default:
		if strings.TrimSpace(status) != "" {
			return prefix + "：" + status + "，请稍后重试或重新授权"
		}
		return prefix + "：请稍后重试或重新授权"
	}
}

func withMicrosoftCode(message string, code string) string {
	code = strings.TrimSpace(code)
	if code == "" {
		return message
	}
	if strings.EqualFold(code, "invalid_grant") {
		return message + "（错误类型：授权失效）"
	}
	return message + "（" + code + "）"
}

func annotateZhanfuDirectRisk(shop appcore.Shop, network networkConfig, err error) error {
	if err == nil || !strings.EqualFold(shop.AdapterName, "zhanfu") || network.Mode != "direct" {
		return err
	}
	if !isMicrosoftRiskError(err.Error()) {
		return err
	}
	if strings.Contains(err.Error(), "站斧直连提示") {
		return err
	}
	return fmt.Errorf("%w；站斧直连提示：Microsoft 可能要求验证或限流，如重复出现，请在邮箱 API 页打开该店铺的“禁用API”，改用网页读取", err)
}

func isMicrosoftRiskError(message string) bool {
	lower := strings.ToLower(message)
	markers := []string{
		"401 unauthorized",
		"403 forbidden",
		"429 too many",
		"too many requests",
		"throttl",
		"rate limit",
		"invalid_grant",
		"interaction_required",
		"authorization_pending",
		"temporarily locked",
		"unusual",
		"verify",
		"verification",
		"mfa",
		"conditional access",
		"aadsts500",
		"aadsts501",
		"aadsts700",
		"限流",
		"验证",
		"授权已失效",
		"权限不足",
	}
	for _, marker := range markers {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func parseIPCheckBody(body []byte) string {
	var parsed map[string]any
	if json.Unmarshal(body, &parsed) == nil {
		if ip := strings.TrimSpace(fmt.Sprint(parsed["ip"])); ip != "" && ip != "<nil>" {
			return ip
		}
	}
	return strings.TrimSpace(string(body))
}

func randomState() string {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 36)
	}
	return base64.RawURLEncoding.EncodeToString(buf)
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprint(value))
}

func boolFromMap(values map[string]any, key string) bool {
	return boolFromMapDefault(values, key, false)
}

func boolFromMapDefault(values map[string]any, key string, fallback bool) bool {
	if values == nil {
		return fallback
	}
	value, ok := values[key]
	if !ok {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func intOption(values map[string]any, key string, fallback int) int {
	if values == nil {
		return fallback
	}
	switch typed := values[key].(type) {
	case int:
		return typed
	case float64:
		return int(typed)
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return parsed
		}
	}
	return fallback
}

func stringOption(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	value, ok := values[key]
	if !ok || value == nil {
		return ""
	}
	out := strings.TrimSpace(fmt.Sprint(value))
	if out == "<nil>" {
		return ""
	}
	return out
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" && strings.TrimSpace(value) != "<nil>" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func isOutlookConversation(conversation appcore.Conversation) bool {
	return strings.EqualFold(strings.TrimSpace(firstNonEmpty(conversation.EmailProvider, conversation.Source)), providerOutlook) ||
		strings.EqualFold(strings.TrimSpace(conversation.Source), "outlook_api")
}

func bindingHasScope(binding map[string]any, scope string) bool {
	scope = strings.ToLower(strings.TrimSpace(scope))
	if scope == "" {
		return true
	}
	raw := strings.ToLower(strings.TrimSpace(fmt.Sprint(binding["scopes"])))
	if raw == "" || raw == "<nil>" {
		return false
	}
	for _, item := range strings.FieldsFunc(raw, func(r rune) bool { return r == ' ' || r == ',' || r == ';' }) {
		if strings.EqualFold(strings.TrimSpace(item), scope) {
			return true
		}
	}
	return false
}

func bindingHasAnyScope(binding map[string]any, scopes ...string) bool {
	for _, scope := range scopes {
		if bindingHasScope(binding, scope) {
			return true
		}
	}
	return false
}

func normalizedSubject(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	re := regexp.MustCompile(`(?i)^(\s*(re|fw|fwd)\s*:\s*)+`)
	value = re.ReplaceAllString(value, "")
	value = regexp.MustCompile(`\s+`).ReplaceAllString(value, " ")
	return strings.TrimSpace(value)
}

func normalizeIP(value string) string {
	return strings.TrimSpace(value)
}

func truncate(value string, max int) string {
	if len([]rune(value)) <= max {
		return value
	}
	runes := []rune(value)
	return string(runes[:max])
}

func cloneMap(values map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range values {
		out[key] = value
	}
	return out
}

type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	Scope        string `json:"scope"`
}

type graphMessageList struct {
	NextLink string         `json:"@odata.nextLink"`
	Value    []graphMessage `json:"value"`
}

type graphMessage struct {
	ID                string           `json:"id"`
	ConversationID    string           `json:"conversationId"`
	InternetMessageID string           `json:"internetMessageId"`
	Subject           string           `json:"subject"`
	ReceivedDateTime  string           `json:"receivedDateTime"`
	BodyPreview       string           `json:"bodyPreview"`
	WebLink           string           `json:"webLink"`
	IsRead            bool             `json:"isRead"`
	From              graphFrom        `json:"from"`
	Body              graphMessageBody `json:"body"`
	FolderRole        string           `json:"-"`
}

type graphFrom struct {
	EmailAddress graphEmailAddress `json:"emailAddress"`
}

type graphEmailAddress struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type graphMessageBody struct {
	ContentType string `json:"contentType"`
	Content     string `json:"content"`
}
