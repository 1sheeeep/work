package shopify

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const InstallationContractVersion = "shopify.connector.installation.v1"

var exactShopifyHostnamePattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$`)

type InstallationState string

const (
	InstallationStateNotConfigured InstallationState = "NOT_CONFIGURED"
	InstallationStateInstalled     InstallationState = "INSTALLED"
	InstallationStateRevoked       InstallationState = "REVOKED"
)

// CompleteOAuthRequest is created inside the connector runtime after the
// provider callback and its signed state have been verified. AuthorizationCode
// deliberately has no JSON representation so it cannot cross a business API
// boundary or be copied into structured request logs.
type CompleteOAuthRequest struct {
	Identity          CanonicalShopIdentity `json:"identity"`
	Context           RequestContext        `json:"context"`
	LegacyShopID      string                `json:"legacyShopId"`
	ShopDomain        string                `json:"shopDomain"`
	AuthorizationCode string                `json:"-"`
}

func (r CompleteOAuthRequest) String() string {
	return fmt.Sprintf("completeOAuth{tenant=%s shop=%s legacy=%s domain=%s code=[REDACTED]}",
		r.Identity.TenantID, r.Identity.ShopID, r.LegacyShopID, r.ShopDomain)
}

func (r CompleteOAuthRequest) GoString() string { return r.String() }

type InstallationProbeRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
}

type InstallationRevokeRequest struct {
	Identity CanonicalShopIdentity `json:"identity"`
	Context  RequestContext        `json:"context"`
}

type InstallationSummary struct {
	ContractVersion string            `json:"contractVersion"`
	TenantID        string            `json:"tenantId"`
	ShopID          string            `json:"shopId"`
	ShopDomain      string            `json:"shopDomain,omitempty"`
	ShopName        string            `json:"shopName,omitempty"`
	State           InstallationState `json:"state"`
	GrantedScopes   []string          `json:"grantedScopes,omitempty"`
	InstalledAt     time.Time         `json:"installedAt,omitempty"`
	UpdatedAt       time.Time         `json:"updatedAt"`
}

type ShopIdentity struct {
	Name            string `json:"name"`
	MyshopifyDomain string `json:"myshopifyDomain"`
}

func ValidateShopIdentity(identity ShopIdentity) error {
	name := strings.TrimSpace(identity.Name)
	domain, ok := NormalizeShopDomain(identity.MyshopifyDomain)
	if name == "" || len(name) > 160 || !ok {
		return errors.New("Shopify shop identity is invalid")
	}
	for _, character := range name {
		if character < ' ' || character == 0x7f {
			return errors.New("Shopify shop identity is invalid")
		}
	}
	if domain != strings.TrimSpace(strings.ToLower(identity.MyshopifyDomain)) {
		return errors.New("Shopify shop identity is invalid")
	}
	return nil
}

func (s InstallationSummary) String() string {
	return fmt.Sprintf("installation{tenant=%s shop=%s domain=%s state=%s}",
		s.TenantID, s.ShopID, s.ShopDomain, s.State)
}

type InstallationRevokeResult struct {
	ContractVersion     string    `json:"contractVersion"`
	TenantID            string    `json:"tenantId"`
	ShopID              string    `json:"shopId"`
	ShopDomain          string    `json:"shopDomain,omitempty"`
	InstallationRevoked bool      `json:"installationRevoked"`
	SourceDisabled      bool      `json:"sourceDisabled"`
	CachesInvalidated   bool      `json:"cachesInvalidated"`
	AlreadyRevoked      bool      `json:"alreadyRevoked"`
	RevokedAt           time.Time `json:"revokedAt"`
}

type InstallationLifecycle interface {
	CompleteOAuth(context.Context, CompleteOAuthRequest) (InstallationSummary, error)
	Probe(context.Context, InstallationProbeRequest) (InstallationSummary, error)
	Revoke(context.Context, InstallationRevokeRequest) (InstallationRevokeResult, error)
}

// InstallationUninstaller is deliberately separate from Revoke. Uninstall is
// an ERP-requested provider operation; Revoke is also used to consume an
// app/uninstalled webhook after Shopify has already removed the app.
type InstallationUninstaller interface {
	Uninstall(context.Context, InstallationRevokeRequest) (InstallationRevokeResult, error)
}

type LegacyShopBindingResolver interface {
	ResolveCanonicalIdentity(context.Context, string) (CanonicalShopIdentity, error)
}

func ValidateCompleteOAuthRequest(request CompleteOAuthRequest) error {
	if err := ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context}); err != nil {
		return err
	}
	if !validInstallationIdentifier(request.LegacyShopID, 128) {
		return errors.New("legacyShopId must be a bounded printable identifier")
	}
	if !validShopifyDomain(request.ShopDomain) {
		return errors.New("shopDomain must be a myshopify.com domain")
	}
	if strings.TrimSpace(request.AuthorizationCode) == "" || len(request.AuthorizationCode) > 4096 {
		return errors.New("authorizationCode is invalid")
	}
	return nil
}

func ValidateInstallationProbeRequest(request InstallationProbeRequest) error {
	return ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func ValidateInstallationRevokeRequest(request InstallationRevokeRequest) error {
	return ValidateRequest(ConnectionProbeRequest{Identity: request.Identity, Context: request.Context})
}

func InvalidInstallationRequestError(identity CanonicalShopIdentity, requestContext RequestContext) *ConnectionProbeError {
	return InvalidRequestError(ConnectionProbeRequest{Identity: identity, Context: requestContext})
}

func ForbiddenInstallationError(requestContext RequestContext) *ConnectionProbeError {
	return &ConnectionProbeError{
		Code: ErrorCodeForbidden, Message: "Shopify installation operation is forbidden",
		Retryable: false, CorrelationID: safeCorrelationID(requestContext.CorrelationID),
	}
}

func SafeInstallationErrorFor(requestContext RequestContext, cause error) *ConnectionProbeError {
	return SafeErrorFor(ConnectionProbeRequest{Context: requestContext}, cause)
}

func validInstallationIdentifier(value string, limit int) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > limit {
		return false
	}
	for _, r := range value {
		if r < 0x21 || r > 0x7e {
			return false
		}
	}
	return true
}

func validShopifyDomain(value string) bool {
	_, ok := NormalizeShopDomain(value)
	return ok
}

func NormalizeShopDomain(value string) (string, bool) {
	if value == "" || value != strings.TrimSpace(value) {
		return "", false
	}
	normalized := strings.ToLower(value)
	if !exactShopifyHostnamePattern.MatchString(normalized) {
		return "", false
	}
	return normalized, true
}
