package platform

import (
	"bufio"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestConnectCuiqiuEmailVerifiesAndStoresSecretsOutsideSourceMetadata(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	var paths []string
	api := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		if got := r.FormValue("token"); got != "api-secret" {
			t.Fatalf("token = %q, want api-secret", got)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v2/mail/list":
			_, _ = w.Write([]byte(`{"code":200,"data":{"list":[{"id":"mail-1","mail":"support@fastmo.cn"}]}}`))
		case "/v1/message/list":
			if got := r.FormValue("mail_id"); got != "mail-1" {
				t.Fatalf("mail_id = %q, want mail-1", got)
			}
			if got := r.FormValue("folder"); got != "Inbox" {
				t.Fatalf("folder = %q, want Inbox", got)
			}
			if got := r.FormValue("page"); got != "1" {
				t.Fatalf("page = %q, want 1", got)
			}
			if got := r.FormValue("limit"); got != "20" {
				t.Fatalf("limit = %q, want 20", got)
			}
			_, _ = w.Write([]byte(`{"code":200,"data":{"list":[],"total":0}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()

	originalClient := cuiqiuHTTPClient
	originalSMTPCheck := verifyCuiqiuSMTPConnection
	cuiqiuHTTPClient = api.Client()
	verifyCuiqiuSMTPConnection = func(config cuiqiuConfig) error {
		if config.Mailbox != "support@fastmo.cn" || config.SMTPHost != "smtp.fastmo.cn" || config.SMTPPassword != "smtp-secret" {
			t.Fatalf("unexpected SMTP config: %#v", config)
		}
		return nil
	}
	t.Cleanup(func() {
		cuiqiuHTTPClient = originalClient
		verifyCuiqiuSMTPConnection = originalSMTPCheck
	})

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Cuiqiu Store"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	settings, err := server.saveCuiqiuDomainSettings(context.Background(), cuiqiuDomainSettingsRequest{
		Domain: "fastmo.cn", APIBase: api.URL, Token: "api-secret", DomainID: "domain-1",
		SMTPHost: "smtp.fastmo.cn", SMTPPort: 465, SMTPMode: "tls",
	}, "https://kf.xzkj.ai")
	if err != nil {
		t.Fatal(err)
	}
	if !settings.HasToken || settings.EncryptedToken != "" || strings.Contains(settings.WebhookURL, "api-secret") {
		t.Fatalf("public settings exposed or lost token state: %#v", settings)
	}
	result, err := server.connectCuiqiuEmail(context.Background(), shop.ID, cuiqiuConnectRequest{
		Mailbox: "support@fastmo.cn", SMTPPassword: "smtp-secret",
	}, "https://kf.xzkj.ai")
	if err != nil {
		t.Fatal(err)
	}
	if result.Source.Provider != cuiqiuProvider || result.Source.Metadata[cuiqiuMailIDKey] != "mail-1" {
		t.Fatalf("unexpected source: %#v", result.Source)
	}
	if result.Source.Metadata[emailNotificationStatusKey] != "pending" {
		t.Fatalf("notification status = %q, want pending until a real webhook is observed", result.Source.Metadata[emailNotificationStatusKey])
	}
	serialized, _ := json.Marshal(result.Source)
	if strings.Contains(string(serialized), "api-secret") || strings.Contains(string(serialized), "smtp-secret") {
		t.Fatalf("source response exposed credentials: %s", serialized)
	}
	if !strings.HasPrefix(result.WebhookURL, "https://kf.xzkj.ai/webhooks/email/cuiqiu?domain=fastmo.cn&key=") || len(strings.TrimPrefix(result.WebhookURL, "https://kf.xzkj.ai/webhooks/email/cuiqiu?domain=fastmo.cn&key=")) != 32 {
		t.Fatalf("unexpected webhook URL: %q", result.WebhookURL)
	}
	installation, err := store.GetEmailInstallation(context.Background(), shop.ID, "support@fastmo.cn")
	if err != nil {
		t.Fatal(err)
	}
	if installation.AccessToken != "api-secret" || installation.RefreshToken != "smtp-secret" {
		t.Fatalf("credentials were not stored in the protected installation: %#v", installation)
	}
	if strings.Join(paths, ",") != "/v2/mail/list,/v1/message/list" {
		t.Fatalf("verification paths = %#v", paths)
	}
}

func TestConnectCuiqiuEmailRequiresWorkingReceiveAPI(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "test-only-encryption-secret")
	messageListCalls := 0
	api := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v2/mail/list":
			_, _ = w.Write([]byte(`{"code":200,"data":{"list":[{"id":"mail-1","mail":"support@fastmo.cn"}]}}`))
		case "/v1/message/list":
			messageListCalls++
			http.Error(w, `{"code":503,"msg":"temporary unavailable"}`, http.StatusServiceUnavailable)
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()

	originalClient := cuiqiuHTTPClient
	originalSMTPCheck := verifyCuiqiuSMTPConnection
	cuiqiuHTTPClient = api.Client()
	verifyCuiqiuSMTPConnection = func(cuiqiuConfig) error { return nil }
	t.Cleanup(func() {
		cuiqiuHTTPClient = originalClient
		verifyCuiqiuSMTPConnection = originalSMTPCheck
	})

	store := NewMemoryStore()
	shop, err := store.CreateShop(context.Background(), Shop{DisplayName: "Cuiqiu Retry Store"})
	if err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	if _, err = server.saveCuiqiuDomainSettings(context.Background(), cuiqiuDomainSettingsRequest{
		Domain: "fastmo.cn", APIBase: api.URL, Token: "api-secret",
		SMTPHost: "smtp.fastmo.cn", SMTPPort: 587, SMTPMode: "starttls",
	}, "https://kf.xzkj.ai"); err != nil {
		t.Fatal(err)
	}
	if _, err = server.connectCuiqiuEmail(context.Background(), shop.ID, cuiqiuConnectRequest{
		Mailbox: "support@fastmo.cn", SMTPPassword: "smtp-secret",
	}, "https://kf.xzkj.ai"); err == nil || !strings.Contains(err.Error(), "收件 API 验证失败") || !strings.Contains(err.Error(), "503 Service Unavailable") || !strings.Contains(err.Error(), `"code":503`) || !strings.Contains(err.Error(), `"msg":"temporary unavailable"`) {
		t.Fatalf("expected receive API failure, got %v", err)
	}
	for _, invented := range []string{"请检查", "Token 或接口权限", "接口响应格式与文档不一致"} {
		if strings.Contains(err.Error(), invented) {
			t.Fatalf("receive API failure contains invented diagnosis %q: %v", invented, err)
		}
	}
	if messageListCalls != 2 {
		t.Fatalf("message list validation calls = %d, want 2", messageListCalls)
	}
	if sources, listErr := store.ListShopSources(context.Background(), shop.ID); listErr != nil || len(sources) != 0 {
		t.Fatalf("failed validation must not create a source: sources=%#v err=%v", sources, listErr)
	}
}

func TestCuiqiuValidationErrorShowsActualSMTPAttemptsOnly(t *testing.T) {
	cause := fmt.Errorf("SMTP authentication attempts failed: %w", errors.Join(
		errors.New("587/starttls AUTH PLAIN failed: 535 5.7.8 Authentication credentials invalid"),
		errors.New("465/tls AUTH LOGIN failed: 535 5.7.8 Authentication credentials invalid"),
	))
	err := newCuiqiuValidationError("脆球 SMTP 验证", cause)
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("newCuiqiuValidationError() = %v; want ErrInvalid", err)
	}
	message := err.Error()
	for _, actual := range []string{"587/starttls", "AUTH PLAIN", "465/tls", "AUTH LOGIN", "535 5.7.8 Authentication credentials invalid"} {
		if !strings.Contains(message, actual) {
			t.Fatalf("newCuiqiuValidationError() = %q; missing actual result %q", message, actual)
		}
	}
	for _, invented := range []string{"invalid input", "第三方邮箱客户端", "协议权限", "请确认", "请检查"} {
		if strings.Contains(message, invented) {
			t.Fatalf("newCuiqiuValidationError() = %q; contains invented guidance %q", message, invented)
		}
	}
}

func TestPostCuiqiuPreservesFailureFieldsAndRedactsSecrets(t *testing.T) {
	api := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":403,"msg":"actual provider message","trace_id":"trace-1","details":{"reason":"mailbox_disabled","access_token":"do-not-show"}}`))
	}))
	defer api.Close()
	originalClient := cuiqiuHTTPClient
	cuiqiuHTTPClient = api.Client()
	t.Cleanup(func() { cuiqiuHTTPClient = originalClient })

	err := postCuiqiu(context.Background(), cuiqiuConfig{APIBase: api.URL, Token: "request-token"}, "/test", nil, nil)
	if err == nil {
		t.Fatal("expected provider failure")
	}
	message := err.Error()
	for _, actual := range []string{`"code":403`, "actual provider message", "trace-1", "mailbox_disabled", `"access_token":"[已隐藏]"`} {
		if !strings.Contains(message, actual) {
			t.Fatalf("postCuiqiu() = %q; missing response field %q", message, actual)
		}
	}
	if strings.Contains(message, "do-not-show") || strings.Contains(message, "request-token") {
		t.Fatalf("postCuiqiu() = %q; leaked token", message)
	}
}

func TestNormalizeCuiqiuConnectRequestPreservesPasswordExactly(t *testing.T) {
	config, err := normalizeCuiqiuConnectRequest(cuiqiuConnectRequest{
		Mailbox: " support@fastmo.cn ", SMTPPassword: " leading-and-trailing ",
	})
	if err != nil {
		t.Fatal(err)
	}
	if config.SMTPPassword != " leading-and-trailing " {
		t.Fatalf("password was changed: %q", config.SMTPPassword)
	}
}

func TestCuiqiuMessageResponsesAcceptArrayAddressesAndAttachments(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(1 << 20)
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/message/list":
			_, _ = w.Write([]byte(`{"code":200,"data":{"list":[{"id":"message-1","from":[{"name":"Buyer","address":"buyer@example.com"}],"to":["support@fastmo.cn"],"subject":"Order help","timestamp":1700000000}],"total":1}}`))
		case "/v1/message/detail":
			if got := r.FormValue("request_header"); got != "1" {
				t.Fatalf("request_header = %q, want 1", got)
			}
			_, _ = w.Write([]byte(`{"code":200,"data":{"content":{"id":"message-1","from":[{"name":"Buyer","address":"buyer@example.com"}],"to":[{"address":"support@fastmo.cn"}],"subject":"Order help","timestamp":1700000000,"plain_text":"Where is my order?","header":"Message-ID: <customer-message@example.com>\r\nReferences: <thread-root@example.com>","attachments":[{"filename":"photo.jpg","content_type":"image/jpeg","base64_data":"cGhvdG8="}]}}}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()

	source := ShopSource{Address: "support@fastmo.cn", Provider: cuiqiuProvider, Metadata: map[string]string{
		cuiqiuAPIBaseKey: api.URL, cuiqiuMailIDKey: "mail-1", cuiqiuLastTimestampKey: "1",
	}}
	batch, err := fetchCuiqiuSyncBatch(context.Background(), "token", source.Address, source)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Messages) != 1 || batch.Messages[0].CustomerEmail != "buyer@example.com" || batch.Messages[0].CustomerName != "Buyer" {
		t.Fatalf("unexpected parsed message: %#v", batch.Messages)
	}
	if batch.Messages[0].Metadata["email_has_attachments"] != "true" {
		t.Fatalf("array attachments were not retained: %#v", batch.Messages[0].Metadata)
	}
	if batch.Messages[0].Metadata["mail_message_id"] != "<customer-message@example.com>" || batch.Messages[0].Metadata["mail_references"] != "<thread-root@example.com>" {
		t.Fatalf("mail thread headers were not retained: %#v", batch.Messages[0].Metadata)
	}
	if len(batch.Messages[0].Attachments) != 1 || batch.Messages[0].Attachments[0].FileName != "photo.jpg" || string(batch.Messages[0].Attachments[0].Content) != "photo" {
		t.Fatalf("attachment payload was not imported: %#v", batch.Messages[0].Attachments)
	}
}

func TestCuiqiuHeaderExtractionAcceptsStructuredProviderFields(t *testing.T) {
	detail := cuiqiuMessageDetail{
		Headers: `[{"name":"Message-ID","value":"<message@example.com>"},{"name":"References","value":["<root@example.com>","<parent@example.com>"]}]`,
	}
	messageID, references := cuiqiuMailThreadHeaders(detail)
	if messageID != "<message@example.com>" || references != "<root@example.com> <parent@example.com>" {
		t.Fatalf("thread headers = %q / %q", messageID, references)
	}
}

func TestCuiqiuOutgoingHistoryUsesRecipientAsCustomer(t *testing.T) {
	incoming := cuiqiuDetailToIncoming("support@fastmo.cn", cuiqiuMessageDetail{
		ID: "sent-1", From: "support@fastmo.cn", To: "Buyer <buyer@example.com>", Subject: "Re: Order help", PlainText: "Reply",
	})
	if incoming.Direction != MessageDirectionAgent || incoming.CustomerEmail != "buyer@example.com" || incoming.CustomerName != "Buyer" {
		t.Fatalf("outgoing identity was not mapped to the recipient: %#v", incoming)
	}
	if incoming.ExternalConversationID != cuiqiuThreadID("buyer@example.com", "Order help", "sent-1") {
		t.Fatalf("outgoing message did not stay in the customer thread: %q", incoming.ExternalConversationID)
	}
}

func TestCuiqiuAttachmentFailureMetadataIsActualProviderPayloadFailure(t *testing.T) {
	incoming := cuiqiuDetailToIncoming("support@fastmo.cn", cuiqiuMessageDetail{
		ID: "message-1", From: "buyer@example.com", Subject: "Attachment", Attachments: `[{"filename":"proof.pdf","content_type":"application/pdf","base64_data":"not-base64"}]`,
	})
	if len(incoming.Attachments) != 0 || !strings.Contains(incoming.Metadata["email_attachment_import_error"], "invalid base64_data") {
		t.Fatalf("unexpected attachment failure state: %#v", incoming)
	}
}

func TestIncomingEmailDocumentAttachmentIsStoredAsFile(t *testing.T) {
	t.Setenv("XZDESK_UPLOAD_DIR", t.TempDir())
	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Attachment Shop"})
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: cuiqiuProvider, Address: "support@fastmo.cn"})
	conversation, _ := store.CreateConversation(context.Background(), Conversation{ShopID: shop.ID, SourceID: source.ID, CustomerEmail: "buyer@example.com", Subject: "Document"})
	server := NewServer(store)
	pdf := []byte("%PDF-1.4\n%%EOF")
	message, _, err := server.addIncomingEmailAttachment(context.Background(), conversation, incomingEmailMessage{SourceMessageID: "cuiqiu:message-1"}, incomingEmailAttachment{
		FileName: "proof.pdf", MIMEType: "application/pdf", Content: pdf,
	}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if message.Type != MessageTypeFile || message.Metadata["fileName"] != "proof.pdf" || message.Metadata["fileSize"] != fmt.Sprint(len(pdf)) {
		t.Fatalf("unexpected file message: %#v", message)
	}
}

func TestFetchCuiqiuSyncBatchUsesTimestampOverlapWithoutDroppingSameSecond(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/message/list":
			if got := r.FormValue("limit"); got != "20" {
				t.Fatalf("limit = %q, want official maximum 20", got)
			}
			_, _ = w.Write([]byte(`{"code":200,"data":{"list":[{"id":"new-2","from":"Buyer Two <two@example.com>","subject":"Re: Order 2","timestamp":102},{"id":"new-1","from":"Buyer One <one@example.com>","subject":"Order 1","timestamp":100},{"id":"old","from":"old@example.com","subject":"Old","timestamp":99}],"total":3}}`))
		case "/v1/message/detail":
			id := r.FormValue("message_id")
			body := "Body " + id
			timestamp := int64(100)
			from := "Buyer One <one@example.com>"
			subject := "Order 1"
			if id == "new-2" {
				timestamp, from, subject = 102, "Buyer Two <two@example.com>", "Re: Order 2"
			}
			response, _ := json.Marshal(map[string]any{"code": 200, "data": map[string]any{"list": []map[string]any{{"id": id, "from": from, "to": "support@fastmo.cn", "subject": subject, "timestamp": timestamp, "plain_text": body}}}})
			_, _ = w.Write(response)
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()

	source := ShopSource{Address: "support@fastmo.cn", Provider: cuiqiuProvider, Metadata: map[string]string{
		cuiqiuAPIBaseKey: api.URL, cuiqiuMailIDKey: "mail-1", cuiqiuLastTimestampKey: "100",
	}}
	batch, err := fetchCuiqiuSyncBatch(context.Background(), "token", source.Address, source)
	if err != nil {
		t.Fatal(err)
	}
	if len(batch.Messages) != 2 {
		t.Fatalf("messages = %#v, want two new/overlap messages", batch.Messages)
	}
	if batch.MetadataUpdates[cuiqiuLastTimestampKey] != "102" {
		t.Fatalf("timestamp cursor = %q, want 102", batch.MetadataUpdates[cuiqiuLastTimestampKey])
	}
	if batch.Messages[0].SourceMessageID != "cuiqiu:new-1" || batch.Messages[1].SourceMessageID != "cuiqiu:new-2" {
		t.Fatalf("messages were not emitted oldest-first: %#v", batch.Messages)
	}
}

func TestFetchCuiqiuSyncBatchFetchesOnlyOneDetailBatchAtATime(t *testing.T) {
	detailCalls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/message/list":
			page, _ := strconv.Atoi(r.FormValue("page"))
			start, end := 25, 6
			if page == 2 {
				start, end = 5, 1
			}
			list := []map[string]any{}
			for id := start; id >= end; id-- {
				list = append(list, map[string]any{"id": fmt.Sprintf("message-%02d", id), "from": "buyer@example.com", "subject": "Order", "timestamp": 100 + id})
			}
			writeJSONResponse(w, http.StatusOK, map[string]any{"code": 200, "data": map[string]any{"list": list, "total": 25}})
		case "/v1/message/detail":
			detailCalls++
			id := r.FormValue("message_id")
			var number int
			_, _ = fmt.Sscanf(id, "message-%d", &number)
			writeJSONResponse(w, http.StatusOK, map[string]any{"code": 200, "data": map[string]any{"list": []map[string]any{{
				"id": id, "from": "buyer@example.com", "to": "support@fastmo.cn", "subject": "Order", "timestamp": 100 + number, "plain_text": "Body",
			}}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer api.Close()

	source := ShopSource{Address: "support@fastmo.cn", Provider: cuiqiuProvider, Metadata: map[string]string{
		cuiqiuAPIBaseKey: api.URL, cuiqiuMailIDKey: "mail-1", cuiqiuLastTimestampKey: "100",
	}}
	batch, err := fetchCuiqiuSyncBatch(context.Background(), "token", source.Address, source)
	if err != nil {
		t.Fatal(err)
	}
	if !batch.BacklogPending || len(batch.Messages) != cuiqiuIncrementalBatchSize || detailCalls != cuiqiuIncrementalBatchSize {
		t.Fatalf("Cuiqiu batch was not bounded: messages=%d details=%d backlog=%v", len(batch.Messages), detailCalls, batch.BacklogPending)
	}
	if batch.Messages[0].SourceMessageID != "cuiqiu:message-01" || batch.Messages[len(batch.Messages)-1].SourceMessageID != "cuiqiu:message-20" || batch.MetadataUpdates[cuiqiuLastTimestampKey] != "120" {
		t.Fatalf("Cuiqiu bounded cursor/order is wrong: first=%q last=%q metadata=%#v", batch.Messages[0].SourceMessageID, batch.Messages[len(batch.Messages)-1].SourceMessageID, batch.MetadataUpdates)
	}
}

func TestBuildCuiqiuSMTPMessageKeepsReplyHeaders(t *testing.T) {
	raw, messageID, err := buildCuiqiuSMTPMessage(
		"support@fastmo.cn", "buyer@example.com",
		Conversation{CustomerName: "Buyer", Subject: "Order help"},
		emailReplyTarget{HeaderMessageID: "<original@example.com>", HeaderReferences: "<older@example.com>"},
		"Hello", nil,
	)
	if err != nil {
		t.Fatal(err)
	}
	text := string(raw)
	for _, required := range []string{"In-Reply-To: <original@example.com>", "References: <older@example.com> <original@example.com>", "Subject: Re: Order help", "Message-ID: " + messageID} {
		if !strings.Contains(text, required) {
			t.Fatalf("SMTP message missing %q:\n%s", required, text)
		}
	}
}

func TestVerifyCuiqiuSMTPFallsBackFromPlainToLogin(t *testing.T) {
	cuiqiuSMTPRouteCache.Clear()
	originalDial := dialCuiqiuSMTPConnection
	mechanisms := make(chan string, 4)
	dialCuiqiuSMTPConnection = func(cuiqiuConfig) (*smtp.Client, error) {
		return newCuiqiuTestSMTPClient(t, mechanisms), nil
	}
	t.Cleanup(func() {
		dialCuiqiuSMTPConnection = originalDial
		cuiqiuSMTPRouteCache.Clear()
	})

	config := cuiqiuConfig{
		Mailbox: "support@fastmo.cn", SMTPPassword: "mailbox-password",
		SMTPHost: "localhost", SMTPPort: 587, SMTPMode: "starttls",
	}
	if err := verifyCuiqiuSMTP(config); err != nil {
		t.Fatal(err)
	}
	if first, second := <-mechanisms, <-mechanisms; first != "PLAIN" || second != "LOGIN" {
		t.Fatalf("authentication mechanisms = %q, %q; want PLAIN then LOGIN", first, second)
	}
	attempts := cuiqiuSMTPAttempts(config)
	if len(attempts) == 0 || attempts[0].AuthMethod != cuiqiuSMTPAuthLogin || attempts[0].Config.SMTPPort != 587 {
		t.Fatalf("successful LOGIN route was not cached first: %#v", attempts)
	}
}

func TestCuiqiuSMTPAttemptsIncludeTLSFallback(t *testing.T) {
	cuiqiuSMTPRouteCache.Clear()
	t.Cleanup(cuiqiuSMTPRouteCache.Clear)
	attempts := cuiqiuSMTPAttempts(cuiqiuConfig{SMTPHost: "domain-smtp.cuiqiu.com", SMTPPort: 587, SMTPMode: "starttls"})
	want := []struct {
		port int
		mode string
		auth cuiqiuSMTPAuthMethod
	}{{587, "starttls", cuiqiuSMTPAuthPlain}, {587, "starttls", cuiqiuSMTPAuthLogin}, {465, "tls", cuiqiuSMTPAuthLogin}, {465, "tls", cuiqiuSMTPAuthPlain}}
	if len(attempts) != len(want) {
		t.Fatalf("attempt count = %d, want %d: %#v", len(attempts), len(want), attempts)
	}
	for index, expected := range want {
		if attempts[index].Config.SMTPPort != expected.port || attempts[index].Config.SMTPMode != expected.mode || attempts[index].AuthMethod != expected.auth {
			t.Fatalf("attempt %d = %#v, want port=%d mode=%s auth=%s", index, attempts[index], expected.port, expected.mode, expected.auth)
		}
	}
}

func TestVerifyCuiqiuSMTPFallsBackFromSTARTTLSToTLS(t *testing.T) {
	cuiqiuSMTPRouteCache.Clear()
	originalDial := dialCuiqiuSMTPConnection
	ports := make(chan int, 4)
	mechanisms := make(chan string, 4)
	dialCuiqiuSMTPConnection = func(config cuiqiuConfig) (*smtp.Client, error) {
		ports <- config.SMTPPort
		if config.SMTPPort == 587 {
			return nil, fmt.Errorf("STARTTLS unavailable")
		}
		return newCuiqiuTestSMTPClient(t, mechanisms), nil
	}
	t.Cleanup(func() {
		dialCuiqiuSMTPConnection = originalDial
		cuiqiuSMTPRouteCache.Clear()
	})

	config := cuiqiuConfig{
		Mailbox: "support@fastmo.cn", SMTPPassword: "mailbox-password",
		SMTPHost: "localhost", SMTPPort: 587, SMTPMode: "starttls",
	}
	if err := verifyCuiqiuSMTP(config); err != nil {
		t.Fatal(err)
	}
	if firstPort, secondPort := <-ports, <-ports; firstPort != 587 || secondPort != 465 {
		t.Fatalf("SMTP ports = %d, %d; want 587 then 465", firstPort, secondPort)
	}
	if mechanism := <-mechanisms; mechanism != "LOGIN" {
		t.Fatalf("TLS fallback authentication = %q, want LOGIN", mechanism)
	}
}

func TestVerifyCuiqiuSMTPTriesBothSecurePortsForRejectedCredentials(t *testing.T) {
	cuiqiuSMTPRouteCache.Clear()
	originalDial := dialCuiqiuSMTPConnection
	ports := make(chan int, 4)
	mechanisms := make(chan string, 4)
	dialCuiqiuSMTPConnection = func(config cuiqiuConfig) (*smtp.Client, error) {
		ports <- config.SMTPPort
		return newCuiqiuTestSMTPClientAccepting(t, mechanisms, ""), nil
	}
	t.Cleanup(func() {
		dialCuiqiuSMTPConnection = originalDial
		cuiqiuSMTPRouteCache.Clear()
	})

	config := cuiqiuConfig{
		Mailbox: "support@fastmo.cn", SMTPPassword: "wrong-password",
		SMTPHost: "localhost", SMTPPort: 587, SMTPMode: "starttls",
	}
	if err := verifyCuiqiuSMTP(config); err == nil {
		t.Fatal("expected rejected credentials")
	}
	close(ports)
	var attemptedPorts []int
	for port := range ports {
		attemptedPorts = append(attemptedPorts, port)
	}
	if len(attemptedPorts) != 4 || attemptedPorts[0] != 587 || attemptedPorts[1] != 587 || attemptedPorts[2] != 465 || attemptedPorts[3] != 465 {
		t.Fatalf("rejected credentials attempted ports %#v, want both authentication methods on 587 then 465", attemptedPorts)
	}
}

func TestVerifyCuiqiuSMTPFallsBackToTLSAfterSTARTTLSAuthRejection(t *testing.T) {
	cuiqiuSMTPRouteCache.Clear()
	originalDial := dialCuiqiuSMTPConnection
	ports := make(chan int, 4)
	mechanisms := make(chan string, 4)
	dialCuiqiuSMTPConnection = func(config cuiqiuConfig) (*smtp.Client, error) {
		ports <- config.SMTPPort
		acceptedMechanism := ""
		if config.SMTPPort == 465 {
			acceptedMechanism = "LOGIN"
		}
		return newCuiqiuTestSMTPClientAccepting(t, mechanisms, acceptedMechanism), nil
	}
	t.Cleanup(func() {
		dialCuiqiuSMTPConnection = originalDial
		cuiqiuSMTPRouteCache.Clear()
	})

	config := cuiqiuConfig{
		Mailbox: "support@fastmo.cn", SMTPPassword: "mailbox-password",
		SMTPHost: "localhost", SMTPPort: 587, SMTPMode: "starttls",
	}
	if err := verifyCuiqiuSMTP(config); err != nil {
		t.Fatal(err)
	}
	if got := []int{<-ports, <-ports, <-ports}; got[0] != 587 || got[1] != 587 || got[2] != 465 {
		t.Fatalf("SMTP ports = %#v, want 587, 587, 465", got)
	}
	if got := []string{<-mechanisms, <-mechanisms, <-mechanisms}; got[0] != "PLAIN" || got[1] != "LOGIN" || got[2] != "LOGIN" {
		t.Fatalf("SMTP authentication methods = %#v, want PLAIN, LOGIN, LOGIN", got)
	}
}

func TestSendCuiqiuSMTPReplyUsesAuthenticationFallback(t *testing.T) {
	cuiqiuSMTPRouteCache.Clear()
	originalDial := dialCuiqiuSMTPConnection
	mechanisms := make(chan string, 4)
	dialCuiqiuSMTPConnection = func(cuiqiuConfig) (*smtp.Client, error) {
		return newCuiqiuTestSMTPClient(t, mechanisms), nil
	}
	t.Cleanup(func() {
		dialCuiqiuSMTPConnection = originalDial
		cuiqiuSMTPRouteCache.Clear()
	})

	config := cuiqiuConfig{
		Mailbox: "support@fastmo.cn", SMTPPassword: "mailbox-password",
		SMTPHost: "localhost", SMTPPort: 587, SMTPMode: "starttls",
	}
	if _, err := sendCuiqiuSMTPReply(config, Conversation{Subject: "Order help"}, emailReplyTarget{CustomerEmail: "buyer@example.com"}, "Hello", nil); err != nil {
		t.Fatal(err)
	}
	if first, second := <-mechanisms, <-mechanisms; first != "PLAIN" || second != "LOGIN" {
		t.Fatalf("send authentication mechanisms = %q, %q; want PLAIN then LOGIN", first, second)
	}
}

func newCuiqiuTestSMTPClient(t *testing.T, mechanisms chan<- string) *smtp.Client {
	return newCuiqiuTestSMTPClientAccepting(t, mechanisms, "LOGIN")
}

func newCuiqiuTestSMTPClientAccepting(t *testing.T, mechanisms chan<- string, acceptedMechanism string) *smtp.Client {
	t.Helper()
	clientConnection, serverConnection := net.Pipe()
	serverErrors := make(chan error, 1)
	go func() {
		defer serverConnection.Close()
		reader := bufio.NewReader(serverConnection)
		writer := bufio.NewWriter(serverConnection)
		writeLine := func(line string) error {
			if _, err := fmt.Fprintf(writer, "%s\r\n", line); err != nil {
				return err
			}
			return writer.Flush()
		}
		if err := writeLine("220 localhost ESMTP"); err != nil {
			serverErrors <- err
			return
		}
		loginStep := 0
		dataMode := false
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimSpace(line)
			if dataMode {
				if line == "." {
					dataMode = false
					err = writeLine("250 2.0.0 queued")
				}
				if err != nil {
					serverErrors <- err
					return
				}
				continue
			}
			switch {
			case strings.HasPrefix(line, "EHLO "):
				if _, err = fmt.Fprint(writer, "250-localhost\r\n250-AUTH LOGIN PLAIN\r\n250 OK\r\n"); err == nil {
					err = writer.Flush()
				}
			case strings.HasPrefix(line, "AUTH PLAIN"):
				mechanisms <- "PLAIN"
				if acceptedMechanism == "PLAIN" {
					err = writeLine("235 2.7.0 authenticated")
				} else {
					err = writeLine("535 5.7.8 authentication failed")
				}
			case line == "AUTH LOGIN":
				mechanisms <- "LOGIN"
				loginStep = 1
				err = writeLine("334 " + base64.StdEncoding.EncodeToString([]byte("Username:")))
			case loginStep == 1:
				decoded, decodeErr := base64.StdEncoding.DecodeString(line)
				if decodeErr != nil || string(decoded) != "support@fastmo.cn" {
					err = fmt.Errorf("unexpected SMTP username response %q", line)
					break
				}
				loginStep = 2
				err = writeLine("334 " + base64.StdEncoding.EncodeToString([]byte("Password:")))
			case loginStep == 2:
				decoded, decodeErr := base64.StdEncoding.DecodeString(line)
				if decodeErr != nil || string(decoded) != "mailbox-password" {
					err = fmt.Errorf("unexpected SMTP password response")
					break
				}
				loginStep = 0
				if acceptedMechanism == "LOGIN" {
					err = writeLine("235 2.7.0 authenticated")
				} else {
					err = writeLine("535 5.7.8 authentication failed")
				}
			case strings.HasPrefix(line, "MAIL FROM:"):
				err = writeLine("250 2.1.0 sender accepted")
			case strings.HasPrefix(line, "RCPT TO:"):
				err = writeLine("250 2.1.5 recipient accepted")
			case line == "DATA":
				dataMode = true
				err = writeLine("354 End data with <CR><LF>.<CR><LF>")
			case line == "RSET":
				err = writeLine("250 2.0.0 reset")
			case line == "QUIT":
				_ = writeLine("221 2.0.0 bye")
				return
			default:
				err = writeLine("500 5.5.2 unsupported command")
			}
			if err != nil {
				serverErrors <- err
				return
			}
		}
	}()
	client, err := smtp.NewClient(clientConnection, "localhost")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-serverErrors:
		t.Fatal(err)
	default:
	}
	return client
}

func TestCuiqiuWebhookKeyChangesWithToken(t *testing.T) {
	source := ShopSource{ID: "source-1"}
	first := cuiqiuWebhookKey(source, EmailInstallation{AccessToken: "one"})
	second := cuiqiuWebhookKey(source, EmailInstallation{AccessToken: "two"})
	if first == second || len(first) != 32 || len(second) != 32 {
		t.Fatalf("unexpected webhook keys: %q %q", first, second)
	}
}

func TestCuiqiuDomainWebhookKeyChangesWithToken(t *testing.T) {
	first := cuiqiuWebhookKeyForDomain("fastmo.cn", "one")
	second := cuiqiuWebhookKeyForDomain("fastmo.cn", "two")
	if first == second || len(first) != 32 || len(second) != 32 {
		t.Fatalf("unexpected domain webhook keys: %q %q", first, second)
	}
}

func TestCuiqiuWebhookParsesOfficialRecipientArray(t *testing.T) {
	var payload cuiqiuWebhookPayload
	if err := json.Unmarshal([]byte(`{
		"version":"1.0.0",
		"msg_to":[{"name":"Support","address":"support@fastmo.cn"}],
		"smtp_to":"alias@fastmo.cn"
	}`), &payload); err != nil {
		t.Fatal(err)
	}
	recipients := cuiqiuWebhookRecipientSet(payload)
	if !recipients["support@fastmo.cn"] || !recipients["alias@fastmo.cn"] || len(recipients) != 2 {
		t.Fatalf("unexpected webhook recipients: %#v", recipients)
	}
}

func TestCuiqiuWebhookMarksOnlyActuallyObservedNotificationHealthy(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "webhook-test-encryption-key")
	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "Webhook Shop"})
	source, _ := store.CreateShopSource(context.Background(), ShopSource{
		ShopID: shop.ID, Type: SourceTypeEmail, Provider: cuiqiuProvider, Address: "support@fastmo.cn", Status: SourceStatusActive,
		Metadata: map[string]string{emailNotificationStatusKey: "pending"},
	})
	encryptedToken, err := encryptAIKey("domain-token")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveCuiqiuDomainSettings(context.Background(), CuiqiuDomainSettings{
		Domain: "fastmo.cn", APIBase: "https://domain-open-api.cuiqiu.com", EncryptedToken: encryptedToken,
		SMTPHost: "domain-smtp.cuiqiu.com", SMTPPort: 465, SMTPMode: "tls",
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	payload := `{"msg_to":[{"address":"support@fastmo.cn"}],"smtp_to":"support@fastmo.cn"}`
	request := httptest.NewRequest(http.MethodPost, "/webhooks/email/cuiqiu?domain=fastmo.cn&key="+cuiqiuWebhookKeyForDomain("fastmo.cn", "domain-token"), strings.NewReader(payload))
	response := httptest.NewRecorder()
	server.handleCuiqiuWebhook(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("webhook response = %d, body=%s", response.Code, response.Body.String())
	}
	updated, err := store.GetShopSource(context.Background(), shop.ID, source.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Metadata[emailNotificationStatusKey] != "ok" || updated.Metadata["cuiqiu_webhook_received_at"] == "" {
		t.Fatalf("webhook observation was not recorded: %#v", updated.Metadata)
	}
	domainSettings, err := store.GetCuiqiuDomainSettings(context.Background(), "fastmo.cn")
	if err != nil || domainSettings.WebhookVerifiedAt.IsZero() {
		t.Fatalf("domain webhook verification was not recorded: %#v err=%v", domainSettings, err)
	}
}

func TestCuiqiuWebhookTestVerifiesDomainWithoutMatchingMailbox(t *testing.T) {
	t.Setenv("AI_SETTINGS_ENCRYPTION_KEY", "webhook-domain-test-encryption-key")
	store := NewMemoryStore()
	encryptedToken, err := encryptAIKey("domain-token")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveCuiqiuDomainSettings(context.Background(), CuiqiuDomainSettings{
		Domain: "fastmo.cn", APIBase: "https://domain-open-api.cuiqiu.com", EncryptedToken: encryptedToken,
		SMTPHost: "domain-smtp.cuiqiu.com", SMTPPort: 465, SMTPMode: "tls",
	}); err != nil {
		t.Fatal(err)
	}
	server := NewServer(store)
	payload := `{"subject":"Cuiqiu webhook test","msg_to":[{"address":"test@example.com"}]}`
	request := httptest.NewRequest(http.MethodPost, "/webhooks/email/cuiqiu?domain=fastmo.cn&key="+cuiqiuWebhookKeyForDomain("fastmo.cn", "domain-token"), strings.NewReader(payload))
	response := httptest.NewRecorder()
	server.handleCuiqiuWebhook(response, request)
	if response.Code != http.StatusAccepted {
		t.Fatalf("webhook response = %d, body=%s", response.Code, response.Body.String())
	}
	settings, err := store.GetCuiqiuDomainSettings(context.Background(), "fastmo.cn")
	if err != nil || settings.WebhookVerifiedAt.IsZero() {
		t.Fatalf("domain webhook verification was not recorded: %#v err=%v", settings, err)
	}
}

func TestNormalizeCuiqiuConnectRequestRejectsNonEmailMailbox(t *testing.T) {
	_, err := normalizeCuiqiuConnectRequest(cuiqiuConnectRequest{
		Mailbox: "not-an-email", SMTPPassword: "password",
	})
	if err == nil {
		t.Fatal("expected invalid mailbox to be rejected")
	}
}

func TestCuiqiuHistoryCursorCompletesSinglePage(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseMultipartForm(1 << 20)
		w.Header().Set("Content-Type", "application/json")
		if r.URL.Path == "/v1/message/list" {
			if got := r.FormValue("limit"); got != "20" {
				t.Fatalf("history limit = %q, want official maximum 20", got)
			}
			_, _ = w.Write([]byte(`{"code":200,"data":{"list":[{"id":"history-1","from":"buyer@example.com","to":"support@fastmo.cn","subject":"History","timestamp":1700000000}],"total":1}}`))
			return
		}
		_, _ = w.Write([]byte(`{"code":200,"data":{"list":[{"id":"history-1","from":"buyer@example.com","to":"support@fastmo.cn","subject":"History","timestamp":1700000000,"plain_text":"Historical body"}]}}`))
	}))
	defer api.Close()
	source := ShopSource{Address: "support@fastmo.cn", Provider: cuiqiuProvider, Metadata: map[string]string{cuiqiuAPIBaseKey: api.URL, cuiqiuMailIDKey: "mail-1"}}
	job := EmailHistoryImportJob{Provider: cuiqiuProvider, Mailbox: source.Address}
	page, err := fetchCuiqiuHistoryPage(context.Background(), job, source, EmailInstallation{AccessToken: "token"})
	if err != nil {
		t.Fatal(err)
	}
	if !page.Done || len(page.Messages) != 1 || !page.Messages[0].ReceivedAt.Equal(time.Unix(1700000000, 0).UTC()) {
		t.Fatalf("unexpected history page: %#v", page)
	}
}

func TestCuiqiuIncomingMetadataSurvivesMessageNormalization(t *testing.T) {
	incoming := cuiqiuDetailToIncoming("support@fastmo.cn", cuiqiuMessageDetail{
		ID: "message-1", From: "Buyer <buyer@example.com>", To: "support@fastmo.cn",
		Subject: "Order help", Time: "2026-08-13T10:00:00+08:00", Timestamp: 1786586400,
		PlainText: "Where is my order?", Attachments: `[{"name":"photo.jpg"}]`,
	})
	normalized, err := normalizeMessageContent(Message{Type: MessageTypeText, Metadata: incoming.Metadata})
	if err != nil {
		t.Fatal(err)
	}
	if normalized.Metadata["cuiqiu_message_id"] != "message-1" ||
		normalized.Metadata["mail_api_provider"] != cuiqiuProvider ||
		normalized.Metadata["mail_reply_to_email"] != "buyer@example.com" ||
		normalized.Metadata["email_has_attachments"] != "true" ||
		normalized.Metadata["email_received_at_original"] != "2026-08-13T10:00:00+08:00" {
		t.Fatalf("normalized metadata lost Cuiqiu fields: %#v", normalized.Metadata)
	}
}
