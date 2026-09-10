package platform

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"
)

const (
	defaultAgentCapacity = 50
	minAgentCapacity     = 1
	maxAgentCapacity     = 50

	RoutingReasonNotRoutable        = "not_routable"
	RoutingReasonNoAssignedAgents   = "no_assigned_agents"
	RoutingReasonNoEligibleAgents   = "no_eligible_agents"
	RoutingReasonAgentsDisconnected = "agents_disconnected"
	RoutingReasonAgentsAtCapacity   = "agents_at_capacity"
	RoutingReasonAwaitingAssignment = "awaiting_assignment"
)

func normalizeReceptionLimit(value int) int {
	if value == 0 {
		return defaultAgentCapacity
	}
	return value
}

func validateReceptionLimit(value int) error {
	if value < minAgentCapacity || value > maxAgentCapacity {
		return fmt.Errorf("%w: receptionLimit must be between %d and %d", ErrInvalid, minAgentCapacity, maxAgentCapacity)
	}
	return nil
}

func isCustomerConversation(conversation Conversation) bool {
	return normalizeConversationKind(conversation.Kind) == ConversationKindCustomer
}

func routingMessageTime(conversation Conversation) time.Time {
	if !conversation.CustomerLastMessageAt.IsZero() {
		return conversation.CustomerLastMessageAt
	}
	if !conversation.LastMessageAt.IsZero() {
		return conversation.LastMessageAt
	}
	return conversation.CreatedAt
}

func (s *Server) customerConversationLoads(ctx context.Context) (map[string]int, error) {
	if store, ok := s.store.(interface {
		CustomerConversationLoads(context.Context) (map[string]int, error)
	}); ok {
		return store.CustomerConversationLoads(ctx)
	}
	conversations, err := s.store.ListConversations(ctx, ConversationFilter{})
	if err != nil {
		return nil, err
	}
	shops, err := s.store.ListShops(ctx)
	if err != nil {
		return nil, err
	}
	activeShops := map[string]bool{}
	for _, shop := range shops {
		activeShops[shop.ID] = shop.Status == ShopStatusActive
	}
	loads := map[string]int{}
	assignedShopsByUser := map[string]map[string]bool{}
	for _, conversation := range conversations {
		if conversation.Status != ConversationStatusAssigned || conversation.AssignedAgentID == "" || !isEffectiveRoutingConversation(conversation) || !activeShops[conversation.ShopID] {
			continue
		}
		assignedShops, loaded := assignedShopsByUser[conversation.AssignedAgentID]
		if !loaded {
			shopIDs, listErr := s.store.ListUserShopIDs(ctx, conversation.AssignedAgentID)
			if listErr != nil {
				return nil, listErr
			}
			assignedShops = stringSet(shopIDs)
			assignedShopsByUser[conversation.AssignedAgentID] = assignedShops
		}
		if assignedShops[conversation.ShopID] {
			loads[conversation.AssignedAgentID]++
		}
	}
	return loads, nil
}

type routingCandidate struct {
	user User
	load int
}

func routingReasonForAgents(agents []User, loads map[string]int, online map[string]bool) string {
	if len(agents) == 0 {
		return RoutingReasonNoAssignedAgents
	}
	hasEligible := false
	hasDisconnectedCapacity := false
	for _, agent := range agents {
		if !userIsCustomerServiceAgent(agent) || agent.Status != UserStatusActive || !agent.ReceptionOnline || !userHasPermission(agent, PermissionWorkbenchAccess) || !userHasPermission(agent, PermissionAutoReception) {
			continue
		}
		hasEligible = true
		underCapacity := loads[agent.ID] < normalizeReceptionLimit(agent.ReceptionLimit)
		if !online[agent.ID] {
			hasDisconnectedCapacity = hasDisconnectedCapacity || underCapacity
			continue
		}
		if underCapacity {
			return RoutingReasonAwaitingAssignment
		}
	}
	if !hasEligible {
		return RoutingReasonNoEligibleAgents
	}
	if hasDisconnectedCapacity {
		return RoutingReasonAgentsDisconnected
	}
	return RoutingReasonAgentsAtCapacity
}

func (s *Server) annotateRoutingReasons(ctx context.Context, items []Conversation) error {
	needsRoutingReason := false
	for _, conversation := range items {
		if conversation.Status == ConversationStatusOpen && conversation.AssignedAgentID == "" {
			needsRoutingReason = true
			break
		}
	}
	if !needsRoutingReason {
		return nil
	}
	loads, err := s.customerConversationLoads(ctx)
	if err != nil {
		return err
	}
	online := s.connectedUserIDs()
	agentsByShop := map[string][]User{}
	loadedShops := map[string]bool{}
	for index := range items {
		conversation := &items[index]
		if conversation.Status != ConversationStatusOpen || conversation.AssignedAgentID != "" {
			continue
		}
		if !isEffectiveRoutingConversation(*conversation) {
			conversation.RoutingReason = RoutingReasonNotRoutable
			continue
		}
		agents := agentsByShop[conversation.ShopID]
		if !loadedShops[conversation.ShopID] {
			agents, err = s.store.ListShopUsers(ctx, conversation.ShopID)
			if err != nil {
				return err
			}
			agentsByShop[conversation.ShopID] = agents
			loadedShops[conversation.ShopID] = true
		}
		conversation.RoutingReason = routingReasonForAgents(agents, loads, online)
	}
	return nil
}

func (s *Server) selectAutoAssignmentAgent(ctx context.Context, conversation Conversation) (User, bool, error) {
	agents, err := s.store.ListShopUsers(ctx, conversation.ShopID)
	if err != nil {
		return User{}, false, err
	}
	loads, err := s.customerConversationLoads(ctx)
	if err != nil {
		return User{}, false, err
	}
	online := s.connectedUserIDs()
	candidates := make([]routingCandidate, 0, len(agents))
	for _, agent := range agents {
		limit := normalizeReceptionLimit(agent.ReceptionLimit)
		if !userIsCustomerServiceAgent(agent) || agent.Status != UserStatusActive || !agent.ReceptionOnline || !userHasPermission(agent, PermissionWorkbenchAccess) || !userHasPermission(agent, PermissionAutoReception) || !online[agent.ID] || loads[agent.ID] >= limit {
			continue
		}
		candidates = append(candidates, routingCandidate{user: agent, load: loads[agent.ID]})
	}
	if len(candidates) == 0 {
		return User{}, false, nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		leftLimit := normalizeReceptionLimit(candidates[i].user.ReceptionLimit)
		rightLimit := normalizeReceptionLimit(candidates[j].user.ReceptionLimit)
		leftRatio := candidates[i].load * rightLimit
		rightRatio := candidates[j].load * leftLimit
		if leftRatio != rightRatio {
			return leftRatio < rightRatio
		}
		if candidates[i].load != candidates[j].load {
			return candidates[i].load < candidates[j].load
		}
		return candidates[i].user.ID < candidates[j].user.ID
	})

	bestRatioLoad := candidates[0].load
	bestRatioLimit := normalizeReceptionLimit(candidates[0].user.ReceptionLimit)
	tied := candidates[:0]
	for _, candidate := range candidates {
		limit := normalizeReceptionLimit(candidate.user.ReceptionLimit)
		if candidate.load*bestRatioLimit != bestRatioLoad*limit {
			break
		}
		tied = append(tied, candidate)
	}
	lastID := s.routingLastAgent[conversation.ShopID]
	selected := tied[0].user
	for index, candidate := range tied {
		if candidate.user.ID == lastID {
			selected = tied[(index+1)%len(tied)].user
			break
		}
	}
	s.routingLastAgent[conversation.ShopID] = selected.ID
	return selected, true, nil
}

func (s *Server) tryAutoAssignConversation(ctx context.Context, conversationID string) (Conversation, bool, error) {
	s.routingMu.Lock()
	defer s.routingMu.Unlock()

	conversation, err := s.store.GetConversation(ctx, strings.TrimSpace(conversationID))
	if err != nil {
		return Conversation{}, false, err
	}
	if conversation.Status != ConversationStatusOpen || conversation.AssignedAgentID != "" || !isEffectiveRoutingConversation(conversation) {
		return conversation, false, nil
	}
	agent, ok, err := s.selectAutoAssignmentAgent(ctx, conversation)
	if err != nil || !ok {
		return conversation, false, err
	}
	updated, err := s.store.ClaimConversation(ctx, conversation.ID, agent.ID)
	if errors.Is(err, ErrConflict) {
		current, getErr := s.store.GetConversation(ctx, conversation.ID)
		return current, false, getErr
	}
	if err != nil {
		return Conversation{}, false, err
	}
	s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	s.enqueueConversationReplyDraft(updated)
	return updated, true, nil
}

func (s *Server) fillAgentCapacity(ctx context.Context, userID string) (int, error) {
	s.routingMu.Lock()
	defer s.routingMu.Unlock()

	user, err := s.store.GetUser(ctx, strings.TrimSpace(userID))
	if err != nil {
		return 0, err
	}
	if !userIsCustomerServiceAgent(user) || user.Status != UserStatusActive || !user.ReceptionOnline || !userHasPermission(user, PermissionWorkbenchAccess) || !userHasPermission(user, PermissionAutoReception) || !s.connectedUserIDs()[user.ID] {
		return 0, nil
	}
	shopIDs, err := s.store.ListUserShopIDs(ctx, user.ID)
	if err != nil {
		return 0, err
	}
	allowedShops := stringSet(shopIDs)
	loads, err := s.customerConversationLoads(ctx)
	if err != nil {
		return 0, err
	}
	remaining := normalizeReceptionLimit(user.ReceptionLimit) - loads[user.ID]
	if remaining <= 0 {
		return 0, nil
	}
	conversations, err := s.store.ListConversations(ctx, ConversationFilter{Status: ConversationStatusOpen, Kind: ConversationKindCustomer})
	if err != nil {
		return 0, err
	}
	queue := make([]Conversation, 0, len(conversations))
	for _, conversation := range conversations {
		if conversation.AssignedAgentID == "" && allowedShops[conversation.ShopID] && isEffectiveRoutingConversation(conversation) {
			queue = append(queue, conversation)
		}
	}
	sort.Slice(queue, func(i, j int) bool {
		left := routingMessageTime(queue[i])
		right := routingMessageTime(queue[j])
		if !left.Equal(right) {
			return left.Before(right)
		}
		return queue[i].ID < queue[j].ID
	})
	claimed := 0
	for _, queued := range queue {
		if claimed >= remaining {
			break
		}
		updated, err := s.store.ClaimConversation(ctx, queued.ID, user.ID)
		if errors.Is(err, ErrConflict) {
			continue
		}
		if err != nil {
			return claimed, err
		}
		claimed++
		s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
		s.enqueueConversationReplyDraft(updated)
	}
	return claimed, nil
}

func (s *Server) fillAgentCapacityAsync(userID string) {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return
	}
	s.routingJobsMu.Lock()
	if _, running := s.routingJobs[userID]; running {
		s.routingJobs[userID] = true
		s.routingJobsMu.Unlock()
		return
	}
	s.routingJobs[userID] = false
	s.routingJobsMu.Unlock()
	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			claimed, err := s.fillAgentCapacity(ctx, userID)
			cancel()
			if err != nil {
				log.Printf("routing: fill agent capacity failed: user_id=%s claimed=%d error=%v", userID, claimed, err)
			} else if claimed > 0 {
				log.Printf("routing: filled agent capacity: user_id=%s claimed=%d", userID, claimed)
			}

			s.routingJobsMu.Lock()
			pending := s.routingJobs[userID]
			if pending {
				s.routingJobs[userID] = false
				s.routingJobsMu.Unlock()
				continue
			}
			delete(s.routingJobs, userID)
			s.routingJobsMu.Unlock()
			return
		}
	}()
}

func (s *Server) refillCapacityAfterConversationChange(before Conversation, after Conversation) {
	previousOwner := strings.TrimSpace(before.AssignedAgentID)
	if previousOwner == "" || before.Status != ConversationStatusAssigned || !isEffectiveRoutingConversation(before) {
		return
	}
	if after.Status != ConversationStatusAssigned || strings.TrimSpace(after.AssignedAgentID) != previousOwner || !isEffectiveRoutingConversation(after) {
		s.fillAgentCapacityAsync(previousOwner)
	}
}

func (s *Server) releaseUserShopConversations(ctx context.Context, userID string, shopID string) error {
	userID = strings.TrimSpace(userID)
	shopID = strings.TrimSpace(shopID)
	if userID == "" || shopID == "" {
		return nil
	}
	conversations, err := s.store.ListConversations(ctx, ConversationFilter{
		ShopID: shopID, Status: ConversationStatusAssigned, AssignedAgentID: userID,
	})
	if err != nil {
		return err
	}
	for _, conversation := range conversations {
		updated, updateErr := s.store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{
			Status: ConversationStatusOpen, AssignedAgentID: "", SetAssignedAgentID: true,
		})
		if updateErr != nil {
			return updateErr
		}
		s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
		if _, _, routeErr := s.tryAutoAssignConversation(ctx, updated.ID); routeErr != nil {
			return routeErr
		}
	}
	return nil
}

func (s *Server) releaseUserConversations(ctx context.Context, userID string) error {
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return nil
	}
	conversations, err := s.store.ListConversations(ctx, ConversationFilter{
		Status:          ConversationStatusAssigned,
		AssignedAgentID: userID,
	})
	if err != nil {
		return err
	}
	for _, conversation := range conversations {
		updated, err := s.store.UpdateConversation(ctx, conversation.ID, ConversationUpdate{
			Status:             ConversationStatusOpen,
			AssignedAgentID:    "",
			SetAssignedAgentID: true,
		})
		if err != nil {
			return err
		}
		s.broadcastConversationEvent(updated, Event{Type: "conversation.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
		if _, _, err := s.tryAutoAssignConversation(ctx, updated.ID); err != nil {
			return err
		}
	}
	return nil
}
