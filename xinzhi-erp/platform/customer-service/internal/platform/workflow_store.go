package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

func (s *MemoryStore) ListActiveSessionUserIDs(ctx context.Context, now time.Time) ([]string, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	seen := map[string]bool{}
	for _, session := range s.sessions {
		if session.ExpiresAt.After(now) {
			seen[session.UserID] = true
		}
	}
	out := make([]string, 0, len(seen))
	for id := range seen {
		out = append(out, id)
	}
	sort.Strings(out)
	return out, nil
}

func (s *MemoryStore) TransferConversation(ctx context.Context, id, fromAgentID, targetAgentID string) (Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Conversation{}, err
	}
	id, fromAgentID, targetAgentID = strings.TrimSpace(id), strings.TrimSpace(fromAgentID), strings.TrimSpace(targetAgentID)
	if id == "" || fromAgentID == "" || targetAgentID == "" || fromAgentID == targetAgentID {
		return Conversation{}, fmt.Errorf("%w: valid source and target agents are required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	conversation, ok := s.conversations[id]
	if !ok {
		return Conversation{}, ErrNotFound
	}
	if conversation.Status != ConversationStatusAssigned || conversation.AssignedAgentID != fromAgentID {
		return Conversation{}, fmt.Errorf("%w: only the assigned agent can transfer the conversation", ErrConflict)
	}
	target, ok := s.users[targetAgentID]
	if !ok || target.Status != UserStatusActive || !userHasPermission(target, PermissionWorkbenchAccess) {
		return Conversation{}, fmt.Errorf("%w: target agent is unavailable", ErrInvalid)
	}
	assigned := false
	for _, link := range s.shopAgents {
		if link.ShopID == conversation.ShopID && link.UserID == targetAgentID {
			assigned = true
			break
		}
	}
	if !assigned {
		return Conversation{}, fmt.Errorf("%w: target agent is not assigned to this shop", ErrInvalid)
	}
	conversation.AssignedAgentID = targetAgentID
	conversation.UpdatedAt = time.Now().UTC()
	s.conversations[id] = conversation
	return conversation, nil
}

func (s *MemoryStore) CreateTransferRequest(ctx context.Context, input TransferRequest) (TransferRequest, error) {
	if err := ctx.Err(); err != nil {
		return TransferRequest{}, err
	}
	input.ConversationID = strings.TrimSpace(input.ConversationID)
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.FromAgentID = strings.TrimSpace(input.FromAgentID)
	input.TargetAgentID = strings.TrimSpace(input.TargetAgentID)
	input.TargetSkillGroup = strings.TrimSpace(input.TargetSkillGroup)
	input.Note = strings.TrimSpace(input.Note)
	if input.ConversationID == "" || input.ShopID == "" || input.FromAgentID == "" || (input.TargetAgentID == "" && input.TargetSkillGroup == "") {
		return TransferRequest{}, fmt.Errorf("%w: transfer target is required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, item := range s.transferRequests {
		if item.ConversationID == input.ConversationID && item.Status == TransferStatusPending {
			return TransferRequest{}, fmt.Errorf("%w: conversation already has a pending transfer", ErrConflict)
		}
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("transfer")
	}
	now := time.Now().UTC()
	input.Status, input.CreatedAt, input.UpdatedAt = TransferStatusPending, now, now
	s.transferRequests[input.ID] = input
	return input, nil
}

func (s *MemoryStore) GetTransferRequest(ctx context.Context, id string) (TransferRequest, error) {
	if err := ctx.Err(); err != nil {
		return TransferRequest{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.transferRequests[strings.TrimSpace(id)]
	if !ok {
		return TransferRequest{}, ErrNotFound
	}
	return item, nil
}

func (s *MemoryStore) ListTransferRequests(ctx context.Context, userID, conversationID, status string) ([]TransferRequest, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	userID, conversationID, status = strings.TrimSpace(userID), strings.TrimSpace(conversationID), strings.TrimSpace(status)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []TransferRequest{}
	for _, item := range s.transferRequests {
		if conversationID != "" && item.ConversationID != conversationID {
			continue
		}
		if status != "" && item.Status != status {
			continue
		}
		if userID != "" && item.TargetAgentID != userID && item.TargetSkillGroup == "" {
			continue
		}
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out, nil
}

func (s *MemoryStore) ResolveTransferRequest(ctx context.Context, id, status, resolvedBy string) (TransferRequest, error) {
	if err := ctx.Err(); err != nil {
		return TransferRequest{}, err
	}
	if !validTransferResolution(status) {
		return TransferRequest{}, fmt.Errorf("%w: invalid transfer status", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.transferRequests[strings.TrimSpace(id)]
	if !ok {
		return TransferRequest{}, ErrNotFound
	}
	if item.Status != TransferStatusPending {
		return TransferRequest{}, fmt.Errorf("%w: transfer request is already resolved", ErrConflict)
	}
	item.Status, item.ResolvedBy, item.UpdatedAt = status, strings.TrimSpace(resolvedBy), time.Now().UTC()
	s.transferRequests[item.ID] = item
	return item, nil
}

func (s *MemoryStore) CreateTicket(ctx context.Context, input Ticket) (Ticket, error) {
	if err := ctx.Err(); err != nil {
		return Ticket{}, err
	}
	input, err := normalizeTicket(input)
	if err != nil {
		return Ticket{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if input.ID == "" {
		input.ID = s.newIDLocked("ticket")
	}
	now := time.Now().UTC()
	input.CreatedAt, input.UpdatedAt = now, now
	input.Attachments = append([]TicketAttachment(nil), input.Attachments...)
	input.CollaboratorIDs = append([]string(nil), input.CollaboratorIDs...)
	s.tickets[input.ID] = input
	return input, nil
}

func (s *MemoryStore) GetTicket(ctx context.Context, id string) (Ticket, error) {
	if err := ctx.Err(); err != nil {
		return Ticket{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	item, ok := s.tickets[strings.TrimSpace(id)]
	if !ok {
		return Ticket{}, ErrNotFound
	}
	item.Attachments = append([]TicketAttachment(nil), item.Attachments...)
	item.CollaboratorIDs = append([]string(nil), item.CollaboratorIDs...)
	return item, nil
}

func (s *MemoryStore) ListTickets(ctx context.Context, filter TicketFilter) ([]Ticket, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	query := strings.ToLower(strings.TrimSpace(filter.Search))
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := []Ticket{}
	for _, item := range s.tickets {
		if filter.Type != "" && item.Type != filter.Type {
			continue
		}
		if filter.ShopID != "" && item.ShopID != filter.ShopID {
			continue
		}
		if filter.ConversationID != "" && item.ConversationID != filter.ConversationID {
			continue
		}
		if filter.AssignedAgentID != "" && item.AssignedAgentID != filter.AssignedAgentID {
			continue
		}
		if filter.ParticipantID != "" && item.AssignedAgentID != filter.ParticipantID && item.CreatedBy != filter.ParticipantID && !ticketContainsString(item.CollaboratorIDs, filter.ParticipantID) {
			continue
		}
		if !ticketMatchesView(item, filter.View, filter.ViewerID) {
			continue
		}
		if filter.Status != "" && item.Status != filter.Status {
			continue
		}
		if filter.Priority != "" && item.Priority != filter.Priority {
			continue
		}
		if query != "" && !strings.Contains(strings.ToLower(item.Title+" "+item.Category+" "+item.Description+" "+item.CustomerName+" "+item.CustomerEmail+" "+item.OrderNumber), query) {
			continue
		}
		item.Attachments = append([]TicketAttachment(nil), item.Attachments...)
		item.CollaboratorIDs = append([]string(nil), item.CollaboratorIDs...)
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	if filter.PageSize > 0 {
		start := (max(filter.Page, 1) - 1) * filter.PageSize
		if start >= len(out) {
			return []Ticket{}, nil
		}
		end := min(start+filter.PageSize, len(out))
		out = out[start:end]
	}
	return out, nil
}

func (s *MemoryStore) GetTicketSummary(ctx context.Context, filter TicketFilter) (TicketSummary, error) {
	if err := ctx.Err(); err != nil {
		return TicketSummary{}, err
	}
	filter.Page, filter.PageSize = 1, 0
	items, err := s.ListTickets(ctx, filter)
	if err != nil {
		return TicketSummary{}, err
	}
	summary := TicketSummary{Total: len(items)}
	now := time.Now().UTC()
	for _, item := range items {
		switch item.Type {
		case TicketTypeInternal:
			summary.Internal++
		default:
			summary.Customer++
		}
		switch item.Status {
		case TicketStatusOpen:
			summary.Open++
		case TicketStatusInProgress:
			summary.InProgress++
		case TicketStatusPendingReview:
			summary.PendingReview++
		}
		if item.AssignedAgentID == filter.ViewerID && (item.Status == TicketStatusInProgress || item.Status == TicketStatusPending) {
			summary.Mine++
		}
		if item.AssignedAgentID == filter.ViewerID && item.Status == TicketStatusOpen {
			summary.WaitingForMe++
		}
		if item.CreatedBy == filter.ViewerID && item.Status == TicketStatusPendingReview {
			summary.ReviewForMe++
		}
		if item.CreatedBy == filter.ViewerID {
			summary.CreatedByMe++
		}
		if ticketStatusActive(item.Status) {
			summary.Active++
		} else {
			summary.Completed++
		}
		if item.DueAt != nil && item.DueAt.Before(now) && !map[string]bool{TicketStatusResolved: true, TicketStatusClosed: true, TicketStatusCancelled: true}[item.Status] {
			summary.Overdue++
		}
	}
	return summary, nil
}

func (s *MemoryStore) UpdateTicket(ctx context.Context, id string, input TicketUpdate) (Ticket, error) {
	if err := ctx.Err(); err != nil {
		return Ticket{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.tickets[strings.TrimSpace(id)]
	if !ok {
		return Ticket{}, ErrNotFound
	}
	if strings.TrimSpace(input.Title) != "" {
		item.Title = strings.TrimSpace(input.Title)
	}
	if input.SetType {
		item.Type = strings.TrimSpace(input.Type)
	}
	if input.SetParentTicketID {
		item.ParentTicketID = strings.TrimSpace(input.ParentTicketID)
	}
	if input.SetConversationID {
		item.ConversationID = strings.TrimSpace(input.ConversationID)
	}
	if strings.TrimSpace(input.Category) != "" {
		item.Category = strings.TrimSpace(input.Category)
	}
	if strings.TrimSpace(input.Priority) != "" {
		item.Priority = strings.TrimSpace(input.Priority)
	}
	if strings.TrimSpace(input.Status) != "" {
		item.Status = strings.TrimSpace(input.Status)
	}
	if input.AssignedGroup != "" {
		item.AssignedGroup = strings.TrimSpace(input.AssignedGroup)
	}
	if input.SetAssignedAgentID {
		item.AssignedAgentID = strings.TrimSpace(input.AssignedAgentID)
	}
	if input.SetHandoffFromID {
		item.HandoffFromAgentID = strings.TrimSpace(input.HandoffFromAgentID)
	}
	if input.SetCollaboratorIDs {
		item.CollaboratorIDs = append([]string(nil), input.CollaboratorIDs...)
	}
	if input.Description != "" {
		item.Description = strings.TrimSpace(input.Description)
	}
	if input.SetDueAt {
		item.DueAt = input.DueAt
	}
	if input.SetWaitingReason {
		item.WaitingReason = strings.TrimSpace(input.WaitingReason)
	}
	if input.RequiresAcceptance != nil {
		item.RequiresAcceptance = *input.RequiresAcceptance
	}
	if input.SetAcceptedAt {
		item.AcceptedAt = input.AcceptedAt
	}
	if input.SetCompletedBy {
		item.CompletedBy = strings.TrimSpace(input.CompletedBy)
	}
	if input.SetCompletedAt {
		item.CompletedAt = input.CompletedAt
	}
	if input.SetCancelledAt {
		item.CancelledAt = input.CancelledAt
	}
	var err error
	item, err = normalizeTicket(item)
	if err != nil {
		return Ticket{}, err
	}
	item.UpdatedAt = time.Now().UTC()
	s.tickets[item.ID] = item
	return item, nil
}

func (s *MemoryStore) AcceptTicket(ctx context.Context, id string, userID string) (Ticket, *Conversation, error) {
	if err := ctx.Err(); err != nil {
		return Ticket{}, nil, err
	}
	id, userID = strings.TrimSpace(id), strings.TrimSpace(userID)
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.tickets[id]
	if !ok {
		return Ticket{}, nil, ErrNotFound
	}
	if item.AssignedAgentID != userID {
		return Ticket{}, nil, fmt.Errorf("%w: ticket belongs to another agent", ErrForbidden)
	}
	if item.Status != TicketStatusOpen {
		return Ticket{}, nil, fmt.Errorf("%w: ticket is no longer waiting for acceptance", ErrConflict)
	}
	now := time.Now().UTC()
	var acceptedConversation *Conversation
	if item.Type == TicketTypeCustomer && item.ConversationID != "" {
		conversation, exists := s.conversations[item.ConversationID]
		if !exists {
			return Ticket{}, nil, ErrNotFound
		}
		if conversation.Status != ConversationStatusAssigned {
			return Ticket{}, nil, fmt.Errorf("%w: linked conversation is no longer active", ErrConflict)
		}
		sourceAgentID := strings.TrimSpace(item.HandoffFromAgentID)
		if sourceAgentID == "" {
			sourceAgentID = conversation.AssignedAgentID
		}
		if conversation.AssignedAgentID != userID {
			if conversation.AssignedAgentID != sourceAgentID {
				return Ticket{}, nil, fmt.Errorf("%w: linked conversation has already been reassigned", ErrConflict)
			}
			conversation.AssignedAgentID = userID
			conversation.UpdatedAt = now
			s.conversations[conversation.ID] = conversation
		}
		copy := conversation
		acceptedConversation = &copy
	}
	item.Status = TicketStatusInProgress
	item.WaitingReason = ""
	item.AcceptedAt = &now
	item.UpdatedAt = now
	s.tickets[item.ID] = item
	return item, acceptedConversation, nil
}

func (s *MemoryStore) AddTicketComment(ctx context.Context, input TicketComment) (TicketComment, error) {
	if err := ctx.Err(); err != nil {
		return TicketComment{}, err
	}
	input.TicketID, input.AuthorID, input.Body = strings.TrimSpace(input.TicketID), strings.TrimSpace(input.AuthorID), strings.TrimSpace(input.Body)
	if input.TicketID == "" || input.AuthorID == "" || input.Body == "" {
		return TicketComment{}, fmt.Errorf("%w: ticket comment is required", ErrInvalid)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, ok := s.tickets[input.TicketID]; !ok {
		return TicketComment{}, ErrNotFound
	}
	if input.ID == "" {
		input.ID = s.newIDLocked("comment")
	}
	input.Kind = defaultString(strings.TrimSpace(input.Kind), TicketCommentKindComment)
	input.CreatedAt = time.Now().UTC()
	s.ticketComments[input.TicketID] = append(s.ticketComments[input.TicketID], input)
	return input, nil
}

func (s *MemoryStore) ListTicketComments(ctx context.Context, ticketID string) ([]TicketComment, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]TicketComment(nil), s.ticketComments[strings.TrimSpace(ticketID)]...), nil
}

func (s *PostgresStore) ListActiveSessionUserIDs(ctx context.Context, now time.Time) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT DISTINCT user_id FROM sessions WHERE expires_at > $1 ORDER BY user_id`, now.UTC())
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *PostgresStore) TransferConversation(ctx context.Context, id, fromAgentID, targetAgentID string) (Conversation, error) {
	row := s.db.QueryRowContext(ctx, `UPDATE conversations SET assigned_agent_id=$3, updated_at=$4 WHERE id=$1 AND status=$5 AND assigned_agent_id=$2 RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at`, strings.TrimSpace(id), strings.TrimSpace(fromAgentID), strings.TrimSpace(targetAgentID), time.Now().UTC(), ConversationStatusAssigned)
	item, err := scanConversation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Conversation{}, fmt.Errorf("%w: only the assigned agent can transfer the conversation", ErrConflict)
	}
	return item, err
}

func (s *PostgresStore) CreateTransferRequest(ctx context.Context, input TransferRequest) (TransferRequest, error) {
	if input.ID == "" {
		input.ID = prefixedID("transfer")
	}
	now := time.Now().UTC()
	input.Status, input.CreatedAt, input.UpdatedAt = TransferStatusPending, now, now
	_, err := s.db.ExecContext(ctx, `INSERT INTO transfer_requests (id,conversation_id,shop_id,from_agent_id,target_agent_id,target_skill_group,status,note,resolved_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$9)`, input.ID, input.ConversationID, input.ShopID, input.FromAgentID, input.TargetAgentID, input.TargetSkillGroup, input.Status, input.Note, now)
	if err != nil {
		if isUniqueConstraintError(err) {
			return TransferRequest{}, fmt.Errorf("%w: conversation already has a pending transfer", ErrConflict)
		}
		return TransferRequest{}, err
	}
	return input, nil
}

func (s *PostgresStore) GetTransferRequest(ctx context.Context, id string) (TransferRequest, error) {
	return scanTransferRequest(s.db.QueryRowContext(ctx, `SELECT id,conversation_id,shop_id,from_agent_id,target_agent_id,target_skill_group,status,note,resolved_by,created_at,updated_at FROM transfer_requests WHERE id=$1`, strings.TrimSpace(id)))
}

func (s *PostgresStore) ListTransferRequests(ctx context.Context, userID, conversationID, status string) ([]TransferRequest, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,conversation_id,shop_id,from_agent_id,target_agent_id,target_skill_group,status,note,resolved_by,created_at,updated_at FROM transfer_requests WHERE ($1='' OR conversation_id=$1) AND ($2='' OR status=$2) AND ($3='' OR target_agent_id=$3 OR target_skill_group<>'') ORDER BY created_at DESC`, strings.TrimSpace(conversationID), strings.TrimSpace(status), strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TransferRequest{}
	for rows.Next() {
		item, err := scanTransferRequest(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ResolveTransferRequest(ctx context.Context, id, status, resolvedBy string) (TransferRequest, error) {
	if !validTransferResolution(status) {
		return TransferRequest{}, fmt.Errorf("%w: invalid transfer status", ErrInvalid)
	}
	item, err := scanTransferRequest(s.db.QueryRowContext(ctx, `UPDATE transfer_requests SET status=$2,resolved_by=$3,updated_at=$4 WHERE id=$1 AND status=$5 RETURNING id,conversation_id,shop_id,from_agent_id,target_agent_id,target_skill_group,status,note,resolved_by,created_at,updated_at`, strings.TrimSpace(id), status, strings.TrimSpace(resolvedBy), time.Now().UTC(), TransferStatusPending))
	if errors.Is(err, sql.ErrNoRows) {
		return TransferRequest{}, fmt.Errorf("%w: transfer request is already resolved", ErrConflict)
	}
	return item, err
}

func (s *PostgresStore) CreateTicket(ctx context.Context, input Ticket) (Ticket, error) {
	var err error
	input, err = normalizeTicket(input)
	if err != nil {
		return Ticket{}, err
	}
	if input.ID == "" {
		input.ID = prefixedID("ticket")
	}
	now := time.Now().UTC()
	input.CreatedAt, input.UpdatedAt = now, now
	attachments, _ := json.Marshal(input.Attachments)
	collaborators, _ := json.Marshal(input.CollaboratorIDs)
	_, err = s.db.ExecContext(ctx, `INSERT INTO tickets (id,ticket_type,parent_ticket_id,conversation_id,shop_id,customer_ref,customer_name,customer_email,order_number,title,category,priority,status,assigned_group,assigned_agent_id,handoff_from_agent_id,collaborator_ids,description,attachments,due_at,waiting_reason,requires_acceptance,accepted_at,completed_by,completed_at,cancelled_at,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,NULLIF($5,''),$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$28)`, input.ID, input.Type, input.ParentTicketID, input.ConversationID, input.ShopID, input.CustomerRef, input.CustomerName, input.CustomerEmail, input.OrderNumber, input.Title, input.Category, input.Priority, input.Status, input.AssignedGroup, input.AssignedAgentID, input.HandoffFromAgentID, collaborators, input.Description, attachments, input.DueAt, input.WaitingReason, input.RequiresAcceptance, input.AcceptedAt, input.CompletedBy, input.CompletedAt, input.CancelledAt, input.CreatedBy, now)
	return input, err
}

func (s *PostgresStore) GetTicket(ctx context.Context, id string) (Ticket, error) {
	return scanTicket(s.db.QueryRowContext(ctx, ticketSelect+` WHERE id=$1`, strings.TrimSpace(id)))
}

func (s *PostgresStore) ListTickets(ctx context.Context, filter TicketFilter) ([]Ticket, error) {
	pageSize := filter.PageSize
	offset := 0
	if pageSize > 0 {
		offset = (max(filter.Page, 1) - 1) * pageSize
	}
	rows, err := s.db.QueryContext(ctx, ticketSelect+` WHERE ($1='' OR ticket_type=$1) AND ($2='' OR shop_id=$2) AND ($3='' OR conversation_id=$3) AND ($4='' OR assigned_agent_id=$4) AND ($5='' OR assigned_agent_id=$5 OR created_by=$5 OR collaborator_ids ? $5) AND ($6='' OR status=$6) AND ($7='' OR priority=$7) AND ($8='' OR lower(title||' '||category||' '||description||' '||customer_name||' '||customer_email||' '||order_number) LIKE '%'||lower($8)||'%') AND (
		$9='' OR
		($9='mine' AND assigned_agent_id=$10 AND status IN ('in_progress','pending')) OR
		($9='waiting_for_me' AND assigned_agent_id=$10 AND status='open') OR
		($9='review_for_me' AND created_by=$10 AND status='pending_review') OR
		($9='created_by_me' AND created_by=$10) OR
		($9='active' AND status NOT IN ('resolved','closed','cancelled')) OR
		($9='completed' AND status IN ('resolved','closed','cancelled'))
	) ORDER BY updated_at DESC LIMIT NULLIF($11,0) OFFSET $12`, filter.Type, filter.ShopID, filter.ConversationID, filter.AssignedAgentID, filter.ParticipantID, filter.Status, filter.Priority, filter.Search, filter.View, filter.ViewerID, pageSize, offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Ticket{}
	for rows.Next() {
		item, err := scanTicket(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *PostgresStore) GetTicketSummary(ctx context.Context, filter TicketFilter) (TicketSummary, error) {
	var summary TicketSummary
	err := s.db.QueryRowContext(ctx, `SELECT
		COUNT(*),
		COUNT(*) FILTER (WHERE ticket_type='customer'),
		COUNT(*) FILTER (WHERE ticket_type='internal'),
		COUNT(*) FILTER (WHERE status='open'),
		COUNT(*) FILTER (WHERE status='in_progress'),
		COUNT(*) FILTER (WHERE status='pending_review'),
		COUNT(*) FILTER (WHERE due_at IS NOT NULL AND due_at < $9 AND status NOT IN ('resolved','closed','cancelled')),
		COUNT(*) FILTER (WHERE assigned_agent_id=$10 AND status IN ('in_progress','pending')),
		COUNT(*) FILTER (WHERE assigned_agent_id=$10 AND status='open'),
		COUNT(*) FILTER (WHERE created_by=$10 AND status='pending_review'),
		COUNT(*) FILTER (WHERE created_by=$10),
		COUNT(*) FILTER (WHERE status NOT IN ('resolved','closed','cancelled')),
		COUNT(*) FILTER (WHERE status IN ('resolved','closed','cancelled'))
	FROM tickets
	WHERE ($1='' OR ticket_type=$1)
	  AND ($2='' OR shop_id=$2)
	  AND ($3='' OR conversation_id=$3)
	  AND ($4='' OR assigned_agent_id=$4)
	  AND ($5='' OR assigned_agent_id=$5 OR created_by=$5 OR collaborator_ids ? $5)
	  AND ($6='' OR status=$6)
	  AND ($7='' OR priority=$7)
	  AND ($8='' OR lower(title||' '||category||' '||description||' '||customer_name||' '||customer_email||' '||order_number) LIKE '%'||lower($8)||'%')`,
		filter.Type, filter.ShopID, filter.ConversationID, filter.AssignedAgentID, filter.ParticipantID, filter.Status, filter.Priority, filter.Search, time.Now().UTC(), filter.ViewerID,
	).Scan(&summary.Total, &summary.Customer, &summary.Internal, &summary.Open, &summary.InProgress, &summary.PendingReview, &summary.Overdue, &summary.Mine, &summary.WaitingForMe, &summary.ReviewForMe, &summary.CreatedByMe, &summary.Active, &summary.Completed)
	return summary, err
}

func (s *PostgresStore) UpdateTicket(ctx context.Context, id string, input TicketUpdate) (Ticket, error) {
	current, err := s.GetTicket(ctx, id)
	if err != nil {
		return Ticket{}, err
	}
	if strings.TrimSpace(input.Title) != "" {
		current.Title = strings.TrimSpace(input.Title)
	}
	if input.SetType {
		current.Type = strings.TrimSpace(input.Type)
	}
	if input.SetParentTicketID {
		current.ParentTicketID = strings.TrimSpace(input.ParentTicketID)
	}
	if input.SetConversationID {
		current.ConversationID = strings.TrimSpace(input.ConversationID)
	}
	if strings.TrimSpace(input.Category) != "" {
		current.Category = strings.TrimSpace(input.Category)
	}
	if strings.TrimSpace(input.Priority) != "" {
		current.Priority = strings.TrimSpace(input.Priority)
	}
	if strings.TrimSpace(input.Status) != "" {
		current.Status = strings.TrimSpace(input.Status)
	}
	if input.AssignedGroup != "" {
		current.AssignedGroup = strings.TrimSpace(input.AssignedGroup)
	}
	if input.SetAssignedAgentID {
		current.AssignedAgentID = strings.TrimSpace(input.AssignedAgentID)
	}
	if input.SetHandoffFromID {
		current.HandoffFromAgentID = strings.TrimSpace(input.HandoffFromAgentID)
	}
	if input.SetCollaboratorIDs {
		current.CollaboratorIDs = append([]string(nil), input.CollaboratorIDs...)
	}
	if input.Description != "" {
		current.Description = strings.TrimSpace(input.Description)
	}
	if input.SetDueAt {
		current.DueAt = input.DueAt
	}
	if input.SetWaitingReason {
		current.WaitingReason = strings.TrimSpace(input.WaitingReason)
	}
	if input.RequiresAcceptance != nil {
		current.RequiresAcceptance = *input.RequiresAcceptance
	}
	if input.SetAcceptedAt {
		current.AcceptedAt = input.AcceptedAt
	}
	if input.SetCompletedBy {
		current.CompletedBy = strings.TrimSpace(input.CompletedBy)
	}
	if input.SetCompletedAt {
		current.CompletedAt = input.CompletedAt
	}
	if input.SetCancelledAt {
		current.CancelledAt = input.CancelledAt
	}
	current, err = normalizeTicket(current)
	if err != nil {
		return Ticket{}, err
	}
	current.UpdatedAt = time.Now().UTC()
	collaborators, _ := json.Marshal(current.CollaboratorIDs)
	return scanTicket(s.db.QueryRowContext(ctx, `UPDATE tickets SET ticket_type=$2,parent_ticket_id=$3,conversation_id=$4,title=$5,category=$6,priority=$7,status=$8,assigned_group=$9,assigned_agent_id=$10,handoff_from_agent_id=$11,collaborator_ids=$12,description=$13,due_at=$14,waiting_reason=$15,requires_acceptance=$16,accepted_at=$17,completed_by=$18,completed_at=$19,cancelled_at=$20,updated_at=$21 WHERE id=$1 RETURNING `+ticketColumns, id, current.Type, current.ParentTicketID, current.ConversationID, current.Title, current.Category, current.Priority, current.Status, current.AssignedGroup, current.AssignedAgentID, current.HandoffFromAgentID, collaborators, current.Description, current.DueAt, current.WaitingReason, current.RequiresAcceptance, current.AcceptedAt, current.CompletedBy, current.CompletedAt, current.CancelledAt, current.UpdatedAt))
}

func (s *PostgresStore) AcceptTicket(ctx context.Context, id string, userID string) (Ticket, *Conversation, error) {
	id, userID = strings.TrimSpace(id), strings.TrimSpace(userID)
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Ticket{}, nil, err
	}
	defer func() { _ = tx.Rollback() }()
	item, err := scanTicket(tx.QueryRowContext(ctx, ticketSelect+` WHERE id=$1 FOR UPDATE`, id))
	if err != nil {
		return Ticket{}, nil, err
	}
	if item.AssignedAgentID != userID {
		return Ticket{}, nil, fmt.Errorf("%w: ticket belongs to another agent", ErrForbidden)
	}
	if item.Status != TicketStatusOpen {
		return Ticket{}, nil, fmt.Errorf("%w: ticket is no longer waiting for acceptance", ErrConflict)
	}
	now := time.Now().UTC()
	var acceptedConversation *Conversation
	if item.Type == TicketTypeCustomer && item.ConversationID != "" {
		conversation, scanErr := scanConversation(tx.QueryRowContext(ctx, `SELECT id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at FROM conversations WHERE id=$1 FOR UPDATE`, item.ConversationID))
		if scanErr != nil {
			return Ticket{}, nil, scanErr
		}
		if conversation.Status != ConversationStatusAssigned {
			return Ticket{}, nil, fmt.Errorf("%w: linked conversation is no longer active", ErrConflict)
		}
		sourceAgentID := strings.TrimSpace(item.HandoffFromAgentID)
		if sourceAgentID == "" {
			sourceAgentID = conversation.AssignedAgentID
		}
		if conversation.AssignedAgentID != userID {
			if conversation.AssignedAgentID != sourceAgentID {
				return Ticket{}, nil, fmt.Errorf("%w: linked conversation has already been reassigned", ErrConflict)
			}
			conversation, scanErr = scanConversation(tx.QueryRowContext(ctx, `UPDATE conversations SET assigned_agent_id=$2,updated_at=$3 WHERE id=$1 RETURNING id, shop_id, source_id, customer_name, customer_email, subject, status, assigned_agent_id, last_message_at, created_at, updated_at, kind, reply_allowed, classification_reason, record_primary, record_secondary, record_tertiary, record_remark, record_classified, record_auto_filled, record_updated_at, record_updated_by, record_order_number, closed_at`, conversation.ID, userID, now))
			if scanErr != nil {
				return Ticket{}, nil, scanErr
			}
		}
		acceptedConversation = &conversation
	}
	item, err = scanTicket(tx.QueryRowContext(ctx, `UPDATE tickets SET status=$2,waiting_reason='',accepted_at=$3,updated_at=$3 WHERE id=$1 RETURNING `+ticketColumns, id, TicketStatusInProgress, now))
	if err != nil {
		return Ticket{}, nil, err
	}
	if err := tx.Commit(); err != nil {
		return Ticket{}, nil, err
	}
	return item, acceptedConversation, nil
}

func (s *PostgresStore) AddTicketComment(ctx context.Context, input TicketComment) (TicketComment, error) {
	input.TicketID = strings.TrimSpace(input.TicketID)
	input.AuthorID = strings.TrimSpace(input.AuthorID)
	input.Body = strings.TrimSpace(input.Body)
	if input.Body == "" {
		return TicketComment{}, fmt.Errorf("%w: ticket comment is required", ErrInvalid)
	}
	if input.ID == "" {
		input.ID = prefixedID("comment")
	}
	input.Kind = defaultString(strings.TrimSpace(input.Kind), TicketCommentKindComment)
	input.CreatedAt = time.Now().UTC()
	_, err := s.db.ExecContext(ctx, `INSERT INTO ticket_comments (id,ticket_id,author_id,kind,body,created_at) VALUES ($1,$2,$3,$4,$5,$6)`, input.ID, input.TicketID, input.AuthorID, input.Kind, input.Body, input.CreatedAt)
	return input, err
}

func (s *PostgresStore) ListTicketComments(ctx context.Context, ticketID string) ([]TicketComment, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id,ticket_id,author_id,kind,body,created_at FROM ticket_comments WHERE ticket_id=$1 ORDER BY created_at`, strings.TrimSpace(ticketID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []TicketComment{}
	for rows.Next() {
		var item TicketComment
		if err := rows.Scan(&item.ID, &item.TicketID, &item.AuthorID, &item.Kind, &item.Body, &item.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

const ticketColumns = `id,ticket_type,parent_ticket_id,conversation_id,COALESCE(shop_id,''),customer_ref,customer_name,customer_email,order_number,title,category,priority,status,assigned_group,assigned_agent_id,handoff_from_agent_id,collaborator_ids,description,attachments,due_at,waiting_reason,requires_acceptance,accepted_at,completed_by,completed_at,cancelled_at,created_by,created_at,updated_at`
const ticketSelect = `SELECT ` + ticketColumns + ` FROM tickets`

type rowScanner interface{ Scan(dest ...any) error }

func scanTransferRequest(row rowScanner) (TransferRequest, error) {
	var item TransferRequest
	err := row.Scan(&item.ID, &item.ConversationID, &item.ShopID, &item.FromAgentID, &item.TargetAgentID, &item.TargetSkillGroup, &item.Status, &item.Note, &item.ResolvedBy, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return TransferRequest{}, ErrNotFound
	}
	return item, err
}
func scanTicket(row rowScanner) (Ticket, error) {
	var item Ticket
	var rawCollaborators, rawAttachments []byte
	err := row.Scan(&item.ID, &item.Type, &item.ParentTicketID, &item.ConversationID, &item.ShopID, &item.CustomerRef, &item.CustomerName, &item.CustomerEmail, &item.OrderNumber, &item.Title, &item.Category, &item.Priority, &item.Status, &item.AssignedGroup, &item.AssignedAgentID, &item.HandoffFromAgentID, &rawCollaborators, &item.Description, &rawAttachments, &item.DueAt, &item.WaitingReason, &item.RequiresAcceptance, &item.AcceptedAt, &item.CompletedBy, &item.CompletedAt, &item.CancelledAt, &item.CreatedBy, &item.CreatedAt, &item.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return Ticket{}, ErrNotFound
	}
	if err == nil && len(rawCollaborators) > 0 {
		err = json.Unmarshal(rawCollaborators, &item.CollaboratorIDs)
	}
	if err == nil && len(rawAttachments) > 0 {
		err = json.Unmarshal(rawAttachments, &item.Attachments)
	}
	if item.Attachments == nil {
		item.Attachments = []TicketAttachment{}
	}
	if item.CollaboratorIDs == nil {
		item.CollaboratorIDs = []string{}
	}
	return item, err
}

func validTransferResolution(status string) bool {
	return status == TransferStatusAccepted || status == TransferStatusRejected || status == TransferStatusCancelled || status == TransferStatusCompleted
}
func normalizeTicket(input Ticket) (Ticket, error) {
	input.Type = defaultString(strings.TrimSpace(input.Type), TicketTypeCustomer)
	input.ParentTicketID = strings.TrimSpace(input.ParentTicketID)
	input.ConversationID = strings.TrimSpace(input.ConversationID)
	input.ShopID = strings.TrimSpace(input.ShopID)
	input.CustomerRef = strings.TrimSpace(input.CustomerRef)
	input.CustomerName = strings.TrimSpace(input.CustomerName)
	input.CustomerEmail = normalizeEmail(input.CustomerEmail)
	if input.CustomerRef == "" && input.CustomerEmail != "" {
		input.CustomerRef = "email:" + input.CustomerEmail
	}
	if input.CustomerRef == "" && input.ConversationID != "" {
		input.CustomerRef = "conversation:" + input.ConversationID
	}
	input.Title = strings.TrimSpace(input.Title)
	defaultCategory := "其他"
	if input.Type == TicketTypeInternal {
		defaultCategory = "内部事务"
	}
	input.Category = defaultString(strings.TrimSpace(input.Category), defaultCategory)
	input.Priority = defaultString(strings.TrimSpace(input.Priority), "normal")
	input.Status = defaultString(strings.TrimSpace(input.Status), TicketStatusOpen)
	input.Description = strings.TrimSpace(input.Description)
	input.AssignedAgentID = strings.TrimSpace(input.AssignedAgentID)
	input.HandoffFromAgentID = strings.TrimSpace(input.HandoffFromAgentID)
	input.WaitingReason = strings.TrimSpace(input.WaitingReason)
	input.CollaboratorIDs = normalizeTicketCollaborators(input.AssignedAgentID, input.CollaboratorIDs)
	if !map[string]bool{TicketTypeCustomer: true, TicketTypeInternal: true}[input.Type] {
		return Ticket{}, fmt.Errorf("%w: invalid ticket type", ErrInvalid)
	}
	if input.Title == "" || input.Description == "" || (input.Type == TicketTypeCustomer && input.ShopID == "") {
		return Ticket{}, fmt.Errorf("%w: ticket title and description are required; customer tickets also require a shop", ErrInvalid)
	}
	if input.Type == TicketTypeInternal && input.AssignedAgentID == "" {
		return Ticket{}, fmt.Errorf("%w: internal task owner is required", ErrInvalid)
	}
	if !map[string]bool{"low": true, "normal": true, "high": true, "urgent": true}[input.Priority] {
		return Ticket{}, fmt.Errorf("%w: invalid ticket priority", ErrInvalid)
	}
	if !map[string]bool{TicketStatusOpen: true, TicketStatusInProgress: true, TicketStatusPending: true, TicketStatusPendingReview: true, TicketStatusResolved: true, TicketStatusClosed: true, TicketStatusCancelled: true}[input.Status] {
		return Ticket{}, fmt.Errorf("%w: invalid ticket status", ErrInvalid)
	}
	if input.Attachments == nil {
		input.Attachments = []TicketAttachment{}
	}
	if input.CollaboratorIDs == nil {
		input.CollaboratorIDs = []string{}
	}
	return input, nil
}

func ticketMatchesView(item Ticket, view string, viewerID string) bool {
	switch strings.TrimSpace(view) {
	case "", "all":
		return true
	case "mine":
		return item.AssignedAgentID == viewerID && (item.Status == TicketStatusInProgress || item.Status == TicketStatusPending)
	case "waiting_for_me":
		return item.AssignedAgentID == viewerID && item.Status == TicketStatusOpen
	case "review_for_me":
		return item.CreatedBy == viewerID && item.Status == TicketStatusPendingReview
	case "created_by_me":
		return item.CreatedBy == viewerID
	case "active":
		return ticketStatusActive(item.Status)
	case "completed":
		return !ticketStatusActive(item.Status)
	default:
		return false
	}
}

func ticketStatusActive(status string) bool {
	return status != TicketStatusResolved && status != TicketStatusClosed && status != TicketStatusCancelled
}

func normalizeTicketCollaborators(ownerID string, values []string) []string {
	ownerID = strings.TrimSpace(ownerID)
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || value == ownerID || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	sort.Strings(out)
	return out
}

func ticketContainsString(values []string, target string) bool {
	target = strings.TrimSpace(target)
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
