package platform

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxChatImageSize = 8 << 20
const maxChatAttachmentSize = maxChatImageSize
const maxEmailAttachmentSize = 25 << 20

var chatImageExtensions = map[string]string{
	"image/jpeg": ".jpg",
	"image/png":  ".png",
	"image/gif":  ".gif",
	"image/webp": ".webp",
}

type chatAttachmentSpec struct {
	Extension string
	MIMEType  string
	Image     bool
}

var chatDocumentSpecs = map[string]chatAttachmentSpec{
	".pdf":  {Extension: ".pdf", MIMEType: "application/pdf"},
	".txt":  {Extension: ".txt", MIMEType: "text/plain; charset=utf-8"},
	".csv":  {Extension: ".csv", MIMEType: "text/csv; charset=utf-8"},
	".doc":  {Extension: ".doc", MIMEType: "application/msword"},
	".docx": {Extension: ".docx", MIMEType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
	".xls":  {Extension: ".xls", MIMEType: "application/vnd.ms-excel"},
	".xlsx": {Extension: ".xlsx", MIMEType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
	".ppt":  {Extension: ".ppt", MIMEType: "application/vnd.ms-powerpoint"},
	".pptx": {Extension: ".pptx", MIMEType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"},
}

func defaultChatUploadDir() string {
	if value := strings.TrimSpace(os.Getenv("XZDESK_UPLOAD_DIR")); value != "" {
		return filepath.Clean(value)
	}
	if dataFile := strings.TrimSpace(os.Getenv("DATA_FILE")); dataFile != "" {
		return filepath.Join(filepath.Dir(filepath.Clean(dataFile)), "uploads")
	}
	return filepath.Join(os.TempDir(), "xzdesk-uploads")
}

func detectChatAttachment(raw []byte, originalName string) (chatAttachmentSpec, error) {
	detected := strings.ToLower(strings.TrimSpace(http.DetectContentType(raw)))
	if extension, ok := chatImageExtensions[detected]; ok {
		return chatAttachmentSpec{Extension: extension, MIMEType: detected, Image: true}, nil
	}
	extension := strings.ToLower(filepath.Ext(filepath.Base(strings.TrimSpace(originalName))))
	spec, ok := chatDocumentSpecs[extension]
	if !ok {
		return chatAttachmentSpec{}, fmt.Errorf("only images, PDF, text, CSV, Word, Excel, and PowerPoint files are supported")
	}
	switch extension {
	case ".pdf":
		if detected != "application/pdf" {
			return chatAttachmentSpec{}, fmt.Errorf("file content does not match its PDF extension")
		}
	case ".txt", ".csv":
		if !strings.HasPrefix(detected, "text/plain") {
			return chatAttachmentSpec{}, fmt.Errorf("file content does not match its text extension")
		}
	case ".doc", ".xls", ".ppt":
		if !bytes.HasPrefix(raw, []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}) {
			return chatAttachmentSpec{}, fmt.Errorf("file content does not match its Microsoft Office extension")
		}
	case ".docx", ".xlsx", ".pptx":
		if !isOfficeOpenXMLFile(raw, extension) {
			return chatAttachmentSpec{}, fmt.Errorf("file content does not match its Microsoft Office extension")
		}
	}
	return spec, nil
}

func isOfficeOpenXMLFile(raw []byte, extension string) bool {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return false
	}
	requiredPrefix := map[string]string{".docx": "word/", ".xlsx": "xl/", ".pptx": "ppt/"}[extension]
	hasContentTypes := false
	hasDocumentPart := false
	for _, file := range reader.File {
		name := strings.ReplaceAll(file.Name, "\\", "/")
		if name == "[Content_Types].xml" {
			hasContentTypes = true
		}
		if strings.HasPrefix(name, requiredPrefix) {
			hasDocumentPart = true
		}
	}
	return hasContentTypes && hasDocumentPart
}

func storedChatAttachmentSpec(fileName string) (chatAttachmentSpec, bool) {
	extension := strings.ToLower(filepath.Ext(fileName))
	for mimeType, imageExtension := range chatImageExtensions {
		if extension == imageExtension {
			return chatAttachmentSpec{Extension: extension, MIMEType: mimeType, Image: true}, true
		}
	}
	spec, ok := chatDocumentSpecs[extension]
	if !ok && strings.HasPrefix(fileName, "emailatt_") {
		return chatAttachmentSpec{Extension: extension, MIMEType: "application/octet-stream"}, true
	}
	return spec, ok
}

func safeEmailAttachmentExtension(originalName string) string {
	extension := strings.ToLower(filepath.Ext(filepath.Base(strings.TrimSpace(originalName))))
	if len(extension) < 2 || len(extension) > 12 {
		return ".bin"
	}
	for _, value := range extension[1:] {
		if (value < 'a' || value > 'z') && (value < '0' || value > '9') {
			return ".bin"
		}
	}
	return extension
}

func (s *Server) saveEmailAttachment(raw []byte, originalName string, mimeType string) (string, string, chatAttachmentSpec, error) {
	if len(raw) == 0 || len(raw) > maxEmailAttachmentSize {
		return "", "", chatAttachmentSpec{}, fmt.Errorf("email attachment must be between 1 byte and 25 MB")
	}
	if err := os.MkdirAll(s.uploadDir, 0750); err != nil {
		return "", "", chatAttachmentSpec{}, fmt.Errorf("storage directory is unavailable")
	}
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	extension := safeEmailAttachmentExtension(originalName)
	spec := chatAttachmentSpec{Extension: extension, MIMEType: firstNonEmpty(mimeType, "application/octet-stream")}
	if imageExtension, ok := chatImageExtensions[mimeType]; ok {
		extension = imageExtension
		spec = chatAttachmentSpec{Extension: extension, MIMEType: mimeType, Image: true}
	}
	fileName := prefixedID("emailatt") + extension
	filePath := filepath.Join(s.uploadDir, fileName)
	if err := os.WriteFile(filePath, raw, 0640); err != nil {
		return "", "", chatAttachmentSpec{}, fmt.Errorf("file could not be stored")
	}
	return fileName, filePath, spec, nil
}

func (s *Server) saveChatAttachment(raw []byte, spec chatAttachmentSpec) (string, string, error) {
	if err := os.MkdirAll(s.uploadDir, 0750); err != nil {
		return "", "", fmt.Errorf("storage directory is unavailable")
	}
	fileName := prefixedID("att") + spec.Extension
	filePath := filepath.Join(s.uploadDir, fileName)
	if err := os.WriteFile(filePath, raw, 0640); err != nil {
		return "", "", fmt.Errorf("file could not be stored")
	}
	return fileName, filePath, nil
}

func (s *Server) handlePublicChatAttachmentUpload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxChatAttachmentSize+(1<<20))
	if err := r.ParseMultipartForm(maxChatAttachmentSize); err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "attachment upload failed: file must be 8 MB or smaller"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "attachment upload failed: file is required"})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxChatAttachmentSize+1))
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "attachment upload failed: file could not be read"})
		return
	}
	if len(raw) == 0 || len(raw) > maxChatAttachmentSize {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "attachment upload failed: file must be between 1 byte and 8 MB"})
		return
	}
	originalName := filepath.Base(strings.TrimSpace(header.Filename))
	if originalName == "." || originalName == "" {
		originalName = "attachment"
	}
	spec, err := detectChatAttachment(raw, originalName)
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "attachment upload failed: " + err.Error()})
		return
	}
	shop, source, err := s.publicChatContext(r.Context(), r.FormValue("shop"))
	if err != nil {
		writeError(w, err)
		return
	}
	clientMessageID, err := normalizePublicClientMessageID(r.FormValue("clientMessageId"))
	if err != nil {
		writeError(w, err)
		return
	}
	conversationID := strings.TrimSpace(r.FormValue("conversationId"))
	if conversationID == "" && clientMessageID != "" {
		candidateID := publicFirstConversationID(source.ID, clientMessageID)
		if existing, lookupErr := s.store.GetConversation(r.Context(), candidateID); lookupErr == nil {
			conversationID = existing.ID
		} else if !errors.Is(lookupErr, ErrNotFound) {
			writeError(w, lookupErr)
			return
		}
	}
	customerID, profile, err := s.authorizePublicChatCustomer(r.Context(), shop, source, conversationID, r.FormValue("customerSession"))
	if err != nil {
		writeError(w, err)
		return
	}
	created := false
	var conversation Conversation
	if conversationID != "" {
		conversation, err = s.store.GetConversation(r.Context(), conversationID)
		if err != nil {
			writeError(w, err)
			return
		}
		if conversation.ShopID != shop.ID || conversation.SourceID != source.ID {
			writeError(w, fmt.Errorf("%w: conversation does not belong to this shop", ErrInvalid))
			return
		}
		conversation, err = s.promotePublicSupportConversation(r.Context(), conversation)
		if err != nil {
			writeError(w, err)
			return
		}
	} else {
		conversation, err = s.store.CreateConversation(r.Context(), Conversation{
			ID:            publicFirstConversationID(source.ID, clientMessageID),
			ShopID:        shop.ID,
			SourceID:      source.ID,
			CustomerName:  customerProfileName(profile),
			CustomerEmail: customerProfileEmail(profile),
			Subject:       "Online chat",
			Status:        ConversationStatusOpen,
		})
		if err != nil {
			if clientMessageID == "" {
				writeError(w, err)
				return
			}
			conversation, err = s.store.GetConversation(r.Context(), publicFirstConversationID(source.ID, clientMessageID))
			if err != nil || conversation.ShopID != shop.ID || conversation.SourceID != source.ID {
				writeError(w, firstNonNilError(err, ErrConflict))
				return
			}
			created = false
		} else {
			created = true
		}
	}
	fileName, filePath, err := s.saveChatAttachment(raw, spec)
	if err != nil {
		writeJSONResponse(w, http.StatusInternalServerError, map[string]string{"error": "attachment upload failed: " + err.Error()})
		return
	}
	body := strings.TrimSpace(r.FormValue("caption"))
	if body == "" {
		body = originalName
	}
	metadata := publicEntryMetadata(
		r.FormValue("pageTitle"), r.FormValue("pageUrl"), r.FormValue("productHandle"),
		r.FormValue("productTitle"), r.FormValue("productImageUrl"), r.FormValue("productPrice"), r.FormValue("productCurrencyCode"),
	)
	if metadata == nil {
		metadata = map[string]string{}
	}
	metadata["url"] = s.chatAttachmentURL(r.Context(), fileName)
	metadata["mimeType"] = spec.MIMEType
	metadata["fileName"] = originalName
	metadata["fileSize"] = strconv.Itoa(len(raw))
	metadata = publicChatCustomerMetadata(metadata, customerID)
	messageType := MessageTypeFile
	if spec.Image {
		messageType = MessageTypeImage
	}
	requestedMessageID := prefixedID("msg")
	message, updated, err := s.store.AddMessage(r.Context(), Message{
		ID:              requestedMessageID,
		ConversationID:  conversation.ID,
		Direction:       MessageDirectionCustomer,
		Type:            messageType,
		Body:            body,
		Metadata:        metadata,
		SenderName:      firstNonEmpty(customerProfileName(profile), "Visitor"),
		SenderEmail:     customerProfileEmail(profile),
		SourceMessageID: publicVisitorMessageID(r.FormValue("visitorId"), fileName, clientMessageID),
	})
	if err != nil {
		_ = os.Remove(filePath)
		writeError(w, err)
		return
	}
	messageCreated := message.ID == requestedMessageID
	if !messageCreated {
		_ = os.Remove(filePath)
	}
	conversation = updated
	if created {
		s.broadcastConversationEvent(conversation, Event{Type: "conversation.created", ShopID: shop.ID, EntityID: conversation.ID, Payload: conversation, CreatedAt: time.Now().UTC()})
	}
	if messageCreated {
		s.broadcastConversationEvent(conversation, Event{Type: "message.created", ShopID: shop.ID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
		if routed, _, routeErr := s.tryAutoAssignConversation(r.Context(), conversation.ID); routeErr == nil {
			conversation = routed
		}
	}
	writeJSONResponse(w, http.StatusCreated, publicChatConversationResponse{
		Shop:         shop,
		Source:       source,
		Conversation: conversation,
		Messages:     []Message{message},
	})
}

func (s *Server) handleChatAttachmentUpload(w http.ResponseWriter, r *http.Request, user User, conversation Conversation) {
	if !userHasPermission(user, PermissionConversationReply) {
		writeError(w, ErrForbidden)
		return
	}
	if r.Method != http.MethodPost {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	emailSource, err := s.store.GetShopSource(r.Context(), conversation.ShopID, conversation.SourceID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		writeError(w, err)
		return
	}
	isEmailConversation := err == nil && emailSource.Type == SourceTypeEmail
	r.Body = http.MaxBytesReader(w, r.Body, maxChatImageSize+(1<<20))
	if err := r.ParseMultipartForm(maxChatImageSize); err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "image upload failed: file must be 8 MB or smaller"})
		return
	}
	file, header, err := r.FormFile("image")
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "image upload failed: image is required"})
		return
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, maxChatImageSize+1))
	if err != nil {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "image upload failed: file could not be read"})
		return
	}
	if len(raw) == 0 || len(raw) > maxChatImageSize {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "image upload failed: file must be between 1 byte and 8 MB"})
		return
	}
	mimeType := http.DetectContentType(raw)
	extension, ok := chatImageExtensions[mimeType]
	if !ok {
		writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "image upload failed: only JPEG, PNG, GIF, and WebP are supported"})
		return
	}
	originalName := filepath.Base(strings.TrimSpace(header.Filename))
	if originalName == "." || originalName == "" {
		originalName = "image" + extension
	}
	caption := strings.TrimSpace(r.FormValue("caption"))
	clientRequestID, requestIDErr := messageClientRequestID(map[string]string{messageClientRequestIDKey: r.FormValue("clientRequestId")})
	if requestIDErr != nil {
		writeError(w, requestIDErr)
		return
	}
	if isEmailConversation && clientRequestID == "" {
		clientRequestID = prefixedID("email_send")
	}
	var fileName string
	var filePath string
	messageMetadata := map[string]string(nil)
	body := caption
	if isEmailConversation {
		if emailSource.Status != SourceStatusActive {
			writeJSONResponse(w, http.StatusBadRequest, map[string]string{"error": "image upload failed: email channel is disabled"})
			return
		}
		fileName, filePath, err = s.saveChatAttachment(raw, chatAttachmentSpec{Extension: extension, MIMEType: mimeType, Image: true})
		if err != nil {
			writeJSONResponse(w, http.StatusInternalServerError, map[string]string{"error": "image upload failed: " + err.Error()})
			return
		}
		requestBody := firstNonEmpty(caption, originalName)
		requestMessage := Message{ConversationID: conversation.ID, Direction: MessageDirectionAgent, Body: requestBody, Type: MessageTypeImage, Metadata: map[string]string{
			"url":                     s.chatAttachmentURL(r.Context(), fileName),
			"mimeType":                mimeType,
			"fileName":                originalName,
			messageClientRequestIDKey: clientRequestID,
		}}
		message, updatedConversation, reconciled, queueErr := s.enqueueAgentEmailMessage(r.Context(), emailSource, conversation, requestMessage, user, clientRequestID)
		if queueErr != nil {
			_ = os.Remove(filePath)
			writeError(w, queueErr)
			return
		}
		if message.Metadata["url"] != requestMessage.Metadata["url"] {
			_ = os.Remove(filePath)
		}
		if !reconciled {
			s.broadcastConversationEvent(updatedConversation, Event{Type: "message.created", ShopID: updatedConversation.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
		} else {
			s.broadcastConversationEvent(updatedConversation, Event{Type: "message.updated", ShopID: updatedConversation.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
		}
		s.signalEmailOutboxWorker()
		status := http.StatusAccepted
		if reconciled {
			status = http.StatusOK
		}
		writeJSONResponse(w, status, message)
		return
	} else {
		fileName, filePath, err = s.saveChatAttachment(raw, chatAttachmentSpec{Extension: extension, MIMEType: mimeType, Image: true})
		if err != nil {
			writeJSONResponse(w, http.StatusInternalServerError, map[string]string{"error": "image upload failed: " + err.Error()})
			return
		}
		messageMetadata = map[string]string{
			"url": s.chatAttachmentURL(r.Context(), fileName), "mimeType": mimeType,
			"fileName": originalName, messageClientRequestIDKey: clientRequestID,
		}
	}
	if body == "" {
		body = originalName
	}
	message := Message{ConversationID: conversation.ID, Direction: MessageDirectionAgent, Type: MessageTypeImage, Body: body, Metadata: messageMetadata}
	message, updatedConversation, err := s.store.AddAgentMessage(r.Context(), message, user.ID)
	if err != nil {
		_ = os.Remove(filePath)
		writeError(w, err)
		return
	}
	s.broadcastConversationEvent(updatedConversation, Event{Type: "message.created", ShopID: updatedConversation.ShopID, EntityID: message.ID, Payload: message, CreatedAt: time.Now().UTC()})
	writeJSONResponse(w, http.StatusCreated, message)
}

func (s *Server) storedChatAttachmentFile(rawURL string) (string, string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", "", ErrNotFound
	}
	parts := splitPath(parsed.Path)
	if len(parts) != 5 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "chat" || parts[3] != "attachments" {
		return "", "", ErrNotFound
	}
	fileName := parts[4]
	if fileName != filepath.Base(fileName) || (!strings.HasPrefix(fileName, "att_") && !strings.HasPrefix(fileName, "emailatt_")) {
		return "", "", ErrNotFound
	}
	if _, ok := storedChatAttachmentSpec(fileName); !ok {
		return "", "", ErrNotFound
	}
	filePath := filepath.Join(s.uploadDir, fileName)
	info, err := os.Stat(filePath)
	if err != nil || info.IsDir() {
		return "", "", ErrNotFound
	}
	return fileName, filePath, nil
}

func (s *Server) chatAttachmentURL(ctx context.Context, fileName string) string {
	value := "/api/v1/chat/attachments/" + fileName
	bound, ok := s.store.(ERPTenantBoundStore)
	if !ok {
		return value
	}
	tenantID, err := bound.GetERPTenantBinding(ctx)
	if err != nil || strings.TrimSpace(tenantID) == "" {
		return value
	}
	return value + "?tenant=" + url.QueryEscape(tenantID)
}

func (s *Server) handleChatAttachmentFile(w http.ResponseWriter, r *http.Request) {
	parts := splitPath(r.URL.Path)
	if len(parts) != 5 || parts[0] != "api" || parts[1] != "v1" || parts[2] != "chat" || parts[3] != "attachments" {
		http.NotFound(w, r)
		return
	}
	fileName := parts[4]
	if fileName != filepath.Base(fileName) || (!strings.HasPrefix(fileName, "att_") && !strings.HasPrefix(fileName, "emailatt_")) {
		http.NotFound(w, r)
		return
	}
	filePath := filepath.Join(s.uploadDir, fileName)
	file, err := os.Open(filePath)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	spec, ok := storedChatAttachmentSpec(fileName)
	if !ok {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", spec.MIMEType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	if !spec.Image {
		downloadName := filepath.Base(strings.TrimSpace(r.URL.Query().Get("name")))
		if downloadName == "." || downloadName == "" {
			downloadName = fileName
		}
		if strings.ToLower(filepath.Ext(downloadName)) != spec.Extension {
			downloadName += spec.Extension
		}
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": downloadName}))
	}
	http.ServeContent(w, r, fileName, info.ModTime(), file)
}
