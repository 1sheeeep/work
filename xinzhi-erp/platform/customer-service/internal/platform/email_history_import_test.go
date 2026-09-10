package platform

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestEmailHistoryImportUsesOneLowPriorityWorker(t *testing.T) {
	server := NewServer(NewMemoryStore())
	if got := cap(server.emailHistoryLimit); got != 1 {
		t.Fatalf("history import concurrency = %d, want 1", got)
	}
	if emailHistoryPageDelay < 10*time.Second {
		t.Fatalf("history import page delay = %s, want at least 10s", emailHistoryPageDelay)
	}
}

func TestGmailHistoryImportIsReadOnlyAndDoesNotEnterLiveQueue(t *testing.T) {
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/users/me/messages":
			if r.URL.Query().Get("includeSpamTrash") != "true" || !strings.Contains(r.URL.Query().Get("q"), "-in:sent") {
				t.Fatalf("history query is incomplete: %s", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(`{"messages":[{"id":"archive-1","threadId":"thread-1"}]}`))
		case "/users/me/messages/archive-1":
			body := base64.RawURLEncoding.EncodeToString([]byte("Please help me check my order."))
			_, _ = fmt.Fprintf(w, `{"id":"archive-1","threadId":"thread-1","labelIds":["IMPORTANT"],"internalDate":"1786377600000","payload":{"mimeType":"text/plain","headers":[{"name":"From","value":"Buyer <buyer@example.com>"},{"name":"Subject","value":"Order help"},{"name":"Message-ID","value":"<archive-1@example.com>"}],"body":{"data":"%s"}}}`, body)
		default:
			t.Fatalf("historical Gmail read made a side-effect or unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer provider.Close()
	t.Setenv("GMAIL_API_BASE_URL", provider.URL)

	store := NewMemoryStore()
	shop, _ := store.CreateShop(context.Background(), Shop{DisplayName: "History Shop"})
	source, _ := store.CreateShopSource(context.Background(), ShopSource{ShopID: shop.ID, Type: SourceTypeEmail, Provider: "gmail", Address: "support@example.com", Status: SourceStatusActive})
	_, _ = store.SaveEmailInstallation(context.Background(), EmailInstallation{ShopID: shop.ID, Mailbox: source.Address, Provider: "gmail", AccessToken: "token", Scope: defaultGmailScopes, ExpiresAt: time.Now().Add(time.Hour)})
	_, _ = store.SaveEmailHistoryImportJob(context.Background(), EmailHistoryImportJob{ShopID: shop.ID, SourceID: source.ID, Provider: "gmail", Mailbox: source.Address, Status: emailHistoryQueued})

	server := NewServer(store)
	server.processEmailHistoryImportPage(context.Background(), source.ID)

	job, err := store.GetEmailHistoryImportJob(context.Background(), shop.ID, source.ID)
	if err != nil || job.Status != emailHistoryCompleted || job.MessagesScanned != 1 || job.MessagesImported != 1 {
		t.Fatalf("unexpected completed history job: %#v err=%v", job, err)
	}
	conversation, err := store.GetConversation(context.Background(), stableExternalConversationID(source.ID, "thread-1"))
	if err != nil || conversation.Status != ConversationStatusClosed || !isHistoricalEmailConversation(conversation) {
		t.Fatalf("historical conversation entered the live queue: %#v err=%v", conversation, err)
	}
	messages, err := store.ListMessages(context.Background(), conversation.ID)
	if err != nil || len(messages) != 1 || !isHistoricalEmailMessage(messages[0]) || messages[0].Metadata["email_folder_origin"] != "archive" {
		t.Fatalf("historical message metadata was not preserved: %#v err=%v", messages, err)
	}
	unread, err := store.ListUnreadConversationIDs(context.Background(), "admin")
	if err != nil || len(unread) != 0 {
		t.Fatalf("historical mail changed unread state: %#v err=%v", unread, err)
	}
}

func TestOutlookHistoryImportSkipsNonReceivedFoldersAndNeverMovesJunk(t *testing.T) {
	folderIDs := map[string]string{
		"inbox": "folder-inbox", "junkemail": "folder-junk", "archive": "folder-archive",
		"sentitems": "folder-sent", "drafts": "folder-drafts", "deleteditems": "folder-deleted", "outbox": "folder-outbox",
	}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasPrefix(r.URL.Path, "/me/mailFolders/") {
			name := strings.TrimPrefix(r.URL.Path, "/me/mailFolders/")
			_, _ = fmt.Fprintf(w, `{"id":%q}`, folderIDs[name])
			return
		}
		switch r.URL.Path {
		case "/me/messages":
			_, _ = fmt.Fprintf(w, `{"value":[{"id":"junk-1","conversationId":"thread-junk","subject":"Order question","receivedDateTime":"2026-08-01T01:00:00Z","parentFolderId":%q,"from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"bodyPreview":"Where is my order?"},{"id":"sent-1","conversationId":"thread-sent","subject":"Reply","receivedDateTime":"2026-08-01T02:00:00Z","parentFolderId":%q,"from":{"emailAddress":{"name":"Support","address":"support@example.com"}}}]}`, folderIDs["junkemail"], folderIDs["sentitems"])
		case "/me/messages/junk-1":
			_, _ = fmt.Fprintf(w, `{"id":"junk-1","conversationId":"thread-junk","subject":"Order question","receivedDateTime":"2026-08-01T01:00:00Z","parentFolderId":%q,"from":{"emailAddress":{"name":"Buyer","address":"buyer@example.com"}},"body":{"contentType":"text","content":"Where is my order?"}}`, folderIDs["junkemail"])
		default:
			t.Fatalf("historical Outlook read made a side-effect or unexpected request: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer provider.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", provider.URL)

	page, err := fetchOutlookHistoryPage(context.Background(), "token", "support@example.com", "")
	if err != nil {
		t.Fatal(err)
	}
	if page.Scanned != 2 || len(page.Messages) != 1 || page.Messages[0].SourceMessageID != "outlook:junk-1" || page.Messages[0].Metadata["email_folder_origin"] != "junk" {
		t.Fatalf("Outlook received-folder filtering failed: %#v", page)
	}
}
