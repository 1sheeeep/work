package platform

import (
	"context"
	"fmt"
	"strings"
)

const messageClientRequestIDKey = "client_request_id"

func messageClientRequestID(metadata map[string]string) (string, error) {
	requestID := strings.TrimSpace(metadata[messageClientRequestIDKey])
	if requestID == "" {
		return "", nil
	}
	if len(requestID) > 100 {
		return "", fmt.Errorf("%w: client request id is too long", ErrInvalid)
	}
	for _, value := range requestID {
		if (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
			(value >= '0' && value <= '9') || value == '-' || value == '_' {
			continue
		}
		return "", fmt.Errorf("%w: client request id is invalid", ErrInvalid)
	}
	return requestID, nil
}

func (s *Server) agentMessageByClientRequestID(ctx context.Context, conversationID string, requestID string) (Message, bool, error) {
	if requestID == "" {
		return Message{}, false, nil
	}
	messages, err := s.store.ListMessages(ctx, conversationID)
	if err != nil {
		return Message{}, false, err
	}
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if message.Direction == MessageDirectionAgent && message.Metadata[messageClientRequestIDKey] == requestID {
			return message, true, nil
		}
	}
	return Message{}, false, nil
}
