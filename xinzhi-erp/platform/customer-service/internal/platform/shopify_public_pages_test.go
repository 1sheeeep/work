package platform

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestXZERPPublicPagesRequireReviewReadyConfiguration(t *testing.T) {
	t.Setenv("XZ_ERP_LEGAL_NAME", "")
	t.Setenv("XZ_ERP_SUPPORT_EMAIL", "")
	t.Setenv("XZ_ERP_PRIVACY_EFFECTIVE_DATE", "")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/shopify/xz-erp/privacy", nil)
	NewServer(NewMemoryStore()).handleXZERPPublicPage(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected missing public page configuration status 503, got %d body=%s", recorder.Code, recorder.Body.String())
	}
	if strings.Contains(recorder.Body.String(), "XZ_ERP_SUPPORT_EMAIL") {
		t.Fatalf("configuration details leaked to public response: %s", recorder.Body.String())
	}
}

func TestXZERPPublicPagesRenderAccessibleReviewContent(t *testing.T) {
	t.Setenv("XZ_ERP_LEGAL_NAME", "XZ Technology Ltd.")
	t.Setenv("XZ_ERP_SUPPORT_EMAIL", "support@example.test")
	t.Setenv("XZ_ERP_PRIVACY_EFFECTIVE_DATE", "2026-07-31")
	server := NewServer(NewMemoryStore())
	tests := []struct {
		path string
		want string
	}{
		{path: "/shopify/xz-erp", want: "Xinzhi Chat"},
		{path: "/shopify/xz-erp/privacy", want: "客户数据访问、客户删除和店铺删除"},
		{path: "/shopify/xz-erp/support", want: "support@example.test"},
		{path: "/shopify/xz-erp/guide", want: "当前版本只同步拒付元数据"},
		{path: "/shopify/xz-erp/data-deletion", want: "customers/data_request"},
	}
	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, test.path, nil)
			server.handleXZERPPublicPage(recorder, request)
			if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), test.want) {
				t.Fatalf("unexpected public page status=%d body=%s", recorder.Code, recorder.Body.String())
			}
			body := recorder.Body.String()
			if !strings.Contains(body, "Xinzhi ERP") || strings.Contains(body, "XZ ERP") {
				t.Fatalf("public page product name is inconsistent: %s", body)
			}
			if !strings.Contains(body, `href="#main"`) ||
				!strings.Contains(body, `aria-label="主要导航"`) ||
				!strings.Contains(body, `name="viewport"`) ||
				strings.Contains(body, "#ZgotmplZ") {
				t.Fatalf("public page accessibility structure is incomplete: %s", body)
			}
			if recorder.Header().Get("Content-Security-Policy") == "" ||
				recorder.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("public page security headers are incomplete: %#v", recorder.Header())
			}
		})
	}
}

func TestXZERPPublicPageRejectsInvalidSupportEmail(t *testing.T) {
	t.Setenv("XZ_ERP_LEGAL_NAME", "XZ Technology Ltd.")
	t.Setenv("XZ_ERP_SUPPORT_EMAIL", "not-an-email")
	t.Setenv("XZ_ERP_PRIVACY_EFFECTIVE_DATE", "2026-07-31")
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/shopify/xz-erp/support", nil)
	NewServer(NewMemoryStore()).handleXZERPPublicPage(recorder, request)
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected invalid support email status 503, got %d body=%s", recorder.Code, recorder.Body.String())
	}
}
