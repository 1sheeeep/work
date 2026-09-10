package installations

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const EmbeddedChatSetupPath = "/shopify/session/chat-setup"
const chatSetupContractVersion = "shopify.connector.chat_setup.v1"

type installationChatSetupReader interface {
	ReadInstallationChatSetup(context.Context, string, string, shopifyconnector.CanonicalShopIdentity) (string, bool, error)
}

type embeddedChatSetup struct {
	ContractVersion string     `json:"contractVersion"`
	ShopDomain      string     `json:"shopDomain"`
	State           string     `json:"state"`
	ServiceOrigin   string     `json:"serviceOrigin,omitempty"`
	CheckedAt       *time.Time `json:"checkedAt,omitempty"`
}

func (s *Service) ReadEmbeddedChatSetup(ctx context.Context, domain string) embeddedChatSetup {
	result := embeddedChatSetup{ContractVersion: chatSetupContractVersion, ShopDomain: domain, State: "UNAVAILABLE"}
	domain, valid := shopifyconnector.NormalizeShopDomain(domain)
	if s == nil || s.repository == nil || !valid || ctx.Err() != nil {
		return result
	}
	reader, ok := s.appDataConfigurer.(installationChatSetupReader)
	if !ok {
		return result
	}
	identity, err := s.repository.ResolveIdentityByDomain(ctx, domain)
	if err != nil {
		return result
	}
	unlock := s.lockIdentity(identity)
	defer unlock()
	binding, record, missing, _, err := s.installedReadRecord(ctx, identity)
	if err != nil || missing || binding.ShopDomain != domain {
		return result
	}
	// Use the normal expiring-credential refresh path, but never exchange an
	// installation token, claim a shop, or rewrite app data from this check.
	origin, matches, err := reader.ReadInstallationChatSetup(ctx, domain, record.AccessToken, identity)
	if err != nil || ctx.Err() != nil {
		return result
	}
	current, err := s.repository.GetInstallation(ctx, identity)
	if err != nil || current.Binding != record.Binding || current.State != shopifyconnector.InstallationStateInstalled ||
		current.NativeLinkPending || current.AccessToken != record.AccessToken || !current.UpdatedAt.Equal(record.UpdatedAt) {
		return result
	}
	checkedAt := s.now().UTC()
	result.CheckedAt = &checkedAt
	result.State = "MISMATCH"
	if !matches {
		return result
	}
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" || parsed.ForceQuery {
		return embeddedChatSetup{ContractVersion: chatSetupContractVersion, ShopDomain: domain, State: "UNAVAILABLE"}
	}
	result.State, result.ServiceOrigin = "CONFIGURED", origin
	return result
}

func (h *Handler) handleEmbeddedChatSetup(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := h.authenticateEmbeddedRequest(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1))
	_ = r.Body.Close()
	if r.URL.RawQuery != "" || err != nil || len(body) != 0 {
		writeEmbeddedError(w, http.StatusBadRequest, "INVALID_CHAT_SETUP_REQUEST", "Invalid chat setup request.", false)
		return
	}
	result := embeddedChatSetup{ContractVersion: chatSetupContractVersion, ShopDomain: claims.ShopDomain(), State: "UNAVAILABLE"}
	if reader, ok := h.lifecycle.(interface {
		ReadEmbeddedChatSetup(context.Context, string) embeddedChatSetup
	}); ok {
		ctx, cancel := context.WithTimeout(r.Context(), 8*time.Second)
		defer cancel()
		result = reader.ReadEmbeddedChatSetup(ctx, claims.ShopDomain())
	}
	writeRuntimeJSON(w, http.StatusOK, result)
}
