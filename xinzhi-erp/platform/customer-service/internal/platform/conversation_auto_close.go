package platform

import (
	"context"
	"errors"
	"log"
	"strings"
	"time"
)

const (
	customerReplyTimeout   = 5 * time.Minute
	conversationCloseSweep = time.Minute
)

func (s *Server) StartConversationAutoClose(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(conversationCloseSweep)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runConversationAutoClose(ctx, time.Now().UTC())
			}
		}
	}()
}

func (s *Server) runConversationAutoClose(ctx context.Context, now time.Time) {
	closed, err := s.store.CloseInactiveCustomerConversations(ctx, now.Add(-customerReplyTimeout))
	if err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			log.Printf("conversation auto-close: customer conversation sweep failed: %v", err)
		}
		return
	}
	agents := make(map[string]struct{}, len(closed))
	for _, conversation := range closed {
		s.broadcastConversationEvent(conversation, Event{
			Type:      "conversation.updated",
			ShopID:    conversation.ShopID,
			EntityID:  conversation.ID,
			Payload:   conversation,
			CreatedAt: now,
		})
		if agentID := strings.TrimSpace(conversation.AssignedAgentID); agentID != "" {
			agents[agentID] = struct{}{}
		}
	}
	for agentID := range agents {
		s.fillAgentCapacityAsync(agentID)
	}
}
