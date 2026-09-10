package installations

import (
	"context"
	"errors"
	"io"
	"net/http"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

const (
	NativeLinkGrantPath   = "/shopify/session/link-grant"
	NativeLinkPreviewPath = "/api/v1/shopify-connector/installations/native-link/preview"
	NativeLinkConfirmPath = "/api/v1/shopify-connector/installations/native-link/confirm"
)

type nativeLinkService interface {
	IssueNativeLink(context.Context, string) (NativeLinkGrant, error)
	ConfirmNativeLink(context.Context, NativeLinkRequest) (shopifyconnector.InstallationSummary, error)
}

type nativeLinkPreviewRequest struct {
	Proof string `json:"proof"`
}

func (r nativeLinkPreviewRequest) String() string   { return "nativeLinkPreview{proof=[REDACTED]}" }
func (r nativeLinkPreviewRequest) GoString() string { return r.String() }

func (h *Handler) handleNativeLinkGrant(w http.ResponseWriter, r *http.Request) {
	claims, _, ok := h.authenticateEmbeddedRequest(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1))
	_ = r.Body.Close()
	if r.URL.RawQuery != "" || err != nil || len(body) != 0 {
		writeNativeLinkError(w, ErrInvalidBinding)
		return
	}
	service, ok := h.lifecycle.(nativeLinkService)
	if !ok {
		writeNativeLinkError(w, errors.New("unavailable"))
		return
	}
	grant, err := service.IssueNativeLink(r.Context(), claims.ShopDomain())
	if err != nil {
		writeNativeLinkError(w, err)
		return
	}
	// App Home builds a fixed, fragment-only native ERP confirmation link.
	// No caller redirect, ERP identity or Shopify credential is returned.
	writeRuntimeJSON(w, http.StatusOK, grant)
}

func (h *Handler) handleNativeLinkPreview(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		writeNativeLinkError(w, ErrInvalidBinding)
		return
	}
	var request nativeLinkPreviewRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	pending, err := h.repository.InspectNativeLink(r.Context(), request.Proof, h.now().UTC())
	if err != nil {
		writeNativeLinkError(w, err)
		return
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{"contractVersion": NativeLinkContractVersion, "pending": pending})
}

func (h *Handler) handleNativeLinkConfirm(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !h.requireServiceToken(w, r) {
		return
	}
	if r.URL.RawQuery != "" {
		writeNativeLinkError(w, ErrInvalidBinding)
		return
	}
	var request NativeLinkRequest
	if !decodeRuntimeJSON(w, r, &request) {
		return
	}
	service, ok := h.lifecycle.(nativeLinkService)
	if !ok {
		writeNativeLinkError(w, errors.New("unavailable"))
		return
	}
	result, err := service.ConfirmNativeLink(r.Context(), request)
	if err != nil {
		writeNativeLinkError(w, err)
		return
	}
	writeRuntimeJSON(w, http.StatusOK, map[string]any{"contractVersion": NativeLinkContractVersion, "installation": result})
}

func writeNativeLinkError(w http.ResponseWriter, err error) {
	status, code, retryable := http.StatusServiceUnavailable, "NATIVE_LINK_RETRY_REQUIRED", true
	if errors.Is(err, ErrInvalidBinding) {
		status, code, retryable = http.StatusBadRequest, "INVALID_NATIVE_LINK_REQUEST", false
	}
	if errors.Is(err, ErrNativeLinkUnavailable) || errors.Is(err, ErrBindingConflict) {
		status, code, retryable = http.StatusConflict, "NATIVE_LINK_UNAVAILABLE", false
	}
	writeRuntimeJSON(w, status, map[string]any{"code": code, "error": "Shopify linking could not be confirmed. Retry the same confirmation or return to Shopify Admin for a new link.", "retryable": retryable})
}
