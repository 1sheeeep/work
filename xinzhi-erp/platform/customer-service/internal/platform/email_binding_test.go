package platform

import (
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteEmailMailboxBindingConflictNamesAccountAndOffersSafeActions(t *testing.T) {
	request := httptest.NewRequest("GET", "https://kf.xzkj.ai/outlook/callback", nil)
	response := httptest.NewRecorder()
	conflict := &emailMailboxBindingConflict{
		Mailbox:       "support@example.com",
		BoundShopID:   "shop-existing",
		BoundShopName: "floravyne",
	}

	writeEmailMailboxBindingConflict(response, request, conflict.Mailbox, conflict, "https://login.example.com/select-account")

	if response.Code != 409 {
		t.Fatalf("status = %d, want 409", response.Code)
	}
	body := response.Body.String()
	for _, expected := range []string{
		"该邮箱已绑定",
		"support@example.com",
		"floravyne",
		"原有连接未受影响",
		`href="https://kf.xzkj.ai/"`,
		"返回 Xzdesk",
		`href="https://login.example.com/select-account"`,
		"使用其他邮箱",
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("response body missing %q: %s", expected, body)
		}
	}
	if !errors.Is(conflict, ErrConflict) {
		t.Fatal("binding conflict must unwrap to ErrConflict")
	}
}
