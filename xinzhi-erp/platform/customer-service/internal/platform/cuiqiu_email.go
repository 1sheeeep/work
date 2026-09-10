package platform

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	cuiqiuProvider             = "cuiqiu"
	cuiqiuAPIBaseKey           = "cuiqiu_api_base"
	cuiqiuMailIDKey            = "cuiqiu_mail_id"
	cuiqiuDomainIDKey          = "cuiqiu_domain_id"
	cuiqiuSMTPHostKey          = "cuiqiu_smtp_host"
	cuiqiuSMTPPortKey          = "cuiqiu_smtp_port"
	cuiqiuSMTPModeKey          = "cuiqiu_smtp_mode"
	cuiqiuProfileDomainKey     = "cuiqiu_profile_domain"
	cuiqiuLastTimestampKey     = "cuiqiu_last_timestamp"
	cuiqiuDefaultAPIBase       = "https://domain-open-api.cuiqiu.com"
	cuiqiuDefaultHistoryFrom   = "2000-01-01"
	cuiqiuMessagePageSize      = 20
	cuiqiuMaxSyncPages         = 500
	cuiqiuIncrementalBatchSize = 20
)

type cuiqiuConnectRequest struct {
	Mailbox      string `json:"mailbox"`
	SMTPPassword string `json:"smtpPassword"`
}

type cuiqiuConnectResponse struct {
	Source     ShopSource `json:"source"`
	WebhookURL string     `json:"webhookUrl"`
}

type cuiqiuConfig struct {
	APIBase      string
	Token        string
	MailID       string
	DomainID     string
	Mailbox      string
	SMTPHost     string
	SMTPPort     int
	SMTPMode     string
	SMTPPassword string
}

type cuiqiuEnvelope struct {
	Code int             `json:"code"`
	Msg  string          `json:"msg"`
	Data json.RawMessage `json:"data"`
}

type cuiqiuMailAccount struct {
	ID   string `json:"id"`
	Mail string `json:"mail"`
}

type cuiqiuMailListData struct {
	List []cuiqiuMailAccount `json:"list"`
}

type cuiqiuAddress string

func (value *cuiqiuAddress) UnmarshalJSON(raw []byte) error {
	if string(raw) == "null" {
		*value = ""
		return nil
	}
	var direct string
	if err := json.Unmarshal(raw, &direct); err == nil {
		*value = cuiqiuAddress(strings.TrimSpace(direct))
		return nil
	}
	var entries []json.RawMessage
	if err := json.Unmarshal(raw, &entries); err == nil {
		for _, entry := range entries {
			if parsed := parseCuiqiuAddressValue(entry); parsed != "" {
				*value = cuiqiuAddress(parsed)
				return nil
			}
		}
		*value = ""
		return nil
	}
	if parsed := parseCuiqiuAddressValue(raw); parsed != "" {
		*value = cuiqiuAddress(parsed)
		return nil
	}
	return fmt.Errorf("unsupported Cuiqiu address response")
}

func parseCuiqiuAddressValue(raw []byte) string {
	var direct string
	if err := json.Unmarshal(raw, &direct); err == nil {
		return strings.TrimSpace(direct)
	}
	var entry struct {
		Name    string `json:"name"`
		Address string `json:"address"`
		Email   string `json:"email"`
		Mail    string `json:"mail"`
	}
	if err := json.Unmarshal(raw, &entry); err != nil {
		return ""
	}
	address := normalizeEmail(firstNonEmpty(entry.Address, entry.Email, entry.Mail))
	if address == "" {
		return ""
	}
	if strings.TrimSpace(entry.Name) == "" {
		return address
	}
	return (&mail.Address{Name: strings.TrimSpace(entry.Name), Address: address}).String()
}

type cuiqiuJSONText string

func (value *cuiqiuJSONText) UnmarshalJSON(raw []byte) error {
	if string(raw) == "null" {
		*value = ""
		return nil
	}
	var direct string
	if err := json.Unmarshal(raw, &direct); err == nil {
		*value = cuiqiuJSONText(direct)
		return nil
	}
	if !json.Valid(raw) {
		return fmt.Errorf("invalid Cuiqiu JSON field")
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, raw); err != nil {
		return err
	}
	*value = cuiqiuJSONText(compact.String())
	return nil
}

type cuiqiuMessageSummary struct {
	From      cuiqiuAddress `json:"from"`
	ID        string        `json:"id"`
	Subject   string        `json:"subject"`
	Time      string        `json:"time"`
	Timestamp int64         `json:"timestamp"`
	To        cuiqiuAddress `json:"to"`
}

type cuiqiuMessageListData struct {
	List  []cuiqiuMessageSummary `json:"list"`
	Total int                    `json:"total"`
}

type cuiqiuMessageDetail struct {
	From              cuiqiuAddress  `json:"from"`
	ID                string         `json:"id"`
	Subject           string         `json:"subject"`
	Time              string         `json:"time"`
	Timestamp         int64          `json:"timestamp"`
	To                cuiqiuAddress  `json:"to"`
	Body              string         `json:"body"`
	PlainText         string         `json:"plain_text"`
	Attachments       cuiqiuJSONText `json:"attachments"`
	Header            cuiqiuJSONText `json:"header"`
	Headers           cuiqiuJSONText `json:"headers"`
	RequestHeader     cuiqiuJSONText `json:"request_header"`
	RawHeader         cuiqiuJSONText `json:"raw_header"`
	InternetMessageID string         `json:"internet_message_id"`
	HeaderMessageID   string         `json:"message_id_header"`
	References        cuiqiuJSONText `json:"references"`
	InReplyTo         string         `json:"in_reply_to"`
}

type cuiqiuAttachment struct {
	FileName    string `json:"filename"`
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	MIMEType    string `json:"mime_type"`
	Base64Data  string `json:"base64_data"`
	Data        string `json:"data"`
}

type cuiqiuMessageDetailData struct {
	List    []cuiqiuMessageDetail `json:"list"`
	Content cuiqiuMessageDetail   `json:"content"`
}

type cuiqiuHistoryCursor struct {
	Page int `json:"page"`
}

type cuiqiuWebhookAddress struct {
	Name    string `json:"name"`
	Address string `json:"address"`
}

type cuiqiuWebhookPayload struct {
	MessageTo []cuiqiuWebhookAddress `json:"msg_to"`
	SMTPTo    string                 `json:"smtp_to"`
}

var (
	cuiqiuHTTPClient           = &http.Client{Timeout: 45 * time.Second}
	verifyCuiqiuSMTPConnection = verifyCuiqiuSMTP
	dialCuiqiuSMTPConnection   = dialCuiqiuSMTP
	cuiqiuSMTPRouteCache       sync.Map
)

func (s *Server) handleCuiqiuConnect(w http.ResponseWriter, r *http.Request, shopID string) {
	var input cuiqiuConnectRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.connectCuiqiuEmail(r.Context(), shopID, input, requestBaseURL(r))
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: result.Source.ID, Payload: result.Source, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) connectCuiqiuEmail(ctx context.Context, shopID string, input cuiqiuConnectRequest, baseURL string) (cuiqiuConnectResponse, error) {
	if _, err := s.store.GetShop(ctx, shopID); err != nil {
		return cuiqiuConnectResponse{}, err
	}
	credentials, err := normalizeCuiqiuConnectRequest(input)
	if err != nil {
		return cuiqiuConnectResponse{}, err
	}
	if err := s.ensureEmailMailboxAvailable(ctx, shopID, credentials.Mailbox); err != nil {
		return cuiqiuConnectResponse{}, err
	}
	settings, token, err := s.resolveCuiqiuDomainSettings(ctx, emailDomain(credentials.Mailbox))
	if err != nil {
		return cuiqiuConnectResponse{}, err
	}
	config := cuiqiuConfig{
		Mailbox: credentials.Mailbox, SMTPPassword: credentials.SMTPPassword,
		APIBase: settings.APIBase, Token: token, DomainID: settings.DomainID,
		SMTPHost: settings.SMTPHost, SMTPPort: settings.SMTPPort, SMTPMode: settings.SMTPMode,
	}
	config.MailID, err = lookupCuiqiuMailID(ctx, config)
	if err != nil {
		return cuiqiuConnectResponse{}, newCuiqiuValidationError("脆球邮箱匹配", err)
	}
	if err := verifyCuiqiuReceiveConnection(ctx, config); err != nil {
		return cuiqiuConnectResponse{}, newCuiqiuValidationError("脆球收件 API 验证", err)
	}
	if err := verifyCuiqiuSMTPConnection(config); err != nil {
		return cuiqiuConnectResponse{}, newCuiqiuValidationError("脆球 SMTP 验证", err)
	}

	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return cuiqiuConnectResponse{}, err
	}
	var source ShopSource
	for _, existing := range sources {
		if existing.Type == SourceTypeEmail && normalizeEmail(sourceEmailAddress(existing)) == config.Mailbox {
			source = existing
			break
		}
	}
	metadata := newEmailSyncMetadata(config.Mailbox, "cuiqiu_api_smtp", emailInitialImportNow)
	metadata = applyCuiqiuDomainSettings(metadata, settings)
	metadata[cuiqiuMailIDKey] = config.MailID
	metadata[emailNotificationStatusKey] = "pending"
	metadata[emailHealthStatusKey] = "ok"
	metadata["email_notification_mode"] = "webhook+daily_reconcile"
	metadata["email_sync_interval"] = "webhook+24h_reconcile"
	if source.ID == "" {
		source, err = s.store.CreateShopSource(ctx, ShopSource{
			ShopID: shopID, Type: SourceTypeEmail, Provider: cuiqiuProvider,
			Address: config.Mailbox, Status: SourceStatusActive, Metadata: metadata,
		})
	} else {
		source, err = s.store.UpdateShopSource(ctx, shopID, source.ID, ShopSource{
			Provider: cuiqiuProvider, Address: config.Mailbox, Status: SourceStatusActive, Metadata: metadata,
		})
	}
	if err != nil {
		return cuiqiuConnectResponse{}, err
	}
	_, err = s.store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID: shopID, Mailbox: config.Mailbox, Provider: cuiqiuProvider,
		AccessToken: config.Token, RefreshToken: config.SMTPPassword,
		Scope: "cuiqiu.receive cuiqiu.read smtp.send", ExpiresAt: time.Now().UTC().AddDate(10, 0, 0),
	})
	if err != nil {
		return cuiqiuConnectResponse{}, err
	}
	s.scheduleEmailSourceSync(source, "cuiqiu-connect")
	webhookURL := cuiqiuDomainWebhookURL(baseURL, settings.Domain, token)
	return cuiqiuConnectResponse{Source: source, WebhookURL: webhookURL}, nil
}

func verifyCuiqiuReceiveConnection(ctx context.Context, config cuiqiuConfig) error {
	today := time.Now().UTC()
	start := today.AddDate(0, 0, -1).Format("2006-01-02")
	end := today.AddDate(0, 0, 1).Format("2006-01-02")
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		listed, err := fetchCuiqiuMessageList(ctx, config, "Inbox", start, end, 1, cuiqiuMessagePageSize)
		if err == nil && len(listed.List) > 0 {
			_, err = fetchCuiqiuMessageDetail(ctx, config, "Inbox", listed.List[0].ID)
		}
		if err == nil {
			return nil
		}
		lastErr = err
		if attempt == 0 {
			if err := waitEmailProviderRetry(ctx, 200*time.Millisecond); err != nil {
				return err
			}
		}
	}
	return lastErr
}

type cuiqiuValidationError struct {
	operation string
	cause     error
}

func newCuiqiuValidationError(operation string, cause error) error {
	return &cuiqiuValidationError{operation: strings.TrimSpace(operation), cause: cause}
}

func (e *cuiqiuValidationError) Error() string {
	return e.operation + "失败；实际错误：" + e.cause.Error()
}

func (e *cuiqiuValidationError) Unwrap() error {
	return e.cause
}

func (e *cuiqiuValidationError) Is(target error) bool {
	return target == ErrInvalid || errors.Is(e.cause, target)
}

func normalizeCuiqiuConnectRequest(input cuiqiuConnectRequest) (cuiqiuConfig, error) {
	config := cuiqiuConfig{
		Mailbox: normalizeEmail(input.Mailbox), SMTPPassword: input.SMTPPassword,
	}
	if config.Mailbox == "" {
		return cuiqiuConfig{}, fmt.Errorf("%w: mailbox is required", ErrInvalid)
	}
	parsedMailbox, err := mail.ParseAddress(config.Mailbox)
	if err != nil || normalizeEmail(parsedMailbox.Address) != config.Mailbox || !strings.Contains(config.Mailbox, "@") {
		return cuiqiuConfig{}, fmt.Errorf("%w: mailbox must be a valid email address", ErrInvalid)
	}
	if config.SMTPPassword == "" {
		return cuiqiuConfig{}, fmt.Errorf("%w: 请输入邮箱密码", ErrInvalid)
	}
	return config, nil
}

func cuiqiuConfigFrom(source ShopSource, installation EmailInstallation) (cuiqiuConfig, error) {
	port, _ := strconv.Atoi(strings.TrimSpace(source.Metadata[cuiqiuSMTPPortKey]))
	config := cuiqiuConfig{
		Mailbox: normalizeEmail(sourceEmailAddress(source)), APIBase: strings.TrimRight(strings.TrimSpace(source.Metadata[cuiqiuAPIBaseKey]), "/"),
		Token: strings.TrimSpace(installation.AccessToken), MailID: strings.TrimSpace(source.Metadata[cuiqiuMailIDKey]),
		DomainID: strings.TrimSpace(source.Metadata[cuiqiuDomainIDKey]), SMTPHost: strings.TrimSpace(source.Metadata[cuiqiuSMTPHostKey]),
		SMTPPort: port, SMTPMode: strings.ToLower(strings.TrimSpace(source.Metadata[cuiqiuSMTPModeKey])), SMTPPassword: installation.RefreshToken,
	}
	if config.APIBase == "" {
		config.APIBase = cuiqiuDefaultAPIBase
	}
	if config.SMTPMode == "" {
		config.SMTPMode = "tls"
	}
	if config.SMTPPort == 0 {
		if config.SMTPMode == "starttls" {
			config.SMTPPort = 587
		} else {
			config.SMTPPort = 465
		}
	}
	if config.Mailbox == "" || config.Token == "" || config.MailID == "" {
		return cuiqiuConfig{}, fmt.Errorf("%w: Cuiqiu receive configuration is incomplete", ErrInvalid)
	}
	return config, nil
}

func lookupCuiqiuMailID(ctx context.Context, config cuiqiuConfig) (string, error) {
	fields := map[string]string{"mail": config.Mailbox, "limit": "20", "sort_value": "created_at", "sort_type": "desc"}
	if config.DomainID != "" {
		fields["domain_id"] = config.DomainID
	}
	var data cuiqiuMailListData
	if err := postCuiqiu(ctx, config, "/v2/mail/list", fields, &data); err != nil {
		return "", err
	}
	for _, account := range data.List {
		if normalizeEmail(account.Mail) == config.Mailbox && strings.TrimSpace(account.ID) != "" {
			return strings.TrimSpace(account.ID), nil
		}
	}
	return "", fmt.Errorf("mailbox %s was not present in the Cuiqiu /v2/mail/list response", config.Mailbox)
}

func fetchCuiqiuMessageList(ctx context.Context, config cuiqiuConfig, folder string, start string, end string, page int, limit int) (cuiqiuMessageListData, error) {
	var data cuiqiuMessageListData
	if err := postCuiqiu(ctx, config, "/v1/message/list", map[string]string{
		"folder": folder, "mail_id": config.MailID, "start_time": start, "end_time": end,
		"page": strconv.Itoa(page), "limit": strconv.Itoa(limit),
	}, &data); err != nil {
		return cuiqiuMessageListData{}, err
	}
	return data, nil
}

func fetchCuiqiuMessageDetail(ctx context.Context, config cuiqiuConfig, folder string, messageID string) (cuiqiuMessageDetail, error) {
	var data cuiqiuMessageDetailData
	if err := postCuiqiu(ctx, config, "/v1/message/detail", map[string]string{
		"folder": folder, "mail_id": config.MailID, "message_id": strings.TrimSpace(messageID), "request_header": "1",
	}, &data); err != nil {
		return cuiqiuMessageDetail{}, err
	}
	if len(data.List) == 0 {
		if strings.TrimSpace(data.Content.ID) == "" {
			return cuiqiuMessageDetail{}, fmt.Errorf("Cuiqiu returned an empty detail for message %s", strings.TrimSpace(messageID))
		}
		return data.Content, nil
	}
	return data.List[0], nil
}

func setCuiqiuMessageRead(ctx context.Context, config cuiqiuConfig, messageID string, read bool) error {
	status := "0"
	if read {
		status = "1"
	}
	return postCuiqiu(ctx, config, "/v1/message/seen", map[string]string{
		"folder": "Inbox", "mail_id": config.MailID, "message_id": strings.TrimSpace(messageID), "status": status,
	}, nil)
}

func postCuiqiu(ctx context.Context, config cuiqiuConfig, endpoint string, fields map[string]string, target any) error {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("token", config.Token); err != nil {
		return err
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return err
		}
	}
	if err := writer.Close(); err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(config.APIBase, "/")+endpoint, &body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Accept", "application/json")
	resp, err := cuiqiuHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("Cuiqiu API request failed: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: providerResponseBodyForDisplay(raw), RetryAfter: resp.Header.Get("Retry-After")}
	}
	var envelope cuiqiuEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("Cuiqiu API returned invalid JSON: %v; actual response: %s", err, providerResponseBodyForDisplay(raw))
	}
	if envelope.Code != 0 && envelope.Code != 200 {
		return fmt.Errorf("Cuiqiu API returned failure fields: %s", providerResponseBodyForDisplay(raw))
	}
	if target == nil || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		return nil
	}
	return json.Unmarshal(envelope.Data, target)
}

func fetchCuiqiuSyncBatch(ctx context.Context, accessToken string, mailbox string, source ShopSource) (emailProviderSyncBatch, error) {
	installation := EmailInstallation{Mailbox: mailbox, Provider: cuiqiuProvider, AccessToken: accessToken}
	config, err := cuiqiuConfigFrom(source, installation)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	startedAt, ok := parseEmailSyncTime(source.Metadata[emailSyncStartedAtKey])
	if !ok {
		startedAt = time.Now().UTC()
	}
	lastTimestamp, _ := strconv.ParseInt(strings.TrimSpace(source.Metadata[cuiqiuLastTimestampKey]), 10, 64)
	if lastTimestamp <= 0 {
		lastTimestamp = startedAt.Unix()
	}
	start := time.Unix(lastTimestamp, 0).UTC().AddDate(0, 0, -1).Format("2006-01-02")
	end := time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")
	summaries := make([]cuiqiuMessageSummary, 0, cuiqiuMessagePageSize)
	seenSummaryIDs := map[string]bool{}
	complete := false
	for page := 1; page <= cuiqiuMaxSyncPages; page++ {
		listed, err := fetchCuiqiuMessageList(ctx, config, "Inbox", start, end, page, cuiqiuMessagePageSize)
		if err != nil {
			return emailProviderSyncBatch{}, err
		}
		allOlder := len(listed.List) > 0
		for _, summary := range listed.List {
			if summary.Timestamp >= lastTimestamp {
				allOlder = false
			}
			if strings.TrimSpace(summary.ID) == "" || seenSummaryIDs[summary.ID] {
				continue
			}
			seenSummaryIDs[summary.ID] = true
			summaries = append(summaries, summary)
		}
		if len(listed.List) < cuiqiuMessagePageSize || (listed.Total > 0 && page*cuiqiuMessagePageSize >= listed.Total) {
			complete = true
			break
		}
		if allOlder {
			complete = true
			break
		}
	}
	if !complete {
		return emailProviderSyncBatch{}, fmt.Errorf("Cuiqiu incremental sync exceeded %d messages; cursor was not advanced", cuiqiuMessagePageSize*cuiqiuMaxSyncPages)
	}
	seenAtCursor := map[string]bool{}
	if raw := strings.TrimSpace(source.Metadata["cuiqiu_cursor_seen_ids"]); raw != "" {
		var ids []string
		if json.Unmarshal([]byte(raw), &ids) == nil {
			for _, id := range ids {
				seenAtCursor[strings.TrimSpace(id)] = true
			}
		}
	}
	relevant := make([]cuiqiuMessageSummary, 0, len(summaries))
	for _, summary := range summaries {
		if summary.Timestamp > 0 && summary.Timestamp < lastTimestamp {
			continue
		}
		if summary.Timestamp == lastTimestamp && seenAtCursor[summary.ID] {
			continue
		}
		relevant = append(relevant, summary)
	}
	sort.SliceStable(relevant, func(i, j int) bool {
		if relevant[i].Timestamp != relevant[j].Timestamp {
			return relevant[i].Timestamp < relevant[j].Timestamp
		}
		return relevant[i].ID < relevant[j].ID
	})
	backlogPending := len(relevant) > cuiqiuIncrementalBatchSize
	if backlogPending {
		relevant = relevant[:cuiqiuIncrementalBatchSize]
	}
	messages := make([]incomingEmailMessage, 0, len(relevant))
	cursorTimestamp := lastTimestamp
	cursorSeen := seenAtCursor
	for _, summary := range relevant {
		detail, detailErr := fetchCuiqiuMessageDetail(ctx, config, "Inbox", summary.ID)
		if detailErr != nil {
			return emailProviderSyncBatch{}, detailErr
		}
		messages = append(messages, cuiqiuDetailToIncoming(config.Mailbox, detail))
		messageTimestamp := detail.Timestamp
		if messageTimestamp <= 0 {
			messageTimestamp = summary.Timestamp
		}
		if messageTimestamp > cursorTimestamp {
			cursorTimestamp = messageTimestamp
			cursorSeen = map[string]bool{}
		}
		if messageTimestamp == cursorTimestamp {
			cursorSeen[summary.ID] = true
		}
	}
	cursorIDs := make([]string, 0, len(cursorSeen))
	for id := range cursorSeen {
		if id != "" {
			cursorIDs = append(cursorIDs, id)
		}
	}
	sort.Strings(cursorIDs)
	if len(cursorIDs) > 1000 {
		cursorIDs = cursorIDs[len(cursorIDs)-1000:]
	}
	encodedCursorIDs, _ := json.Marshal(cursorIDs)
	updates := map[string]string{
		emailSyncVersionKey: emailSyncVersionCurrent, "email_sync_mode": "incremental",
		cuiqiuLastTimestampKey:   strconv.FormatInt(cursorTimestamp, 10),
		"cuiqiu_cursor_seen_ids": string(encodedCursorIDs),
	}
	return emailProviderSyncBatch{Messages: messages, MetadataUpdates: updates, BacklogPending: backlogPending}, nil
}

func fetchCuiqiuHistoryPage(ctx context.Context, job EmailHistoryImportJob, source ShopSource, installation EmailInstallation) (emailHistoryPage, error) {
	config, err := cuiqiuConfigFrom(source, installation)
	if err != nil {
		return emailHistoryPage{}, err
	}
	cursor := cuiqiuHistoryCursor{Page: 1}
	if strings.TrimSpace(job.Cursor) != "" {
		if err := json.Unmarshal([]byte(job.Cursor), &cursor); err != nil || cursor.Page < 1 {
			return emailHistoryPage{}, fmt.Errorf("invalid Cuiqiu history cursor")
		}
	}
	end := time.Now().UTC().AddDate(0, 0, 1).Format("2006-01-02")
	listed, err := fetchCuiqiuMessageList(ctx, config, "Inbox", cuiqiuDefaultHistoryFrom, end, cursor.Page, cuiqiuMessagePageSize)
	if err != nil {
		return emailHistoryPage{}, err
	}
	messages := make([]incomingEmailMessage, 0, len(listed.List))
	for _, summary := range listed.List {
		detail, detailErr := fetchCuiqiuMessageDetail(ctx, config, "Inbox", summary.ID)
		if detailErr != nil {
			return emailHistoryPage{}, detailErr
		}
		messages = append(messages, cuiqiuDetailToIncoming(config.Mailbox, detail))
	}
	done := len(listed.List) < cuiqiuMessagePageSize || (listed.Total > 0 && cursor.Page*cuiqiuMessagePageSize >= listed.Total)
	next := ""
	if !done {
		raw, _ := json.Marshal(cuiqiuHistoryCursor{Page: cursor.Page + 1})
		next = string(raw)
	}
	return emailHistoryPage{Messages: messages, Scanned: len(listed.List), NextCursor: next, Done: done}, nil
}

func cuiqiuDetailToIncoming(mailbox string, detail cuiqiuMessageDetail) incomingEmailMessage {
	senderName, senderEmail := parseMailAddress(string(detail.From))
	if senderEmail == "" {
		senderEmail = normalizeEmail(string(detail.From))
	}
	body := strings.TrimSpace(detail.PlainText)
	if body == "" {
		body = htmlToPlainText(detail.Body)
	}
	receivedAt := time.Now().UTC()
	if detail.Timestamp > 0 {
		receivedAt = time.Unix(detail.Timestamp, 0).UTC()
	} else if parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(detail.Time)); err == nil {
		receivedAt = parsed.UTC()
	}
	messageID := strings.TrimSpace(detail.ID)
	direction := MessageDirectionCustomer
	if normalizeEmail(senderEmail) == normalizeEmail(mailbox) {
		direction = MessageDirectionAgent
	}
	customerName, customerEmail := senderName, senderEmail
	if direction == MessageDirectionAgent {
		customerName, customerEmail = parseMailAddress(string(detail.To))
		if customerEmail == "" {
			customerEmail = normalizeEmail(string(detail.To))
		}
	}
	threadID := cuiqiuThreadID(customerEmail, detail.Subject, messageID)
	metadata := map[string]string{
		"cuiqiu_message_id": messageID,
		"mail_api_provider": cuiqiuProvider, "mail_api_mailbox": normalizeEmail(mailbox),
		"mail_reply_to_email": customerEmail, "mail_reply_to_name": customerName,
	}
	headerMessageID, references := cuiqiuMailThreadHeaders(detail)
	if headerMessageID != "" {
		metadata["mail_message_id"] = headerMessageID
	}
	if references != "" {
		metadata["mail_references"] = references
	}
	if strings.TrimSpace(detail.Time) != "" {
		metadata["email_received_at_original"] = strings.TrimSpace(detail.Time)
	}
	attachments, attachmentErr := parseCuiqiuAttachments(detail.Attachments)
	if strings.TrimSpace(string(detail.Attachments)) != "" && strings.TrimSpace(string(detail.Attachments)) != "[]" {
		metadata["email_has_attachments"] = "true"
	}
	if attachmentErr != nil {
		metadata["email_attachment_import_error"] = truncateEmailPreview(attachmentErr.Error(), 500)
	}
	return incomingEmailMessage{
		ExternalConversationID: threadID, CustomerName: customerName, CustomerEmail: customerEmail,
		SenderName: senderName, SenderEmail: senderEmail, Subject: strings.TrimSpace(detail.Subject), Body: body,
		ReplyToName: customerName, ReplyToEmail: customerEmail,
		SourceMessageID: cuiqiuProvider + ":" + messageID, Metadata: metadata, Attachments: attachments,
		ReceivedAt: receivedAt, Direction: direction,
	}
}

func parseCuiqiuAttachments(raw cuiqiuJSONText) ([]incomingEmailAttachment, error) {
	value := strings.TrimSpace(string(raw))
	if value == "" || value == "[]" || value == "null" {
		return nil, nil
	}
	var providerAttachments []cuiqiuAttachment
	if err := json.Unmarshal([]byte(value), &providerAttachments); err != nil {
		return nil, fmt.Errorf("Cuiqiu attachments field could not be decoded: %w", err)
	}
	attachments := make([]incomingEmailAttachment, 0, len(providerAttachments))
	warnings := make([]string, 0)
	for index, attachment := range providerAttachments {
		fileName := strings.TrimSpace(firstNonEmpty(attachment.FileName, attachment.Name))
		encoded := strings.Map(func(r rune) rune {
			if r == '\r' || r == '\n' || r == '\t' || r == ' ' {
				return -1
			}
			return r
		}, firstNonEmpty(attachment.Base64Data, attachment.Data))
		if encoded == "" {
			warnings = append(warnings, fmt.Sprintf("Cuiqiu attachment %d (%s) did not include base64_data", index+1, firstNonEmpty(fileName, "unnamed")))
			continue
		}
		content, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			content, err = base64.RawStdEncoding.DecodeString(encoded)
		}
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("Cuiqiu attachment %d (%s) contained invalid base64_data: %v", index+1, firstNonEmpty(fileName, "unnamed"), err))
			continue
		}
		attachments = append(attachments, incomingEmailAttachment{
			FileName: fileName,
			MIMEType: strings.TrimSpace(firstNonEmpty(attachment.ContentType, attachment.MIMEType)),
			Content:  content,
		})
	}
	if len(warnings) > 0 {
		return attachments, errors.New(strings.Join(warnings, "; "))
	}
	return attachments, nil
}

func cuiqiuMailThreadHeaders(detail cuiqiuMessageDetail) (string, string) {
	values := map[string]string{
		"message-id":  firstNonEmpty(detail.HeaderMessageID, detail.InternetMessageID),
		"references":  strings.TrimSpace(string(detail.References)),
		"in-reply-to": strings.TrimSpace(detail.InReplyTo),
	}
	for _, raw := range []cuiqiuJSONText{detail.Header, detail.Headers, detail.RequestHeader, detail.RawHeader} {
		collectCuiqiuMailHeaders(strings.TrimSpace(string(raw)), values)
	}
	messageID := strings.TrimSpace(values["message-id"])
	references := strings.TrimSpace(values["references"])
	if references == "" {
		references = strings.TrimSpace(values["in-reply-to"])
	}
	return messageID, references
}

func collectCuiqiuMailHeaders(raw string, values map[string]string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return
	}
	var decoded any
	if json.Unmarshal([]byte(raw), &decoded) == nil {
		collectCuiqiuMailHeaderValue(decoded, values)
		return
	}
	reader, err := mail.ReadMessage(strings.NewReader(raw + "\r\n\r\n"))
	if err != nil {
		return
	}
	for _, name := range []string{"Message-ID", "References", "In-Reply-To"} {
		setCuiqiuMailHeader(values, name, reader.Header.Get(name))
	}
}

func collectCuiqiuMailHeaderValue(value any, values map[string]string) {
	switch typed := value.(type) {
	case string:
		collectCuiqiuMailHeaders(typed, values)
	case []any:
		for _, item := range typed {
			collectCuiqiuMailHeaderValue(item, values)
		}
	case map[string]any:
		name, _ := typed["name"].(string)
		if name == "" {
			name, _ = typed["key"].(string)
		}
		if name != "" {
			setCuiqiuMailHeader(values, name, cuiqiuMailHeaderText(typed["value"]))
		}
		for key, item := range typed {
			normalized := normalizeCuiqiuMailHeaderName(key)
			switch normalized {
			case "message-id", "references", "in-reply-to":
				setCuiqiuMailHeader(values, normalized, cuiqiuMailHeaderText(item))
			case "header", "headers", "request-header", "raw-header":
				collectCuiqiuMailHeaderValue(item, values)
			}
		}
	}
}

func setCuiqiuMailHeader(values map[string]string, name string, value string) {
	name = normalizeCuiqiuMailHeaderName(name)
	value = strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(value, "\r", " "), "\n", " "))
	if value != "" && values[name] == "" {
		values[name] = value
	}
}

func normalizeCuiqiuMailHeaderName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "-")
	switch strings.ReplaceAll(value, "-", "") {
	case "messageid", "internetmessageid":
		return "message-id"
	case "inreplyto":
		return "in-reply-to"
	case "requestheader":
		return "request-header"
	case "rawheader":
		return "raw-header"
	}
	return value
}

func cuiqiuMailHeaderText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := cuiqiuMailHeaderText(item); strings.TrimSpace(text) != "" {
				parts = append(parts, strings.TrimSpace(text))
			}
		}
		return strings.Join(parts, " ")
	default:
		return ""
	}
}

func cuiqiuThreadID(senderEmail string, subject string, messageID string) string {
	normalizedSubject := strings.ToLower(strings.TrimSpace(subject))
	for {
		previous := normalizedSubject
		for _, prefix := range []string{"re:", "fw:", "fwd:", "回复:", "答复:"} {
			normalizedSubject = strings.TrimSpace(strings.TrimPrefix(normalizedSubject, prefix))
		}
		if normalizedSubject == previous {
			break
		}
	}
	key := normalizeEmail(senderEmail) + "|" + normalizedSubject
	if key == "|" {
		return strings.TrimSpace(messageID)
	}
	return key
}

type cuiqiuSMTPAuthMethod string

const (
	cuiqiuSMTPAuthPlain cuiqiuSMTPAuthMethod = "plain"
	cuiqiuSMTPAuthLogin cuiqiuSMTPAuthMethod = "login"
)

type cuiqiuSMTPAttempt struct {
	Config     cuiqiuConfig
	AuthMethod cuiqiuSMTPAuthMethod
}

type cuiqiuSMTPRoute struct {
	Port       int
	Mode       string
	AuthMethod cuiqiuSMTPAuthMethod
}

type cuiqiuLoginAuth struct {
	username string
	password string
}

func (a *cuiqiuLoginAuth) Start(server *smtp.ServerInfo) (string, []byte, error) {
	if !server.TLS && server.Name != "localhost" {
		return "", nil, errors.New("unencrypted SMTP connection")
	}
	return "LOGIN", nil, nil
}

func (a *cuiqiuLoginAuth) Next(challenge []byte, more bool) ([]byte, error) {
	if !more {
		return nil, nil
	}
	normalizedChallenge := strings.Trim(strings.ToLower(strings.TrimSpace(string(challenge))), ":")
	switch normalizedChallenge {
	case "username", "user name":
		return []byte(a.username), nil
	case "password":
		return []byte(a.password), nil
	default:
		return nil, fmt.Errorf("unexpected SMTP LOGIN challenge %q", strings.TrimSpace(string(challenge)))
	}
}

func verifyCuiqiuSMTP(config cuiqiuConfig) error {
	client, err := authenticatedCuiqiuSMTPClient(config)
	if err != nil {
		return err
	}
	defer client.Close()
	if err := client.Mail(config.Mailbox); err != nil {
		return fmt.Errorf("sender rejected: %w", err)
	}
	if err := client.Reset(); err != nil {
		return fmt.Errorf("SMTP reset failed: %w", err)
	}
	return client.Quit()
}

func authenticatedCuiqiuSMTPClient(config cuiqiuConfig) (*smtp.Client, error) {
	attempts := cuiqiuSMTPAttempts(config)
	failures := make([]error, 0, len(attempts))
	unreachableTransports := map[string]bool{}
	for _, attempt := range attempts {
		transportKey := strconv.Itoa(attempt.Config.SMTPPort) + "/" + attempt.Config.SMTPMode
		if unreachableTransports[transportKey] {
			continue
		}
		client, err := dialCuiqiuSMTPConnection(attempt.Config)
		if err != nil {
			unreachableTransports[transportKey] = true
			failures = append(failures, fmt.Errorf("%d/%s connection failed: %w", attempt.Config.SMTPPort, attempt.Config.SMTPMode, err))
			continue
		}
		auth := cuiqiuSMTPAuth(attempt)
		if err = client.Auth(auth); err == nil {
			cuiqiuSMTPRouteCache.Store(cuiqiuSMTPRouteKey(config), cuiqiuSMTPRoute{
				Port: attempt.Config.SMTPPort, Mode: attempt.Config.SMTPMode, AuthMethod: attempt.AuthMethod,
			})
			return client, nil
		}
		_ = client.Close()
		failures = append(failures, fmt.Errorf("%d/%s AUTH %s failed: %w", attempt.Config.SMTPPort, attempt.Config.SMTPMode, strings.ToUpper(string(attempt.AuthMethod)), err))
	}
	cuiqiuSMTPRouteCache.Delete(cuiqiuSMTPRouteKey(config))
	return nil, fmt.Errorf("SMTP authentication attempts failed: %w", errors.Join(failures...))
}

func cuiqiuSMTPAuth(attempt cuiqiuSMTPAttempt) smtp.Auth {
	if attempt.AuthMethod == cuiqiuSMTPAuthLogin {
		return &cuiqiuLoginAuth{username: attempt.Config.Mailbox, password: attempt.Config.SMTPPassword}
	}
	return smtp.PlainAuth("", attempt.Config.Mailbox, attempt.Config.SMTPPassword, attempt.Config.SMTPHost)
}

func cuiqiuSMTPAttempts(config cuiqiuConfig) []cuiqiuSMTPAttempt {
	primary := config
	primary.SMTPMode = strings.ToLower(strings.TrimSpace(primary.SMTPMode))
	transports := []cuiqiuConfig{primary}
	if primary.SMTPPort == 587 && primary.SMTPMode == "starttls" {
		fallback := primary
		fallback.SMTPPort = 465
		fallback.SMTPMode = "tls"
		transports = append(transports, fallback)
	} else if primary.SMTPPort == 465 && primary.SMTPMode == "tls" {
		fallback := primary
		fallback.SMTPPort = 587
		fallback.SMTPMode = "starttls"
		transports = append(transports, fallback)
	}

	attempts := make([]cuiqiuSMTPAttempt, 0, len(transports)*2+1)
	if cached, ok := cuiqiuSMTPRouteCache.Load(cuiqiuSMTPRouteKey(config)); ok {
		if route, valid := cached.(cuiqiuSMTPRoute); valid {
			cachedConfig := primary
			cachedConfig.SMTPPort = route.Port
			cachedConfig.SMTPMode = route.Mode
			attempts = append(attempts, cuiqiuSMTPAttempt{Config: cachedConfig, AuthMethod: route.AuthMethod})
		}
	}
	for index, transport := range transports {
		if index == 0 {
			attempts = appendUniqueCuiqiuSMTPAttempt(attempts, cuiqiuSMTPAttempt{Config: transport, AuthMethod: cuiqiuSMTPAuthPlain})
			attempts = appendUniqueCuiqiuSMTPAttempt(attempts, cuiqiuSMTPAttempt{Config: transport, AuthMethod: cuiqiuSMTPAuthLogin})
			continue
		}
		attempts = appendUniqueCuiqiuSMTPAttempt(attempts, cuiqiuSMTPAttempt{Config: transport, AuthMethod: cuiqiuSMTPAuthLogin})
		attempts = appendUniqueCuiqiuSMTPAttempt(attempts, cuiqiuSMTPAttempt{Config: transport, AuthMethod: cuiqiuSMTPAuthPlain})
	}
	return attempts
}

func appendUniqueCuiqiuSMTPAttempt(attempts []cuiqiuSMTPAttempt, candidate cuiqiuSMTPAttempt) []cuiqiuSMTPAttempt {
	for _, existing := range attempts {
		if existing.Config.SMTPHost == candidate.Config.SMTPHost && existing.Config.SMTPPort == candidate.Config.SMTPPort && existing.Config.SMTPMode == candidate.Config.SMTPMode && existing.AuthMethod == candidate.AuthMethod {
			return attempts
		}
	}
	return append(attempts, candidate)
}

func cuiqiuSMTPRouteKey(config cuiqiuConfig) string {
	return strings.ToLower(strings.TrimSpace(config.SMTPHost)) + "|" + strconv.Itoa(config.SMTPPort) + "|" + strings.ToLower(strings.TrimSpace(config.SMTPMode))
}

func dialCuiqiuSMTP(config cuiqiuConfig) (*smtp.Client, error) {
	address := net.JoinHostPort(config.SMTPHost, strconv.Itoa(config.SMTPPort))
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	tlsConfig := &tls.Config{ServerName: config.SMTPHost, MinVersion: tls.VersionTLS12}
	if config.SMTPMode == "tls" {
		connection, err := tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
		if err != nil {
			return nil, err
		}
		client, err := smtp.NewClient(connection, config.SMTPHost)
		if err != nil {
			_ = connection.Close()
			return nil, err
		}
		return client, nil
	}
	connection, err := dialer.Dial("tcp", address)
	if err != nil {
		return nil, err
	}
	client, err := smtp.NewClient(connection, config.SMTPHost)
	if err != nil {
		_ = connection.Close()
		return nil, err
	}
	if err := client.StartTLS(tlsConfig); err != nil {
		_ = client.Close()
		return nil, err
	}
	return client, nil
}

func sendCuiqiuSMTPReply(config cuiqiuConfig, conversation Conversation, target emailReplyTarget, body string, attachment *emailAttachmentInput) (string, error) {
	to := normalizeEmail(firstNonEmpty(target.CustomerEmail, conversation.CustomerEmail))
	if to == "" {
		return "", fmt.Errorf("%w: Cuiqiu email reply failed: customer email is required", ErrInvalid)
	}
	raw, messageID, err := buildCuiqiuSMTPMessage(config.Mailbox, to, conversation, target, body, attachment)
	if err != nil {
		return "", err
	}
	client, err := authenticatedCuiqiuSMTPClient(config)
	if err != nil {
		return "", fmt.Errorf("Cuiqiu SMTP authentication failed: %w", err)
	}
	defer client.Close()
	if err := client.Mail(config.Mailbox); err != nil {
		return "", fmt.Errorf("Cuiqiu SMTP sender rejected: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return "", fmt.Errorf("Cuiqiu SMTP recipient rejected: %w", err)
	}
	writer, err := client.Data()
	if err != nil {
		return "", err
	}
	if _, err := writer.Write(raw); err != nil {
		_ = writer.Close()
		return "", err
	}
	if err := writer.Close(); err != nil {
		return "", err
	}
	if err := client.Quit(); err != nil {
		return "", err
	}
	return messageID, nil
}

func buildCuiqiuSMTPMessage(from string, to string, conversation Conversation, target emailReplyTarget, body string, attachment *emailAttachmentInput) ([]byte, string, error) {
	messageDomain := "xzdesk.local"
	if parts := strings.SplitN(from, "@", 2); len(parts) == 2 && strings.TrimSpace(parts[1]) != "" {
		messageDomain = strings.TrimSpace(parts[1])
	}
	messageID := fmt.Sprintf("<xzdesk-%s@%s>", prefixedID("mail"), messageDomain)
	var message strings.Builder
	writeMailHeader(&message, "From", (&mail.Address{Address: from}).String())
	writeMailHeader(&message, "To", (&mail.Address{Name: conversation.CustomerName, Address: to}).String())
	writeMailHeader(&message, "Subject", mime.QEncoding.Encode("utf-8", replySubject(conversation.Subject)))
	writeMailHeader(&message, "Date", time.Now().Format(time.RFC1123Z))
	writeMailHeader(&message, "Message-ID", messageID)
	writeMailHeader(&message, "In-Reply-To", target.HeaderMessageID)
	writeMailHeader(&message, "References", mergeReferences(target.HeaderReferences, target.HeaderMessageID))
	writeMailHeader(&message, "MIME-Version", "1.0")
	if attachment == nil {
		writeMailHeader(&message, "Content-Type", "text/plain; charset=UTF-8")
		writeMailHeader(&message, "Content-Transfer-Encoding", "base64")
		message.WriteString("\r\n")
		message.WriteString(base64.StdEncoding.EncodeToString([]byte(strings.TrimSpace(body))))
		message.WriteString("\r\n")
		return []byte(message.String()), messageID, nil
	}
	boundary := "xzdesk_" + prefixedID("mime")
	writeMailHeader(&message, "Content-Type", `multipart/mixed; boundary="`+boundary+`"`)
	message.WriteString("\r\n")
	message.WriteString("--" + boundary + "\r\n")
	writeMailHeader(&message, "Content-Type", "text/plain; charset=UTF-8")
	writeMailHeader(&message, "Content-Transfer-Encoding", "base64")
	message.WriteString("\r\n")
	textBody := strings.TrimSpace(body)
	if textBody == "" {
		textBody = "Attached file: " + attachment.FileName
	}
	message.WriteString(base64.StdEncoding.EncodeToString([]byte(textBody)) + "\r\n")
	message.WriteString("--" + boundary + "\r\n")
	writeMailHeader(&message, "Content-Type", attachment.MIMEType+`; name="`+sanitizeEmailHeader(attachment.FileName)+`"`)
	writeMailHeader(&message, "Content-Disposition", `attachment; filename="`+sanitizeEmailHeader(attachment.FileName)+`"`)
	writeMailHeader(&message, "Content-Transfer-Encoding", "base64")
	message.WriteString("\r\n")
	encoded := base64.StdEncoding.EncodeToString(attachment.Content)
	for len(encoded) > 76 {
		message.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	message.WriteString(encoded + "\r\n--" + boundary + "--\r\n")
	return []byte(message.String()), messageID, nil
}

func (s *Server) handleCuiqiuWebhook(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var payload cuiqiuWebhookPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "invalid Cuiqiu webhook payload"})
		return
	}
	key := strings.TrimSpace(r.URL.Query().Get("key"))
	if key == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	domain := normalizeEmailDomain(r.URL.Query().Get("domain"))
	domainKeyValid := false
	if domain != "" {
		settings, token, resolveErr := s.resolveCuiqiuDomainSettings(r.Context(), domain)
		if resolveErr != nil || key != cuiqiuWebhookKeyForDomain(domain, token) {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if err := s.markCuiqiuDomainWebhookVerified(r.Context(), settings); err != nil {
			writeError(w, err)
			return
		}
		domainKeyValid = true
	}
	recipients := cuiqiuWebhookRecipientSet(payload)
	if len(recipients) == 0 {
		if domainKeyValid {
			writeJSONResponse(w, http.StatusAccepted, map[string]bool{"accepted": true})
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	sources, err := s.store.ListShopSources(r.Context(), "")
	if err != nil {
		writeError(w, err)
		return
	}
	matched := 0
	for _, source := range sources {
		if source.Type != SourceTypeEmail || source.Status != SourceStatusActive || !strings.EqualFold(source.Provider, cuiqiuProvider) || !recipients[normalizeEmail(sourceEmailAddress(source))] {
			continue
		}
		if domainKeyValid {
			if emailDomain(sourceEmailAddress(source)) != domain {
				continue
			}
			if err := s.markCuiqiuWebhookObserved(r.Context(), source); err != nil {
				writeError(w, err)
				return
			}
			if err := s.scheduleEmailSourceSync(source, "cuiqiu-webhook"); err != nil {
				writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{"error": "email notification queue unavailable"})
				return
			}
			matched++
			continue
		}
		installation, installErr := s.store.GetEmailInstallation(r.Context(), source.ShopID, sourceEmailAddress(source))
		if installErr != nil || key != cuiqiuWebhookKey(source, installation) {
			continue
		}
		if err := s.markCuiqiuWebhookObserved(r.Context(), source); err != nil {
			writeError(w, err)
			return
		}
		if err := s.scheduleEmailSourceSync(source, "cuiqiu-webhook"); err != nil {
			writeJSONResponse(w, http.StatusServiceUnavailable, map[string]string{"error": "email notification queue unavailable"})
			return
		}
		matched++
	}
	if matched == 0 {
		if domainKeyValid {
			writeJSONResponse(w, http.StatusAccepted, map[string]bool{"accepted": true})
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	writeJSONResponse(w, http.StatusAccepted, map[string]bool{"accepted": true})
}

func (s *Server) markCuiqiuDomainWebhookVerified(ctx context.Context, settings CuiqiuDomainSettings) error {
	return s.store.MarkCuiqiuDomainWebhookVerified(ctx, settings.Domain, time.Now().UTC())
}

func (s *Server) markCuiqiuWebhookObserved(ctx context.Context, source ShopSource) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	updated, err := s.store.MutateShopSourceMetadata(ctx, source.ShopID, source.ID, func(metadata map[string]string) map[string]string {
		metadata[emailNotificationStatusKey] = "ok"
		metadata[emailNotificationCheckedAtKey] = now
		metadata["cuiqiu_webhook_received_at"] = now
		metadata["email_notification_mode"] = "webhook+daily_reconcile"
		delete(metadata, emailNotificationErrorKey)
		return metadata
	})
	if err != nil {
		return err
	}
	if source.Metadata[emailNotificationStatusKey] != updated.Metadata[emailNotificationStatusKey] ||
		source.Metadata["cuiqiu_webhook_received_at"] != updated.Metadata["cuiqiu_webhook_received_at"] {
		s.broadcast(Event{
			Type: "shop_source.updated", ShopID: updated.ShopID, EntityID: updated.ID,
			Payload: updated, CreatedAt: time.Now().UTC(),
		})
	}
	return nil
}

func cuiqiuWebhookRecipientSet(payload cuiqiuWebhookPayload) map[string]bool {
	out := cuiqiuWebhookRecipients(payload.SMTPTo)
	for _, recipient := range payload.MessageTo {
		if address := normalizeEmail(recipient.Address); address != "" {
			out[address] = true
		}
	}
	return out
}

func cuiqiuDomainWebhookURL(baseURL string, domain string, token string) string {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	domain = normalizeEmailDomain(domain)
	if baseURL == "" || domain == "" || strings.TrimSpace(token) == "" {
		return ""
	}
	return baseURL + "/webhooks/email/cuiqiu?domain=" + url.QueryEscape(domain) + "&key=" + cuiqiuWebhookKeyForDomain(domain, token)
}

func cuiqiuWebhookKeyForDomain(domain string, token string) string {
	sum := sha256.Sum256([]byte(normalizeEmailDomain(domain) + "|" + strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:16])
}

func cuiqiuWebhookKey(source ShopSource, installation EmailInstallation) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(source.ID) + "|" + strings.TrimSpace(installation.AccessToken)))
	return hex.EncodeToString(sum[:16])
}

func cuiqiuWebhookRecipients(value string) map[string]bool {
	out := map[string]bool{}
	for _, part := range strings.FieldsFunc(value, func(r rune) bool { return r == ',' || r == ';' }) {
		_, address := parseMailAddress(part)
		if address != "" {
			out[address] = true
		}
	}
	return out
}
