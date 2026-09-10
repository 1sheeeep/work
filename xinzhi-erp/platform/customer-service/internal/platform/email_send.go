package platform

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"mime/quotedprintable"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strings"
	"time"
)

const (
	platformGmailReadScope   = "https://www.googleapis.com/auth/gmail.readonly"
	platformGmailModifyScope = "https://www.googleapis.com/auth/gmail.modify"
	platformGmailSendScope   = "https://www.googleapis.com/auth/gmail.send"
)

type emailReplyTarget struct {
	Provider                 string
	MessageID                string
	ThreadID                 string
	InternetMessageID        string
	ConversationID           string
	HeaderMessageID          string
	HeaderReferences         string
	SourceMessageID          string
	CustomerEmail            string
	Subject                  string
	LatestCustomerMessageRaw map[string]string
}

type gmailSendResponse struct {
	ID       string `json:"id"`
	ThreadID string `json:"threadId"`
}

type emailAttachmentInput struct {
	FileName string
	MIMEType string
	Content  []byte
	Body     string
}

func (s *Server) sendAgentEmailReply(ctx context.Context, conversation Conversation, input Message, user User) (map[string]string, error) {
	source, ok, err := s.emailSourceForConversation(ctx, conversation)
	if err != nil || !ok {
		return nil, err
	}
	if err := validateAgentReplyBeforeExternalSend(conversation, input, user.ID); err != nil {
		return nil, err
	}
	if source.Status != SourceStatusActive {
		return nil, fmt.Errorf("%w: email send failed: email channel is disabled", ErrInvalid)
	}
	installation, err := s.store.GetEmailInstallation(ctx, conversation.ShopID, source.Address)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, fmt.Errorf("%w: email send failed: mailbox is not authorized", ErrInvalid)
		}
		return nil, err
	}
	provider := strings.ToLower(strings.TrimSpace(firstNonEmpty(source.Provider, installation.Provider)))
	if provider == "" {
		provider = "outlook"
	}
	installation.Provider = provider
	installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		return nil, err
	}
	target, err := s.latestCustomerEmailReplyTarget(ctx, conversation, provider)
	if err != nil {
		return nil, err
	}
	sentAt := time.Now().UTC().Format(time.RFC3339)
	metadata := map[string]string{
		"mail_api_provider": provider,
		"mail_api_mailbox":  installation.Mailbox,
		"mail_api_sent_at":  sentAt,
	}
	switch provider {
	case "gmail":
		if err := validateGmailGrantedScopes(installation.Scope); err != nil {
			return metadata, err
		}
		sent, err := sendGmailThreadReply(ctx, installation.AccessToken, conversation, target, input.Body)
		if err != nil {
			return metadata, err
		}
		metadata["gmail_thread_id"] = firstNonEmpty(sent.ThreadID, target.ThreadID)
		if sent.ID != "" {
			metadata["gmail_message_id"] = sent.ID
			metadata["mail_api_sent_message_id"] = "gmail:" + sent.ID
		}
		if target.MessageID != "" {
			if err := setGmailMessageRead(ctx, installation.AccessToken, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	case "outlook":
		if err := validateOutlookGrantedScopes(installation.Scope); err != nil {
			return metadata, err
		}
		if sendErr := sendOutlookThreadReply(ctx, installation.AccessToken, target.MessageID, input.Body); sendErr != nil {
			logOutlookSendLimit(source, conversation, user, sendErr)
			return metadata, sendErr
		}
		metadata["outlook_message_id"] = target.MessageID
		metadata["outlook_conversation_id"] = target.ConversationID
		metadata["outlook_internet_message_id"] = target.InternetMessageID
		metadata["mail_api_sent_message_id"] = "outlook:reply:" + target.MessageID
		if target.MessageID != "" {
			if err := setOutlookMessageRead(ctx, installation.AccessToken, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	case cuiqiuProvider:
		config, err := cuiqiuConfigFrom(source, installation)
		if err != nil {
			return metadata, err
		}
		sentID, err := sendCuiqiuSMTPReply(config, conversation, target, input.Body, nil)
		if err != nil {
			return metadata, err
		}
		metadata["cuiqiu_message_id"] = target.MessageID
		metadata["mail_message_id"] = sentID
		metadata["mail_api_sent_message_id"] = "cuiqiu:smtp:" + sentID
		if target.MessageID != "" {
			if err := setCuiqiuMessageRead(ctx, config, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	case standardMailProvider:
		config, err := standardMailConfigFrom(source, installation)
		if err != nil {
			return metadata, err
		}
		sentID, err := sendStandardSMTPThreadReply(ctx, config, conversation, target, input.Body, nil)
		if err != nil {
			return metadata, err
		}
		metadata[standardMailProvider+"_message_id"] = target.MessageID
		metadata["mail_message_id"] = sentID
		metadata["mail_api_sent_message_id"] = standardMailProvider + ":smtp:" + sentID
		if target.MessageID != "" {
			if err := setStandardIMAPMessageRead(ctx, config, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	default:
		return metadata, fmt.Errorf("%w: email send failed: unsupported email provider %q", ErrInvalid, provider)
	}
	return metadata, nil
}

func (s *Server) sendAgentEmailAttachmentReply(ctx context.Context, conversation Conversation, input emailAttachmentInput, user User) (map[string]string, error) {
	if err := validateAgentEmailOperation(conversation, user.ID); err != nil {
		return nil, err
	}
	if len(input.Content) == 0 || strings.TrimSpace(input.MIMEType) == "" || strings.TrimSpace(input.FileName) == "" {
		return nil, fmt.Errorf("%w: email attachment send failed: file name, content type, and content are required", ErrInvalid)
	}
	source, ok, err := s.emailSourceForConversation(ctx, conversation)
	if err != nil || !ok {
		return nil, err
	}
	if source.Status != SourceStatusActive {
		return nil, fmt.Errorf("%w: email attachment send failed: email channel is disabled", ErrInvalid)
	}
	installation, err := s.store.GetEmailInstallation(ctx, conversation.ShopID, source.Address)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, fmt.Errorf("%w: email attachment send failed: mailbox is not authorized", ErrInvalid)
		}
		return nil, err
	}
	provider := strings.ToLower(strings.TrimSpace(firstNonEmpty(source.Provider, installation.Provider)))
	if provider == "" {
		provider = "outlook"
	}
	installation.Provider = provider
	installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		return nil, err
	}
	target, err := s.latestCustomerEmailReplyTarget(ctx, conversation, provider)
	if err != nil {
		return nil, err
	}
	metadata := map[string]string{
		"mail_api_provider": provider,
		"mail_api_mailbox":  installation.Mailbox,
		"mail_api_sent_at":  time.Now().UTC().Format(time.RFC3339),
	}
	switch provider {
	case "gmail":
		if err := validateGmailGrantedScopes(installation.Scope); err != nil {
			return metadata, err
		}
		sent, err := sendGmailThreadAttachmentReply(ctx, installation.AccessToken, conversation, target, input)
		if err != nil {
			return metadata, err
		}
		metadata["gmail_thread_id"] = firstNonEmpty(sent.ThreadID, target.ThreadID)
		if sent.ID != "" {
			metadata["gmail_message_id"] = sent.ID
			metadata["mail_api_sent_message_id"] = "gmail:" + sent.ID
		}
		if target.MessageID != "" {
			if err := setGmailMessageRead(ctx, installation.AccessToken, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	case "outlook":
		if err := validateOutlookGrantedScopes(installation.Scope); err != nil {
			return metadata, err
		}
		draftID, sendErr := sendOutlookThreadAttachmentReply(ctx, installation.AccessToken, target.MessageID, input)
		if sendErr != nil {
			logOutlookSendLimit(source, conversation, user, sendErr)
			return metadata, sendErr
		}
		metadata["outlook_message_id"] = firstNonEmpty(draftID, target.MessageID)
		metadata["outlook_conversation_id"] = target.ConversationID
		metadata["outlook_internet_message_id"] = target.InternetMessageID
		metadata["mail_api_sent_message_id"] = "outlook:" + firstNonEmpty(draftID, target.MessageID)
		if target.MessageID != "" {
			if err := setOutlookMessageRead(ctx, installation.AccessToken, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	case cuiqiuProvider:
		config, err := cuiqiuConfigFrom(source, installation)
		if err != nil {
			return metadata, err
		}
		sentID, err := sendCuiqiuSMTPReply(config, conversation, target, input.Body, &input)
		if err != nil {
			return metadata, err
		}
		metadata["cuiqiu_message_id"] = target.MessageID
		metadata["mail_message_id"] = sentID
		metadata["mail_api_sent_message_id"] = "cuiqiu:smtp:" + sentID
		if target.MessageID != "" {
			if err := setCuiqiuMessageRead(ctx, config, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	case standardMailProvider:
		config, err := standardMailConfigFrom(source, installation)
		if err != nil {
			return metadata, err
		}
		sentID, err := sendStandardSMTPThreadReply(ctx, config, conversation, target, input.Body, &input)
		if err != nil {
			return metadata, err
		}
		metadata[standardMailProvider+"_message_id"] = target.MessageID
		metadata["mail_message_id"] = sentID
		metadata["mail_api_sent_message_id"] = standardMailProvider + ":smtp:" + sentID
		if target.MessageID != "" {
			if err := setStandardIMAPMessageRead(ctx, config, target.MessageID, true); err != nil {
				metadata["mail_api_mark_read_error"] = err.Error()
			}
		}
	default:
		return metadata, fmt.Errorf("%w: email attachment send failed: unsupported email provider %q", ErrInvalid, provider)
	}
	return metadata, nil
}

func logOutlookSendLimit(source ShopSource, conversation Conversation, user User, sendErr error) {
	var providerErr *emailSendProviderError
	if !errors.As(sendErr, &providerErr) || providerErr.statusCode != http.StatusTooManyRequests {
		return
	}
	log.Printf("Outlook send limited: shop=%s source=%s conversation=%s agent=%s code=%s", source.ShopID, source.ID, conversation.ID, user.ID, providerErr.responseCode)
}

func validateAgentReplyBeforeExternalSend(conversation Conversation, input Message, userID string) error {
	if strings.TrimSpace(input.Body) == "" {
		return fmt.Errorf("%w: body is required", ErrInvalid)
	}
	if normalizeMessageType(input.Type) != MessageTypeText {
		return fmt.Errorf("%w: email send failed: only text replies can be sent by email API", ErrInvalid)
	}
	return validateAgentEmailOperation(conversation, userID)
}

func validateAgentEmailOperation(conversation Conversation, userID string) error {
	if !conversation.ReplyAllowed {
		return fmt.Errorf("%w: system notification conversations are read-only", ErrForbidden)
	}
	if conversation.Status != ConversationStatusAssigned {
		return fmt.Errorf("%w: conversation must be claimed before replying", ErrConflict)
	}
	if conversation.AssignedAgentID != strings.TrimSpace(userID) {
		return fmt.Errorf("%w: conversation is assigned to another agent", ErrForbidden)
	}
	return nil
}

func (s *Server) emailSourceForConversation(ctx context.Context, conversation Conversation) (ShopSource, bool, error) {
	if strings.TrimSpace(conversation.SourceID) == "" {
		return ShopSource{}, false, nil
	}
	source, err := s.store.GetShopSource(ctx, conversation.ShopID, conversation.SourceID)
	if err != nil {
		return ShopSource{}, false, err
	}
	return source, source.Type == SourceTypeEmail, nil
}

func (s *Server) latestCustomerEmailReplyTarget(ctx context.Context, conversation Conversation, provider string) (emailReplyTarget, error) {
	messages, err := s.store.ListMessages(ctx, conversation.ID)
	if err != nil {
		return emailReplyTarget{}, err
	}
	for index := len(messages) - 1; index >= 0; index-- {
		message := messages[index]
		if message.Direction != MessageDirectionCustomer {
			continue
		}
		target := emailReplyTarget{
			Provider:                 provider,
			SourceMessageID:          strings.TrimSpace(message.SourceMessageID),
			CustomerEmail:            firstNonEmpty(message.Metadata["mail_reply_to_email"], conversation.CustomerEmail),
			Subject:                  conversation.Subject,
			LatestCustomerMessageRaw: cloneStringMap(message.Metadata),
		}
		target.MessageID = firstNonEmpty(message.Metadata[provider+"_message_id"], stripEmailMessagePrefix(message.SourceMessageID, provider))
		target.HeaderMessageID = firstNonEmpty(message.Metadata["mail_message_id"], message.Metadata[provider+"_internet_message_id"])
		target.HeaderReferences = message.Metadata["mail_references"]
		switch provider {
		case "gmail":
			target.ThreadID = message.Metadata["gmail_thread_id"]
			if target.MessageID == "" || target.ThreadID == "" || target.HeaderMessageID == "" {
				continue
			}
		case "outlook":
			target.InternetMessageID = message.Metadata["outlook_internet_message_id"]
			target.ConversationID = message.Metadata["outlook_conversation_id"]
			if target.MessageID == "" || target.InternetMessageID == "" || target.ConversationID == "" {
				continue
			}
		case cuiqiuProvider:
			if target.MessageID == "" || target.CustomerEmail == "" {
				continue
			}
		case standardMailProvider:
			if target.MessageID == "" || target.CustomerEmail == "" || target.HeaderMessageID == "" {
				continue
			}
		default:
			return emailReplyTarget{}, fmt.Errorf("%w: email reply failed: unsupported email provider %q", ErrInvalid, provider)
		}
		return target, nil
	}
	switch provider {
	case "gmail":
		return emailReplyTarget{}, fmt.Errorf("%w: Gmail email reply failed: original message id, threadId, and Message-ID header are required; ingest the email through Gmail API before replying", ErrInvalid)
	case "outlook":
		return emailReplyTarget{}, fmt.Errorf("%w: Outlook email reply failed: original message id, internetMessageId, and conversationId are required; ingest the email through Microsoft Graph before replying", ErrInvalid)
	case cuiqiuProvider:
		return emailReplyTarget{}, fmt.Errorf("%w: Cuiqiu email reply failed: original message id and customer email are required", ErrInvalid)
	case standardMailProvider:
		return emailReplyTarget{}, fmt.Errorf("%w: IMAP/SMTP email reply failed: original message UID, Message-ID header, and customer email are required", ErrInvalid)
	default:
		return emailReplyTarget{}, fmt.Errorf("%w: email reply failed: no customer email message is available to reply to", ErrInvalid)
	}
}

func sendOutlookThreadReply(ctx context.Context, accessToken string, messageID string, body string) error {
	if strings.TrimSpace(messageID) == "" {
		return fmt.Errorf("%w: Outlook email reply failed: original message id is required", ErrInvalid)
	}
	payload := map[string]string{"comment": strings.TrimSpace(body)}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, outlookGraphBase()+"/me/messages/"+url.PathEscape(messageID)+"/reply", strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("Outlook email reply failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return newEmailSendProviderError("Outlook", "回复邮件", resp.StatusCode, resp.Status, responseBody)
	}
	return nil
}

type emailSendProviderError struct {
	provider     string
	operation    string
	statusCode   int
	status       string
	responseBody string
	responseCode string
}

func (e *emailSendProviderError) Error() string {
	status := strings.TrimSpace(e.status)
	if status == "" {
		status = fmt.Sprintf("%d", e.statusCode)
	}
	message := fmt.Sprintf("%s %s失败：HTTP %s", e.provider, e.operation, status)
	if e.responseBody == "" {
		return message + "；服务返回的响应体为空"
	}
	return message + "；服务返回：" + e.responseBody
}

func (e *emailSendProviderError) Unwrap() error {
	if e.statusCode == http.StatusTooManyRequests {
		return ErrRateLimited
	}
	return nil
}

func newEmailSendProviderError(provider string, operation string, statusCode int, status string, responseBody []byte) error {
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(responseBody, &envelope)
	return &emailSendProviderError{
		provider:     strings.TrimSpace(provider),
		operation:    strings.TrimSpace(operation),
		statusCode:   statusCode,
		status:       strings.TrimSpace(status),
		responseBody: providerResponseBodyForDisplay(responseBody),
		responseCode: strings.TrimSpace(envelope.Error.Code),
	}
}

func sendOutlookThreadAttachmentReply(ctx context.Context, accessToken string, messageID string, input emailAttachmentInput) (string, error) {
	if strings.TrimSpace(messageID) == "" {
		return "", fmt.Errorf("%w: Outlook email attachment send failed: original message id is required", ErrInvalid)
	}
	comment := strings.TrimSpace(input.Body)
	if comment == "" {
		comment = "Attached image: " + input.FileName
	}
	payload, _ := json.Marshal(map[string]string{"comment": comment})
	endpoint := outlookGraphBase() + "/me/messages/" + url.PathEscape(messageID) + "/createReply"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Outlook email attachment send failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", newEmailSendProviderError("Outlook", "创建带附件的回复草稿", resp.StatusCode, resp.Status, responseBody)
	}
	var draft struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(responseBody, &draft)
	draft.ID = strings.TrimSpace(draft.ID)
	if draft.ID == "" {
		return "", fmt.Errorf("%w: Outlook email attachment send failed: createReply response missing draft id", ErrInvalid)
	}
	attachment := map[string]string{
		"@odata.type":  "#microsoft.graph.fileAttachment",
		"name":         input.FileName,
		"contentType":  input.MIMEType,
		"contentBytes": base64.StdEncoding.EncodeToString(input.Content),
	}
	rawAttachment, _ := json.Marshal(attachment)
	req, err = http.NewRequestWithContext(ctx, http.MethodPost, outlookGraphBase()+"/me/messages/"+url.PathEscape(draft.ID)+"/attachments", strings.NewReader(string(rawAttachment)))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err = externalHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Outlook email attachment send failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ = io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", newEmailSendProviderError("Outlook", "上传回复附件", resp.StatusCode, resp.Status, responseBody)
	}
	req, err = http.NewRequestWithContext(ctx, http.MethodPost, outlookGraphBase()+"/me/messages/"+url.PathEscape(draft.ID)+"/send", nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	resp, err = externalHTTPClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("Outlook email attachment send failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ = io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", newEmailSendProviderError("Outlook", "发送带附件的回复", resp.StatusCode, resp.Status, responseBody)
	}
	return draft.ID, nil
}

func setOutlookMessageRead(ctx context.Context, accessToken string, messageID string, read bool) error {
	if strings.TrimSpace(messageID) == "" {
		return nil
	}
	payload, _ := json.Marshal(map[string]bool{"isRead": read})
	endpoint := outlookGraphBase() + "/me/messages/" + url.PathEscape(messageID)
	req, err := http.NewRequestWithContext(ctx, http.MethodPatch, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("Outlook mark read state failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(body), RetryAfter: resp.Header.Get("Retry-After")}
	}
	return nil
}

func sendGmailThreadReply(ctx context.Context, accessToken string, conversation Conversation, target emailReplyTarget, body string) (gmailSendResponse, error) {
	raw, err := gmailRawThreadReply(conversation, target, body)
	if err != nil {
		return gmailSendResponse{}, err
	}
	payload, err := json.Marshal(map[string]string{"raw": raw, "threadId": target.ThreadID})
	if err != nil {
		return gmailSendResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gmailAPIBase()+"/users/me/messages/send", strings.NewReader(string(payload)))
	if err != nil {
		return gmailSendResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return gmailSendResponse{}, fmt.Errorf("Gmail email reply failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return gmailSendResponse{}, newEmailSendProviderError("Gmail", "回复邮件", resp.StatusCode, resp.Status, responseBody)
	}
	var sent gmailSendResponse
	if len(strings.TrimSpace(string(responseBody))) > 0 {
		_ = json.Unmarshal(responseBody, &sent)
	}
	return sent, nil
}

func sendGmailThreadAttachmentReply(ctx context.Context, accessToken string, conversation Conversation, target emailReplyTarget, input emailAttachmentInput) (gmailSendResponse, error) {
	raw, err := gmailRawThreadAttachmentReply(conversation, target, input)
	if err != nil {
		return gmailSendResponse{}, err
	}
	payload, err := json.Marshal(map[string]string{"raw": raw, "threadId": target.ThreadID})
	if err != nil {
		return gmailSendResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, gmailAPIBase()+"/users/me/messages/send", strings.NewReader(string(payload)))
	if err != nil {
		return gmailSendResponse{}, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return gmailSendResponse{}, fmt.Errorf("Gmail email attachment send failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return gmailSendResponse{}, newEmailSendProviderError("Gmail", "发送带附件的回复", resp.StatusCode, resp.Status, responseBody)
	}
	var sent gmailSendResponse
	if len(strings.TrimSpace(string(responseBody))) > 0 {
		_ = json.Unmarshal(responseBody, &sent)
	}
	return sent, nil
}

func setGmailMessageRead(ctx context.Context, accessToken string, messageID string, read bool) error {
	if strings.TrimSpace(messageID) == "" {
		return nil
	}
	payload := map[string][]string{}
	if read {
		payload["removeLabelIds"] = []string{"UNREAD"}
	} else {
		payload["addLabelIds"] = []string{"UNREAD"}
	}
	raw, _ := json.Marshal(payload)
	endpoint := gmailAPIBase() + "/users/me/messages/" + url.PathEscape(messageID) + "/modify"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("Gmail mark read state failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(body), RetryAfter: resp.Header.Get("Retry-After")}
	}
	return nil
}

func setGmailMessageNotSpam(ctx context.Context, accessToken string, messageID string) error {
	if strings.TrimSpace(messageID) == "" {
		return nil
	}
	payload := map[string][]string{
		"addLabelIds":    {"INBOX"},
		"removeLabelIds": {"SPAM"},
	}
	raw, _ := json.Marshal(payload)
	endpoint := gmailAPIBase() + "/users/me/messages/" + url.PathEscape(messageID) + "/modify"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(string(raw)))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(accessToken))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("Gmail mark not spam failed: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Gmail mark not spam failed: %s %s", resp.Status, compactResponseBody(body))
	}
	return nil
}

func gmailRawThreadReply(conversation Conversation, target emailReplyTarget, body string) (string, error) {
	to := normalizeEmail(firstNonEmpty(target.CustomerEmail, conversation.CustomerEmail))
	if to == "" {
		return "", fmt.Errorf("%w: Gmail email reply failed: customer email is required", ErrInvalid)
	}
	references := mergeReferences(target.HeaderReferences, target.HeaderMessageID)
	var message strings.Builder
	writeMailHeader(&message, "To", (&mail.Address{Name: conversation.CustomerName, Address: to}).String())
	writeMailHeader(&message, "Subject", mime.QEncoding.Encode("utf-8", replySubject(conversation.Subject)))
	writeMailHeader(&message, "In-Reply-To", target.HeaderMessageID)
	writeMailHeader(&message, "References", references)
	writeMailHeader(&message, "MIME-Version", "1.0")
	writeMailHeader(&message, "Content-Type", "text/plain; charset=UTF-8")
	writeMailHeader(&message, "Content-Transfer-Encoding", "quoted-printable")
	message.WriteString("\r\n")
	qp := quotedprintable.NewWriter(&message)
	if _, err := qp.Write([]byte(strings.TrimSpace(body))); err != nil {
		_ = qp.Close()
		return "", err
	}
	if err := qp.Close(); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString([]byte(message.String())), nil
}

func gmailRawThreadAttachmentReply(conversation Conversation, target emailReplyTarget, input emailAttachmentInput) (string, error) {
	to := normalizeEmail(firstNonEmpty(target.CustomerEmail, conversation.CustomerEmail))
	if to == "" {
		return "", fmt.Errorf("%w: Gmail email attachment send failed: customer email is required", ErrInvalid)
	}
	references := mergeReferences(target.HeaderReferences, target.HeaderMessageID)
	boundary := "xzdesk_" + prefixedID("mime")
	text := strings.TrimSpace(input.Body)
	if text == "" {
		text = "Attached image: " + input.FileName
	}
	var message strings.Builder
	writeMailHeader(&message, "To", (&mail.Address{Name: conversation.CustomerName, Address: to}).String())
	writeMailHeader(&message, "Subject", mime.QEncoding.Encode("utf-8", replySubject(conversation.Subject)))
	writeMailHeader(&message, "In-Reply-To", target.HeaderMessageID)
	writeMailHeader(&message, "References", references)
	writeMailHeader(&message, "MIME-Version", "1.0")
	writeMailHeader(&message, "Content-Type", `multipart/mixed; boundary="`+boundary+`"`)
	message.WriteString("\r\n")
	message.WriteString("--" + boundary + "\r\n")
	writeMailHeader(&message, "Content-Type", "text/plain; charset=UTF-8")
	writeMailHeader(&message, "Content-Transfer-Encoding", "quoted-printable")
	message.WriteString("\r\n")
	qp := quotedprintable.NewWriter(&message)
	if _, err := qp.Write([]byte(text)); err != nil {
		_ = qp.Close()
		return "", err
	}
	if err := qp.Close(); err != nil {
		return "", err
	}
	message.WriteString("\r\n--" + boundary + "\r\n")
	writeMailHeader(&message, "Content-Type", input.MIMEType+`; name="`+sanitizeEmailHeader(input.FileName)+`"`)
	writeMailHeader(&message, "Content-Disposition", `attachment; filename="`+sanitizeEmailHeader(input.FileName)+`"`)
	writeMailHeader(&message, "Content-Transfer-Encoding", "base64")
	message.WriteString("\r\n")
	encoded := base64.StdEncoding.EncodeToString(input.Content)
	for len(encoded) > 76 {
		message.WriteString(encoded[:76] + "\r\n")
		encoded = encoded[76:]
	}
	if encoded != "" {
		message.WriteString(encoded + "\r\n")
	}
	message.WriteString("--" + boundary + "--\r\n")
	return base64.RawURLEncoding.EncodeToString([]byte(message.String())), nil
}

func (s *Server) emailInstallationWithFreshToken(ctx context.Context, installation EmailInstallation) (EmailInstallation, error) {
	if strings.EqualFold(strings.TrimSpace(installation.Provider), cuiqiuProvider) {
		if strings.TrimSpace(installation.AccessToken) == "" {
			return EmailInstallation{}, fmt.Errorf("%w: Cuiqiu API token is missing; reconnect the email channel", ErrInvalid)
		}
		return installation, nil
	}
	if strings.EqualFold(strings.TrimSpace(installation.Provider), standardMailProvider) {
		if strings.TrimSpace(installation.AccessToken) == "" {
			return EmailInstallation{}, fmt.Errorf("%w: mailbox client authorization code is missing; reconnect the email channel", ErrInvalid)
		}
		return installation, nil
	}
	if time.Now().UTC().Add(90 * time.Second).Before(installation.ExpiresAt) {
		return installation, nil
	}
	if strings.TrimSpace(installation.RefreshToken) == "" {
		return EmailInstallation{}, fmt.Errorf("%w: email authorization expired and refresh token is missing; reauthorize the email channel", ErrInvalid)
	}
	switch strings.ToLower(strings.TrimSpace(installation.Provider)) {
	case "gmail":
		cfg, err := gmailAppConfig()
		if err != nil {
			return EmailInstallation{}, err
		}
		token, err := refreshGmailOAuthToken(ctx, installation.RefreshToken, cfg)
		if err != nil {
			return EmailInstallation{}, err
		}
		installation.AccessToken = token.AccessToken
		installation.RefreshToken = firstNonEmpty(token.RefreshToken, installation.RefreshToken)
		installation.Scope = firstNonEmpty(token.Scope, installation.Scope, defaultGmailScopes)
		installation.ExpiresAt = time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
	case "outlook":
		cfg, err := outlookAppConfig()
		if err != nil {
			return EmailInstallation{}, err
		}
		token, err := refreshOutlookOAuthToken(ctx, installation.RefreshToken, cfg)
		if err != nil {
			return EmailInstallation{}, err
		}
		installation.AccessToken = token.AccessToken
		installation.RefreshToken = firstNonEmpty(token.RefreshToken, installation.RefreshToken)
		installation.Scope = firstNonEmpty(token.Scope, installation.Scope, defaultOutlookScopes)
		installation.ExpiresAt = time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
	default:
		return EmailInstallation{}, fmt.Errorf("%w: email refresh failed: unsupported email provider %q", ErrInvalid, installation.Provider)
	}
	return s.store.SaveEmailInstallation(ctx, installation)
}

func refreshGmailOAuthToken(ctx context.Context, refreshToken string, cfg gmailAppSettings) (gmailOAuthTokenResponse, error) {
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("client_secret", cfg.ClientSecret)
	values.Set("refresh_token", strings.TrimSpace(refreshToken))
	values.Set("grant_type", "refresh_token")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return gmailOAuthTokenResponse{}, fmt.Errorf("Gmail token refresh failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return gmailOAuthTokenResponse{}, fmt.Errorf("Gmail token refresh failed: %w", &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(body), RetryAfter: resp.Header.Get("Retry-After")})
	}
	var token gmailOAuthTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return gmailOAuthTokenResponse{}, err
	}
	token.AccessToken = strings.TrimSpace(token.AccessToken)
	if token.AccessToken == "" {
		return gmailOAuthTokenResponse{}, fmt.Errorf("%w: Gmail refresh response missing access_token", ErrInvalid)
	}
	if token.ExpiresIn <= 0 {
		token.ExpiresIn = 3600
	}
	return token, nil
}

func refreshOutlookOAuthToken(ctx context.Context, refreshToken string, cfg outlookAppSettings) (outlookOAuthTokenResponse, error) {
	values := url.Values{}
	values.Set("client_id", cfg.ClientID)
	values.Set("client_secret", cfg.ClientSecret)
	values.Set("refresh_token", strings.TrimSpace(refreshToken))
	values.Set("grant_type", "refresh_token")
	values.Set("scope", cfg.Scopes)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(values.Encode()))
	if err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := externalHTTPClient.Do(req)
	if err != nil {
		return outlookOAuthTokenResponse{}, fmt.Errorf("Outlook token refresh failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return outlookOAuthTokenResponse{}, fmt.Errorf("Outlook token refresh failed: %w", &emailProviderHTTPError{StatusCode: resp.StatusCode, Status: resp.Status, Body: compactResponseBody(body), RetryAfter: resp.Header.Get("Retry-After")})
	}
	var token outlookOAuthTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return outlookOAuthTokenResponse{}, err
	}
	token.AccessToken = strings.TrimSpace(token.AccessToken)
	if token.AccessToken == "" {
		return outlookOAuthTokenResponse{}, fmt.Errorf("%w: Outlook refresh response missing access_token", ErrInvalid)
	}
	if token.ExpiresIn <= 0 {
		token.ExpiresIn = 3600
	}
	return token, nil
}

func writeMailHeader(message *strings.Builder, key string, value string) {
	value = sanitizeEmailHeader(value)
	if value == "" {
		return
	}
	message.WriteString(key)
	message.WriteString(": ")
	message.WriteString(value)
	message.WriteString("\r\n")
}

func replySubject(subject string) string {
	subject = sanitizeEmailHeader(strings.TrimSpace(subject))
	if subject == "" {
		subject = "(no subject)"
	}
	if !strings.HasPrefix(strings.ToLower(subject), "re:") {
		subject = "Re: " + subject
	}
	return subject
}

func sanitizeEmailHeader(value string) string {
	value = strings.ReplaceAll(value, "\r", " ")
	value = strings.ReplaceAll(value, "\n", " ")
	return strings.TrimSpace(value)
}

func mergeReferences(references string, messageID string) string {
	parts := strings.Fields(sanitizeEmailHeader(references))
	messageID = sanitizeEmailHeader(messageID)
	for _, part := range parts {
		if part == messageID {
			return strings.Join(parts, " ")
		}
	}
	if messageID != "" {
		parts = append(parts, messageID)
	}
	return strings.Join(parts, " ")
}

func stripEmailMessagePrefix(value string, provider string) string {
	value = strings.TrimSpace(value)
	for _, prefix := range []string{provider + "-api:", provider + ":"} {
		if strings.HasPrefix(strings.ToLower(value), prefix) {
			return strings.TrimSpace(value[len(prefix):])
		}
	}
	return value
}

func validateOutlookGrantedScopes(scopes string) error {
	if !scopeListContains(scopes, "Mail.Send") {
		return fmt.Errorf("%w: Outlook authorization is missing Mail.Send; reauthorize the email channel", ErrInvalid)
	}
	if !scopeListContains(scopes, "Mail.ReadWrite") {
		return fmt.Errorf("%w: Outlook authorization is missing Mail.ReadWrite; reauthorize the email channel", ErrInvalid)
	}
	return nil
}

func validateGmailGrantedScopes(scopes string) error {
	if !scopeListContains(scopes, platformGmailSendScope) {
		return fmt.Errorf("%w: Gmail authorization is missing gmail.send; reauthorize the email channel", ErrInvalid)
	}
	if !scopeListContains(scopes, platformGmailModifyScope) {
		return fmt.Errorf("%w: Gmail authorization is missing gmail.modify; reauthorize the email channel", ErrInvalid)
	}
	if !scopeListContains(scopes, platformGmailReadScope) && !scopeListContains(scopes, platformGmailModifyScope) {
		return fmt.Errorf("%w: Gmail authorization is missing Gmail read permission; reauthorize the email channel", ErrInvalid)
	}
	return nil
}

func scopeListContains(scopes string, expected string) bool {
	expected = strings.ToLower(strings.TrimSpace(expected))
	if expected == "" {
		return true
	}
	for _, scope := range strings.FieldsFunc(strings.ToLower(scopes), func(r rune) bool {
		return r == ' ' || r == ',' || r == ';'
	}) {
		if strings.TrimSpace(scope) == expected {
			return true
		}
	}
	return false
}

func outlookGraphBase() string {
	return strings.TrimRight(firstNonEmpty(os.Getenv("OUTLOOK_GRAPH_BASE_URL"), "https://graph.microsoft.com/v1.0"), "/")
}

func gmailAPIBase() string {
	return strings.TrimRight(firstNonEmpty(os.Getenv("GMAIL_API_BASE_URL"), "https://gmail.googleapis.com/gmail/v1"), "/")
}

func compactResponseBody(body []byte) string {
	text := strings.TrimSpace(string(body))
	if len(text) > 500 {
		text = text[:500]
	}
	return text
}

func providerResponseBodyForDisplay(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return ""
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return text
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return text
	}
	encoded, err := json.Marshal(redactSensitiveProviderFields(value))
	if err != nil {
		return text
	}
	return string(encoded)
}

func redactSensitiveProviderFields(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(typed))
		for key, item := range typed {
			if isSensitiveProviderField(key) {
				result[key] = "[已隐藏]"
				continue
			}
			result[key] = redactSensitiveProviderFields(item)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, item := range typed {
			result[index] = redactSensitiveProviderFields(item)
		}
		return result
	default:
		return value
	}
}

func isSensitiveProviderField(key string) bool {
	normalized := strings.NewReplacer("_", "", "-", "", ".", "", " ", "").Replace(strings.ToLower(strings.TrimSpace(key)))
	for _, marker := range []string{"password", "passwd", "secret", "token", "authorization", "credential", "cookie"} {
		if strings.Contains(normalized, marker) {
			return true
		}
	}
	return false
}
