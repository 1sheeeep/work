package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTransferAndTicketWorkflow(t *testing.T) {
	store := NewMemoryStore()
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agent := createWorkflowAgent(t, server.URL, adminToken, "agent-owner@example.com", "Agent Owner")
	available := createWorkflowAgent(t, server.URL, adminToken, "available@example.com", "Available")
	offline := createWorkflowAgent(t, server.URL, adminToken, "offline@example.com", "Offline")

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Workflow Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	for _, user := range []User{agent, available, offline} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: user.ID}, http.StatusCreated, nil)
	}

	ownerLogin := loginWorkflowAgent(t, server.URL, "agent-owner@example.com")
	availableLogin := loginWorkflowAgent(t, server.URL, "available@example.com")
	availableSocket := dialEventWebSocket(t, server.URL, availableLogin.Token)
	defer availableSocket.Close()
	waitForConnectedUser(t, app, available.ID)
	first := createAndClaimWorkflowConversation(t, server.URL, adminToken, ownerLogin.Token, shop.ID, source.ID, "First Customer")

	var candidates []TransferCandidate
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+first.ID+"/transfer-candidates", ownerLogin.Token, nil, http.StatusOK, &candidates)
	if candidatePresence(candidates, available.ID) != "available" || candidatePresence(candidates, offline.ID) != "offline" {
		t.Fatalf("unexpected transfer candidates: %#v", candidates)
	}

	var completed TransferRequest
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+first.ID+"/transfers", ownerLogin.Token, createTransferRequest{TargetAgentID: available.ID}, http.StatusOK, &completed)
	if completed.Status != TransferStatusCompleted {
		t.Fatalf("expected direct transfer to complete, got %#v", completed)
	}
	transferred, err := store.GetConversation(context.Background(), first.ID)
	if err != nil {
		t.Fatalf("read transferred conversation: %v", err)
	}
	if transferred.AssignedAgentID != available.ID {
		t.Fatalf("expected available agent to own conversation, got %#v", transferred)
	}

	second := createAndClaimWorkflowConversation(t, server.URL, adminToken, ownerLogin.Token, shop.ID, source.ID, "Second Customer")
	var pending TransferRequest
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+second.ID+"/transfers", ownerLogin.Token, createTransferRequest{TargetAgentID: offline.ID, Note: "Needs follow-up"}, http.StatusAccepted, &pending)
	if pending.Status != TransferStatusPending {
		t.Fatalf("expected offline transfer to require acceptance, got %#v", pending)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/transfers/"+pending.ID+"/accept", availableLogin.Token, nil, http.StatusForbidden, nil)

	offlineLogin := loginWorkflowAgent(t, server.URL, "offline@example.com")
	var accepted TransferRequest
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/transfers/"+pending.ID+"/accept", offlineLogin.Token, nil, http.StatusOK, &accepted)
	if accepted.Status != TransferStatusAccepted {
		t.Fatalf("expected transfer acceptance, got %#v", accepted)
	}

	var ticket Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", offlineLogin.Token, createTicketRequest{
		ConversationID:  second.ID,
		Title:           "Refund follow-up",
		Category:        "Refund",
		Priority:        "high",
		Status:          TicketStatusOpen,
		AssignedAgentID: agent.ID,
		Description:     "Verify the refund amount with the customer.",
	}, http.StatusCreated, &ticket)
	if ticket.ConversationID != second.ID || ticket.AssignedAgentID != agent.ID {
		t.Fatalf("ticket context was not inherited: %#v", ticket)
	}

	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+ticket.ID+"/accept", availableLogin.Token, nil, http.StatusForbidden, nil)
	var acceptedTicket acceptTicketResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+ticket.ID+"/accept", ownerLogin.Token, nil, http.StatusOK, &acceptedTicket)
	if acceptedTicket.Ticket.Status != TicketStatusInProgress || acceptedTicket.Conversation == nil || acceptedTicket.Conversation.AssignedAgentID != agent.ID {
		t.Fatalf("expected ticket acceptance to transfer the conversation: %#v", acceptedTicket)
	}
	var originalWorkbench []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", offlineLogin.Token, nil, http.StatusOK, &originalWorkbench)
	if containsConversation(originalWorkbench, second.ID) {
		t.Fatalf("transferred conversation remained visible to the original agent: %#v", originalWorkbench)
	}
	var recipientWorkbench []Conversation
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations?scope=assigned", ownerLogin.Token, nil, http.StatusOK, &recipientWorkbench)
	if !containsConversation(recipientWorkbench, second.ID) {
		t.Fatalf("transferred conversation was not visible to the accepting agent: %#v", recipientWorkbench)
	}
	var comment TicketComment
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+ticket.ID+"/comments", ownerLogin.Token, map[string]string{"body": "Customer confirmed the amount."}, http.StatusCreated, &comment)
	if comment.TicketID != ticket.ID || comment.Body == "" {
		t.Fatalf("unexpected ticket comment: %#v", comment)
	}
	var resolved Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+ticket.ID+"/complete", ownerLogin.Token, ticketActionRequest{}, http.StatusOK, &resolved)
	if resolved.Status != TicketStatusResolved {
		t.Fatalf("expected resolved ticket, got %#v", resolved)
	}
	var resolvedMessages []Message
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/conversations/"+second.ID+"/messages", ownerLogin.Token, nil, http.StatusOK, &resolvedMessages)
	foundResolvedMessage := false
	for _, message := range resolvedMessages {
		if message.Direction == MessageDirectionSystem && strings.Contains(message.Body, "已完成") {
			foundResolvedMessage = true
			break
		}
	}
	if !foundResolvedMessage {
		t.Fatalf("resolved ticket status was not recorded in the conversation: %#v", resolvedMessages)
	}
	var unrelatedTickets []Ticket
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets", availableLogin.Token, nil, http.StatusOK, &unrelatedTickets)
	if !containsTicket(unrelatedTickets, ticket.ID) {
		t.Fatalf("ticket permission should expose all ticket data: %#v", unrelatedTickets)
	}
	var creatorTickets []Ticket
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets", offlineLogin.Token, nil, http.StatusOK, &creatorTickets)
	if !containsTicket(creatorTickets, ticket.ID) {
		t.Fatalf("ticket creator should retain visibility: %#v", creatorTickets)
	}

	var otherShop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Other Workflow Shop"}, http.StatusCreated, &otherShop)
	var otherSource ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+otherShop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &otherSource)
	for _, user := range []User{agent, offline} {
		requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+otherShop.ID+"/agents", adminToken, assignShopUserRequest{UserID: user.ID}, http.StatusCreated, nil)
	}
	third := createAndClaimWorkflowConversation(t, server.URL, adminToken, ownerLogin.Token, otherShop.ID, otherSource.ID, "Third Customer")
	var groupPending TransferRequest
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+third.ID+"/transfers", ownerLogin.Token, createTransferRequest{TargetSkillGroup: defaultSkillGroup}, http.StatusAccepted, &groupPending)
	var outsiderTransfers []TransferRequest
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/transfers?status=pending", availableLogin.Token, nil, http.StatusOK, &outsiderTransfers)
	for _, item := range outsiderTransfers {
		if item.ID == groupPending.ID {
			t.Fatalf("cross-shop skill-group transfer leaked to unrelated agent: %#v", item)
		}
	}
}

func TestInternalTaskTicketWorkflow(t *testing.T) {
	store := NewMemoryStore()
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	creator := createWorkflowAgent(t, server.URL, adminToken, "task-creator@example.com", "Task Creator")
	owner := createWorkflowAgent(t, server.URL, adminToken, "task-owner@example.com", "Task Owner")
	collaborator := createWorkflowAgent(t, server.URL, adminToken, "task-collaborator@example.com", "Task Collaborator")
	creatorLogin := loginWorkflowAgent(t, server.URL, creator.Email)
	ownerLogin := loginWorkflowAgent(t, server.URL, owner.Email)

	dueAt := time.Now().UTC().Add(24 * time.Hour).Truncate(time.Second)
	var task Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", creatorLogin.Token, createTicketRequest{
		Type:               TicketTypeInternal,
		Title:              "Prepare weekly operations report",
		Category:           "Operations",
		Priority:           "high",
		AssignedAgentID:    owner.ID,
		CollaboratorIDs:    []string{collaborator.ID},
		Description:        "Reconcile the queue and document follow-up actions.",
		DueAt:              &dueAt,
		RequiresAcceptance: true,
	}, http.StatusCreated, &task)
	if task.Type != TicketTypeInternal || task.ShopID != "" || task.AssignedAgentID != owner.ID || len(task.CollaboratorIDs) != 1 {
		t.Fatalf("unexpected internal task: %#v", task)
	}
	var summary TicketSummary
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/ticket-summary?type=internal", creatorLogin.Token, nil, http.StatusOK, &summary)
	if summary.Total != 1 || summary.Internal != 1 || summary.Open != 1 || summary.CreatedByMe != 1 {
		t.Fatalf("unexpected internal task summary: %#v", summary)
	}
	var createdByMe []Ticket
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets?view=created_by_me", creatorLogin.Token, nil, http.StatusOK, &createdByMe)
	if !containsTicket(createdByMe, task.ID) {
		t.Fatalf("creator could not find their task: %#v", createdByMe)
	}

	var participantTasks []Ticket
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets?participantId="+collaborator.ID, collaboratorLogin(t, server.URL, collaborator.Email).Token, nil, http.StatusOK, &participantTasks)
	if !containsTicket(participantTasks, task.ID) {
		t.Fatalf("collaborator could not find internal task: %#v", participantTasks)
	}

	var accepted acceptTicketResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/accept", ownerLogin.Token, nil, http.StatusOK, &accepted)
	if accepted.Ticket.Status != TicketStatusInProgress || accepted.Conversation != nil {
		t.Fatalf("internal task acceptance should not transfer a conversation: %#v", accepted)
	}

	var pendingReview Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/complete", ownerLogin.Token, ticketActionRequest{}, http.StatusOK, &pendingReview)
	if pendingReview.Status != TicketStatusPendingReview || pendingReview.CompletedBy != owner.ID || pendingReview.CompletedAt == nil {
		t.Fatalf("expected task completion to wait for creator acceptance: %#v", pendingReview)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/complete", ownerLogin.Token, ticketActionRequest{}, http.StatusForbidden, nil)

	var resolved Ticket
	approved := true
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/review", creatorLogin.Token, ticketActionRequest{Approved: &approved}, http.StatusOK, &resolved)
	if resolved.Status != TicketStatusResolved {
		t.Fatalf("creator could not accept completed task: %#v", resolved)
	}
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets?view=created_by_me", creatorLogin.Token, nil, http.StatusOK, &createdByMe)
	if !containsTicket(createdByMe, task.ID) {
		t.Fatalf("completed task disappeared from creator queue: %#v", createdByMe)
	}

	var comments []TicketComment
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets/"+task.ID+"/comments", creatorLogin.Token, nil, http.StatusOK, &comments)
	foundSystemAudit := false
	for _, comment := range comments {
		if comment.Kind == TicketCommentKindSystem && strings.Contains(comment.Body, "等待创建人验收") {
			foundSystemAudit = true
		}
	}
	if !foundSystemAudit {
		t.Fatalf("internal task audit trail is incomplete: %#v", comments)
	}

	var reassignedTask Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", creatorLogin.Token, createTicketRequest{
		Type: TicketTypeInternal, Title: "Hand off internal task", AssignedAgentID: owner.ID, Description: "Verify owner handoff rules.",
	}, http.StatusCreated, &reassignedTask)
	newOwner := collaborator.ID
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/tickets/"+reassignedTask.ID, creatorLogin.Token, updateTicketRequest{AssignedAgentID: &newOwner}, http.StatusBadRequest, nil)
	var handedOff Ticket
	requestJSON(t, http.MethodPatch, server.URL+"/api/v1/tickets/"+reassignedTask.ID, creatorLogin.Token, updateTicketRequest{AssignedAgentID: &newOwner, HandoverNote: "Take over the remaining checks."}, http.StatusOK, &handedOff)
	if handedOff.AssignedAgentID != collaborator.ID || handedOff.Status != TicketStatusOpen {
		t.Fatalf("task handoff did not reset acceptance: %#v", handedOff)
	}
}

func TestTicketCustomerAssociationAndSearch(t *testing.T) {
	store := NewMemoryStore()
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	agent := createWorkflowAgent(t, server.URL, adminToken, "customer-link@example.com", "Customer Link Agent")
	agentLogin := loginWorkflowAgent(t, server.URL, agent.Email)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Customer Link Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: agent.ID}, http.StatusCreated, nil)

	var emailConversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Mia Customer",
		CustomerEmail: "MIA@Example.COM",
	}, http.StatusCreated, &emailConversation)

	var duplicateConversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:        shop.ID,
		SourceID:      source.ID,
		CustomerName:  "Mia Customer",
		CustomerEmail: "mia@example.com",
	}, http.StatusCreated, &duplicateConversation)

	var customers []TicketCustomer
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/ticket-customers?shopId="+shop.ID+"&query=mia", agentLogin.Token, nil, http.StatusOK, &customers)
	if len(customers) != 1 || customers[0].CustomerRef != "email:mia@example.com" || customers[0].CustomerEmail != "mia@example.com" {
		t.Fatalf("email customer search was not normalized and deduplicated: %#v", customers)
	}

	var emailTask Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", agentLogin.Token, createTicketRequest{
		Type:            TicketTypeInternal,
		ConversationID:  emailConversation.ID,
		Title:           "Email-linked task",
		AssignedAgentID: agent.ID,
		Description:     "Verify customer identity association.",
	}, http.StatusCreated, &emailTask)
	if emailTask.CustomerRef != "email:mia@example.com" || emailTask.CustomerEmail != "mia@example.com" || emailTask.ShopID != shop.ID {
		t.Fatalf("email customer identity was not persisted on the ticket: %#v", emailTask)
	}

	var shopifyConversation Conversation
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations", adminToken, Conversation{
		ShopID:       shop.ID,
		SourceID:     source.ID,
		CustomerName: "Bound Buyer",
	}, http.StatusCreated, &shopifyConversation)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/conversations/"+shopifyConversation.ID+"/messages", adminToken, Message{
		Direction: MessageDirectionCustomer,
		Body:      "Please review my order.",
		Metadata:  map[string]string{publicChatCustomerIDMetadataKey: "8173975273657"},
	}, http.StatusCreated, nil)

	requestJSON(t, http.MethodGet, server.URL+"/api/v1/ticket-customers?shopId="+shop.ID+"&query=bound", agentLogin.Token, nil, http.StatusOK, &customers)
	if len(customers) != 1 || customers[0].CustomerRef != "shopify:8173975273657" || customers[0].ConversationID != shopifyConversation.ID {
		t.Fatalf("shopify customer fallback was not returned by customer search: %#v", customers)
	}

	var shopifyTask Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", agentLogin.Token, createTicketRequest{
		Type:            TicketTypeInternal,
		ConversationID:  shopifyConversation.ID,
		Title:           "Shopify-linked task",
		AssignedAgentID: agent.ID,
		Description:     "Verify Shopify customer fallback.",
	}, http.StatusCreated, &shopifyTask)
	if shopifyTask.CustomerRef != "shopify:8173975273657" || shopifyTask.CustomerName != "Bound Buyer" {
		t.Fatalf("shopify customer identity was not persisted on the ticket: %#v", shopifyTask)
	}
}

func TestInternalTaskLinkedConversationContextAndActions(t *testing.T) {
	store := NewMemoryStore()
	app := NewServer(store)
	server := httptest.NewServer(app.Routes())
	defer server.Close()
	adminToken := bootstrapAdmin(t, server.URL)

	creator := createWorkflowAgent(t, server.URL, adminToken, "linked-creator@example.com", "Day Shift")
	owner := createWorkflowAgent(t, server.URL, adminToken, "linked-owner@example.com", "Night Shift")
	outsider := createWorkflowAgent(t, server.URL, adminToken, "linked-outsider@example.com", "Outsider")
	creatorLogin := loginWorkflowAgent(t, server.URL, creator.Email)
	ownerLogin := loginWorkflowAgent(t, server.URL, owner.Email)
	outsiderLogin := loginWorkflowAgent(t, server.URL, outsider.Email)

	var shop Shop
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops", adminToken, Shop{DisplayName: "Linked Context Shop"}, http.StatusCreated, &shop)
	var source ShopSource
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/sources", adminToken, ShopSource{Type: SourceTypeShopifyChat}, http.StatusCreated, &source)
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/shops/"+shop.ID+"/agents", adminToken, assignShopUserRequest{UserID: creator.ID}, http.StatusCreated, nil)
	conversation := createAndClaimWorkflowConversation(t, server.URL, adminToken, creatorLogin.Token, shop.ID, source.ID, "Linked Customer")
	if _, _, err := store.AddMessage(context.Background(), Message{ConversationID: conversation.ID, Direction: MessageDirectionCustomer, Type: MessageTypeText, Body: "Please check my refund."}); err != nil {
		t.Fatalf("add linked conversation message: %v", err)
	}

	var task Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets", creatorLogin.Token, createTicketRequest{
		Type: TicketTypeInternal, ConversationID: conversation.ID, Title: "Check refund record", AssignedAgentID: owner.ID,
		Description: "Review the full customer conversation before handling.", RequiresAcceptance: true,
	}, http.StatusCreated, &task)
	var linkedContext TicketContext
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets/"+task.ID+"/context", ownerLogin.Token, nil, http.StatusOK, &linkedContext)
	if linkedContext.Conversation.ID != conversation.ID || len(linkedContext.Messages) == 0 {
		t.Fatalf("linked task did not expose live read-only context: %#v", linkedContext)
	}
	var outsiderContext TicketContext
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets/"+task.ID+"/context", outsiderLogin.Token, nil, http.StatusOK, &outsiderContext)
	if outsiderContext.Conversation.ID != conversation.ID {
		t.Fatalf("ticket viewer could not read linked conversation context: %#v", outsiderContext)
	}
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/accept", outsiderLogin.Token, nil, http.StatusForbidden, nil)

	var waiting []Ticket
	requestJSON(t, http.MethodGet, server.URL+"/api/v1/tickets?view=waiting_for_me", ownerLogin.Token, nil, http.StatusOK, &waiting)
	if !containsTicket(waiting, task.ID) {
		t.Fatalf("task was not visible in the recipient queue: %#v", waiting)
	}
	var accepted acceptTicketResponse
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/accept", ownerLogin.Token, nil, http.StatusOK, &accepted)
	var paused Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/wait", ownerLogin.Token, ticketActionRequest{Reason: "Waiting for warehouse"}, http.StatusOK, &paused)
	if paused.Status != TicketStatusPending || paused.WaitingReason != "Waiting for warehouse" {
		t.Fatalf("task did not enter waiting state: %#v", paused)
	}
	var resumed Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/resume", ownerLogin.Token, ticketActionRequest{}, http.StatusOK, &resumed)
	if resumed.Status != TicketStatusInProgress || resumed.WaitingReason != "" {
		t.Fatalf("task did not resume cleanly: %#v", resumed)
	}
	var submitted Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/complete", ownerLogin.Token, ticketActionRequest{}, http.StatusOK, &submitted)
	if submitted.Status != TicketStatusPendingReview {
		t.Fatalf("task did not enter review queue: %#v", submitted)
	}
	approved := true
	var completed Ticket
	requestJSON(t, http.MethodPost, server.URL+"/api/v1/tickets/"+task.ID+"/review", creatorLogin.Token, ticketActionRequest{Approved: &approved}, http.StatusOK, &completed)
	if completed.Status != TicketStatusResolved {
		t.Fatalf("task was not completed after review: %#v", completed)
	}
}

func collaboratorLogin(t *testing.T, baseURL, email string) AuthResult {
	t.Helper()
	return loginWorkflowAgent(t, baseURL, email)
}

func waitForConnectedUser(t *testing.T, server *Server, userID string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		if server.connectedUserIDs()[userID] {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("user %s did not become connected", userID)
}

func createWorkflowAgent(t *testing.T, baseURL, adminToken, email, name string) User {
	t.Helper()
	var user User
	requestJSON(t, http.MethodPost, baseURL+"/api/v1/users", adminToken, createUserRequest{Email: email, DisplayName: name, Password: "agent-password", Role: UserRoleAgent}, http.StatusCreated, &user)
	return user
}

func loginWorkflowAgent(t *testing.T, baseURL, email string) AuthResult {
	t.Helper()
	var result AuthResult
	requestJSON(t, http.MethodPost, baseURL+"/api/v1/auth/login", "", loginRequest{Email: email, Password: "agent-password"}, http.StatusOK, &result)
	return result
}

func createAndClaimWorkflowConversation(t *testing.T, baseURL, adminToken, agentToken, shopID, sourceID, customerName string) Conversation {
	t.Helper()
	var conversation Conversation
	requestJSON(t, http.MethodPost, baseURL+"/api/v1/conversations", adminToken, Conversation{ShopID: shopID, SourceID: sourceID, CustomerName: customerName}, http.StatusCreated, &conversation)
	requestJSON(t, http.MethodPost, baseURL+"/api/v1/conversations/"+conversation.ID+"/claim", agentToken, nil, http.StatusOK, &conversation)
	return conversation
}

func candidatePresence(candidates []TransferCandidate, userID string) string {
	for _, candidate := range candidates {
		if candidate.Agent.ID == userID {
			return candidate.Presence
		}
	}
	return ""
}

func containsTicket(tickets []Ticket, ticketID string) bool {
	for _, ticket := range tickets {
		if ticket.ID == ticketID {
			return true
		}
	}
	return false
}

func containsConversation(conversations []Conversation, conversationID string) bool {
	for _, conversation := range conversations {
		if conversation.ID == conversationID {
			return true
		}
	}
	return false
}
