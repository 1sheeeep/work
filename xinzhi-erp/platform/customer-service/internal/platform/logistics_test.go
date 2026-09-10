package platform

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLogisticsEndpointsReportUnconfiguredService(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Tracking Shop"}, http.StatusCreated, &shop)

	var status LogisticsTrackingStatus
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/logistics/status", adminToken, nil, http.StatusOK, &status)
	if status.Configured || status.Message != "物流查询服务尚未配置" {
		t.Fatalf("unexpected logistics status: %#v", status)
	}

	var result LogisticsTrackingResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/logistics/track", adminToken, LogisticsTrackingRequest{
		ShopID:         shop.ID,
		Carrier:        "UPS",
		TrackingNumber: "1Z999",
	}, http.StatusOK, &result)
	if result.Configured || result.TrackingNumber != "1Z999" || result.Message != "物流查询服务尚未配置" || result.Events == nil {
		t.Fatalf("unexpected logistics tracking result: %#v", result)
	}
}

func TestLogisticsEndpointsRequireAuthentication(t *testing.T) {
	server := httptest.NewServer(NewServer(NewMemoryStore()).Routes())
	defer server.Close()

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/logistics/status", "", nil, http.StatusUnauthorized, nil)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/logistics/track", "", LogisticsTrackingRequest{
		ShopID:         "shop-1",
		TrackingNumber: "TRACK-1",
	}, http.StatusUnauthorized, nil)
}

func TestLogisticsTrackEndpointUsesSharedProviderSnapshot(t *testing.T) {
	platformServer := NewServer(NewMemoryStore())
	tracker := &fakeLogisticsTracker{result: LogisticsTrackingResult{
		Configured:     true,
		TrackingNumber: "LIVE-1",
		Events:         []LogisticsTrackingEvent{},
	}}
	platformServer.logisticsTracker = tracker
	server := httptest.NewServer(platformServer.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Latest Tracking Shop"}, http.StatusCreated, &shop)
	var result LogisticsTrackingResult
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/logistics/track", adminToken, LogisticsTrackingRequest{
		ShopID:         shop.ID,
		TrackingNumber: "LIVE-1",
	}, http.StatusOK, &result)
	if tracker.lastRequest.TrackingNumber != "LIVE-1" {
		t.Fatalf("unexpected logistics request: %#v", tracker.lastRequest)
	}
}
