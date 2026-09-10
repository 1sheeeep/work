package platform

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

const defaultSkillGroup = SkillGroupConsulting

type createTransferRequest struct {
	TargetAgentID    string `json:"targetAgentId"`
	TargetSkillGroup string `json:"targetSkillGroup"`
	Note             string `json:"note"`
}
type createTicketRequest struct {
	Type               string             `json:"type"`
	ParentTicketID     string             `json:"parentTicketId"`
	ConversationID     string             `json:"conversationId"`
	ShopID             string             `json:"shopId"`
	CustomerRef        string             `json:"customerRef"`
	CustomerName       string             `json:"customerName"`
	CustomerEmail      string             `json:"customerEmail"`
	OrderNumber        string             `json:"orderNumber"`
	Title              string             `json:"title"`
	Category           string             `json:"category"`
	Priority           string             `json:"priority"`
	Status             string             `json:"status"`
	AssignedGroup      string             `json:"assignedGroup"`
	AssignedAgentID    string             `json:"assignedAgentId"`
	CollaboratorIDs    []string           `json:"collaboratorIds"`
	Description        string             `json:"description"`
	Attachments        []TicketAttachment `json:"attachments"`
	DueAt              *time.Time         `json:"dueAt"`
	RequiresAcceptance bool               `json:"requiresAcceptance"`
}
type updateTicketRequest struct {
	Title              string    `json:"title"`
	Category           string    `json:"category"`
	Priority           string    `json:"priority"`
	Status             string    `json:"status"`
	AssignedGroup      string    `json:"assignedGroup"`
	AssignedAgentID    *string   `json:"assignedAgentId"`
	CollaboratorIDs    *[]string `json:"collaboratorIds"`
	Description        string    `json:"description"`
	DueAt              *string   `json:"dueAt"`
	RequiresAcceptance *bool     `json:"requiresAcceptance"`
	HandoverNote       string    `json:"handoverNote"`
}

type ticketActionRequest struct {
	Reason          string `json:"reason"`
	Note            string `json:"note"`
	Approved        *bool  `json:"approved"`
	AssignedAgentID string `json:"assignedAgentId"`
}

type acceptTicketResponse struct {
	Ticket       Ticket        `json:"ticket"`
	Conversation *Conversation `json:"conversation,omitempty"`
}

func (s *Server) transferCandidates(ctx context.Context, user User, conversation Conversation) ([]TransferCandidate, error) {
	allowed, err := s.userCanAccessWorkbenchShop(ctx, user, conversation.ShopID)
	if err != nil {
		return nil, err
	}
	if !allowed {
		return nil, ErrForbidden
	}
	agents, err := s.store.ListShopUsers(ctx, conversation.ShopID)
	if err != nil {
		return nil, err
	}
	conversations, err := s.store.ListConversations(ctx, ConversationFilter{ShopID: conversation.ShopID})
	if err != nil {
		return nil, err
	}
	active := s.connectedUserIDs()
	loads := map[string]int{}
	for _, item := range conversations {
		if item.Status == ConversationStatusAssigned && item.AssignedAgentID != "" && isCustomerConversation(item) {
			loads[item.AssignedAgentID]++
		}
	}
	out := []TransferCandidate{}
	for _, agent := range agents {
		if !userIsCustomerServiceAgent(agent) || !userHasPermission(agent, PermissionWorkbenchAccess) || agent.ID == conversation.AssignedAgentID {
			continue
		}
		presence := "offline"
		effectiveOnline := agent.Status == UserStatusActive && agent.ReceptionOnline && active[agent.ID]
		if effectiveOnline {
			presence = "available"
		}
		capacity := normalizeReceptionLimit(agent.ReceptionLimit)
		if effectiveOnline && loads[agent.ID] >= capacity {
			presence = "full"
		}
		skillGroup := ""
		if agent.Role == UserRoleAgent {
			skillGroup = agent.SkillGroup
			if skillGroup == "" {
				skillGroup = defaultSkillGroup
			}
		}
		out = append(out, TransferCandidate{Agent: agent, SkillGroup: skillGroup, ActiveConversations: loads[agent.ID], Capacity: capacity, Presence: presence, RequiresAcceptance: presence != "available"})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].RequiresAcceptance != out[j].RequiresAcceptance {
			return !out[i].RequiresAcceptance
		}
		if out[i].ActiveConversations != out[j].ActiveConversations {
			return out[i].ActiveConversations < out[j].ActiveConversations
		}
		return out[i].Agent.DisplayName < out[j].Agent.DisplayName
	})
	return out, nil
}

func (s *Server) handleTransferCandidates(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if !userHasPermission(user, PermissionConversationTransfer) {
		writeError(w, ErrForbidden)
		return
	}
	if r.Method != http.MethodGet {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	items, err := s.transferCandidates(r.Context(), user, conversation)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(items))
}

func (s *Server) handleConversationTransfers(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if !userHasPermission(user, PermissionConversationTransfer) {
		writeError(w, ErrForbidden)
		return
	}
	if !s.requireWorkbenchShopAccess(w, r, user, conversation.ShopID) {
		return
	}
	if r.Method == http.MethodGet {
		items, err := s.store.ListTransferRequests(r.Context(), "", conversation.ID, strings.TrimSpace(r.URL.Query().Get("status")))
		if err != nil {
			writeError(w, err)
			return
		}
		writeJSONResponse(w, http.StatusOK, nonNilSlice(items))
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if conversation.Status != ConversationStatusAssigned || conversation.AssignedAgentID != user.ID {
		writeError(w, fmt.Errorf("%w: only the assigned agent can transfer the conversation", ErrForbidden))
		return
	}
	var input createTransferRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	input.TargetAgentID = strings.TrimSpace(input.TargetAgentID)
	input.TargetSkillGroup = strings.TrimSpace(input.TargetSkillGroup)
	candidates, err := s.transferCandidates(r.Context(), user, conversation)
	if err != nil {
		writeError(w, err)
		return
	}
	var target *TransferCandidate
	if input.TargetAgentID != "" {
		for i := range candidates {
			if candidates[i].Agent.ID == input.TargetAgentID {
				target = &candidates[i]
				break
			}
		}
		if target == nil {
			writeError(w, fmt.Errorf("%w: target agent is unavailable for this shop", ErrInvalid))
			return
		}
	} else {
		if input.TargetSkillGroup == "" {
			input.TargetSkillGroup = defaultSkillGroup
		}
		for i := range candidates {
			if candidates[i].SkillGroup == input.TargetSkillGroup && !candidates[i].RequiresAcceptance {
				target = &candidates[i]
				break
			}
		}
		if target == nil && len(candidates) == 0 {
			writeError(w, fmt.Errorf("%w: no agent is assigned to this shop", ErrInvalid))
			return
		}
	}
	request := TransferRequest{ConversationID: conversation.ID, ShopID: conversation.ShopID, FromAgentID: user.ID, TargetSkillGroup: input.TargetSkillGroup, Note: strings.TrimSpace(input.Note)}
	if target != nil {
		request.TargetAgentID = target.Agent.ID
	}
	request, err = s.store.CreateTransferRequest(r.Context(), request)
	if err != nil {
		writeError(w, err)
		return
	}
	if target != nil && !target.RequiresAcceptance {
		updated, transferErr := s.store.TransferConversation(r.Context(), conversation.ID, user.ID, target.Agent.ID)
		if transferErr != nil {
			_, _ = s.store.ResolveTransferRequest(r.Context(), request.ID, TransferStatusCancelled, user.ID)
			writeError(w, transferErr)
			return
		}
		request, err = s.store.ResolveTransferRequest(r.Context(), request.ID, TransferStatusCompleted, target.Agent.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		s.addWorkflowSystemMessage(r.Context(), updated, fmt.Sprintf("会话已由 %s 转接给 %s", user.DisplayName, target.Agent.DisplayName))
		s.broadcastConversationEvent(updated, Event{Type: "conversation.transferred", ShopID: updated.ShopID, EntityID: updated.ID, Payload: request, CreatedAt: time.Now().UTC()})
		writeJSONResponse(w, http.StatusOK, request)
		return
	}
	s.broadcastConversationEvent(conversation, Event{Type: "transfer.requested", ShopID: conversation.ShopID, EntityID: request.ID, Payload: request, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusAccepted, request)
}

func (s *Server) handleTransfers(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	items, err := s.store.ListTransferRequests(r.Context(), user.ID, "", strings.TrimSpace(r.URL.Query().Get("status")))
	if err != nil {
		writeError(w, err)
		return
	}
	visible := make([]TransferRequest, 0, len(items))
	for _, item := range items {
		if !transferTargetsUser(item, user) {
			continue
		}
		allowed, accessErr := s.userCanAccessWorkbenchShop(r.Context(), user, item.ShopID)
		if accessErr != nil {
			writeError(w, accessErr)
			return
		}
		if allowed {
			visible = append(visible, item)
		}
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(visible))
}

func (s *Server) handleTransferSubroutes(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	parts := splitPath(r.URL.Path)
	if len(parts) != 5 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "transfers" || r.Method != http.MethodPost {
		http.NotFound(w, r)
		return
	}
	request, err := s.store.GetTransferRequest(r.Context(), parts[3])
	if err != nil {
		writeError(w, err)
		return
	}
	conversation, err := s.store.GetConversation(r.Context(), request.ConversationID)
	if err != nil {
		writeError(w, err)
		return
	}
	if !s.requireWorkbenchShopAccess(w, r, user, request.ShopID) {
		return
	}
	action := parts[4]
	switch action {
	case "accept":
		if !userHasPermission(user, PermissionWorkbenchAccess) || !userHasPermission(user, PermissionConversationTransfer) {
			writeError(w, fmt.Errorf("%w: workbench transfer permission is required", ErrForbidden))
			return
		}
		if request.TargetAgentID != "" && request.TargetAgentID != user.ID {
			writeError(w, fmt.Errorf("%w: transfer request belongs to another agent", ErrForbidden))
			return
		}
		if request.TargetAgentID == "" && !transferTargetsUser(request, user) {
			writeError(w, fmt.Errorf("%w: transfer request belongs to another skill group", ErrForbidden))
			return
		}
		if err := s.validateConversationAssignee(r.Context(), conversation.ShopID, user.ID); err != nil {
			writeError(w, err)
			return
		}
		updated, err := s.store.TransferConversation(r.Context(), conversation.ID, request.FromAgentID, user.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		request, err = s.store.ResolveTransferRequest(r.Context(), request.ID, TransferStatusAccepted, user.ID)
		if err != nil {
			writeError(w, err)
			return
		}
		s.addWorkflowSystemMessage(r.Context(), updated, fmt.Sprintf("转接请求已由 %s 接受", user.DisplayName))
		s.broadcastConversationEvent(updated, Event{Type: "conversation.transferred", ShopID: updated.ShopID, EntityID: updated.ID, Payload: request, CreatedAt: time.Now().UTC()})
	case "reject":
		if request.TargetAgentID != "" && request.TargetAgentID != user.ID {
			writeError(w, ErrForbidden)
			return
		}
		request, err = s.store.ResolveTransferRequest(r.Context(), request.ID, TransferStatusRejected, user.ID)
	case "cancel":
		if request.FromAgentID != user.ID && effectiveAccessScope(user.ConversationScope, user.Role) != AccessScopeAll {
			writeError(w, ErrForbidden)
			return
		}
		request, err = s.store.ResolveTransferRequest(r.Context(), request.ID, TransferStatusCancelled, user.ID)
	default:
		http.NotFound(w, r)
		return
	}
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, request)
}

func transferTargetsUser(request TransferRequest, user User) bool {
	if request.TargetAgentID != "" {
		return request.TargetAgentID == user.ID
	}
	return request.TargetSkillGroup != "" &&
		user.Role == UserRoleAgent &&
		user.SkillGroup == request.TargetSkillGroup
}

func (s *Server) handleTickets(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if r.Method == http.MethodGet {
		if !userHasPermission(user, PermissionTicketsView) {
			writeError(w, ErrForbidden)
			return
		}
		s.handleTicketList(w, r, user)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !userHasPermission(user, PermissionTicketsManage) {
		writeError(w, ErrForbidden)
		return
	}
	var input createTicketRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	ticket := Ticket{Type: input.Type, ParentTicketID: strings.TrimSpace(input.ParentTicketID), ConversationID: strings.TrimSpace(input.ConversationID), ShopID: strings.TrimSpace(input.ShopID), CustomerRef: input.CustomerRef, CustomerName: input.CustomerName, CustomerEmail: input.CustomerEmail, OrderNumber: input.OrderNumber, Title: input.Title, Category: input.Category, Priority: input.Priority, Status: input.Status, AssignedGroup: input.AssignedGroup, AssignedAgentID: input.AssignedAgentID, CollaboratorIDs: input.CollaboratorIDs, Description: input.Description, Attachments: input.Attachments, DueAt: input.DueAt, RequiresAcceptance: input.RequiresAcceptance, CreatedBy: user.ID}
	ticket.Type = defaultString(strings.TrimSpace(ticket.Type), TicketTypeCustomer)
	var conversation Conversation
	var err error
	if ticket.ParentTicketID != "" {
		parent, parentErr := s.store.GetTicket(r.Context(), ticket.ParentTicketID)
		if parentErr != nil {
			writeError(w, parentErr)
			return
		}
		if ticket.ConversationID == "" {
			ticket.ConversationID = parent.ConversationID
		} else if parent.ConversationID != "" && parent.ConversationID != ticket.ConversationID {
			writeError(w, fmt.Errorf("%w: parent ticket belongs to another conversation", ErrInvalid))
			return
		}
		if ticket.ShopID == "" {
			ticket.ShopID = parent.ShopID
		}
		if ticket.CustomerRef == "" {
			ticket.CustomerRef = parent.CustomerRef
		}
		if ticket.CustomerName == "" {
			ticket.CustomerName = parent.CustomerName
		}
		if ticket.CustomerEmail == "" {
			ticket.CustomerEmail = parent.CustomerEmail
		}
	}
	if ticket.ConversationID != "" {
		conversation, err = s.store.GetConversation(r.Context(), ticket.ConversationID)
		if err != nil {
			writeError(w, err)
			return
		}
		ticket.ShopID = conversation.ShopID
		if ticket.CustomerName == "" {
			ticket.CustomerName = conversation.CustomerName
		}
		if ticket.CustomerEmail == "" {
			ticket.CustomerEmail = conversation.CustomerEmail
		}
		ticket.CustomerRef, err = s.ticketCustomerReference(r.Context(), conversation)
		if err != nil {
			writeError(w, err)
			return
		}
		if ticket.Type == TicketTypeCustomer && ticket.AssignedAgentID == "" {
			ticket.AssignedAgentID = conversation.AssignedAgentID
		}
		if ticket.Type == TicketTypeCustomer {
			ticket.HandoffFromAgentID = conversation.AssignedAgentID
			ticket.Status = TicketStatusOpen
		}
	}
	if ticket.Type == TicketTypeInternal && strings.TrimSpace(ticket.AssignedAgentID) == "" {
		ticket.AssignedAgentID = user.ID
	}
	if ticket.Type == TicketTypeCustomer && ticket.AssignedGroup == "" {
		ticket.AssignedGroup = defaultSkillGroup
	}
	if ticket.ShopID != "" {
		if !s.requireModuleShopAccess(w, r, user, DataScopeTickets, ticket.ShopID) {
			return
		}
	}
	if err := s.validateTicketParticipants(r.Context(), ticket); err != nil {
		writeError(w, err)
		return
	}
	ticket, err = s.store.CreateTicket(r.Context(), ticket)
	if err != nil {
		writeError(w, err)
		return
	}
	if conversation.ID != "" {
		s.addWorkflowSystemMessage(r.Context(), conversation, "已创建工单 "+ticket.ID+"："+ticket.Title)
	}
	s.broadcast(Event{Type: "ticket.created", ShopID: ticket.ShopID, EntityID: ticket.ID, Payload: ticket, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusCreated, ticket)
}

func (s *Server) handleTicketCustomers(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasAnyPermission(user, PermissionTicketsView, PermissionTicketsManage) {
		writeError(w, ErrForbidden)
		return
	}
	shopID := strings.TrimSpace(r.URL.Query().Get("shopId"))
	if shopID == "" {
		writeError(w, fmt.Errorf("%w: shop is required", ErrInvalid))
		return
	}
	if !s.requireModuleShopAccess(w, r, user, DataScopeTickets, shopID) {
		return
	}
	conversations, err := s.store.ListConversations(r.Context(), ConversationFilter{
		ShopID:   shopID,
		Search:   strings.TrimSpace(r.URL.Query().Get("query")),
		Page:     1,
		PageSize: 100,
	})
	if err != nil {
		writeError(w, err)
		return
	}
	customers := make([]TicketCustomer, 0, 20)
	seen := map[string]bool{}
	for _, conversation := range conversations {
		if strings.TrimSpace(conversation.CustomerName) == "" && normalizeEmail(conversation.CustomerEmail) == "" {
			continue
		}
		customerRef, refErr := s.ticketCustomerReference(r.Context(), conversation)
		if refErr != nil {
			writeError(w, refErr)
			return
		}
		if seen[customerRef] {
			continue
		}
		seen[customerRef] = true
		customers = append(customers, TicketCustomer{
			CustomerRef:    customerRef,
			ShopID:         shopID,
			CustomerName:   strings.TrimSpace(conversation.CustomerName),
			CustomerEmail:  normalizeEmail(conversation.CustomerEmail),
			ConversationID: conversation.ID,
			LastMessageAt:  conversation.CustomerLastMessageAt,
		})
		if len(customers) == 20 {
			break
		}
	}
	writeJSONResponse(w, http.StatusOK, customers)
}

func (s *Server) ticketCustomerReference(ctx context.Context, conversation Conversation) (string, error) {
	if email := normalizeEmail(conversation.CustomerEmail); email != "" {
		return "email:" + email, nil
	}
	messages, err := s.store.ListMessages(ctx, conversation.ID)
	if err != nil {
		return "", err
	}
	if customerID := publicChatBoundCustomerID(messages); customerID != "" {
		return "shopify:" + customerID, nil
	}
	return "conversation:" + strings.TrimSpace(conversation.ID), nil
}

func (s *Server) handleTicketList(w http.ResponseWriter, r *http.Request, user User) {
	filter := TicketFilter{Type: strings.TrimSpace(r.URL.Query().Get("type")), ShopID: strings.TrimSpace(r.URL.Query().Get("shopId")), ConversationID: strings.TrimSpace(r.URL.Query().Get("conversationId")), AssignedAgentID: strings.TrimSpace(r.URL.Query().Get("assignedAgentId")), ParticipantID: strings.TrimSpace(r.URL.Query().Get("participantId")), Status: strings.TrimSpace(r.URL.Query().Get("status")), Priority: strings.TrimSpace(r.URL.Query().Get("priority")), Search: strings.TrimSpace(r.URL.Query().Get("search")), View: strings.TrimSpace(r.URL.Query().Get("view")), ViewerID: user.ID, Page: positiveQueryInt(r.URL.Query().Get("page"), 1), PageSize: positiveQueryInt(r.URL.Query().Get("pageSize"), 100)}
	if filter.PageSize > 200 {
		filter.PageSize = 200
	}
	items, err := s.store.ListTickets(r.Context(), filter)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, nonNilSlice(items))
}

func (s *Server) handleTicketSummary(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasPermission(user, PermissionTicketsView) {
		writeError(w, ErrForbidden)
		return
	}
	filter := TicketFilter{
		Type: strings.TrimSpace(r.URL.Query().Get("type")), ShopID: strings.TrimSpace(r.URL.Query().Get("shopId")),
		ConversationID: strings.TrimSpace(r.URL.Query().Get("conversationId")), AssignedAgentID: strings.TrimSpace(r.URL.Query().Get("assignedAgentId")),
		ParticipantID: strings.TrimSpace(r.URL.Query().Get("participantId")), Status: strings.TrimSpace(r.URL.Query().Get("status")),
		Priority: strings.TrimSpace(r.URL.Query().Get("priority")), Search: strings.TrimSpace(r.URL.Query().Get("search")),
		ViewerID: user.ID,
	}
	summary, err := s.store.GetTicketSummary(r.Context(), filter)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, summary)
}

func (s *Server) handleTicketAssignees(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasAnyPermission(user, PermissionTicketsView, PermissionTicketsManage) {
		writeError(w, ErrForbidden)
		return
	}
	users, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	out := []User{}
	for _, candidate := range users {
		if candidate.Status == UserStatusActive && userHasPermission(candidate, PermissionTicketsManage) {
			out = append(out, publicUser(candidate))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].DisplayName < out[j].DisplayName })
	writeJSONResponse(w, http.StatusOK, nonNilSlice(out))
}

func (s *Server) validateTicketParticipants(ctx context.Context, ticket Ticket) error {
	users, err := s.store.ListUsers(ctx)
	if err != nil {
		return err
	}
	byID := make(map[string]User, len(users))
	for _, user := range users {
		byID[user.ID] = user
	}
	validateParticipant := func(userID string) error {
		if strings.TrimSpace(userID) == "" {
			return nil
		}
		user, ok := byID[strings.TrimSpace(userID)]
		if !ok || user.Status != UserStatusActive || !userHasPermission(user, PermissionTicketsManage) {
			return fmt.Errorf("%w: ticket participant is unavailable", ErrInvalid)
		}
		return nil
	}
	if err := validateParticipant(ticket.AssignedAgentID); err != nil {
		return err
	}
	if ticket.Type == TicketTypeCustomer && ticket.AssignedAgentID != "" {
		if err := s.validateConversationAssignee(ctx, ticket.ShopID, ticket.AssignedAgentID); err != nil {
			return err
		}
	}
	for _, collaboratorID := range normalizeTicketCollaborators(ticket.AssignedAgentID, ticket.CollaboratorIDs) {
		if err := validateParticipant(collaboratorID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) handleTicketSubroutes(w http.ResponseWriter, r *http.Request) {
	_, user, ok := s.requireAuth(w, r)
	if !ok {
		return
	}
	if !userHasPermission(user, PermissionTicketsView) {
		writeError(w, ErrForbidden)
		return
	}
	parts := splitPath(r.URL.Path)
	if len(parts) < 4 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "tickets" {
		http.NotFound(w, r)
		return
	}
	ticket, err := s.store.GetTicket(r.Context(), parts[3])
	if err != nil {
		writeError(w, err)
		return
	}
	if len(parts) == 5 && parts[4] == "context" {
		if r.Method != http.MethodGet {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		s.handleTicketContext(w, r, user, ticket)
		return
	}
	if ticket.ShopID != "" {
		if !s.requireModuleShopAccess(w, r, user, DataScopeTickets, ticket.ShopID) {
			return
		}
	}
	if len(parts) == 5 && parts[4] == "accept" {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !userHasPermission(user, PermissionTicketsManage) {
			writeError(w, ErrForbidden)
			return
		}
		s.acceptTicket(w, r, user, ticket)
		return
	}
	if len(parts) == 5 && map[string]bool{"complete": true, "wait": true, "resume": true, "review": true, "cancel": true, "convert-to-customer": true}[parts[4]] {
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if !userHasPermission(user, PermissionTicketsManage) {
			writeError(w, ErrForbidden)
			return
		}
		s.handleTicketAction(w, r, user, ticket, parts[4])
		return
	}
	if len(parts) == 5 && parts[4] == "comments" {
		if r.Method == http.MethodGet {
			items, err := s.store.ListTicketComments(r.Context(), ticket.ID)
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusOK, nonNilSlice(items))
			return
		}
		if r.Method == http.MethodPost {
			if !userHasPermission(user, PermissionTicketsManage) {
				writeError(w, ErrForbidden)
				return
			}
			var input struct {
				Body string `json:"body"`
			}
			if !decodeJSON(w, r, &input) {
				return
			}
			item, err := s.store.AddTicketComment(r.Context(), TicketComment{TicketID: ticket.ID, AuthorID: user.ID, Body: input.Body})
			if err != nil {
				writeError(w, err)
				return
			}
			writeJSONResponse(w, http.StatusCreated, item)
			return
		}
	}
	if len(parts) != 4 {
		http.NotFound(w, r)
		return
	}
	if r.Method == http.MethodGet {
		writeJSONResponse(w, http.StatusOK, ticket)
		return
	}
	if r.Method != http.MethodPatch {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	if !userHasPermission(user, PermissionTicketsManage) {
		writeError(w, ErrForbidden)
		return
	}
	var input updateTicketRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	if strings.TrimSpace(input.Status) != "" {
		writeError(w, fmt.Errorf("%w: ticket status must be changed through a workflow action", ErrInvalid))
		return
	}
	isCreatorOrAdmin := ticket.CreatedBy == user.ID || user.SystemAdmin || user.Role == UserRoleAdmin
	if !isCreatorOrAdmin && ticket.AssignedAgentID != user.ID {
		writeError(w, ErrForbidden)
		return
	}
	update := TicketUpdate{Title: input.Title, Category: input.Category, Priority: input.Priority, AssignedGroup: input.AssignedGroup, Description: input.Description, RequiresAcceptance: input.RequiresAcceptance}
	if input.AssignedAgentID != nil {
		update.SetAssignedAgentID = true
		update.AssignedAgentID = strings.TrimSpace(*input.AssignedAgentID)
		if ticket.Type == TicketTypeCustomer && update.AssignedAgentID != ticket.AssignedAgentID {
			writeError(w, fmt.Errorf("%w: use a transfer or customer ticket to change the conversation owner", ErrInvalid))
			return
		}
		if update.AssignedAgentID != ticket.AssignedAgentID && !isCreatorOrAdmin {
			writeError(w, fmt.Errorf("%w: only the creator can reassign an internal task", ErrForbidden))
			return
		}
		if update.AssignedAgentID != ticket.AssignedAgentID && ticket.AssignedAgentID != "" && strings.TrimSpace(input.HandoverNote) == "" {
			writeError(w, fmt.Errorf("%w: handover note is required when changing the ticket owner", ErrInvalid))
			return
		}
		if ticket.Type == TicketTypeInternal && update.AssignedAgentID != ticket.AssignedAgentID && ticketStatusActive(ticket.Status) {
			update.Status = TicketStatusOpen
			update.SetAcceptedAt = true
		}
	}
	if input.CollaboratorIDs != nil {
		if !isCreatorOrAdmin {
			writeError(w, fmt.Errorf("%w: only the creator can change collaborators", ErrForbidden))
			return
		}
		update.SetCollaboratorIDs = true
		update.CollaboratorIDs = append([]string(nil), (*input.CollaboratorIDs)...)
	}
	if input.RequiresAcceptance != nil && !isCreatorOrAdmin {
		writeError(w, fmt.Errorf("%w: only the creator can change review settings", ErrForbidden))
		return
	}
	if input.DueAt != nil {
		update.SetDueAt = true
		if value := strings.TrimSpace(*input.DueAt); value != "" {
			dueAt, parseErr := time.Parse(time.RFC3339, value)
			if parseErr != nil {
				writeError(w, fmt.Errorf("%w: invalid due date", ErrInvalid))
				return
			}
			update.DueAt = &dueAt
		}
	}
	candidate := ticket
	if update.SetAssignedAgentID {
		candidate.AssignedAgentID = update.AssignedAgentID
	}
	if update.SetCollaboratorIDs {
		candidate.CollaboratorIDs = update.CollaboratorIDs
	}
	if err := s.validateTicketParticipants(r.Context(), candidate); err != nil {
		writeError(w, err)
		return
	}
	previousOwner := ticket.AssignedAgentID
	previousRequiresAcceptance := ticket.RequiresAcceptance
	previousTitle, previousCategory, previousDescription := ticket.Title, ticket.Category, ticket.Description
	previousPriority := ticket.Priority
	ticket, err = s.store.UpdateTicket(r.Context(), ticket.ID, update)
	if err != nil {
		writeError(w, err)
		return
	}
	if update.SetAssignedAgentID && previousOwner != ticket.AssignedAgentID {
		body := "已分配负责人"
		if previousOwner != "" {
			body = "负责人已转交：" + strings.TrimSpace(input.HandoverNote)
		}
		s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, body)
	}
	if update.SetCollaboratorIDs {
		s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, "协作人已更新")
	}
	if update.SetDueAt {
		s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, "截止时间已更新")
	}
	if input.RequiresAcceptance != nil && previousRequiresAcceptance != ticket.RequiresAcceptance {
		s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, "验收方式已更新")
	}
	if previousTitle != ticket.Title || previousCategory != ticket.Category || previousDescription != ticket.Description {
		s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, "工单内容已更新")
	}
	if previousPriority != ticket.Priority {
		s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, "优先级已更新")
	}
	eventType := "ticket.updated"
	if previousOwner != ticket.AssignedAgentID {
		eventType = "ticket.assigned"
	}
	s.broadcast(Event{Type: eventType, ShopID: ticket.ShopID, EntityID: ticket.ID, Payload: ticket, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, ticket)
}

func (s *Server) addTicketSystemComment(ctx context.Context, ticketID, actorID, body string) {
	_, _ = s.store.AddTicketComment(ctx, TicketComment{TicketID: ticketID, AuthorID: actorID, Kind: TicketCommentKindSystem, Body: body})
}

func ticketStatusName(status string) string {
	return map[string]string{
		TicketStatusOpen:          "待接收",
		TicketStatusInProgress:    "处理中",
		TicketStatusPending:       "等待中",
		TicketStatusPendingReview: "待验收",
		TicketStatusResolved:      "已完成",
		TicketStatusClosed:        "已关闭",
		TicketStatusCancelled:     "已取消",
	}[status]
}

func (s *Server) acceptTicket(w http.ResponseWriter, r *http.Request, user User, ticket Ticket) {
	if !userHasPermission(user, PermissionTicketsManage) {
		writeError(w, ErrForbidden)
		return
	}
	if ticket.AssignedAgentID != user.ID {
		writeError(w, fmt.Errorf("%w: ticket belongs to another agent", ErrForbidden))
		return
	}
	if ticket.Status != TicketStatusOpen {
		writeError(w, fmt.Errorf("%w: ticket is no longer waiting for acceptance", ErrConflict))
		return
	}
	if ticket.Type == TicketTypeCustomer {
		if !userHasPermission(user, PermissionWorkbenchAccess) {
			writeError(w, fmt.Errorf("%w: workbench ticket permission is required", ErrForbidden))
			return
		}
		if err := s.validateConversationAssignee(r.Context(), ticket.ShopID, user.ID); err != nil {
			writeError(w, err)
			return
		}
	}

	updated, acceptedConversation, err := s.store.AcceptTicket(r.Context(), ticket.ID, user.ID)
	if err != nil {
		writeError(w, err)
		return
	}
	s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, "已接收工单并开始处理")
	if acceptedConversation != nil {
		s.addWorkflowSystemMessage(r.Context(), *acceptedConversation, fmt.Sprintf("工单 %s 已由 %s 接收，会话已完成交接", updated.ID, user.DisplayName))
		s.broadcastConversationEvent(*acceptedConversation, Event{Type: "conversation.transferred", ShopID: acceptedConversation.ShopID, EntityID: acceptedConversation.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	}
	s.broadcast(Event{Type: "ticket.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusOK, acceptTicketResponse{Ticket: updated, Conversation: acceptedConversation})
}

func (s *Server) handleTicketContext(w http.ResponseWriter, r *http.Request, user User, ticket Ticket) {
	if ticket.ConversationID == "" {
		writeError(w, fmt.Errorf("%w: ticket has no linked conversation", ErrNotFound))
		return
	}
	conversation, err := s.store.GetConversation(r.Context(), ticket.ConversationID)
	if err != nil {
		writeError(w, err)
		return
	}
	messages, err := s.store.ListMessages(r.Context(), ticket.ConversationID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSONResponse(w, http.StatusOK, TicketContext{Conversation: conversation, Messages: nonNilSlice(messages)})
}

func (s *Server) handleTicketAction(w http.ResponseWriter, r *http.Request, user User, ticket Ticket, action string) {
	var input ticketActionRequest
	if !decodeJSON(w, r, &input) {
		return
	}
	isOwner := ticket.AssignedAgentID == user.ID
	isCreator := ticket.CreatedBy == user.ID
	now := time.Now().UTC()
	update := TicketUpdate{}
	systemComment := ""

	switch action {
	case "complete":
		if !isOwner || (ticket.Status != TicketStatusInProgress && ticket.Status != TicketStatusPending) {
			writeError(w, fmt.Errorf("%w: only the active ticket owner can complete it", ErrForbidden))
			return
		}
		update.SetCompletedBy, update.CompletedBy = true, user.ID
		update.SetCompletedAt, update.CompletedAt = true, &now
		if ticket.RequiresAcceptance && !isCreator {
			update.Status = TicketStatusPendingReview
			systemComment = "负责人已提交完成，等待创建人验收"
		} else {
			update.Status = TicketStatusResolved
			systemComment = "工单已完成"
		}
	case "wait":
		if !isOwner || ticket.Status != TicketStatusInProgress {
			writeError(w, fmt.Errorf("%w: only the active ticket owner can pause it", ErrForbidden))
			return
		}
		if strings.TrimSpace(input.Reason) == "" {
			writeError(w, fmt.Errorf("%w: waiting reason is required", ErrInvalid))
			return
		}
		update.Status = TicketStatusPending
		update.SetWaitingReason, update.WaitingReason = true, input.Reason
		systemComment = "工单转为等待：" + strings.TrimSpace(input.Reason)
	case "resume":
		if ticket.Status == TicketStatusPendingReview {
			if !isCreator {
				writeError(w, fmt.Errorf("%w: only the creator can return a task", ErrForbidden))
				return
			}
			update.SetCompletedBy, update.CompletedBy = true, ""
			update.SetCompletedAt, update.CompletedAt = true, nil
			systemComment = "创建人退回工单继续处理"
		} else if ticket.Status == TicketStatusPending {
			if !isOwner {
				writeError(w, fmt.Errorf("%w: only the ticket owner can resume it", ErrForbidden))
				return
			}
			systemComment = "工单已恢复处理"
		} else {
			writeError(w, fmt.Errorf("%w: ticket cannot be resumed from its current status", ErrConflict))
			return
		}
		update.Status = TicketStatusInProgress
		update.SetWaitingReason = true
	case "review":
		if !isCreator || ticket.Status != TicketStatusPendingReview || input.Approved == nil {
			writeError(w, fmt.Errorf("%w: only the creator can review a completed task", ErrForbidden))
			return
		}
		if *input.Approved {
			update.Status = TicketStatusResolved
			systemComment = "创建人已验收完成"
		} else {
			update.Status = TicketStatusInProgress
			update.SetCompletedBy, update.CompletedBy = true, ""
			update.SetCompletedAt, update.CompletedAt = true, nil
			update.SetWaitingReason = true
			systemComment = "创建人退回工单继续处理"
		}
	case "cancel":
		if !isCreator && !user.SystemAdmin && user.Role != UserRoleAdmin {
			writeError(w, fmt.Errorf("%w: only the creator can cancel the ticket", ErrForbidden))
			return
		}
		if !ticketStatusActive(ticket.Status) {
			writeError(w, fmt.Errorf("%w: ticket is already completed", ErrConflict))
			return
		}
		update.Status = TicketStatusCancelled
		update.SetCancelledAt, update.CancelledAt = true, &now
		systemComment = "工单已取消"
	case "convert-to-customer":
		if ticket.Type != TicketTypeInternal || ticket.ConversationID == "" || !isCreator {
			writeError(w, fmt.Errorf("%w: only the creator can convert a linked internal task", ErrForbidden))
			return
		}
		targetID := strings.TrimSpace(input.AssignedAgentID)
		if targetID == "" {
			writeError(w, fmt.Errorf("%w: target agent is required", ErrInvalid))
			return
		}
		conversation, err := s.store.GetConversation(r.Context(), ticket.ConversationID)
		if err != nil {
			writeError(w, err)
			return
		}
		candidate := ticket
		candidate.Type, candidate.AssignedAgentID = TicketTypeCustomer, targetID
		if err := s.validateTicketParticipants(r.Context(), candidate); err != nil {
			writeError(w, err)
			return
		}
		update.SetType, update.Type = true, TicketTypeCustomer
		update.SetAssignedAgentID, update.AssignedAgentID = true, targetID
		update.SetHandoffFromID, update.HandoffFromAgentID = true, conversation.AssignedAgentID
		update.Status = TicketStatusOpen
		update.SetAcceptedAt = true
		update.SetCompletedBy, update.CompletedBy = true, ""
		update.SetCompletedAt, update.CompletedAt = true, nil
		update.SetWaitingReason = true
		systemComment = "内部任务已转为客户工单，等待接收"
	default:
		http.NotFound(w, r)
		return
	}
	updated, err := s.store.UpdateTicket(r.Context(), ticket.ID, update)
	if err != nil {
		writeError(w, err)
		return
	}
	if strings.TrimSpace(input.Note) != "" {
		_, _ = s.store.AddTicketComment(r.Context(), TicketComment{TicketID: ticket.ID, AuthorID: user.ID, Body: input.Note})
	}
	s.addTicketSystemComment(r.Context(), ticket.ID, user.ID, systemComment)
	if updated.Type == TicketTypeCustomer && updated.ConversationID != "" && updated.Status == TicketStatusResolved {
		if conversation, conversationErr := s.store.GetConversation(r.Context(), updated.ConversationID); conversationErr == nil {
			s.addWorkflowSystemMessage(r.Context(), conversation, fmt.Sprintf("工单 %s 已完成：%s", updated.ID, updated.Title))
		}
	}
	s.broadcast(Event{Type: "ticket.updated", ShopID: updated.ShopID, EntityID: updated.ID, Payload: updated, CreatedAt: now})
	writeJSONResponse(w, http.StatusOK, updated)
}

func (s *Server) addWorkflowSystemMessage(ctx context.Context, conversation Conversation, body string) {
	message, updated, err := s.store.AddMessage(ctx, Message{ConversationID: conversation.ID, Direction: MessageDirectionSystem, Type: MessageTypeText, Body: body, SenderName: "Xzdesk"})
	if err == nil {
		s.broadcastConversationEvent(updated, Event{Type: "message.created", ShopID: updated.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
	}
}
