package platform

import (
	"context"
	"strings"
	"time"

	"shopify-support-platform/internal/records"
)

type conversationRecordOrderBackfillStore interface {
	BackfillConversationRecordLifecycle(context.Context, string, string, string) error
}

type recordOrderBackfillResult struct {
	Candidates int
	Updated    int
	Failed     int
}

func (s *Server) backfillConversationRecordOrders(ctx context.Context, interval time.Duration) recordOrderBackfillResult {
	backfillStore, ok := s.store.(conversationRecordOrderBackfillStore)
	if !ok {
		return recordOrderBackfillResult{}
	}
	conversations, err := s.store.ListConversations(ctx, ConversationFilter{})
	if err != nil {
		return recordOrderBackfillResult{Failed: 1}
	}
	result := recordOrderBackfillResult{}
	for _, conversation := range conversations {
		if ctx.Err() != nil {
			break
		}
		if !conversation.RecordClassified || !conversation.RecordAutoFilled || normalizeConversationKind(conversation.Kind) != ConversationKindCustomer || conversation.RecordPrimary == records.PrimaryNotOrdered || strings.TrimSpace(conversation.RecordOrderNumber) != "" || normalizeEmail(conversation.CustomerEmail) == "" {
			continue
		}
		result.Candidates++
		messages, messagesErr := s.store.ListMessages(ctx, conversation.ID)
		if messagesErr != nil {
			result.Failed++
		} else {
			order, state := s.lookupConversationRecordOrder(ctx, conversation, messages)
			primary := ""
			orderNumber := ""
			switch state {
			case conversationRecordOrderVerified:
				orderNumber = strings.TrimSpace(order.Name)
				if verifiedPrimary, ok := s.verifiedRecordPrimary(ctx, conversation, order, true); ok {
					primary = verifiedPrimary
				}
			case conversationRecordOrderNotOrdered:
				primary = records.PrimaryNotOrdered
			}
			if primary == "" || (primary == conversation.RecordPrimary && orderNumber == "") {
				// Ambiguous or unavailable Shopify data must not rewrite history.
			} else if updateErr := backfillStore.BackfillConversationRecordLifecycle(ctx, conversation.ID, primary, orderNumber); updateErr != nil {
				result.Failed++
			} else {
				result.Updated++
			}
		}
		if interval > 0 && !waitForRecordOrderBackfill(ctx, interval) {
			break
		}
	}
	return result
}

func waitForRecordOrderBackfill(ctx context.Context, interval time.Duration) bool {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
