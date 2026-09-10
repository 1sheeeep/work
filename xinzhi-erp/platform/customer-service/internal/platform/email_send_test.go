package platform

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSendOutlookThreadReplyShowsProviderResponseWithoutInventedGuidance(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/me/messages/message-id/reply" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"code":"ErrorExceededMessageLimit","message":"account details","internal":"WASCL RefuseQuota"}}`))
	}))
	defer server.Close()
	t.Setenv("OUTLOOK_GRAPH_BASE_URL", server.URL)

	err := sendOutlookThreadReply(context.Background(), "access-token", "message-id", "reply")
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("sendOutlookThreadReply() error = %v; want ErrRateLimited", err)
	}
	message := err.Error()
	for _, returned := range []string{"HTTP 429 Too Many Requests", "ErrorExceededMessageLimit", "account details", "WASCL RefuseQuota"} {
		if !strings.Contains(message, returned) {
			t.Fatalf("sendOutlookThreadReply() error = %q; missing returned value %q", message, returned)
		}
	}
	for _, invented := range []string{"收件箱", "验证提示", "稍后重试", "本次邮件未发送"} {
		if strings.Contains(message, invented) {
			t.Fatalf("sendOutlookThreadReply() error = %q; contains invented guidance %q", message, invented)
		}
	}
}

func TestEmailSendProviderErrorPreservesAllFieldsAndRedactsSecrets(t *testing.T) {
	err := newEmailSendProviderError(
		"Gmail",
		"回复邮件",
		http.StatusBadRequest,
		"400 Bad Request",
		[]byte(`{"error":{"code":400,"message":"actual provider message","status":"INVALID_ARGUMENT","details":[{"reason":"mailRejected","access_token":"do-not-show"}]},"requestId":"request-1"}`),
	)
	message := err.Error()
	for _, returned := range []string{"400 Bad Request", `"code":400`, "actual provider message", "INVALID_ARGUMENT", "mailRejected", "request-1", `"access_token":"[已隐藏]"`} {
		if !strings.Contains(message, returned) {
			t.Fatalf("newEmailSendProviderError() = %q; missing %q", message, returned)
		}
	}
	if strings.Contains(message, "do-not-show") {
		t.Fatalf("newEmailSendProviderError() = %q; leaked token", message)
	}
}

func TestEmailSendProviderErrorReportsEmptyResponseBodyFactually(t *testing.T) {
	err := newEmailSendProviderError("Outlook", "回复邮件", http.StatusBadGateway, "502 Bad Gateway", nil)
	if got := err.Error(); got != "Outlook 回复邮件失败：HTTP 502 Bad Gateway；服务返回的响应体为空" {
		t.Fatalf("newEmailSendProviderError() = %q", got)
	}
}

func TestWriteErrorMapsRateLimitToHTTP429(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeError(recorder, errors.Join(ErrRateLimited, errors.New("provider quota")))
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("writeError() status = %d; want %d", recorder.Code, http.StatusTooManyRequests)
	}
}
