package installations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	shopifyconnector "shopify-support-platform/internal/connectors/shopify"
)

type HTTPRevocationEffects struct {
	endpoint string
	token    string
	client   *http.Client
}

func NewHTTPRevocationEffects(baseURL string, serviceToken string, client *http.Client) (*HTTPRevocationEffects, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	serviceToken = strings.TrimSpace(serviceToken)
	parsed, err := url.Parse(baseURL)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || serviceToken == "" {
		return nil, errors.New("customer-service revocation endpoint configuration is invalid")
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &HTTPRevocationEffects{
		endpoint: baseURL + RevocationEffectsPath, token: serviceToken, client: client,
	}, nil
}

func (e *HTTPRevocationEffects) ApplyRevocation(ctx context.Context, record RevocationRecord) error {
	if e == nil || e.client == nil {
		return errors.New("customer-service revocation effects are unavailable")
	}
	body, err := json.Marshal(record)
	if err != nil {
		return errors.New("customer-service revocation effects are unavailable")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return errors.New("customer-service revocation effects are unavailable")
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(ServiceTokenHeader, e.token)
	response, err := e.client.Do(request)
	if err != nil {
		return errors.New("customer-service revocation effects are unavailable")
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, installationRequestLimit+1))
	if err != nil || len(raw) > installationRequestLimit || response.StatusCode != http.StatusOK {
		return errors.New("customer-service revocation effects are unavailable")
	}
	var result RevocationEffectsResult
	if json.Unmarshal(raw, &result) != nil ||
		result.ContractVersion != shopifyconnector.InstallationContractVersion ||
		result.TenantID != record.Identity.TenantID || result.ShopID != record.Identity.ShopID ||
		!result.SourceDisabled || !result.CachesInvalidated {
		return errors.New("customer-service revocation effects returned an invalid result")
	}
	return nil
}

var _ RevocationEffects = (*HTTPRevocationEffects)(nil)
