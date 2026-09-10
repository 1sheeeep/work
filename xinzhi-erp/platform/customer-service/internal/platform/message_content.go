package platform

import (
	"fmt"
	"net/url"
	"strings"
)

var productMetadataKeys = []string{
	"productId", "productTitle", "variantId", "variantTitle", "sku",
	"price", "currencyCode", "imageUrl", "onlineStoreUrl",
	messageAgentIDMetadataKey,
	publicChatCustomerIDMetadataKey,
	messageClientRequestIDKey,
	emailSendStatusKey,
	emailSendErrorKey,
	emailSendCompletedAtKey,
}

var imageMetadataKeys = []string{
	"url", "mimeType", "fileName", "fileSize",
	"entryPageTitle", "entryPageUrl", "entryProductHandle", "entryProductTitle", "entryProductImageUrl", "entryProductPrice", "entryProductCurrencyCode",
	"mail_api_provider", "mail_api_mailbox", "mail_api_sent_at", "mail_api_mark_read_error", "mail_api_sent_message_id",
	emailSyncedSourceMessageIDKey,
	"mail_message_id", "mail_references", "mail_reply_to_email", "mail_reply_to_name",
	"email_has_attachments", "email_attachment_names", "email_attachment_import_error", "email_received_at_original",
	"email_attachment_archive_status", "email_attachment_archive_error", "email_attachment_archive_completed_at", "email_attachment_count", "email_attachment_archived_count", "email_attachment_inline", "email_attachment_stored_name",
	"email_folder_origin", "email_ingress_label", "email_no_reply_warning",
	"gmail_message_id", "gmail_thread_id",
	"outlook_message_id", "outlook_internet_message_id", "outlook_conversation_id",
	"cuiqiu_message_id",
	standardMailProvider + "_message_id",
	emailHistoricalImportKey,
	messageAgentIDMetadataKey,
	publicChatCustomerIDMetadataKey,
	messageClientRequestIDKey,
	emailSendStatusKey,
	emailSendErrorKey,
	emailSendCompletedAtKey,
}
var fileMetadataKeys = []string{
	"url", "mimeType", "fileName", "fileSize",
	"entryPageTitle", "entryPageUrl", "entryProductHandle", "entryProductTitle", "entryProductImageUrl", "entryProductPrice", "entryProductCurrencyCode",
	"mail_api_provider", "mail_api_mailbox", "mail_api_sent_at", "mail_api_mark_read_error", "mail_api_sent_message_id",
	emailSyncedSourceMessageIDKey,
	"mail_message_id", "mail_references", "mail_reply_to_email", "mail_reply_to_name",
	"email_has_attachments", "email_attachment_names", "email_attachment_import_error", "email_received_at_original",
	"email_attachment_archive_status", "email_attachment_archive_error", "email_attachment_archive_completed_at", "email_attachment_count", "email_attachment_archived_count", "email_attachment_inline", "email_attachment_stored_name",
	"email_folder_origin", "email_ingress_label", "email_no_reply_warning",
	"gmail_message_id", "gmail_thread_id",
	"outlook_message_id", "outlook_internet_message_id", "outlook_conversation_id",
	"cuiqiu_message_id",
	standardMailProvider + "_message_id",
	emailHistoricalImportKey,
	messageAgentIDMetadataKey,
	publicChatCustomerIDMetadataKey,
	messageClientRequestIDKey,
	emailSendStatusKey,
	emailSendErrorKey,
	emailSendCompletedAtKey,
}
var textMetadataKeys = []string{
	"entryPageTitle", "entryPageUrl", "entryProductHandle", "entryProductTitle", "entryProductImageUrl", "entryProductPrice", "entryProductCurrencyCode",
	"mail_api_provider", "mail_api_mailbox", "mail_api_sent_at", "mail_api_mark_read_error", "mail_api_sent_message_id",
	emailSyncedSourceMessageIDKey,
	"mail_message_id", "mail_references", "mail_reply_to_email", "mail_reply_to_name",
	"email_has_attachments", "email_attachment_names", "email_attachment_import_error", "email_received_at_original",
	"email_attachment_archive_status", "email_attachment_archive_error", "email_attachment_archive_completed_at", "email_attachment_count", "email_attachment_archived_count",
	"email_folder_origin", "email_ingress_label", "email_no_reply_warning",
	"gmail_message_id", "gmail_thread_id",
	"outlook_message_id", "outlook_internet_message_id", "outlook_conversation_id",
	"cuiqiu_message_id",
	standardMailProvider + "_message_id",
	emailHistoricalImportKey,
	"workflow", "workflowStatus", "instantAnswerId",
	messageAgentIDMetadataKey,
	publicChatCustomerIDMetadataKey,
	messageClientRequestIDKey,
	emailSendStatusKey,
	emailSendErrorKey,
	emailSendCompletedAtKey,
}

func normalizeMessageContent(input Message) (Message, error) {
	input.Type = normalizeMessageType(input.Type)
	switch input.Type {
	case MessageTypeText:
		input.Metadata = copyMessageMetadata(input.Metadata, textMetadataKeys)
		if value := input.Metadata["entryPageUrl"]; value != "" && !isSafeHTTPURL(value) {
			return Message{}, fmt.Errorf("%w: entry page URL must use HTTP or HTTPS", ErrInvalid)
		}
	case MessageTypeImage:
		input.Metadata = copyMessageMetadata(input.Metadata, imageMetadataKeys)
		if !isSafeImageMessageURL(input.Metadata["url"]) {
			return Message{}, fmt.Errorf("%w: image message URL must use HTTP, HTTPS, or an Xzdesk attachment path", ErrInvalid)
		}
		if value := input.Metadata["entryPageUrl"]; value != "" && !isSafeHTTPURL(value) {
			return Message{}, fmt.Errorf("%w: entry page URL must use HTTP or HTTPS", ErrInvalid)
		}
	case MessageTypeFile:
		input.Metadata = copyMessageMetadata(input.Metadata, fileMetadataKeys)
		if !isSafeAttachmentURL(input.Metadata["url"]) {
			return Message{}, fmt.Errorf("%w: file message URL must use HTTP, HTTPS, or an Xzdesk attachment path", ErrInvalid)
		}
		if value := input.Metadata["entryPageUrl"]; value != "" && !isSafeHTTPURL(value) {
			return Message{}, fmt.Errorf("%w: entry page URL must use HTTP or HTTPS", ErrInvalid)
		}
	case MessageTypeProduct:
		input.Metadata = copyMessageMetadata(input.Metadata, productMetadataKeys)
		if value := input.Metadata["imageUrl"]; value != "" && !isSafeHTTPURL(value) {
			return Message{}, fmt.Errorf("%w: product image URL must use HTTP or HTTPS", ErrInvalid)
		}
		if value := input.Metadata["onlineStoreUrl"]; value != "" && !isSafeHTTPURL(value) {
			return Message{}, fmt.Errorf("%w: product page URL must use HTTP or HTTPS", ErrInvalid)
		}
	}
	if value := input.Metadata["entryProductImageUrl"]; value != "" && !isSafeHTTPURL(value) {
		return Message{}, fmt.Errorf("%w: entry product image URL must use HTTP or HTTPS", ErrInvalid)
	}
	return input, nil
}

func copyMessageMetadata(input map[string]string, allowedKeys []string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(allowedKeys))
	for _, key := range allowedKeys {
		if value := strings.TrimSpace(input[key]); value != "" {
			output[key] = value
		}
	}
	if len(output) == 0 {
		return nil
	}
	return output
}

func isSafeImageMessageURL(value string) bool {
	return isSafeAttachmentURL(value)
}

func isSafeAttachmentURL(value string) bool {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "/api/v1/chat/attachments/att_") || strings.HasPrefix(value, "/api/v1/chat/attachments/emailatt_") {
		return true
	}
	return isSafeHTTPURL(value)
}

func isSafeHTTPURL(value string) bool {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}
