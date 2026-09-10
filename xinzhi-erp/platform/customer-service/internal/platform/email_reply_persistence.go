package platform

import (
	"context"
	"strings"
)

func (s *Server) persistAgentEmailReply(ctx context.Context, conversation Conversation, input Message, userID string) (Message, Conversation, bool, error) {
	switch strings.ToLower(strings.TrimSpace(input.Metadata["mail_api_provider"])) {
	case "gmail":
		return s.persistGmailAgentReply(ctx, conversation, input, userID)
	case "outlook":
		return s.persistOutlookAgentReply(ctx, conversation, input, userID)
	default:
		message, updated, err := s.store.AddAgentMessage(ctx, input, userID)
		return message, updated, false, err
	}
}
