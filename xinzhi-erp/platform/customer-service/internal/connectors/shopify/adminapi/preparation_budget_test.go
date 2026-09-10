package adminapi

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
)

type preparationBudgetAuthorityFunc func(context.Context, int) error

func (f preparationBudgetAuthorityFunc) Reserve(ctx context.Context, cost int) error {
	return f(ctx, cost)
}

type preparationBudgetTransportFunc func(*http.Request) (*http.Response, error)

func (f preparationBudgetTransportFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestPreparationBudgetPrecedesEveryTransportAndNeverRetriesOrLeaksFailure(t *testing.T) {
	calls, reservations := 0, 0
	denied := false
	base := preparationBudgetTransportFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		return &http.Response{StatusCode: 302, Header: http.Header{"Location": []string{"https://other.invalid"}}, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	authority := preparationBudgetAuthorityFunc(func(_ context.Context, cost int) error {
		reservations++
		if cost != 1000 {
			t.Fatal("unreviewed cost estimate")
		}
		if denied {
			return errors.New("synthetic-private-authority-value")
		}
		return nil
	})
	client, err := NewPreparationBudgetedHTTPClient(base, authority)
	if err != nil {
		t.Fatal(err)
	}
	r, _ := http.NewRequest("POST", "https://owned.invalid/graphql.json", strings.NewReader("synthetic"))
	response, err := client.Do(r)
	if err != nil || response.StatusCode != 302 || calls != 1 || reservations != 1 {
		t.Fatal("redirect followed or budget skipped")
	}
	response.Body.Close()
	denied = true
	_, err = client.Do(r)
	if err == nil || strings.Contains(err.Error(), "private-authority") || calls != 1 || reservations != 2 {
		t.Fatal("denied budget reached upstream or leaked details")
	}
	if _, err = NewPreparationBudgetedHTTPClient(base, nil); err == nil {
		t.Fatal("nil authority accepted")
	}
	if _, err = NewPreparationBudgetedHTTPClient(nil, authority); err == nil {
		t.Fatal("implicit transport accepted")
	}
}
