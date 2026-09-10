package platform

import (
	"bufio"
	"context"
	"crypto/tls"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/mail"
	"net/smtp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/emersion/go-imap"
	imapclient "github.com/emersion/go-imap/client"
	"golang.org/x/net/html/charset"
)

const (
	standardMailProvider       = "imap_smtp"
	standardMailServiceKey     = "mail_service"
	standardMailDomainKey      = "mail_domain"
	standardIMAPHostKey        = "imap_host"
	standardIMAPPortKey        = "imap_port"
	standardSMTPHostKey        = "smtp_host"
	standardSMTPPortKey        = "smtp_port"
	standardSMTPModeKey        = "smtp_mode"
	standardIMAPUIDValidityKey = "imap_uid_validity"
	standardIMAPLastUIDKey     = "imap_last_uid"
	standardIMAPBatchSize      = 200
	standardIMAPHistorySize    = 25
	standardMailMaxMessageSize = 32 << 20
)

type standardMailPreset struct {
	Service         string
	Domain          string
	Label           string
	CredentialLabel string
	UsernameLocal   bool
	IMAPHost        string
	IMAPPort        int
	SMTPHost        string
	SMTPPort        int
	SMTPMode        string
}

var standardMailPresets = map[string]standardMailPreset{
	"163.com":    {Service: "netease", Domain: "163.com", Label: "网易163邮箱", CredentialLabel: "客户端授权码", IMAPHost: "imap.163.com", IMAPPort: 993, SMTPHost: "smtp.163.com", SMTPPort: 465, SMTPMode: "tls"},
	"126.com":    {Service: "netease", Domain: "126.com", Label: "网易126邮箱", CredentialLabel: "客户端授权码", IMAPHost: "imap.126.com", IMAPPort: 993, SMTPHost: "smtp.126.com", SMTPPort: 465, SMTPMode: "tls"},
	"qq.com":     {Service: "qq", Domain: "qq.com", Label: "QQ邮箱", CredentialLabel: "客户端授权码", IMAPHost: "imap.qq.com", IMAPPort: 993, SMTPHost: "smtp.qq.com", SMTPPort: 465, SMTPMode: "tls"},
	"vip.qq.com": {Service: "qq", Domain: "vip.qq.com", Label: "QQ VIP邮箱", CredentialLabel: "客户端授权码", IMAPHost: "imap.qq.com", IMAPPort: 993, SMTPHost: "smtp.qq.com", SMTPPort: 465, SMTPMode: "tls"},
	"139.com":    {Service: "139", Domain: "139.com", Label: "139邮箱", CredentialLabel: "客户端授权码", IMAPHost: "imap.139.com", IMAPPort: 993, SMTPHost: "smtp.139.com", SMTPPort: 465, SMTPMode: "tls"},
	"189.cn":     {Service: "189", Domain: "189.cn", Label: "189邮箱", CredentialLabel: "客户端专用密码", UsernameLocal: true, IMAPHost: "imap.189.cn", IMAPPort: 993, SMTPHost: "smtp.189.cn", SMTPPort: 465, SMTPMode: "tls"},
}

type standardMailConnectRequest struct {
	Mailbox           string `json:"mailbox"`
	Credential        string `json:"credential"`
	AuthorizationCode string `json:"authorizationCode"`
}

type standardMailConnectResponse struct {
	Source ShopSource `json:"source"`
}

type standardMailConfig struct {
	Preset     standardMailPreset
	Mailbox    string
	Credential string
}

type standardIMAPBaseline struct {
	UIDValidity uint32
	LastUID     uint32
}

type standardIMAPMailboxClient interface {
	Select(name string, readOnly bool) (*imap.MailboxStatus, error)
	UidSearch(criteria *imap.SearchCriteria) ([]uint32, error)
	UidFetch(seqset *imap.SeqSet, items []imap.FetchItem, ch chan *imap.Message) error
}

type standardIMAPRealtimeClient interface {
	standardIMAPMailboxClient
	WaitForMailboxUpdate(ctx context.Context) error
	Logout() error
}

var (
	verifyStandardIMAPConnection = verifyStandardIMAP
	verifyStandardSMTPConnection = verifyStandardSMTP
	fetchStandardIMAPSyncBatch   = fetchStandardIMAPBatch
	setStandardIMAPMessageRead   = setStandardIMAPRead
	sendStandardSMTPThreadReply  = sendStandardSMTPReply
	openStandardIMAPRealtime     = func(ctx context.Context, config standardMailConfig) (standardIMAPRealtimeClient, error) {
		client, err := dialStandardIMAP(ctx, config)
		if err != nil {
			return nil, err
		}
		return newStandardIMAPRealtimeConnection(client), nil
	}
)

func standardMailPresetForMailbox(mailbox string) (standardMailPreset, error) {
	mailbox = normalizeEmail(mailbox)
	parsed, err := mail.ParseAddress(mailbox)
	if err != nil || normalizeEmail(parsed.Address) != mailbox || !strings.Contains(mailbox, "@") {
		return standardMailPreset{}, fmt.Errorf("%w: 请输入完整有效的邮箱地址", ErrInvalid)
	}
	domain := emailDomain(mailbox)
	preset, ok := standardMailPresets[domain]
	if !ok {
		return standardMailPreset{}, fmt.Errorf("%w: 当前支持 @163.com、@126.com、@qq.com、@vip.qq.com、@139.com 和 @189.cn", ErrInvalid)
	}
	return preset, nil
}

func normalizeStandardMailConnectRequest(input standardMailConnectRequest) (standardMailConfig, error) {
	mailbox := normalizeEmail(input.Mailbox)
	preset, err := standardMailPresetForMailbox(mailbox)
	if err != nil {
		return standardMailConfig{}, err
	}
	credential := input.Credential
	if credential == "" {
		credential = input.AuthorizationCode
	}
	credential = strings.TrimSpace(credential)
	if credential == "" {
		return standardMailConfig{}, fmt.Errorf("%w: %s不能为空", ErrInvalid, preset.CredentialLabel)
	}
	return standardMailConfig{Preset: preset, Mailbox: mailbox, Credential: credential}, nil
}

func (s *Server) handleStandardMailConnect(w http.ResponseWriter, r *http.Request, shopID string) {
	var input standardMailConnectRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	result, err := s.connectStandardEmail(r.Context(), shopID, input)
	if err != nil {
		writeError(w, err)
		return
	}
	s.broadcast(Event{Type: "shop_source.updated", ShopID: shopID, EntityID: result.Source.ID, Payload: result.Source, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, result)
}

func (s *Server) connectStandardEmail(ctx context.Context, shopID string, input standardMailConnectRequest) (standardMailConnectResponse, error) {
	if _, err := s.store.GetShop(ctx, shopID); err != nil {
		return standardMailConnectResponse{}, err
	}
	config, err := normalizeStandardMailConnectRequest(input)
	if err != nil {
		return standardMailConnectResponse{}, err
	}
	if err := s.ensureEmailMailboxAvailable(ctx, shopID, config.Mailbox); err != nil {
		return standardMailConnectResponse{}, err
	}
	baseline, err := verifyStandardIMAPConnection(ctx, config)
	if err != nil {
		return standardMailConnectResponse{}, fmt.Errorf("%w: %s收信验证失败：%v", ErrInvalid, config.Preset.Label, err)
	}
	if err := verifyStandardSMTPConnection(ctx, config); err != nil {
		return standardMailConnectResponse{}, fmt.Errorf("%w: %s发信验证失败：%v", ErrInvalid, config.Preset.Label, err)
	}

	sources, err := s.store.ListShopSources(ctx, shopID)
	if err != nil {
		return standardMailConnectResponse{}, err
	}
	var source ShopSource
	for _, existing := range sources {
		if existing.Type == SourceTypeEmail && normalizeEmail(sourceEmailAddress(existing)) == config.Mailbox {
			source = existing
			break
		}
	}
	metadata := standardMailMetadata(config, baseline)
	if source.ID == "" {
		source, err = s.store.CreateShopSource(ctx, ShopSource{
			ShopID: shopID, Type: SourceTypeEmail, Provider: standardMailProvider,
			Address: config.Mailbox, Status: SourceStatusActive, Metadata: metadata,
		})
	} else {
		source, err = s.store.UpdateShopSource(ctx, shopID, source.ID, ShopSource{
			Provider: standardMailProvider, Address: config.Mailbox, Status: SourceStatusActive, Metadata: metadata,
		})
	}
	if err != nil {
		return standardMailConnectResponse{}, err
	}
	if _, err = s.store.SaveEmailInstallation(ctx, EmailInstallation{
		ShopID: shopID, Mailbox: config.Mailbox, Provider: standardMailProvider,
		AccessToken: config.Credential, Scope: "imap.read imap.modify smtp.send",
		ExpiresAt: time.Now().UTC().AddDate(10, 0, 0),
	}); err != nil {
		return standardMailConnectResponse{}, err
	}
	s.notifyStandardIMAPSupervisor()
	s.scheduleEmailSourceSync(source, "standard-mail-connect")
	return standardMailConnectResponse{Source: source}, nil
}

func standardMailMetadata(config standardMailConfig, baseline standardIMAPBaseline) map[string]string {
	authType := "client_authorization_code"
	if config.Preset.Service == "189" {
		authType = "client_specific_password"
	}
	metadata := newEmailSyncMetadata(config.Mailbox, authType, emailInitialImportNow)
	metadata[standardMailServiceKey] = config.Preset.Service
	metadata[standardMailDomainKey] = config.Preset.Domain
	metadata[standardIMAPHostKey] = config.Preset.IMAPHost
	metadata[standardIMAPPortKey] = strconv.Itoa(config.Preset.IMAPPort)
	metadata[standardSMTPHostKey] = config.Preset.SMTPHost
	metadata[standardSMTPPortKey] = strconv.Itoa(config.Preset.SMTPPort)
	metadata[standardSMTPModeKey] = config.Preset.SMTPMode
	metadata[standardIMAPUIDValidityKey] = strconv.FormatUint(uint64(baseline.UIDValidity), 10)
	metadata[standardIMAPLastUIDKey] = strconv.FormatUint(uint64(baseline.LastUID), 10)
	metadata[emailNotificationStatusKey] = "ok"
	metadata[emailHealthStatusKey] = "ok"
	metadata["email_notification_mode"] = "imap_idle_or_5m_noop"
	metadata["email_sync_interval"] = standardIMAPSyncIntervalForService(config.Preset.Service)
	return metadata
}

func standardIMAPReconcileInterval(source ShopSource) time.Duration {
	if strings.EqualFold(strings.TrimSpace(source.Metadata[standardMailServiceKey]), "qq") {
		return 24 * time.Hour
	}
	return 0
}

func standardIMAPSyncInterval(source ShopSource) string {
	return standardIMAPSyncIntervalForService(source.Metadata[standardMailServiceKey])
}

func standardIMAPSyncIntervalForService(service string) string {
	if strings.EqualFold(strings.TrimSpace(service), "qq") {
		return "imap_event+24h_reconcile"
	}
	return "imap_5m_noop+reconnect_recovery"
}

func standardMailConfigFrom(source ShopSource, installation EmailInstallation) (standardMailConfig, error) {
	mailbox := normalizeEmail(sourceEmailAddress(source))
	preset, err := standardMailPresetForMailbox(mailbox)
	if err != nil {
		return standardMailConfig{}, err
	}
	if service := strings.TrimSpace(source.Metadata[standardMailServiceKey]); service != "" && service != preset.Service {
		return standardMailConfig{}, fmt.Errorf("%w: 邮箱服务预设与邮箱后缀不匹配", ErrInvalid)
	}
	credential := strings.TrimSpace(installation.AccessToken)
	if credential == "" {
		return standardMailConfig{}, fmt.Errorf("%w: %s缺失，请重新接入邮箱", ErrInvalid, preset.CredentialLabel)
	}
	return standardMailConfig{Preset: preset, Mailbox: mailbox, Credential: credential}, nil
}

func standardMailUsername(config standardMailConfig) string {
	if config.Preset.UsernameLocal {
		if local, _, ok := strings.Cut(config.Mailbox, "@"); ok {
			return local
		}
	}
	return config.Mailbox
}

func dialStandardIMAP(ctx context.Context, config standardMailConfig) (*imapclient.Client, error) {
	address := net.JoinHostPort(config.Preset.IMAPHost, strconv.Itoa(config.Preset.IMAPPort))
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, fmt.Errorf("connect %s failed: %w", address, err)
	}
	deadline := time.Now().Add(30 * time.Second)
	if value, ok := ctx.Deadline(); ok && value.Before(deadline) {
		deadline = value
	}
	_ = conn.SetDeadline(deadline)
	tlsConn := tls.Client(conn, &tls.Config{ServerName: config.Preset.IMAPHost, MinVersion: tls.VersionTLS12})
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("TLS handshake failed: %w", err)
	}
	client, err := imapclient.New(tlsConn)
	if err != nil {
		_ = tlsConn.Close()
		return nil, err
	}
	if err := client.Login(standardMailUsername(config), config.Credential); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("authentication failed: %w", err)
	}
	if config.Preset.Service == "netease" {
		if err := identifyNetEaseIMAPClient(client, config.Mailbox); err != nil {
			_ = client.Close()
			return nil, fmt.Errorf("IMAP client identification failed: %w", err)
		}
	}
	_ = conn.SetDeadline(time.Time{})
	client.Timeout = 30 * time.Second
	return client, nil
}

// NetEase requires third-party IMAP clients to identify themselves with the
// RFC 2971 ID command after authentication and before selecting a mailbox.
func identifyNetEaseIMAPClient(client *imapclient.Client, mailbox string) error {
	status, err := client.Execute(&imap.Command{
		Name: "ID",
		Arguments: []interface{}{[]interface{}{
			"name", "Xzdesk Agent",
			"version", "1.0",
			"vendor", "Xinzhi Technology",
			"support-email", normalizeEmail(mailbox),
		}},
	}, nil)
	if err != nil {
		return err
	}
	return status.Err()
}

func verifyStandardIMAP(ctx context.Context, config standardMailConfig) (standardIMAPBaseline, error) {
	client, err := dialStandardIMAP(ctx, config)
	if err != nil {
		return standardIMAPBaseline{}, err
	}
	defer client.Logout()
	status, err := client.Select("INBOX", true)
	if err != nil {
		return standardIMAPBaseline{}, fmt.Errorf("select INBOX failed: %w", err)
	}
	lastUID := uint32(0)
	if status.UidNext > 0 {
		lastUID = status.UidNext - 1
	}
	return standardIMAPBaseline{UIDValidity: status.UidValidity, LastUID: lastUID}, nil
}

func dialStandardSMTP(ctx context.Context, config standardMailConfig) (*smtp.Client, error) {
	var failures []error
	username := standardMailUsername(config)
	for _, auth := range []smtp.Auth{
		smtp.PlainAuth("", username, config.Credential, config.Preset.SMTPHost),
		&cuiqiuLoginAuth{username: username, password: config.Credential},
	} {
		client, err := dialStandardSMTPTransport(ctx, config)
		if err != nil {
			return nil, err
		}
		if err := client.Auth(auth); err == nil {
			return client, nil
		} else {
			failures = append(failures, err)
		}
		_ = client.Close()
	}
	return nil, fmt.Errorf("authentication failed: %w", errors.Join(failures...))
}

func dialStandardSMTPTransport(ctx context.Context, config standardMailConfig) (*smtp.Client, error) {
	address := net.JoinHostPort(config.Preset.SMTPHost, strconv.Itoa(config.Preset.SMTPPort))
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, fmt.Errorf("connect %s failed: %w", address, err)
	}
	deadline := time.Now().Add(30 * time.Second)
	if value, ok := ctx.Deadline(); ok && value.Before(deadline) {
		deadline = value
	}
	_ = conn.SetDeadline(deadline)
	tlsConn := tls.Client(conn, &tls.Config{ServerName: config.Preset.SMTPHost, MinVersion: tls.VersionTLS12})
	if err := tlsConn.HandshakeContext(ctx); err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("TLS handshake failed: %w", err)
	}
	client, err := smtp.NewClient(tlsConn, config.Preset.SMTPHost)
	if err != nil {
		_ = tlsConn.Close()
		return nil, err
	}
	return client, nil
}

func verifyStandardSMTP(ctx context.Context, config standardMailConfig) error {
	client, err := dialStandardSMTP(ctx, config)
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

func fetchStandardIMAPBatch(ctx context.Context, accessToken string, mailbox string, source ShopSource) (emailProviderSyncBatch, error) {
	installation := EmailInstallation{Mailbox: mailbox, Provider: standardMailProvider, AccessToken: accessToken}
	config, err := standardMailConfigFrom(source, installation)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	client, err := dialStandardIMAP(ctx, config)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	defer client.Logout()
	return fetchStandardIMAPBatchWithClient(client, config.Mailbox, source)
}

func fetchStandardIMAPBatchWithClient(client standardIMAPMailboxClient, mailbox string, source ShopSource) (emailProviderSyncBatch, error) {
	status, err := client.Select("INBOX", true)
	if err != nil {
		return emailProviderSyncBatch{}, fmt.Errorf("select INBOX failed: %w", err)
	}
	storedValidity, _ := strconv.ParseUint(strings.TrimSpace(source.Metadata[standardIMAPUIDValidityKey]), 10, 32)
	lastUID64, _ := strconv.ParseUint(strings.TrimSpace(source.Metadata[standardIMAPLastUIDKey]), 10, 32)
	lastUID := uint32(lastUID64)
	criteria := imap.NewSearchCriteria()
	recovering := storedValidity != 0 && uint32(storedValidity) != status.UidValidity
	if recovering {
		criteria.Since = emailSyncRecoveryStart(source)
	} else {
		criteria.Uid = new(imap.SeqSet)
		criteria.Uid.AddRange(lastUID+1, 0)
	}
	uids, err := client.UidSearch(criteria)
	if err != nil {
		return emailProviderSyncBatch{}, fmt.Errorf("search INBOX failed: %w", err)
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	if len(uids) > standardIMAPBatchSize {
		uids = uids[:standardIMAPBatchSize]
	}
	messages, quarantined, err := fetchStandardIMAPMessages(client, mailbox, status.UidValidity, uids)
	if err != nil {
		return emailProviderSyncBatch{}, err
	}
	maxUID := standardIMAPNextCursor(lastUID, status.UidNext, recovering, uids)
	updates := map[string]string{
		standardIMAPUIDValidityKey: strconv.FormatUint(uint64(status.UidValidity), 10),
		standardIMAPLastUIDKey:     strconv.FormatUint(uint64(maxUID), 10),
		emailSyncVersionKey:        emailSyncVersionCurrent,
		"email_sync_mode":          "incremental",
	}
	if recovering {
		updates["email_cursor_recovered_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return emailProviderSyncBatch{Messages: messages, Quarantined: quarantined, MetadataUpdates: updates, BacklogPending: len(uids) == standardIMAPBatchSize && status.UidNext > maxUID+1}, nil
}

func standardIMAPNextCursor(lastUID uint32, uidNext uint32, recovering bool, uids []uint32) uint32 {
	maxUID := lastUID
	if recovering {
		maxUID = 0
	}
	for _, uid := range uids {
		if uid > maxUID {
			maxUID = uid
		}
	}
	if recovering && len(uids) == 0 && uidNext > 0 {
		return uidNext - 1
	}
	return maxUID
}

func fetchStandardIMAPMessages(client standardIMAPMailboxClient, mailbox string, uidValidity uint32, uids []uint32) ([]incomingEmailMessage, []emailQuarantineCandidate, error) {
	if len(uids) == 0 {
		return nil, nil, nil
	}
	set := new(imap.SeqSet)
	for _, uid := range uids {
		set.AddNum(uid)
	}
	section := &imap.BodySectionName{Peek: true}
	items := []imap.FetchItem{imap.FetchUid, imap.FetchFlags, imap.FetchInternalDate, section.FetchItem()}
	results := make(chan *imap.Message, len(uids))
	done := make(chan error, 1)
	go func() { done <- client.UidFetch(set, items, results) }()
	out := make([]incomingEmailMessage, 0, len(uids))
	quarantined := make([]emailQuarantineCandidate, 0)
	seen := make(map[uint32]bool, len(uids))
	for message := range results {
		if message == nil || message.Uid == 0 {
			continue
		}
		seen[message.Uid] = true
		body := message.GetBody(section)
		if body == nil {
			parseErr := fmt.Errorf("message UID %d returned no RFC822 body", message.Uid)
			quarantined = append(quarantined, standardIMAPQuarantineCandidate(mailbox, uidValidity, message.Uid, "imap_fetch", parseErr, nil))
			continue
		}
		raw, err := io.ReadAll(io.LimitReader(body, standardMailMaxMessageSize+1))
		if err != nil {
			quarantined = append(quarantined, standardIMAPQuarantineCandidate(mailbox, uidValidity, message.Uid, "imap_read", err, nil))
			continue
		}
		if len(raw) > standardMailMaxMessageSize {
			parseErr := fmt.Errorf("message UID %d exceeds the %d MiB import limit", message.Uid, standardMailMaxMessageSize>>20)
			quarantined = append(quarantined, standardIMAPQuarantineCandidate(mailbox, uidValidity, message.Uid, "imap_size", parseErr, nil))
			continue
		}
		parsed, err := parseStandardMailMessage(mailbox, uidValidity, message.Uid, message.InternalDate, message.Flags, raw)
		if err != nil {
			parseErr := fmt.Errorf("parse message UID %d failed: %w", message.Uid, err)
			quarantined = append(quarantined, standardIMAPQuarantineCandidate(mailbox, uidValidity, message.Uid, "imap_parse", parseErr, raw))
			continue
		}
		out = append(out, parsed)
	}
	if err := <-done; err != nil {
		return nil, nil, fmt.Errorf("fetch INBOX messages failed: %w", err)
	}
	for _, uid := range uids {
		if seen[uid] {
			continue
		}
		missingErr := fmt.Errorf("message UID %d was not returned by IMAP", uid)
		quarantined = append(quarantined, standardIMAPQuarantineCandidate(mailbox, uidValidity, uid, "imap_missing", missingErr, nil))
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].ReceivedAt.Before(out[j].ReceivedAt) })
	return out, quarantined, nil
}

func parseStandardMailMessage(mailbox string, uidValidity uint32, uid uint32, internalDate time.Time, flags []string, raw []byte) (incomingEmailMessage, error) {
	message, err := mail.ReadMessage(bufio.NewReader(strings.NewReader(string(raw))))
	if err != nil {
		return incomingEmailMessage{}, err
	}
	decoder := &mime.WordDecoder{CharsetReader: charset.NewReaderLabel}
	decodeHeader := func(value string) string {
		decoded, decodeErr := decoder.DecodeHeader(strings.TrimSpace(value))
		if decodeErr != nil {
			return strings.TrimSpace(value)
		}
		return strings.TrimSpace(decoded)
	}
	senderName, senderEmail := parseMailAddress(decodeHeader(message.Header.Get("From")))
	replyName, replyEmail := parseMailAddress(decodeHeader(message.Header.Get("Reply-To")))
	toName, toEmail := parseMailAddress(decodeHeader(message.Header.Get("To")))
	direction := MessageDirectionCustomer
	customerName, customerEmail := senderName, senderEmail
	if normalizeEmail(senderEmail) == normalizeEmail(mailbox) {
		direction = MessageDirectionAgent
		customerName, customerEmail = toName, toEmail
	}
	if replyEmail == "" {
		replyName, replyEmail = customerName, customerEmail
	}
	body, attachments, err := readStandardMIMEEntity(message.Header, message.Body, decoder)
	if err != nil {
		return incomingEmailMessage{}, err
	}
	receivedAt := internalDate.UTC()
	if parsedDate, dateErr := mail.ParseDate(message.Header.Get("Date")); dateErr == nil {
		receivedAt = parsedDate.UTC()
	}
	if receivedAt.IsZero() {
		receivedAt = time.Now().UTC()
	}
	messageID := strings.TrimSpace(message.Header.Get("Message-ID"))
	references := strings.TrimSpace(message.Header.Get("References"))
	inReplyTo := strings.TrimSpace(message.Header.Get("In-Reply-To"))
	threadHeader := firstReferenceHeader(references, inReplyTo)
	threadID := standardMailThreadID(customerEmail, decodeHeader(message.Header.Get("Subject")), threadHeader, messageID)
	uidText := strconv.FormatUint(uint64(uid), 10)
	uidValidityText := strconv.FormatUint(uint64(uidValidity), 10)
	metadata := map[string]string{
		standardMailProvider + "_message_id": uidText,
		"mail_api_provider":                  standardMailProvider,
		"mail_api_mailbox":                   normalizeEmail(mailbox),
		"mail_reply_to_email":                normalizeEmail(replyEmail),
		"mail_reply_to_name":                 strings.TrimSpace(replyName),
	}
	if messageID != "" {
		metadata["mail_message_id"] = messageID
	}
	if references != "" {
		metadata["mail_references"] = references
	}
	if inReplyTo != "" {
		metadata["mail_in_reply_to"] = inReplyTo
	}
	if len(attachments) > 0 {
		metadata["email_has_attachments"] = "true"
	}
	for _, flag := range flags {
		if strings.EqualFold(flag, imap.SeenFlag) {
			metadata["email_provider_read"] = "true"
			break
		}
	}
	return incomingEmailMessage{
		ExternalConversationID: threadID, CustomerName: customerName, CustomerEmail: normalizeEmail(customerEmail),
		SenderName: senderName, SenderEmail: normalizeEmail(senderEmail), ReplyToName: replyName, ReplyToEmail: normalizeEmail(replyEmail),
		Subject: decodeHeader(message.Header.Get("Subject")), Body: strings.TrimSpace(body),
		SourceMessageID: standardMailProvider + ":" + uidValidityText + ":" + uidText, Metadata: metadata, Attachments: attachments,
		ReceivedAt: receivedAt, Direction: direction,
	}, nil
}

func readStandardMIMEEntity(header mail.Header, body io.Reader, decoder *mime.WordDecoder) (string, []incomingEmailAttachment, error) {
	mediaType, params, err := mime.ParseMediaType(header.Get("Content-Type"))
	if err != nil || mediaType == "" {
		mediaType = "text/plain"
		params = map[string]string{}
	}
	if strings.HasPrefix(strings.ToLower(mediaType), "multipart/") {
		boundary := strings.TrimSpace(params["boundary"])
		if boundary == "" {
			return "", nil, fmt.Errorf("multipart message is missing its boundary")
		}
		reader := multipart.NewReader(standardTransferReader(header.Get("Content-Transfer-Encoding"), body), boundary)
		plainParts := []string{}
		htmlParts := []string{}
		attachments := []incomingEmailAttachment{}
		for {
			part, partErr := reader.NextPart()
			if errors.Is(partErr, io.EOF) {
				break
			}
			if partErr != nil {
				return "", nil, partErr
			}
			partHeader := mail.Header(part.Header)
			partType, partParams, _ := mime.ParseMediaType(partHeader.Get("Content-Type"))
			disposition, dispositionParams, _ := mime.ParseMediaType(partHeader.Get("Content-Disposition"))
			fileName := firstNonEmpty(dispositionParams["filename"], partParams["name"], part.FileName())
			if decoded, decodeErr := decoder.DecodeHeader(fileName); decodeErr == nil {
				fileName = decoded
			}
			if strings.EqualFold(disposition, "attachment") || strings.EqualFold(disposition, "inline") || strings.TrimSpace(fileName) != "" {
				content, readErr := io.ReadAll(io.LimitReader(standardTransferReader(partHeader.Get("Content-Transfer-Encoding"), part), maxEmailAttachmentSize+1))
				if readErr != nil {
					return "", nil, readErr
				}
				if len(content) <= maxEmailAttachmentSize {
					attachments = append(attachments, incomingEmailAttachment{FileName: firstNonEmpty(strings.TrimSpace(fileName), "attachment"), MIMEType: firstNonEmpty(partType, "application/octet-stream"), Content: content, Inline: strings.EqualFold(disposition, "inline")})
				}
				continue
			}
			text, nested, readErr := readStandardMIMEEntity(partHeader, part, decoder)
			if readErr != nil {
				return "", nil, readErr
			}
			attachments = append(attachments, nested...)
			if strings.EqualFold(partType, "text/html") {
				htmlParts = append(htmlParts, text)
			} else if strings.TrimSpace(text) != "" {
				plainParts = append(plainParts, text)
			}
		}
		if len(plainParts) > 0 {
			return strings.Join(plainParts, "\n\n"), attachments, nil
		}
		return htmlToPlainText(strings.Join(htmlParts, "\n")), attachments, nil
	}
	reader := standardTransferReader(header.Get("Content-Transfer-Encoding"), body)
	if charsetName := strings.TrimSpace(params["charset"]); charsetName != "" && !strings.EqualFold(charsetName, "utf-8") && !strings.EqualFold(charsetName, "us-ascii") {
		converted, convertErr := charset.NewReaderLabel(charsetName, reader)
		if convertErr == nil {
			reader = converted
		}
	}
	content, err := io.ReadAll(io.LimitReader(reader, standardMailMaxMessageSize+1))
	if err != nil {
		return "", nil, err
	}
	if strings.EqualFold(mediaType, "text/html") {
		return htmlToPlainText(string(content)), nil, nil
	}
	return string(content), nil, nil
}

func standardTransferReader(encoding string, reader io.Reader) io.Reader {
	switch strings.ToLower(strings.TrimSpace(encoding)) {
	case "base64":
		return base64NewLineReader(reader)
	case "quoted-printable":
		return quotedprintable.NewReader(reader)
	default:
		return reader
	}
}

func base64NewLineReader(reader io.Reader) io.Reader {
	return base64.NewDecoder(base64.StdEncoding, reader)
}

func firstReferenceHeader(references string, inReplyTo string) string {
	fields := strings.Fields(strings.TrimSpace(references))
	if len(fields) > 0 {
		return fields[0]
	}
	return strings.TrimSpace(inReplyTo)
}

func standardMailThreadID(customerEmail string, subject string, threadHeader string, messageID string) string {
	return cuiqiuThreadID(customerEmail, subject, firstNonEmpty(threadHeader, messageID))
}

func setStandardIMAPRead(ctx context.Context, config standardMailConfig, messageID string, read bool) error {
	messageID = strings.TrimSpace(messageID)
	if separator := strings.LastIndex(messageID, ":"); separator >= 0 {
		messageID = messageID[separator+1:]
	}
	uid, err := strconv.ParseUint(messageID, 10, 32)
	if err != nil || uid == 0 {
		return fmt.Errorf("%w: IMAP message UID is invalid", ErrInvalid)
	}
	client, err := dialStandardIMAP(ctx, config)
	if err != nil {
		return err
	}
	defer client.Logout()
	if _, err := client.Select("INBOX", false); err != nil {
		return err
	}
	set := new(imap.SeqSet)
	set.AddNum(uint32(uid))
	operation := imap.StoreItem(imap.AddFlags)
	if !read {
		operation = imap.StoreItem(imap.RemoveFlags)
	}
	return client.UidStore(set, operation, []interface{}{imap.SeenFlag}, nil)
}

func sendStandardSMTPReply(ctx context.Context, config standardMailConfig, conversation Conversation, target emailReplyTarget, body string, attachment *emailAttachmentInput) (string, error) {
	to := normalizeEmail(firstNonEmpty(target.CustomerEmail, conversation.CustomerEmail))
	if to == "" {
		return "", fmt.Errorf("%w: SMTP reply failed: customer email is required", ErrInvalid)
	}
	raw, messageID, err := buildCuiqiuSMTPMessage(config.Mailbox, to, conversation, target, body, attachment)
	if err != nil {
		return "", err
	}
	client, err := dialStandardSMTP(ctx, config)
	if err != nil {
		return "", fmt.Errorf("SMTP authentication failed: %w", err)
	}
	defer client.Close()
	if err := client.Mail(config.Mailbox); err != nil {
		return "", fmt.Errorf("SMTP sender rejected: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return "", fmt.Errorf("SMTP recipient rejected: %w", err)
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

func fetchStandardIMAPHistoryPage(ctx context.Context, job EmailHistoryImportJob, source ShopSource, installation EmailInstallation) (emailHistoryPage, error) {
	config, err := standardMailConfigFrom(source, installation)
	if err != nil {
		return emailHistoryPage{}, err
	}
	client, err := dialStandardIMAP(ctx, config)
	if err != nil {
		return emailHistoryPage{}, err
	}
	defer client.Logout()
	status, err := client.Select("INBOX", true)
	if err != nil {
		return emailHistoryPage{}, err
	}
	uids, err := client.UidSearch(imap.NewSearchCriteria())
	if err != nil {
		return emailHistoryPage{}, err
	}
	sort.Slice(uids, func(i, j int) bool { return uids[i] < uids[j] })
	if cursor, parseErr := strconv.ParseUint(strings.TrimSpace(job.Cursor), 10, 32); parseErr == nil && cursor > 0 {
		filtered := uids[:0]
		for _, uid := range uids {
			if uint64(uid) < cursor {
				filtered = append(filtered, uid)
			}
		}
		uids = filtered
	}
	done := len(uids) <= standardIMAPHistorySize
	if len(uids) > standardIMAPHistorySize {
		uids = uids[len(uids)-standardIMAPHistorySize:]
	}
	messages, quarantined, err := fetchStandardIMAPMessages(client, config.Mailbox, status.UidValidity, uids)
	if err != nil {
		return emailHistoryPage{}, err
	}
	next := ""
	if !done && len(uids) > 0 {
		next = strconv.FormatUint(uint64(uids[0]), 10)
	}
	return emailHistoryPage{Messages: messages, Quarantined: quarantined, Scanned: len(uids), NextCursor: next, Done: done}, nil
}
