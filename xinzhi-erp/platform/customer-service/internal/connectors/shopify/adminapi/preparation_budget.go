package adminapi

import (
	"context"
	"errors"
	"net/http"
	"time"
)

// PreparationBudgetAuthority must authenticate the source, verify its live
// installation and ORIGINAL business actor, then reserve in the common durable
// app+shop budget. No request headers, body, token or URL are passed to it.
type PreparationBudgetAuthority interface {
	Reserve(context.Context, int) error
}

type preparationBudgetTransport struct {
	base      http.RoundTripper
	authority PreparationBudgetAuthority
}

// NewPreparationBudgetedHTTPClient is never called by a production entrypoint.
// The conservative ceiling is Shopify's single GraphQL query limit. A future
// lower cost plan requires a separately reviewed exact query/cost observation;
// this candidate does not guess costs or refund unknown/failed requests.
func NewPreparationBudgetedHTTPClient(base http.RoundTripper, authority PreparationBudgetAuthority) (*http.Client, error) {
	if base == nil || authority == nil {
		return nil, errors.New("preparation budget dependencies required")
	}
	return &http.Client{Timeout: 8 * time.Second, Transport: &preparationBudgetTransport{base, authority}, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}, nil
}

func (t *preparationBudgetTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r == nil || r.Context().Err() != nil {
		return nil, errors.New("preparation request unavailable")
	}
	if err := t.authority.Reserve(r.Context(), 1000); err != nil {
		return nil, errors.New("preparation shared budget unavailable")
	}
	return t.base.RoundTrip(r)
}
