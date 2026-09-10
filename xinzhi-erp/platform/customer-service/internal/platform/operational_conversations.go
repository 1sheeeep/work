package platform

import "context"

// operationalConversationStore is implemented by stores that can exclude
// historical imports and non-customer notifications before loading rows.
// Keeping it optional preserves compatibility with focused test stores.
type operationalConversationStore interface {
	ListOperationalCustomerConversations(context.Context, ConversationFilter) ([]Conversation, error)
}

func (s *Server) listOperationalCustomerConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error) {
	if store, ok := s.store.(operationalConversationStore); ok {
		return store.ListOperationalCustomerConversations(ctx, filter)
	}
	filter.Kind = ConversationKindCustomer
	filter.ServiceLineOnly = true
	conversations, err := s.store.ListConversations(ctx, filter)
	if err != nil {
		return nil, err
	}
	return filterOperationalCustomerConversations(conversations), nil
}

func (s *MemoryStore) ListOperationalCustomerConversations(ctx context.Context, filter ConversationFilter) ([]Conversation, error) {
	filter.Kind = ConversationKindCustomer
	filter.ServiceLineOnly = true
	conversations, err := s.ListConversations(ctx, filter)
	if err != nil {
		return nil, err
	}
	return filterOperationalCustomerConversations(conversations), nil
}
