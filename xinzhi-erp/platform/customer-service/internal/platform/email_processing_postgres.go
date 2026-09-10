package platform

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const emailProcessingCategoryExpression = `CASE
	WHEN c.classification_reason = 'verification code or authentication notice'
		OR (c.classification_reason || E'\n' || c.subject) ~* '(verification|security|authentication|one[- ]?time|login|sign[- ]?in|confirm|验证码|动态码|安全码|登录码|确认码).{0,32}(code|password|pin|验证码|动态码|安全码|登录码|确认码)|(^|[^[:alnum:]_])(otp|2fa|mfa)($|[^[:alnum:]_])'
	THEN 'verification'
	WHEN c.classification_reason IN ('automated email pending review', 'suspected marketing email pending review') THEN 'other'
	WHEN (c.classification_reason || E'\n' || c.subject) ~* '(^|[^[:alnum:]_])(security|password|login|sign[- ]?in|new device|account access|suspicious|unauthorized|安全|密码|登录|新设备|异常访问)($|[^[:alnum:]_])' THEN 'security'
	WHEN (c.classification_reason || E'\n' || c.subject) ~* '(^|[^[:alnum:]_])(payment|payout|refund|chargeback|dispute|invoice|billing|subscription|付款|收款|退款|拒付|争议|账单|订阅)($|[^[:alnum:]_])' THEN 'payment'
	WHEN (c.classification_reason || E'\n' || c.subject) ~* '(^|[^[:alnum:]_])(shipment|shipping|delivery|fulfillment|tracking|inventory|stock|物流|配送|履约|运单|库存)($|[^[:alnum:]_])' THEN 'logistics'
	WHEN c.classification_reason = 'automated platform or account notification' THEN 'platform'
	ELSE 'other'
END`

const emailProcessingPostgresCandidates = `
	WITH candidates AS (
		SELECT
			c.id, c.shop_id, c.source_id, c.customer_name, c.customer_email, c.subject,
			c.status, c.assigned_agent_id, c.last_message_at, c.created_at, c.updated_at,
			c.kind, c.reply_allowed, c.classification_reason, c.record_primary, c.record_secondary,
			c.record_tertiary, c.record_remark, c.record_classified, c.record_auto_filled,
			c.record_updated_at, c.record_updated_by, c.record_order_number, c.closed_at,
			sh.display_name AS shop_name, src.address AS source_address, src.provider,
			COALESCE(tags.tags, '[]'::jsonb) AS tags,
			$4::text AS unread_user_id,
			` + emailProcessingCategoryExpression + ` AS category
		FROM conversations c
		JOIN shop_sources src ON src.id = c.source_id AND src.type = 'email'
		JOIN shops sh ON sh.id = c.shop_id
		LEFT JOIN conversation_email_tags tags ON tags.conversation_id = c.id
		WHERE c.kind = 'system'
		  AND ($1 = '' OR c.shop_id = $1)
		  AND ($2 = '' OR c.source_id = $2)
		  AND ($3 = '' OR EXISTS (
			SELECT 1 FROM shop_agents scope_sa
			JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
			WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $3
		  ))
		  AND ($5 = '' OR LOWER(CONCAT_WS(E'\n', c.customer_name, c.customer_email, c.subject,
			sh.display_name, sh.external_id, src.address, src.provider)) LIKE '%' || $5 || '%')
	), filtered AS (
		SELECT * FROM candidates candidate
		WHERE ($6 = '' OR ($6 = 'closed' AND candidate.status = 'closed') OR ($6 = 'open' AND candidate.status <> 'closed'))
		  AND ($7 = '' OR candidate.category = $7)
		  AND ($8 = '' OR EXISTS (
			SELECT 1 FROM jsonb_array_elements(candidate.tags) tag
			WHERE LOWER(BTRIM(tag->>'label')) = LOWER(BTRIM($8))
		  ))
	)
`

func (s *PostgresStore) QueryEmailProcessing(ctx context.Context, filter emailProcessingFilter, scopeUserID string, unreadUserID string) ([]emailProcessingQueryRow, int, int, []EmailProcessingTag, error) {
	if strings.TrimSpace(filter.Category) == "" && strings.TrimSpace(filter.Tag) == "" {
		return s.queryEmailProcessingFast(ctx, filter, scopeUserID, unreadUserID)
	}
	args := []any{
		strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.TrimSpace(scopeUserID),
		strings.TrimSpace(unreadUserID), strings.ToLower(strings.TrimSpace(filter.Search)), strings.TrimSpace(filter.Status),
		strings.TrimSpace(filter.Category), strings.TrimSpace(filter.Tag),
	}
	var total int
	var openCount int
	if err := s.db.QueryRowContext(ctx, emailProcessingPostgresCandidates+`
		SELECT (SELECT COUNT(*) FROM filtered), (SELECT COUNT(*) FROM candidates WHERE status <> 'closed')
	`, args...).Scan(&total, &openCount); err != nil {
		return nil, 0, 0, nil, fmt.Errorf("count email processing rows: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 30
	}
	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * pageSize
	rows, err := s.db.QueryContext(ctx, emailProcessingPostgresCandidates+`
		SELECT filtered.id, filtered.shop_id, filtered.source_id, filtered.customer_name, filtered.customer_email,
			filtered.subject, filtered.status, filtered.assigned_agent_id, filtered.last_message_at, filtered.created_at,
			filtered.updated_at, filtered.kind, filtered.reply_allowed, filtered.classification_reason,
			filtered.record_primary, filtered.record_secondary, filtered.record_tertiary, filtered.record_remark,
			filtered.record_classified, filtered.record_auto_filled, filtered.record_updated_at,
			filtered.record_updated_by, filtered.record_order_number, filtered.closed_at,
			COALESCE((SELECT MAX(customer_message.created_at) FROM messages customer_message
				WHERE customer_message.conversation_id = filtered.id AND LOWER(customer_message.direction) = 'customer'), filtered.last_message_at),
			COALESCE((SELECT LOWER(latest_message.direction) FROM messages latest_message
				WHERE latest_message.conversation_id = filtered.id AND LOWER(latest_message.direction) IN ('customer', 'agent')
				ORDER BY latest_message.created_at DESC, latest_message.id DESC LIMIT 1), ''),
			CASE WHEN filtered.unread_user_id = '' THEN FALSE ELSE EXISTS (
				SELECT 1 FROM messages unread_message
				LEFT JOIN conversation_reads read_state ON read_state.conversation_id = filtered.id AND read_state.user_id = filtered.unread_user_id
				WHERE unread_message.conversation_id = filtered.id
				  AND LOWER(unread_message.direction) IN ('customer', 'system')
				  AND (read_state.last_read_at IS NULL OR unread_message.created_at > read_state.last_read_at)
			) END,
			filtered.shop_name, filtered.source_address, filtered.provider, filtered.category,
			COALESCE((SELECT latest.body FROM messages latest WHERE latest.conversation_id = filtered.id
				ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1), ''), filtered.tags
		FROM filtered
		ORDER BY filtered.last_message_at DESC, filtered.created_at DESC, filtered.id ASC
		LIMIT $9 OFFSET $10
	`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, 0, nil, fmt.Errorf("query email processing rows: %w", err)
	}
	out, err := scanEmailProcessingQueryRows(rows, pageSize)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	tagOptions, err := s.queryEmailProcessingTagOptions(ctx, filter, scopeUserID)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	return out, total, openCount, tagOptions, nil
}

func (s *PostgresStore) queryEmailProcessingFast(ctx context.Context, filter emailProcessingFilter, scopeUserID string, unreadUserID string) ([]emailProcessingQueryRow, int, int, []EmailProcessingTag, error) {
	args := []any{
		strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.TrimSpace(scopeUserID),
		strings.TrimSpace(unreadUserID), strings.ToLower(strings.TrimSpace(filter.Search)), strings.TrimSpace(filter.Status),
	}
	var total int
	var openCount int
	countArgs := []any{args[0], args[1], args[2], args[4], args[5]}
	if err := s.db.QueryRowContext(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE $5 = '' OR ($5 = 'closed' AND c.status = 'closed') OR ($5 = 'open' AND c.status <> 'closed')),
			COUNT(*) FILTER (WHERE c.status <> 'closed')
		FROM conversations c
		JOIN shop_sources src ON src.id = c.source_id AND src.type = 'email'
		JOIN shops sh ON sh.id = c.shop_id
		WHERE c.kind = 'system'
		  AND ($1 = '' OR c.shop_id = $1)
		  AND ($2 = '' OR c.source_id = $2)
		  AND ($3 = '' OR EXISTS (
			SELECT 1 FROM shop_agents scope_sa
			JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
			WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $3
		  ))
		  AND ($4 = '' OR LOWER(CONCAT_WS(E'\n', c.customer_name, c.customer_email, c.subject,
			sh.display_name, sh.external_id, src.address, src.provider)) LIKE '%' || $4 || '%')
	`, countArgs...).Scan(&total, &openCount); err != nil {
		return nil, 0, 0, nil, fmt.Errorf("count email processing rows: %w", err)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if pageSize < 1 {
		pageSize = 30
	}
	totalPages := 1
	if total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	if page > totalPages {
		page = totalPages
	}
	offset := (page - 1) * pageSize
	rows, err := s.db.QueryContext(ctx, `
		WITH candidates AS (
			SELECT c.id, c.shop_id, c.source_id, c.customer_name, c.customer_email, c.subject,
				c.status, c.assigned_agent_id, c.last_message_at, c.created_at, c.updated_at,
				c.kind, c.reply_allowed, c.classification_reason, c.record_primary, c.record_secondary,
				c.record_tertiary, c.record_remark, c.record_classified, c.record_auto_filled,
				c.record_updated_at, c.record_updated_by, c.record_order_number, c.closed_at,
				sh.display_name AS shop_name, src.address AS source_address, src.provider,
				$4::text AS unread_user_id
			FROM conversations c
			JOIN shop_sources src ON src.id = c.source_id AND src.type = 'email'
			JOIN shops sh ON sh.id = c.shop_id
			WHERE c.kind = 'system'
			  AND ($1 = '' OR c.shop_id = $1)
			  AND ($2 = '' OR c.source_id = $2)
			  AND ($3 = '' OR EXISTS (
				SELECT 1 FROM shop_agents scope_sa
				JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
				WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $3
			  ))
			  AND ($5 = '' OR LOWER(CONCAT_WS(E'\n', c.customer_name, c.customer_email, c.subject,
				sh.display_name, sh.external_id, src.address, src.provider)) LIKE '%' || $5 || '%')
		), paged AS (
			SELECT * FROM candidates
			WHERE $6 = '' OR ($6 = 'closed' AND status = 'closed') OR ($6 = 'open' AND status <> 'closed')
			ORDER BY last_message_at DESC, created_at DESC, id ASC
			LIMIT $7 OFFSET $8
		)
		SELECT paged.id, paged.shop_id, paged.source_id, paged.customer_name, paged.customer_email,
			paged.subject, paged.status, paged.assigned_agent_id, paged.last_message_at, paged.created_at,
			paged.updated_at, paged.kind, paged.reply_allowed, paged.classification_reason,
			paged.record_primary, paged.record_secondary, paged.record_tertiary, paged.record_remark,
			paged.record_classified, paged.record_auto_filled, paged.record_updated_at,
			paged.record_updated_by, paged.record_order_number, paged.closed_at,
			COALESCE((SELECT MAX(customer_message.created_at) FROM messages customer_message
				WHERE customer_message.conversation_id = paged.id AND LOWER(customer_message.direction) = 'customer'), paged.last_message_at),
			COALESCE((SELECT LOWER(latest_message.direction) FROM messages latest_message
				WHERE latest_message.conversation_id = paged.id AND LOWER(latest_message.direction) IN ('customer', 'agent')
				ORDER BY latest_message.created_at DESC, latest_message.id DESC LIMIT 1), ''),
			CASE WHEN paged.unread_user_id = '' THEN FALSE ELSE EXISTS (
				SELECT 1 FROM messages unread_message
				LEFT JOIN conversation_reads read_state ON read_state.conversation_id = paged.id AND read_state.user_id = paged.unread_user_id
				WHERE unread_message.conversation_id = paged.id
				  AND LOWER(unread_message.direction) IN ('customer', 'system')
				  AND (read_state.last_read_at IS NULL OR unread_message.created_at > read_state.last_read_at)
			) END,
			paged.shop_name, paged.source_address, paged.provider,
			`+strings.ReplaceAll(emailProcessingCategoryExpression, "c.", "paged.")+`,
			COALESCE((SELECT latest.body FROM messages latest WHERE latest.conversation_id = paged.id
				ORDER BY latest.created_at DESC, latest.id DESC LIMIT 1), ''), COALESCE(tags.tags, '[]'::jsonb)
		FROM paged
		LEFT JOIN conversation_email_tags tags ON tags.conversation_id = paged.id
		ORDER BY paged.last_message_at DESC, paged.created_at DESC, paged.id ASC
	`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, 0, nil, fmt.Errorf("query email processing rows: %w", err)
	}
	out, err := scanEmailProcessingQueryRows(rows, pageSize)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	tagOptions, err := s.queryEmailProcessingTagOptions(ctx, filter, scopeUserID)
	if err != nil {
		return nil, 0, 0, nil, err
	}
	return out, total, openCount, tagOptions, nil
}

func scanEmailProcessingQueryRows(rows *sql.Rows, capacity int) ([]emailProcessingQueryRow, error) {
	defer rows.Close()
	out := make([]emailProcessingQueryRow, 0, capacity)
	for rows.Next() {
		var item emailProcessingQueryRow
		var customerLastMessageAt time.Time
		var lastMessageDirection string
		var tagsJSON []byte
		conversation, err := scanConversationValues(rows, &customerLastMessageAt, &lastMessageDirection, true,
			&item.ShopName, &item.SourceAddress, &item.Provider, &item.Category, &item.LatestBody, &tagsJSON)
		if err != nil {
			return nil, err
		}
		conversation.CustomerLastMessageAt = customerLastMessageAt
		conversation.LastMessageDirection = lastMessageDirection
		item.Conversation = conversation
		if err := json.Unmarshal(tagsJSON, &item.Tags); err != nil {
			return nil, fmt.Errorf("decode email processing tags: %w", err)
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *PostgresStore) queryEmailProcessingTagOptions(ctx context.Context, filter emailProcessingFilter, scopeUserID string) ([]EmailProcessingTag, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT DISTINCT ON (LOWER(BTRIM(tag->>'label'))) tag
		FROM conversation_email_tags tagged
		JOIN conversations c ON c.id = tagged.conversation_id AND c.kind = 'system'
		JOIN shop_sources src ON src.id = c.source_id AND src.type = 'email'
		CROSS JOIN LATERAL jsonb_array_elements(tagged.tags) tag
		WHERE ($1 = '' OR c.shop_id = $1)
		  AND ($2 = '' OR c.source_id = $2)
		  AND ($3 = '' OR EXISTS (
			SELECT 1 FROM shop_agents scope_sa
			JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
			WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $3
		  ))
		ORDER BY LOWER(BTRIM(tag->>'label')), tag->>'label'
	`, strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.TrimSpace(scopeUserID))
	if err != nil {
		return nil, fmt.Errorf("query email processing tag options: %w", err)
	}
	defer rows.Close()
	out := []EmailProcessingTag{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var tag EmailProcessingTag
		if err := json.Unmarshal(raw, &tag); err != nil {
			return nil, fmt.Errorf("decode email processing tag option: %w", err)
		}
		out = append(out, tag)
	}
	return out, rows.Err()
}
