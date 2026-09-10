package mailapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"shopify-support-platform/internal/appcore"
)

const (
	googleAuthEndpoint  = "https://accounts.google.com/o/oauth2/v2/auth"
	googleTokenEndpoint = "https://oauth2.googleapis.com/token"
	gmailAPIBaseURL     = "https://gmail.googleapis.com/gmail/v1"
	gmailDefaultScope   = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send"
)

type GmailProvider struct{}

type googleOAuthConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURI  string
	Scope        string
}

type googleErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

type googleCredentialsFile struct {
	Installed googleCredentialsBlock `json:"installed"`
	Web       googleCredentialsBlock `json:"web"`
}

type googleCredentialsBlock struct {
	ClientID     string   `json:"client_id"`
	ClientSecret string   `json:"client_secret"`
	RedirectURIs []string `json:"redirect_uris"`
}

type gmailMessageList struct {
	Messages      []gmailMessageRef `json:"messages"`
	NextPageToken string            `json:"nextPageToken"`
}

type gmailMessageRef struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
}

type gmailThread struct {
	ID       string         `json:"id"`
	Messages []gmailMessage `json:"messages"`
}

type gmailMessage struct {
	ID           string       `json:"id"`
	ThreadID     string       `json:"threadId"`
	LabelIDs     []string     `json:"labelIds"`
	Snippet      string       `json:"snippet"`
	InternalDate string       `json:"internalDate"`
	Payload      gmailPayload `json:"payload"`
}

type gmailPayload struct {
	MimeType string         `json:"mimeType"`
	Headers  []gmailHeader  `json:"headers"`
	Body     gmailBody      `json:"body"`
	Parts    []gmailPayload `json:"parts"`
}

type gmailHeader struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

type gmailBody struct {
	Data string `json:"data"`
}

func (GmailProvider) AuthorizationURL(settings appcore.Settings, shop appcore.Shop) (appcore.Settings, appcore.MailAuthStartResult, error) {
	config, err := gmailOAuthConfig(settings)
	if err != nil {
		return settings, appcore.MailAuthStartResult{}, err
	}
	binding := ensureBinding(&settings, shop)
	binding["provider"] = providerGmail
	network := resolveNetwork(settings, shop, binding)
	applyNetwork(binding, network)
	state := randomState()
	binding["pending_state"] = state
	binding["pending_started_at"] = time.Now().Format(time.RFC3339)
	values := url.Values{}
	values.Set("client_id", config.ClientID)
	values.Set("response_type", "code")
	values.Set("redirect_uri", config.RedirectURI)
	values.Set("scope", config.Scope)
	values.Set("access_type", "offline")
	values.Set("prompt", "consent")
	values.Set("state", state)
	return settings, appcore.MailAuthStartResult{
		MallID:      shop.MallID,
		MailAccount: effectiveMailAccount(shop, binding),
		AuthURL:     googleAuthEndpoint + "?" + values.Encode(),
		RedirectURI: config.RedirectURI,
		State:       state,
	}, nil
}

func (p GmailProvider) CompleteAuthorization(ctx context.Context, settings appcore.Settings, codeOrURL string) (appcore.Settings, appcore.MailProxyTestResult, error) {
	code, state, err := parseCallbackCode(codeOrURL)
	if err != nil {
		return settings, appcore.MailProxyTestResult{}, err
	}
	binding := findPendingBinding(settings, state)
	if binding == nil {
		return settings, appcore.MailProxyTestResult{}, errors.New("no pending Gmail authorization was found; click API authorization again")
	}
	binding["provider"] = providerGmail
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
		config, _ := gmailOAuthConfig(settings)
		binding["scopes"] = firstNonEmpty(config.Scope, gmailDefaultScope)
	}
	binding["pending_state"] = ""
	binding["api_last_error"] = ""
	binding["authorized_at"] = time.Now().Format(time.RFC3339)
	return settings, tested, nil
}

func (p GmailProvider) ReadMessages(ctx context.Context, settings appcore.Settings, shop appcore.Shop, options map[string]any) (appcore.Settings, appcore.InboxResult, error) {
	if !apiAllowed(settings, shop) {
		return settings, emptyInbox(shop), errors.New(apiDisabledReason(settings, shop))
	}
	binding := ensureBinding(&settings, shop)
	binding["provider"] = providerGmail
	if !bindingHasScope(binding, gmailDefaultScope) {
		err := errors.New("Gmail API is missing read permission; click API authorization again")
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
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	messages, err := p.gmailUnreadMessages(ctx, network, accessToken, options)
	if err != nil {
		binding["api_last_error"] = err.Error()
		return settings, emptyInbox(shop), err
	}
	filtered, ignoredCount, ignoredFingerprints := filterGraphMessagesLikeWebProvider(options, messages, providerGmail)
	now := time.Now().Format(time.RFC3339)
	binding["api_last_error"] = ""
	binding["api_last_read_at"] = now
	result := emptyInbox(shop)
	result.Title = "Gmail API"
	result.ProviderErrors = nil
	result.Status = "ok"
	result.IgnoredEmailCount = ignoredCount
	result.IgnoredEmailFingerprints = ignoredFingerprints
	threads, warnings := p.gmailConversationThreads(ctx, network, accessToken, filtered)
	result.Warnings = append(result.Warnings, warnings...)
	result.Conversations = gmailMessagesToConversations(shop, filtered, threads, now)
	return settings, result, nil
}

func (p GmailProvider) exchangeCode(ctx context.Context, settings appcore.Settings, network networkConfig, code string) (tokenResponse, error) {
	config, err := gmailOAuthConfig(settings)
	if err != nil {
		return tokenResponse{}, err
	}
	form := url.Values{}
	form.Set("client_id", config.ClientID)
	if config.ClientSecret != "" {
		form.Set("client_secret", config.ClientSecret)
	}
	form.Set("code", code)
	form.Set("redirect_uri", config.RedirectURI)
	form.Set("grant_type", "authorization_code")
	return postGoogleToken(ctx, network, form)
}

func (p GmailProvider) accessToken(ctx context.Context, settings appcore.Settings, network networkConfig, binding map[string]any) (string, error) {
	if token := stringFromMap(binding, "access_token"); token != "" && !tokenExpired(binding) {
		return token, nil
	}
	refreshToken := stringFromMap(binding, "refresh_token")
	if refreshToken == "" {
		return "", errors.New("this shop has not completed Gmail authorization; click API authorization first")
	}
	config, err := gmailOAuthConfig(settings)
	if err != nil {
		return "", err
	}
	form := url.Values{}
	form.Set("client_id", config.ClientID)
	if config.ClientSecret != "" {
		form.Set("client_secret", config.ClientSecret)
	}
	form.Set("refresh_token", refreshToken)
	form.Set("grant_type", "refresh_token")
	token, err := postGoogleToken(ctx, network, form)
	if err != nil {
		return "", err
	}
	saveToken(binding, token)
	return token.AccessToken, nil
}

func (GmailProvider) gmailUnreadMessages(ctx context.Context, network networkConfig, accessToken string, options map[string]any) ([]graphMessage, error) {
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
	if maxMessages < 250 {
		maxMessages = 250
	}
	client, err := httpClientForNetwork(network)
	if err != nil {
		return nil, err
	}
	values := url.Values{}
	values.Set("maxResults", strconv.Itoa(pageSize))
	values.Set("labelIds", "INBOX")
	values.Set("q", gmailUnreadQuery())
	endpoint := gmailAPIBaseURL + "/users/me/messages?" + values.Encode()
	var refs []gmailMessageRef
	for endpoint != "" && len(refs) < maxMessages {
		var parsed gmailMessageList
		if err := gmailGetJSON(ctx, client, accessToken, endpoint, &parsed); err != nil {
			return nil, err
		}
		for _, ref := range parsed.Messages {
			if len(refs) >= maxMessages {
				break
			}
			refs = append(refs, ref)
		}
		if parsed.NextPageToken == "" {
			break
		}
		nextValues := url.Values{}
		nextValues.Set("maxResults", strconv.Itoa(pageSize))
		nextValues.Set("labelIds", "INBOX")
		nextValues.Set("q", gmailUnreadQuery())
		nextValues.Set("pageToken", parsed.NextPageToken)
		endpoint = gmailAPIBaseURL + "/users/me/messages?" + nextValues.Encode()
	}
	out := make([]graphMessage, len(refs))
	errs := make([]error, len(refs))
	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	for index, ref := range refs {
		index, ref := index, ref
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				errs[index] = ctx.Err()
				return
			}
			message, err := gmailGetMessage(ctx, client, accessToken, ref.ID)
			if err != nil {
				errs[index] = err
				return
			}
			out[index] = gmailMessageToGraph(message)
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			return nil, err
		}
	}
	sortGraphMessagesByReceivedAt(out)
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

func gmailUnreadQuery() string {
	return "is:unread newer_than:7d"
}

func (GmailProvider) gmailConversationThreads(ctx context.Context, network networkConfig, accessToken string, anchors []graphMessage) (map[string][]graphMessage, []string) {
	threads := map[string][]graphMessage{}
	var warnings []string
	seen := map[string]bool{}
	client, err := httpClientForNetwork(network)
	if err != nil {
		return threads, []string{"Gmail API thread history failed: " + err.Error()}
	}
	for _, anchor := range anchors {
		threadID := graphThreadID(anchor)
		if threadID == "" || seen[threadID] {
			continue
		}
		seen[threadID] = true
		thread, err := gmailGetThread(ctx, client, accessToken, threadID)
		if err != nil {
			warnings = append(warnings, "Gmail API thread history failed; showing latest mail first: "+err.Error())
			threads[threadID] = []graphMessage{anchor}
			continue
		}
		messages := make([]graphMessage, 0, len(thread.Messages))
		for _, item := range thread.Messages {
			messages = append(messages, gmailMessageToGraph(item))
		}
		if len(messages) == 0 {
			messages = []graphMessage{anchor}
		}
		sortGraphMessagesByReceivedAt(messages)
		threads[threadID] = messages
	}
	return threads, warnings
}

func gmailGetMessage(ctx context.Context, client *http.Client, accessToken string, id string) (gmailMessage, error) {
	var message gmailMessage
	endpoint := gmailAPIBaseURL + "/users/me/messages/" + url.PathEscape(id) + "?format=full"
	err := gmailGetJSON(ctx, client, accessToken, endpoint, &message)
	return message, err
}

func gmailGetThread(ctx context.Context, client *http.Client, accessToken string, id string) (gmailThread, error) {
	var thread gmailThread
	endpoint := gmailAPIBaseURL + "/users/me/threads/" + url.PathEscape(id) + "?format=full"
	err := gmailGetJSON(ctx, client, accessToken, endpoint, &thread)
	return thread, err
}

func gmailGetJSON(ctx context.Context, client *http.Client, accessToken string, endpoint string, target any) error {
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
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	_ = resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return googleAPIError("Gmail mail read failed", resp.Status, body)
	}
	return json.Unmarshal(body, target)
}

func postGoogleToken(ctx context.Context, network networkConfig, form url.Values) (tokenResponse, error) {
	client, err := httpClientForNetwork(network)
	if err != nil {
		return tokenResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, googleTokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return tokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return tokenResponse{}, err
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	_ = resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return tokenResponse{}, googleAPIError("Gmail authorization failed", resp.Status, body)
	}
	var token tokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return tokenResponse{}, err
	}
	if token.AccessToken == "" {
		return tokenResponse{}, errors.New("Gmail authorization returned no access_token")
	}
	return token, nil
}

func googleAPIError(prefix string, status string, body []byte) error {
	var parsed googleErrorResponse
	if json.Unmarshal(body, &parsed) == nil && strings.TrimSpace(parsed.Error) != "" {
		return fmt.Errorf("%s: %s %s", prefix, parsed.Error, strings.TrimSpace(parsed.ErrorDescription))
	}
	if len(strings.TrimSpace(string(body))) > 0 {
		return fmt.Errorf("%s: %s %s", prefix, status, compactBody(body))
	}
	return fmt.Errorf("%s: %s", prefix, status)
}

func gmailOAuthConfig(settings appcore.Settings) (googleOAuthConfig, error) {
	gmail := mapFromAny(settings.Mail["gmail"])
	config := googleOAuthConfig{
		ClientID:     firstNonEmpty(stringFromMap(gmail, "client_id"), stringFromMap(settings.Mail, "gmail_client_id"), os.Getenv("GMAIL_CLIENT_ID")),
		ClientSecret: firstNonEmpty(stringFromMap(gmail, "client_secret"), stringFromMap(settings.Mail, "gmail_client_secret"), os.Getenv("GMAIL_CLIENT_SECRET")),
		RedirectURI:  firstNonEmpty(stringFromMap(gmail, "redirect_uri"), stringFromMap(settings.Mail, "gmail_redirect_uri"), stringFromMap(settings.Mail, "redirect_uri"), "http://localhost:8400/"),
		Scope:        firstNonEmpty(stringFromMap(gmail, "scope"), stringFromMap(settings.Mail, "gmail_scope"), gmailDefaultScope),
	}
	if config.ClientID == "" || config.ClientSecret == "" {
		if loaded := loadGoogleCredentials(firstNonEmpty(stringFromMap(gmail, "credentials_path"), stringFromMap(settings.Mail, "gmail_credentials_path"))); loaded.ClientID != "" {
			config.ClientID = firstNonEmpty(config.ClientID, loaded.ClientID)
			config.ClientSecret = firstNonEmpty(config.ClientSecret, loaded.ClientSecret)
		}
	}
	if config.ClientID == "" {
		return config, errors.New("Gmail Client ID is not configured")
	}
	return config, nil
}

func loadGoogleCredentials(configuredPath string) googleOAuthConfig {
	homeDir, _ := os.UserHomeDir()
	candidates := compactStrings([]string{
		configuredPath,
		"gmail_credentials.json",
		filepath.Join(".", "gmail_credentials.json"),
		filepath.Join("..", "gmail_credentials.json"),
		filepath.Join(homeDir, "Documents", "客服助手", "gmail_credentials.json"),
	})
	for _, path := range candidates {
		body, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var parsed googleCredentialsFile
		if json.Unmarshal(body, &parsed) != nil {
			continue
		}
		block := parsed.Installed
		if block.ClientID == "" {
			block = parsed.Web
		}
		return googleOAuthConfig{
			ClientID:     block.ClientID,
			ClientSecret: block.ClientSecret,
			RedirectURI:  firstRedirectURI(block.RedirectURIs),
		}
	}
	return googleOAuthConfig{}
}

func firstRedirectURI(values []string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func gmailMessageToGraph(message gmailMessage) graphMessage {
	fromName, fromAddress := parseGmailFrom(gmailHeaderValue(message.Payload.Headers, "From"))
	subject := gmailHeaderValue(message.Payload.Headers, "Subject")
	receivedAt := gmailReceivedAt(message)
	body := gmailPayloadText(message.Payload)
	return graphMessage{
		ID:                message.ID,
		ConversationID:    message.ThreadID,
		InternetMessageID: gmailHeaderValue(message.Payload.Headers, "Message-ID"),
		Subject:           subject,
		ReceivedDateTime:  receivedAt,
		BodyPreview:       firstNonEmpty(message.Snippet, truncate(plainText(body), 260)),
		WebLink:           gmailWebLink(message.ThreadID),
		IsRead:            !gmailHasLabel(message.LabelIDs, "UNREAD"),
		From: graphFrom{EmailAddress: graphEmailAddress{
			Name:    fromName,
			Address: fromAddress,
		}},
		Body: graphMessageBody{ContentType: "text", Content: body},
	}
}

func gmailMessagesToConversations(shop appcore.Shop, messages []graphMessage, threads map[string][]graphMessage, fetchedAt string) []appcore.Conversation {
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
		displayMessages := outlookAPIThreadMessageItems(shop, mailAccount(shop), threadMessages)
		latestText := outlookAPILatestMessageText(message)
		if latestText == "" && len(displayMessages) > 0 {
			latestText = displayMessages[len(displayMessages)-1].Text
		}
		from := message.From.EmailAddress.Address
		out = append(out, appcore.Conversation{
			ID:                   "gmail:" + message.ID,
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
			Source:               providerGmail,
			EmailProvider:        providerGmail,
			EmailAccount:         mailAccount(shop),
			EmailMessageID:       message.ID,
			EmailThreadID:        threadID,
			EmailInternetID:      message.InternetMessageID,
			ShopKey:              appcore.ShopKey(shop),
			ShopName:             shop.DisplayName,
			MallID:               shop.MallID,
			SourceURL:            gmailWebLink(threadID),
			FetchedAt:            fetchedAt,
			RawLines:             []string{message.Subject, from, latestText},
			Messages:             displayMessages,
			CustomerProfileLines: []string{},
			OrderCartLines:       []string{},
			OrderLinks:           []appcore.InfoLink{},
			ProductCards:         []appcore.ProductCard{},
			DataSources:          []string{"gmail_api"},
		})
	}
	return out
}

func gmailPayloadText(payload gmailPayload) string {
	var plainParts []string
	var htmlParts []string
	var walk func(gmailPayload)
	walk = func(item gmailPayload) {
		data := decodeGmailBody(item.Body.Data)
		switch strings.ToLower(strings.TrimSpace(item.MimeType)) {
		case "text/plain":
			if data != "" {
				plainParts = append(plainParts, data)
			}
		case "text/html":
			if data != "" {
				htmlParts = append(htmlParts, emailReadableText(data))
			}
		}
		for _, part := range item.Parts {
			walk(part)
		}
	}
	walk(payload)
	if len(plainParts) > 0 {
		return normalizeEmailWhitespace(strings.Join(plainParts, "\n\n"))
	}
	return normalizeEmailWhitespace(strings.Join(htmlParts, "\n\n"))
}

func decodeGmailBody(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	body, err := base64.RawURLEncoding.DecodeString(value)
	if err != nil {
		body, err = base64.URLEncoding.DecodeString(value)
	}
	if err != nil {
		return ""
	}
	return string(body)
}

func gmailHeaderValue(headers []gmailHeader, name string) string {
	for _, header := range headers {
		if strings.EqualFold(header.Name, name) {
			return strings.TrimSpace(header.Value)
		}
	}
	return ""
}

func parseGmailFrom(value string) (string, string) {
	parsed, err := mail.ParseAddress(value)
	if err == nil {
		return strings.TrimSpace(parsed.Name), normalizeEmailAddress(parsed.Address)
	}
	return "", normalizeEmailAddress(value)
}

func gmailReceivedAt(message gmailMessage) string {
	if millis, err := strconv.ParseInt(strings.TrimSpace(message.InternalDate), 10, 64); err == nil && millis > 0 {
		return time.UnixMilli(millis).UTC().Format(time.RFC3339)
	}
	if date := gmailHeaderValue(message.Payload.Headers, "Date"); date != "" {
		if parsed, err := mail.ParseDate(date); err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	}
	return time.Now().UTC().Format(time.RFC3339)
}

func gmailHasLabel(labels []string, label string) bool {
	for _, item := range labels {
		if strings.EqualFold(item, label) {
			return true
		}
	}
	return false
}

func gmailWebLink(threadID string) string {
	threadID = strings.TrimSpace(threadID)
	if threadID == "" {
		return "https://mail.google.com/mail/u/0/#inbox"
	}
	return "https://mail.google.com/mail/u/0/#inbox/" + url.PathEscape(threadID)
}
