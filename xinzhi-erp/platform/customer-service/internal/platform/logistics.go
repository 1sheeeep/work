package platform

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type LogisticsTracker interface {
	Provider() string
	Track(context.Context, LogisticsTrackingRequest) (LogisticsTrackingResult, error)
}

type LogisticsTrackingStatus struct {
	Configured bool   `json:"configured"`
	Provider   string `json:"provider,omitempty"`
	Message    string `json:"message,omitempty"`
}

type LogisticsTrackingRequest struct {
	ShopID         string `json:"shopId"`
	Carrier        string `json:"carrier,omitempty"`
	TrackingNumber string `json:"trackingNumber"`
}

type LogisticsTrackingEvent struct {
	Time        string `json:"time,omitempty"`
	Status      string `json:"status,omitempty"`
	Description string `json:"description,omitempty"`
	Location    string `json:"location,omitempty"`
}

type LogisticsTrackingResult struct {
	Configured     bool                     `json:"configured"`
	Provider       string                   `json:"provider,omitempty"`
	Carrier        string                   `json:"carrier,omitempty"`
	TrackingNumber string                   `json:"trackingNumber"`
	Status         string                   `json:"status,omitempty"`
	Message        string                   `json:"message,omitempty"`
	UpdatedAt      string                   `json:"updatedAt,omitempty"`
	Events         []LogisticsTrackingEvent `json:"events"`
}

func (s *Server) handleLogisticsStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if _, _, ok := s.requireAuth(w, r); !ok {
		return
	}
	config, err := s.resolveLogisticsConfig(r.Context())
	if err != nil || !config.Enabled || config.APIKey == "" {
		writeJSONResponse(w, http.StatusOK, LogisticsTrackingStatus{
			Configured: false,
			Message:    "物流查询服务尚未配置",
		})
		return
	}
	writeJSONResponse(w, http.StatusOK, LogisticsTrackingStatus{
		Configured: true,
		Provider:   strings.TrimSpace(s.logisticsTracker.Provider()),
	})
}

func (s *Server) handleLogisticsTrack(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	var input LogisticsTrackingRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.Carrier = strings.TrimSpace(input.Carrier)
	input.TrackingNumber = strings.TrimSpace(input.TrackingNumber)
	if input.ShopID == "" || input.TrackingNumber == "" {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "shopId and trackingNumber are required"})
		return
	}
	if !s.requireWorkbenchOrModuleShopAccess(w, r, user, DataScopeOrders, input.ShopID) {
		return
	}
	if s.logisticsTracker == nil {
		writeJSONResponse(w, http.StatusOK, LogisticsTrackingResult{
			Configured:     false,
			Carrier:        input.Carrier,
			TrackingNumber: input.TrackingNumber,
			Message:        "物流查询服务尚未配置",
			Events:         []LogisticsTrackingEvent{},
		})
		return
	}
	result, err := s.logisticsTracker.Track(r.Context(), input)
	if err != nil {
		writeError(w, err)
		return
	}
	if result.Configured {
		result.Provider = strings.TrimSpace(s.logisticsTracker.Provider())
	} else if result.Message == "" {
		result.Message = "物流查询服务尚未配置"
	}
	result.Carrier = firstNonEmpty(result.Carrier, input.Carrier)
	result.TrackingNumber = firstNonEmpty(result.TrackingNumber, input.TrackingNumber)
	if result.UpdatedAt == "" {
		result.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if result.Events == nil {
		result.Events = []LogisticsTrackingEvent{}
	}
	writeJSONResponse(w, http.StatusOK, result)
}
