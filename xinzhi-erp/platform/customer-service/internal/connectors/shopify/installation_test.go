package shopify

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestInstallationLifecycleDTOsNeverSerializeOAuthCodeOrAccessToken(t *testing.T) {
	request := CompleteOAuthRequest{
		Identity:          CanonicalShopIdentity{TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ShopID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
		Context:           RequestContext{CorrelationID: "corr-install", RequestID: "request-install"},
		LegacyShopID:      "legacy-shop",
		ShopDomain:        "demo.myshopify.com",
		AuthorizationCode: "oauth-code-secret",
	}
	payload, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	serialized := string(payload)
	for _, secret := range []string{"oauth-code-secret", "accessToken", "access_token"} {
		if strings.Contains(serialized, secret) {
			t.Fatalf("installation DTO leaked secret marker %q: %s", secret, serialized)
		}
	}
	if formatted := fmt.Sprintf("%#v", request); strings.Contains(formatted, "oauth-code-secret") {
		t.Fatalf("installation request diagnostic leaked OAuth code: %s", formatted)
	}
}

func TestValidateInstallationRequestsRequiresCanonicalIdentityAndRequestContext(t *testing.T) {
	valid := InstallationProbeRequest{
		Identity: CanonicalShopIdentity{TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ShopID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
		Context:  RequestContext{CorrelationID: "corr-probe", RequestID: "request-probe"},
	}
	if err := ValidateInstallationProbeRequest(valid); err != nil {
		t.Fatalf("valid probe rejected: %v", err)
	}
	for _, request := range []InstallationProbeRequest{
		{},
		{Identity: valid.Identity},
		{Identity: valid.Identity, Context: RequestContext{CorrelationID: "bad space", RequestID: "request-probe"}},
	} {
		if err := ValidateInstallationProbeRequest(request); err == nil {
			t.Fatalf("invalid probe accepted: %#v", request)
		}
	}
}

func TestValidateCompleteOAuthRequiresExactSingleLabelShopifyHostname(t *testing.T) {
	valid := CompleteOAuthRequest{
		Identity:     CanonicalShopIdentity{TenantID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ShopID: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
		Context:      RequestContext{CorrelationID: "corr-domain", RequestID: "request-domain"},
		LegacyShopID: "legacy-shop", ShopDomain: "demo-shop.myshopify.com", AuthorizationCode: "oauth-code",
	}
	if err := ValidateCompleteOAuthRequest(valid); err != nil {
		t.Fatalf("valid Shopify hostname rejected: %v", err)
	}
	invalid := []string{
		"https://demo.myshopify.com/", " demo.myshopify.com", "demo.myshopify.com ",
		"evil.demo.myshopify.com", "demo.myshopify.com\\evil", "demo.myshopify.com/evil",
		"démø.myshopify.com", "-demo.myshopify.com", "demo-.myshopify.com",
		"demo..myshopify.com", ".myshopify.com", "demo.myshopify.com.evil.example",
	}
	for _, domain := range invalid {
		request := valid
		request.ShopDomain = domain
		if err := ValidateCompleteOAuthRequest(request); err == nil {
			t.Fatalf("invalid Shopify hostname accepted: %q", domain)
		}
	}
}
