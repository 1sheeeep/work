package platform

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/emersion/go-imap"
	imapclient "github.com/emersion/go-imap/client"
)

func TestIdentifyNetEaseIMAPClientSendsRFC2971IDBeforeMailboxAccess(t *testing.T) {
	clientConn, serverConn := net.Pipe()
	commandLine := make(chan string, 1)
	serverDone := make(chan error, 1)
	serverRelease := make(chan struct{})
	defer close(serverRelease)
	go func() {
		defer serverConn.Close()
		if _, err := fmt.Fprint(serverConn, "* OK IMAP server ready\r\n"); err != nil {
			serverDone <- err
			return
		}
		reader := bufio.NewReader(serverConn)
		capabilityLine, err := reader.ReadString('\n')
		if err != nil {
			serverDone <- err
			return
		}
		capabilityFields := strings.Fields(capabilityLine)
		if len(capabilityFields) == 0 {
			serverDone <- fmt.Errorf("missing CAPABILITY command tag")
			return
		}
		if _, err := fmt.Fprintf(serverConn, "* CAPABILITY IMAP4rev1\r\n%s OK CAPABILITY completed\r\n", capabilityFields[0]); err != nil {
			serverDone <- err
			return
		}
		line, err := reader.ReadString('\n')
		if err != nil {
			serverDone <- err
			return
		}
		commandLine <- strings.TrimSpace(line)
		fields := strings.Fields(line)
		if len(fields) == 0 {
			serverDone <- fmt.Errorf("missing IMAP command tag")
			return
		}
		_, err = fmt.Fprintf(serverConn, "* ID (\"name\" \"NetEase Mail\")\r\n%s OK ID completed\r\n", fields[0])
		serverDone <- err
		<-serverRelease
	}()

	client, err := imapclient.New(clientConn)
	if err != nil {
		t.Fatalf("create IMAP client: %v", err)
	}
	defer client.Close()
	if err := identifyNetEaseIMAPClient(client, "Support@163.com"); err != nil {
		t.Fatalf("identifyNetEaseIMAPClient: %v", err)
	}
	if err := <-serverDone; err != nil {
		t.Fatalf("fake IMAP server: %v", err)
	}
	line := <-commandLine
	for _, required := range []string{
		" ID ", `"name" "Xzdesk Agent"`, `"version" "1.0"`,
		`"vendor" "Xinzhi Technology"`, `"support-email" "support@163.com"`,
	} {
		if !strings.Contains(line, required) {
			t.Fatalf("IMAP ID command %q does not contain %q", line, required)
		}
	}
}

func TestStandardMailPresetForSupportedDomains(t *testing.T) {
	tests := []struct {
		mailbox  string
		service  string
		imapHost string
		smtpHost string
	}{
		{mailbox: "Support@163.com", service: "netease", imapHost: "imap.163.com", smtpHost: "smtp.163.com"},
		{mailbox: "finance@126.com", service: "netease", imapHost: "imap.126.com", smtpHost: "smtp.126.com"},
		{mailbox: "support@qq.com", service: "qq", imapHost: "imap.qq.com", smtpHost: "smtp.qq.com"},
		{mailbox: "member@vip.qq.com", service: "qq", imapHost: "imap.qq.com", smtpHost: "smtp.qq.com"},
		{mailbox: "support@139.com", service: "139", imapHost: "imap.139.com", smtpHost: "smtp.139.com"},
		{mailbox: "support@189.cn", service: "189", imapHost: "imap.189.cn", smtpHost: "smtp.189.cn"},
	}
	for _, test := range tests {
		preset, err := standardMailPresetForMailbox(test.mailbox)
		if err != nil {
			t.Fatalf("standardMailPresetForMailbox(%q): %v", test.mailbox, err)
		}
		if preset.Service != test.service || preset.IMAPHost != test.imapHost || preset.IMAPPort != 993 || preset.SMTPHost != test.smtpHost || preset.SMTPPort != 465 || preset.SMTPMode != "tls" {
			t.Fatalf("unexpected preset for %s: %#v", test.mailbox, preset)
		}
	}
	for _, mailbox := range []string{"support@example.com", "not-an-email"} {
		if _, err := standardMailPresetForMailbox(mailbox); err == nil {
			t.Fatalf("unsupported mailbox %q was accepted", mailbox)
		}
	}
}

func TestConnectStandardEmailVerifiesBothProtocolsAndKeepsCredentialSecret(t *testing.T) {
	originalIMAP := verifyStandardIMAPConnection
	originalSMTP := verifyStandardSMTPConnection
	var imapChecked, smtpChecked bool
	verifyStandardIMAPConnection = func(_ context.Context, config standardMailConfig) (standardIMAPBaseline, error) {
		imapChecked = true
		if config.Mailbox != "support@163.com" || config.Credential != "client-secret" || config.Preset.IMAPHost != "imap.163.com" {
			t.Fatalf("unexpected IMAP config: %#v", config)
		}
		return standardIMAPBaseline{UIDValidity: 77, LastUID: 1234}, nil
	}
	verifyStandardSMTPConnection = func(_ context.Context, config standardMailConfig) error {
		smtpChecked = true
		if config.Mailbox != "support@163.com" || config.Credential != "client-secret" || config.Preset.SMTPHost != "smtp.163.com" {
			t.Fatalf("unexpected SMTP config: %#v", config)
		}
		return nil
	}
	t.Cleanup(func() {
		verifyStandardIMAPConnection = originalIMAP
		verifyStandardSMTPConnection = originalSMTP
	})

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "NetEase Store"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	result, err := server.connectStandardEmail(context.Background(), shop.ID, standardMailConnectRequest{
		Mailbox: "support@163.com", Credential: "client-secret",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !imapChecked || !smtpChecked {
		t.Fatalf("protocol verification was incomplete: imap=%v smtp=%v", imapChecked, smtpChecked)
	}
	if result.Source.Provider != standardMailProvider || result.Source.Metadata[standardMailServiceKey] != "netease" || result.Source.Metadata[standardIMAPLastUIDKey] != "1234" {
		t.Fatalf("unexpected source: %#v", result.Source)
	}
	if result.Source.Metadata[emailNotificationStatusKey] != "ok" || result.Source.Metadata["email_sync_interval"] != "imap_5m_noop+reconnect_recovery" {
		t.Fatalf("unexpected runtime metadata: %#v", result.Source.Metadata)
	}
	serialized, _ := json.Marshal(result)
	if strings.Contains(string(serialized), "client-secret") {
		t.Fatalf("source response exposed the authorization code: %s", serialized)
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, "support@163.com")
	if err != nil {
		t.Fatal(err)
	}
	if installation.AccessToken != "client-secret" || installation.Provider != standardMailProvider || installation.RefreshToken != "" {
		t.Fatalf("authorization code was not stored in the credential record: %#v", installation)
	}
}

func TestStandardMailUsernameUsesLocalPartOnlyFor189(t *testing.T) {
	if got := standardMailUsername(standardMailConfig{Preset: standardMailPresets["189.cn"], Mailbox: "support@189.cn"}); got != "support" {
		t.Fatalf("189 username = %q, want support", got)
	}
	if got := standardMailUsername(standardMailConfig{Preset: standardMailPresets["139.com"], Mailbox: "support@139.com"}); got != "support@139.com" {
		t.Fatalf("139 username = %q, want full mailbox", got)
	}
	metadata := standardMailMetadata(standardMailConfig{Preset: standardMailPresets["189.cn"], Mailbox: "support@189.cn"}, standardIMAPBaseline{})
	if standardMailPresets["189.cn"].CredentialLabel != "客户端专用密码" {
		t.Fatalf("unexpected 189 credential label: %q", standardMailPresets["189.cn"].CredentialLabel)
	}
	if metadata["auth"] != "client_specific_password" || metadata[standardMailServiceKey] != "189" {
		t.Fatalf("unexpected 189 metadata: %#v", metadata)
	}
}

func TestParseStandardMailMessagePreservesThreadBodyAndAttachment(t *testing.T) {
	attachmentContent := []byte("invoice-content")
	raw := strings.Join([]string{
		"From: =?UTF-8?B?5a6i5oi3?= <buyer@example.com>",
		"To: support@126.com",
		"Reply-To: buyer@example.com",
		"Subject: =?UTF-8?B?6K6i5Y2V6Zeu6aKY?=",
		"Date: Sat, 15 Aug 2026 10:00:00 +0800",
		"Message-ID: <message-2@example.com>",
		"In-Reply-To: <message-1@example.com>",
		"References: <root@example.com> <message-1@example.com>",
		"MIME-Version: 1.0",
		"Content-Type: multipart/mixed; boundary=outer",
		"",
		"--outer",
		"Content-Type: text/plain; charset=UTF-8",
		"Content-Transfer-Encoding: base64",
		"",
		base64.StdEncoding.EncodeToString([]byte("请查看附件。")),
		"--outer",
		"Content-Type: application/pdf; name=invoice.pdf",
		"Content-Disposition: attachment; filename=invoice.pdf",
		"Content-Transfer-Encoding: base64",
		"",
		base64.StdEncoding.EncodeToString(attachmentContent),
		"--outer--",
		"",
	}, "\r\n")

	message, err := parseStandardMailMessage("support@126.com", 77, 42, time.Time{}, []string{imap.SeenFlag}, []byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if message.Subject != "订单问题" || message.Body != "请查看附件。" || message.CustomerEmail != "buyer@example.com" {
		t.Fatalf("unexpected parsed message: %#v", message)
	}
	if message.ExternalConversationID != "buyer@example.com|订单问题" || message.Metadata["mail_message_id"] != "<message-2@example.com>" || message.Metadata["mail_references"] == "" {
		t.Fatalf("thread headers were not preserved: %#v", message.Metadata)
	}
	if message.SourceMessageID != standardMailProvider+":77:42" || message.Metadata[standardMailProvider+"_message_id"] != "42" || message.Metadata["email_provider_read"] != "true" {
		t.Fatalf("IMAP identity or flags were not preserved: %#v", message)
	}
	if len(message.Attachments) != 1 || message.Attachments[0].FileName != "invoice.pdf" || string(message.Attachments[0].Content) != string(attachmentContent) {
		t.Fatalf("attachment was not decoded: %#v", message.Attachments)
	}
	normalized, err := normalizeMessageContent(Message{Type: MessageTypeText, Body: message.Body, Metadata: message.Metadata})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Metadata[standardMailProvider+"_message_id"] != "42" || normalized.Metadata["mail_message_id"] != "<message-2@example.com>" {
		t.Fatalf("threading metadata was removed during persistence normalization: %#v", normalized.Metadata)
	}
}

func TestStandardMailPollingHasNoScheduledFallback(t *testing.T) {
	source := ShopSource{ID: "mail-1", Provider: standardMailProvider, Metadata: map[string]string{}}
	if interval := standardIMAPReconcileInterval(source); interval != 0 {
		t.Fatalf("non-IDLE mailbox reconcile interval = %s, want disabled", interval)
	}
	if got := standardIMAPSyncInterval(source); got != "imap_5m_noop+reconnect_recovery" {
		t.Fatalf("non-IDLE sync mode = %q", got)
	}
}

func TestQQMailPollingUsesDailyFallback(t *testing.T) {
	now := time.Now().UTC()
	source := ShopSource{ID: "qq-mail-1", Provider: standardMailProvider, Metadata: map[string]string{
		standardMailServiceKey:  "qq",
		emailLastReconcileAtKey: now.Add(-23 * time.Hour).Format(time.RFC3339Nano),
	}}
	if interval := standardIMAPReconcileInterval(source); interval != 24*time.Hour {
		t.Fatalf("QQ reconcile interval = %s, want 24h", interval)
	}
	if emailSourcePollDue(source, now, standardIMAPReconcileInterval(source)) {
		t.Fatal("QQ source should not be due before 24 hours")
	}
	source.Metadata[emailLastReconcileAtKey] = now.Add(-25 * time.Hour).Format(time.RFC3339Nano)
	if !emailSourcePollDue(source, now, standardIMAPReconcileInterval(source)) {
		t.Fatal("QQ source should be due after 24 hours")
	}
	if got := standardIMAPSyncInterval(source); got != "imap_event+24h_reconcile" {
		t.Fatalf("QQ sync interval metadata = %q", got)
	}
	if got := standardIMAPSyncIntervalForService("qq"); got != "imap_event+24h_reconcile" {
		t.Fatalf("QQ connect metadata = %q", got)
	}
}

func TestStandardIMAPCursorResetsAfterUIDValidityChange(t *testing.T) {
	if got := standardIMAPNextCursor(50000, 100, true, []uint32{90, 91}); got != 91 {
		t.Fatalf("recovered cursor = %d, want 91", got)
	}
	if got := standardIMAPNextCursor(50000, 100, true, nil); got != 99 {
		t.Fatalf("empty recovered cursor = %d, want 99", got)
	}
	if got := standardIMAPNextCursor(80, 100, false, []uint32{81, 82}); got != 82 {
		t.Fatalf("normal cursor = %d, want 82", got)
	}
}

type boundedStandardIMAPClient struct {
	status *imap.MailboxStatus
	uids   []uint32
}

func (client boundedStandardIMAPClient) Select(string, bool) (*imap.MailboxStatus, error) {
	return client.status, nil
}

func (client boundedStandardIMAPClient) UidSearch(*imap.SearchCriteria) ([]uint32, error) {
	return append([]uint32(nil), client.uids...), nil
}

func (boundedStandardIMAPClient) UidFetch(_ *imap.SeqSet, _ []imap.FetchItem, messages chan *imap.Message) error {
	close(messages)
	return nil
}

func TestStandardIMAPIncrementalBatchIsBoundedAndContinuesBacklog(t *testing.T) {
	uids := make([]uint32, 250)
	for index := range uids {
		uids[index] = uint32(index + 1)
	}
	client := boundedStandardIMAPClient{status: &imap.MailboxStatus{UidValidity: 77, UidNext: 251}, uids: uids}
	batch, err := fetchStandardIMAPBatchWithClient(client, "support@126.com", ShopSource{Metadata: map[string]string{
		standardIMAPUIDValidityKey: "77", standardIMAPLastUIDKey: "0",
	}})
	if err != nil {
		t.Fatal(err)
	}
	if !batch.BacklogPending || len(batch.Quarantined) != standardIMAPBatchSize || batch.MetadataUpdates[standardIMAPLastUIDKey] != "200" {
		t.Fatalf("IMAP batch was not bounded/checkpointed: backlog=%v quarantined=%d metadata=%#v", batch.BacklogPending, len(batch.Quarantined), batch.MetadataUpdates)
	}
}

func TestAgentReplyUsesStandardSMTPThreadHeaders(t *testing.T) {
	originalSend := sendStandardSMTPThreadReply
	originalRead := setStandardIMAPMessageRead
	var sent, markedRead bool
	sendStandardSMTPThreadReply = func(_ context.Context, config standardMailConfig, conversation Conversation, target emailReplyTarget, body string, attachment *emailAttachmentInput) (string, error) {
		sent = true
		if config.Mailbox != "support@126.com" || config.Credential != "client-secret" {
			t.Fatalf("unexpected send config: %#v", config)
		}
		if conversation.Subject != "Order help" || target.MessageID != "42" || target.HeaderMessageID != "<customer-42@example.com>" || target.HeaderReferences != "<root@example.com>" || target.CustomerEmail != "buyer@example.com" || body != "We are checking it now." || attachment != nil {
			t.Fatalf("thread reply fields were not preserved: conversation=%#v target=%#v body=%q", conversation, target, body)
		}
		return "<sent@example.com>", nil
	}
	setStandardIMAPMessageRead = func(_ context.Context, config standardMailConfig, messageID string, read bool) error {
		markedRead = true
		if config.Mailbox != "support@126.com" || messageID != "42" || !read {
			t.Fatalf("unexpected read-state request: mailbox=%q message=%q read=%v", config.Mailbox, messageID, read)
		}
		return nil
	}
	t.Cleanup(func() {
		sendStandardSMTPThreadReply = originalSend
		setStandardIMAPMessageRead = originalRead
	})

	store := NewMemoryStore()
	platformServer := NewServer(store)
	startTestEmailOutbox(t, platformServer)
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)
	var admin User
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/auth/me", adminToken, nil, http.StatusOK, &admin)
	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "NetEase Reply Shop"}, http.StatusCreated, &shop)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: admin.ID}, http.StatusCreated, nil)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{
		Type: SourceTypeEmail, Provider: standardMailProvider, Address: "support@126.com", Metadata: map[string]string{standardMailServiceKey: "netease"},
	}, http.StatusCreated, &source)
	if _, err := store.SaveEmailInstallation(context.Background(), EmailInstallation{
		ShopID: shop.ID, Mailbox: source.Address, Provider: standardMailProvider, AccessToken: "client-secret", Scope: "imap.read imap.modify smtp.send", ExpiresAt: time.Now().UTC().AddDate(10, 0, 0),
	}); err != nil {
		t.Fatal(err)
	}
	var conversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID: shop.ID, SourceID: source.ID, CustomerName: "Buyer", CustomerEmail: "buyer@example.com", Subject: "Order help",
	}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/claim", adminToken, nil, http.StatusOK, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer, Body: "Where is my order?", SourceMessageID: standardMailProvider + ":77:42",
		Metadata: map[string]string{standardMailProvider + "_message_id": "42", "mail_message_id": "<customer-42@example.com>", "mail_references": "<root@example.com>", "mail_reply_to_email": "buyer@example.com"},
	}, http.StatusCreated, nil)
	var reply Message
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+conversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionAgent, Body: "We are checking it now.",
	}, http.StatusAccepted, &reply)
	reply = waitForEmailMessageStatus(t, store, conversation.ID, reply.ID, emailSendStatusSent)
	if !sent || !markedRead {
		t.Fatalf("SMTP send or IMAP read synchronization did not run: sent=%v read=%v", sent, markedRead)
	}
	if reply.Metadata["mail_api_provider"] != standardMailProvider || reply.Metadata["mail_message_id"] != "<sent@example.com>" || reply.Metadata["mail_api_sent_message_id"] != standardMailProvider+":smtp:<sent@example.com>" {
		t.Fatalf("unexpected stored reply metadata: %#v", reply.Metadata)
	}
}
