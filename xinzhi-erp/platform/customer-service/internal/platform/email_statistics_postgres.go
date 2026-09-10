package platform

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const emailStatisticsPostgresCandidates = `
	WITH candidates AS (
		SELECT
			c.id AS conversation_id,
			c.shop_id,
			c.source_id,
			c.customer_name,
			c.customer_email,
			c.subject,
			c.status,
			c.kind,
			c.classification_reason,
			sh.display_name AS shop_name,
			COALESCE(sh.metadata->>'internalNote', '') AS shop_note,
			src.address AS source_address,
			src.provider,
			m.id AS message_id,
			m.direction,
			m.message_type,
			m.body,
			m.metadata,
			m.sender_name,
			m.sender_email,
			m.source_message_id,
			m.created_at,
			COALESCE(NULLIF(BTRIM(m.source_message_id), ''), NULLIF(BTRIM(m.metadata->>'mail_message_id'), ''), m.id) AS unique_id,
			CASE
				WHEN c.classification_reason = 'verification code or authentication notice'
					OR (c.classification_reason || E'\n' || c.subject) ~* '(verification|security|authentication|one[- ]time|login|sign[- ]?in|confirm|验证码|动态码|安全码|登录码|确认码).{0,32}(code|password|pin|验证码|动态码|安全码|登录码|确认码)|(^|[^[:alnum:]_])(otp|2fa|mfa)($|[^[:alnum:]_])'
				THEN 'verification'
				WHEN c.classification_reason IN ('automated email pending review', 'suspected marketing email pending review') THEN 'other'
				WHEN (c.classification_reason || E'\n' || c.subject) ~* '(^|[^[:alnum:]_])(security|password|login|sign[- ]?in|new device|account access|suspicious|unauthorized|安全|密码|登录|新设备|异常访问)($|[^[:alnum:]_])' THEN 'security'
				WHEN (c.classification_reason || E'\n' || c.subject) ~* '(^|[^[:alnum:]_])(payment|payout|refund|chargeback|dispute|invoice|billing|subscription|付款|收款|退款|拒付|争议|账单|订阅)($|[^[:alnum:]_])' THEN 'payment'
				WHEN (c.classification_reason || E'\n' || c.subject) ~* '(^|[^[:alnum:]_])(shipment|shipping|delivery|fulfillment|tracking|inventory|stock|物流|配送|履约|运单|库存)($|[^[:alnum:]_])' THEN 'logistics'
				WHEN c.classification_reason = 'automated platform or account notification' THEN 'platform'
				ELSE 'other'
			END AS category
		FROM messages m
		JOIN conversations c ON c.id = m.conversation_id
		JOIN shop_sources src ON src.id = c.source_id AND src.type = 'email'
		JOIN shops sh ON sh.id = c.shop_id
		WHERE c.kind IN ('system', 'department')
		  AND c.classification_reason <> 'suspected marketing email pending review'
		  AND m.direction <> 'agent'
		  AND m.message_type = 'text'
		  AND m.source_message_id NOT LIKE '%:attachment:%'
		  AND ($1 = '' OR c.shop_id = $1)
		  AND ($2 = '' OR c.source_id = $2)
		  AND ($3 = '' OR LOWER(BTRIM(src.provider)) = $3)
		  AND ($4 = '' OR ($4 = 'closed' AND c.status = 'closed') OR ($4 = 'open' AND c.status <> 'closed'))
		  AND (NOT $5 OR (m.created_at >= $6 AND m.created_at < $7))
		  AND ($8 = '' OR EXISTS (
			SELECT 1 FROM shop_agents scope_sa
			JOIN shops scope_shop ON scope_shop.id = scope_sa.shop_id AND scope_shop.status = 'active'
			WHERE scope_sa.shop_id = c.shop_id AND scope_sa.user_id = $8
		  ))
	), filtered AS (
		SELECT *
		FROM candidates candidate
		WHERE ($9 = '' OR candidate.category = $9)
		  AND ($10 = '' OR
			LOWER(CONCAT_WS(E'\n', candidate.unique_id, candidate.source_address, candidate.sender_name,
				candidate.sender_email, candidate.subject, candidate.body, candidate.provider, candidate.shop_name,
				candidate.metadata->>'email_attachment_names')) LIKE '%' || $10 || '%'
			OR EXISTS (
				SELECT 1 FROM messages attachment
				WHERE attachment.conversation_id = candidate.conversation_id
				  AND LOWER(attachment.message_type) IN ('image', 'file')
				  AND LEFT(attachment.source_message_id, LENGTH(candidate.source_message_id) + LENGTH(':attachment:')) = candidate.source_message_id || ':attachment:'
				  AND LOWER(COALESCE(NULLIF(attachment.metadata->>'fileName', ''), attachment.body)) LIKE '%' || $10 || '%'
			)
		  )
	)
`

func (s *PostgresStore) QueryEmailStatistics(ctx context.Context, filter emailStatisticsFilter, scopeUserID string, paginate bool) ([]emailStatisticsQueryRow, int, error) {
	args := []any{
		strings.TrimSpace(filter.ShopID), strings.TrimSpace(filter.SourceID), strings.ToLower(strings.TrimSpace(filter.Provider)),
		strings.TrimSpace(filter.Status), !filter.Start.IsZero(), filter.Start, filter.EndExclusive,
		strings.TrimSpace(scopeUserID), strings.TrimSpace(filter.Category), strings.ToLower(strings.TrimSpace(filter.Search)),
	}
	var total int
	if err := s.db.QueryRowContext(ctx, emailStatisticsPostgresCandidates+`SELECT COUNT(*) FROM filtered`, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count email statistics: %w", err)
	}
	if !paginate && total > emailStatisticsExportMaxRows {
		return nil, total, fmt.Errorf("%w: 导出结果超过 %d 封，请缩小日期范围或增加筛选条件", ErrInvalid, emailStatisticsExportMaxRows)
	}
	page := filter.Page
	if page < 1 {
		page = 1
	}
	pageSize := filter.PageSize
	if !paginate {
		pageSize = 0
	}
	totalPages := 1
	if pageSize > 0 && total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	if page > totalPages {
		page = totalPages
	}
	offset := 0
	if pageSize > 0 {
		offset = (page - 1) * pageSize
	}
	rows, err := s.db.QueryContext(ctx, emailStatisticsPostgresCandidates+`
		SELECT filtered.conversation_id, filtered.shop_id, filtered.source_id, filtered.customer_name,
			filtered.customer_email, filtered.subject, filtered.status, filtered.kind, filtered.classification_reason,
			filtered.shop_name, filtered.shop_note, filtered.source_address, filtered.provider,
			filtered.message_id, filtered.direction, filtered.message_type, filtered.body, filtered.metadata,
			filtered.sender_name, filtered.sender_email, filtered.source_message_id, filtered.created_at,
			COALESCE(tags.tags, '[]'::jsonb),
			COALESCE((
				SELECT jsonb_agg(COALESCE(NULLIF(attachment.metadata->>'fileName', ''), attachment.body) ORDER BY attachment.created_at, attachment.id)
				FROM messages attachment
				WHERE attachment.conversation_id = filtered.conversation_id
				  AND LOWER(attachment.message_type) IN ('image', 'file')
				  AND LEFT(attachment.source_message_id, LENGTH(filtered.source_message_id) + LENGTH(':attachment:')) = filtered.source_message_id || ':attachment:'
			), '[]'::jsonb)
		FROM filtered
		LEFT JOIN conversation_email_tags tags ON tags.conversation_id = filtered.conversation_id
		ORDER BY filtered.created_at DESC, filtered.unique_id DESC
		LIMIT NULLIF($11, 0) OFFSET $12
	`, append(args, pageSize, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("query email statistics: %w", err)
	}
	defer rows.Close()
	out := make([]emailStatisticsQueryRow, 0)
	for rows.Next() {
		var item emailStatisticsQueryRow
		var messageMetadata []byte
		var tagsJSON []byte
		var attachmentsJSON []byte
		var shopNote string
		if err := rows.Scan(
			&item.Conversation.ID, &item.Conversation.ShopID, &item.Conversation.SourceID, &item.Conversation.CustomerName,
			&item.Conversation.CustomerEmail, &item.Conversation.Subject, &item.Conversation.Status, &item.Conversation.Kind,
			&item.Conversation.Classification, &item.Shop.DisplayName, &shopNote, &item.Source.Address, &item.Source.Provider,
			&item.Message.ID, &item.Message.Direction, &item.Message.Type, &item.Message.Body, &messageMetadata,
			&item.Message.SenderName, &item.Message.SenderEmail, &item.Message.SourceMessageID, &item.Message.CreatedAt,
			&tagsJSON, &attachmentsJSON,
		); err != nil {
			return nil, 0, err
		}
		item.Shop.ID = item.Conversation.ShopID
		item.Shop.Metadata = map[string]string{"internalNote": shopNote}
		item.Source.ID = item.Conversation.SourceID
		item.Source.ShopID = item.Conversation.ShopID
		item.Source.Type = SourceTypeEmail
		item.Message.ConversationID = item.Conversation.ID
		item.Message.Metadata = unmarshalMetadata(messageMetadata)
		if err := json.Unmarshal(tagsJSON, &item.Tags); err != nil {
			return nil, 0, fmt.Errorf("decode email statistics tags: %w", err)
		}
		if err := json.Unmarshal(attachmentsJSON, &item.AttachmentNames); err != nil {
			return nil, 0, fmt.Errorf("decode email statistics attachments: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}
