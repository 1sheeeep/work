package platform

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	emailAttachmentArchiveWorkerCount = 2
	emailAttachmentPriorityBackground = 10
	emailAttachmentPriorityExport     = 100
	emailAttachmentArchiveTimeout     = 2 * time.Minute
	emailAttachmentClaimRetryDelay    = 30 * time.Second
)

type emailAttachmentArchiveSummary struct {
	Total     int
	Succeeded int
	Failed    int
	Warnings  []string
}

func (s *Server) notifyEmailAttachmentWorkers() {
	for worker := 0; worker < emailAttachmentArchiveWorkerCount; worker++ {
		select {
		case s.emailAttachmentWake <- struct{}{}:
		default:
		}
	}
}

func providerMessageIDForAttachmentArchive(provider string, message Message) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "gmail":
		return firstNonEmpty(message.Metadata["gmail_message_id"], stripEmailMessagePrefix(message.SourceMessageID, "gmail"))
	case "outlook":
		return firstNonEmpty(message.Metadata["outlook_message_id"], stripEmailMessagePrefix(message.SourceMessageID, "outlook"))
	case cuiqiuProvider:
		return firstNonEmpty(message.Metadata["cuiqiu_message_id"], stripEmailMessagePrefix(message.SourceMessageID, cuiqiuProvider))
	case standardMailProvider:
		return firstNonEmpty(message.Metadata[standardMailProvider+"_message_id"], standardMessageUID(message.SourceMessageID))
	default:
		return ""
	}
}

func standardMessageUID(sourceMessageID string) string {
	parts := strings.Split(strings.TrimSpace(sourceMessageID), ":")
	if len(parts) == 3 && parts[0] == standardMailProvider {
		return strings.TrimSpace(parts[2])
	}
	return ""
}

func (s *Server) enqueueEmailAttachmentArchive(ctx context.Context, source ShopSource, message Message, priority int) error {
	queue, ok := s.store.(emailAttachmentJobStore)
	if !ok {
		return errors.New("email attachment queue storage is unavailable")
	}
	providerMessageID := providerMessageIDForAttachmentArchive(source.Provider, message)
	if providerMessageID == "" {
		return fmt.Errorf("%w: provider message identity is missing", ErrInvalid)
	}
	_, err := queue.EnqueueEmailAttachmentJob(ctx, EmailAttachmentJob{
		ShopID: source.ShopID, SourceID: source.ID, ConversationID: message.ConversationID,
		MessageID: message.ID, Provider: source.Provider, ProviderMessageID: providerMessageID,
		Priority: priority,
	})
	if err != nil {
		return err
	}
	_, _ = s.store.UpdateMessageMetadata(ctx, message.ConversationID, message.ID, map[string]string{
		"email_attachment_archive_status": "queued",
	})
	s.notifyEmailAttachmentWorkers()
	return nil
}

func (s *Server) StartEmailAttachmentArchives(ctx context.Context) {
	queue, ok := s.store.(emailAttachmentJobStore)
	if !ok {
		log.Printf("email attachment queue: durable store is unavailable")
		return
	}
	if recovered, err := queue.RecoverEmailAttachmentJobs(ctx, time.Now().UTC().Add(-5*time.Minute)); err != nil {
		if ctx.Err() == nil {
			log.Printf("email attachment queue: recover interrupted jobs failed: %v", err)
		}
	} else if recovered > 0 {
		log.Printf("email attachment queue: recovered %d interrupted job(s)", recovered)
	}
	for worker := 0; worker < emailAttachmentArchiveWorkerCount; worker++ {
		go s.runEmailAttachmentArchiveWorker(ctx, queue)
	}
}

func (s *Server) emailAttachmentRunningSources() []string {
	s.emailAttachmentRunMu.Lock()
	defer s.emailAttachmentRunMu.Unlock()
	out := make([]string, 0, len(s.emailAttachmentRun))
	for sourceID := range s.emailAttachmentRun {
		out = append(out, sourceID)
	}
	return out
}

func (s *Server) reserveEmailAttachmentSource(sourceID string) bool {
	s.emailAttachmentRunMu.Lock()
	defer s.emailAttachmentRunMu.Unlock()
	if s.emailAttachmentRun[sourceID] {
		return false
	}
	s.emailAttachmentRun[sourceID] = true
	return true
}

func (s *Server) releaseEmailAttachmentSource(sourceID string) {
	s.emailAttachmentRunMu.Lock()
	delete(s.emailAttachmentRun, sourceID)
	s.emailAttachmentRunMu.Unlock()
}

func (s *Server) runEmailAttachmentArchiveWorker(ctx context.Context, queue emailAttachmentJobStore) {
	for {
		job, err := queue.ClaimEmailAttachmentJob(ctx, s.emailAttachmentRunningSources(), time.Now().UTC())
		if err == nil {
			if !s.reserveEmailAttachmentSource(job.SourceID) {
				_ = queue.FinishEmailAttachmentJob(context.WithoutCancel(ctx), job.MessageID, time.Now().UTC().Add(time.Second), "waiting for the same mailbox")
				continue
			}
			s.processEmailAttachmentArchiveJob(ctx, queue, job)
			s.releaseEmailAttachmentSource(job.SourceID)
			continue
		}
		claimFailed := !errors.Is(err, ErrNotFound)
		if claimFailed && ctx.Err() == nil {
			log.Printf("email attachment queue: claim failed: %v", err)
		}
		var due <-chan time.Time
		var timer *time.Timer
		if claimFailed {
			timer = time.NewTimer(emailAttachmentClaimRetryDelay)
			due = timer.C
		} else if availableAt, nextErr := queue.NextEmailAttachmentJobAvailableAt(ctx); nextErr == nil {
			delay := time.Until(availableAt)
			if delay < 0 {
				delay = 0
			}
			timer = time.NewTimer(delay)
			due = timer.C
		}
		select {
		case <-ctx.Done():
			if timer != nil {
				timer.Stop()
			}
			return
		case <-s.emailAttachmentWake:
			if timer != nil {
				timer.Stop()
			}
		case <-due:
		}
	}
}

func (s *Server) processEmailAttachmentArchiveJob(parent context.Context, queue emailAttachmentJobStore, job EmailAttachmentJob) {
	ctx, cancel := context.WithTimeout(parent, emailAttachmentArchiveTimeout)
	defer cancel()
	_, err := s.archiveEmailAttachments(ctx, job)
	finishCtx, finishCancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
	defer finishCancel()
	if err == nil {
		_ = queue.FinishEmailAttachmentJob(finishCtx, job.MessageID, time.Time{}, "")
		return
	}
	if job.Attempts < 3 && !emailRetryStateIsPermanent(emailRetryStateForError(err)) {
		delay := 10 * time.Minute
		if job.Attempts > 1 {
			delay = time.Hour
		}
		_ = queue.FinishEmailAttachmentJob(finishCtx, job.MessageID, time.Now().UTC().Add(delay), truncateEmailPreview(err.Error(), 500))
		return
	}
	finalStatus := "failed"
	if message, lookupErr := s.store.GetMessage(finishCtx, job.ConversationID, job.MessageID); lookupErr == nil {
		if archivedCount, parseErr := strconv.Atoi(strings.TrimSpace(message.Metadata["email_attachment_archived_count"])); parseErr == nil && archivedCount > 0 {
			finalStatus = "partial"
		}
	}
	_, _ = s.store.UpdateMessageMetadata(finishCtx, job.ConversationID, job.MessageID, map[string]string{
		"email_attachment_archive_status": finalStatus,
		"email_attachment_archive_error":  truncateEmailPreview(err.Error(), 500),
	})
	_ = queue.FinishEmailAttachmentJob(finishCtx, job.MessageID, time.Time{}, "")
	s.recordEmailRuntimeEvent(finishCtx, EmailRuntimeEvent{
		Category: "attachment.archive_failed", Severity: "warning", ShopID: job.ShopID, SourceID: job.SourceID,
		EntityID: job.MessageID, Message: "邮件附件后台保存失败，可在导出时再次补取",
	})
}

func (s *Server) archiveEmailAttachments(ctx context.Context, job EmailAttachmentJob) (emailAttachmentArchiveSummary, error) {
	message, err := s.store.GetMessage(ctx, job.ConversationID, job.MessageID)
	if err != nil {
		return emailAttachmentArchiveSummary{}, err
	}
	source, err := s.store.GetShopSource(ctx, job.ShopID, job.SourceID)
	if err != nil {
		return emailAttachmentArchiveSummary{}, err
	}
	installation, err := s.store.GetEmailInstallation(ctx, source.ShopID, source.Address)
	if err != nil {
		return emailAttachmentArchiveSummary{}, fmt.Errorf("邮箱授权不存在，无法补取附件: %w", err)
	}
	installation.Provider = source.Provider
	installation, err = s.emailInstallationWithFreshToken(ctx, installation)
	if err != nil {
		return emailAttachmentArchiveSummary{}, fmt.Errorf("邮箱授权不可用，无法补取附件: %w", err)
	}
	attachments, warnings, fetchErr := s.fetchArchivedEmailAttachments(ctx, source, installation, message, job.ProviderMessageID)
	if fetchErr != nil && len(attachments) == 0 {
		return emailAttachmentArchiveSummary{}, fetchErr
	}
	if fetchErr != nil {
		warnings = append(warnings, fetchErr.Error())
	}
	if len(attachments) == 0 && len(warnings) == 0 && strings.EqualFold(message.Metadata["email_has_attachments"], "true") {
		warnings = append(warnings, "邮箱服务商未返回可下载的附件")
	}
	messages, err := s.store.ListMessages(ctx, job.ConversationID)
	if err != nil {
		return emailAttachmentArchiveSummary{}, err
	}
	existingCounts := map[string]int{}
	nextIndex := 0
	for _, candidate := range messages {
		if !strings.HasPrefix(candidate.SourceMessageID, message.SourceMessageID+":attachment:") {
			continue
		}
		if index, parseErr := strconv.Atoi(strings.TrimPrefix(candidate.SourceMessageID, message.SourceMessageID+":attachment:")); parseErr == nil && index >= nextIndex {
			nextIndex = index + 1
		}
		if _, filePath, fileErr := s.storedChatAttachmentFile(candidate.Metadata["url"]); fileErr == nil {
			if info, statErr := os.Stat(filePath); statErr == nil && !info.IsDir() {
				existingCounts[strings.ToLower(firstNonEmpty(candidate.Metadata["fileName"], candidate.Body))]++
			}
		}
	}
	input := incomingEmailMessage{
		SourceMessageID: message.SourceMessageID, Metadata: message.Metadata, ReceivedAt: message.CreatedAt,
		SenderName: message.SenderName, SenderEmail: message.SenderEmail, Direction: message.Direction,
	}
	succeeded := 0
	allNames := []string{}
	for _, attachment := range attachments {
		nameKey := strings.ToLower(strings.TrimSpace(attachment.FileName))
		allNames = append(allNames, attachment.FileName)
		if existingCounts[nameKey] > 0 {
			existingCounts[nameKey]--
			succeeded++
			continue
		}
		created, updated, addErr := s.addIncomingEmailAttachment(ctx, Conversation{ID: job.ConversationID, ShopID: job.ShopID, SourceID: job.SourceID}, input, attachment, nextIndex)
		if addErr != nil {
			warnings = append(warnings, attachment.FileName+": "+addErr.Error())
			nextIndex++
			continue
		}
		nextIndex++
		succeeded++
		s.broadcastConversationEvent(updated, Event{Type: "message.created", ShopID: job.ShopID, EntityID: created.ID, Payload: created, CreatedAt: time.Now().UTC()})
	}
	allNames = uniqueStrings(append(strings.Split(message.Metadata["email_attachment_names"], "\n"), allNames...))
	status := "completed"
	if len(warnings) > 0 {
		status = "partial"
	}
	summary := emailAttachmentArchiveSummary{
		Total: len(attachments) + len(warnings), Succeeded: succeeded, Failed: len(warnings), Warnings: warnings,
	}
	patch := map[string]string{
		"email_has_attachments":                 "true",
		"email_attachment_names":                strings.Join(allNames, "\n"),
		"email_attachment_archive_status":       status,
		"email_attachment_archive_completed_at": time.Now().UTC().Format(time.RFC3339),
		"email_attachment_count":                strconv.Itoa(summary.Total),
		"email_attachment_archived_count":       strconv.Itoa(summary.Succeeded),
	}
	if len(warnings) > 0 {
		patch["email_attachment_archive_error"] = truncateEmailPreview(strings.Join(warnings, "; "), 500)
	} else {
		patch["email_attachment_archive_error"] = ""
	}
	if _, err := s.store.UpdateMessageMetadata(ctx, job.ConversationID, job.MessageID, patch); err != nil {
		return summary, err
	}
	return summary, fetchErr
}

func (s *Server) fetchArchivedEmailAttachments(ctx context.Context, source ShopSource, installation EmailInstallation, message Message, providerMessageID string) ([]incomingEmailAttachment, []string, error) {
	switch strings.ToLower(strings.TrimSpace(source.Provider)) {
	case "gmail":
		var full platformGmailMessage
		endpoint := gmailAPIBase() + "/users/me/messages/" + url.PathEscape(providerMessageID) + "?format=full"
		if err := getProviderJSON(ctx, installation.AccessToken, endpoint, &full); err != nil {
			return nil, nil, fmt.Errorf("Gmail附件原邮件读取失败: %w", err)
		}
		attachments, warnings, err := fetchGmailAllAttachments(ctx, installation.AccessToken, providerMessageID, full.Payload)
		if err != nil {
			return attachments, warnings, fmt.Errorf("Gmail附件读取失败: %w", err)
		}
		return attachments, warnings, nil
	case "outlook":
		attachments, warnings, err := fetchOutlookAllAttachments(ctx, installation.AccessToken, providerMessageID)
		if err != nil {
			return attachments, warnings, fmt.Errorf("Outlook附件读取失败: %w", err)
		}
		return attachments, warnings, nil
	case cuiqiuProvider:
		config, err := cuiqiuConfigFrom(source, installation)
		if err != nil {
			return nil, nil, err
		}
		detail, err := fetchCuiqiuMessageDetail(ctx, config, "Inbox", providerMessageID)
		if err != nil {
			return nil, nil, fmt.Errorf("脆球附件原邮件读取失败: %w", err)
		}
		attachments, parseErr := parseCuiqiuAttachments(detail.Attachments)
		if parseErr != nil {
			return attachments, []string{parseErr.Error()}, nil
		}
		return attachments, nil, nil
	case standardMailProvider:
		config, err := standardMailConfigFrom(source, installation)
		if err != nil {
			return nil, nil, err
		}
		uid64, err := strconv.ParseUint(providerMessageID, 10, 32)
		if err != nil || uid64 == 0 {
			return nil, nil, fmt.Errorf("IMAP附件原邮件UID无效")
		}
		client, err := dialStandardIMAP(ctx, config)
		if err != nil {
			return nil, nil, err
		}
		defer func() { _ = client.Logout() }()
		mailboxStatus, err := client.Select("INBOX", true)
		if err != nil {
			return nil, nil, fmt.Errorf("IMAP附件邮箱读取失败: %w", err)
		}
		parts := strings.Split(message.SourceMessageID, ":")
		if len(parts) == 3 {
			originalValidity, _ := strconv.ParseUint(parts[1], 10, 32)
			if originalValidity != 0 && uint32(originalValidity) != mailboxStatus.UidValidity {
				return nil, nil, fmt.Errorf("IMAP邮箱UID已重建，无法定位原附件")
			}
		}
		items, _, err := fetchStandardIMAPMessages(client, config.Mailbox, mailboxStatus.UidValidity, []uint32{uint32(uid64)})
		if err != nil {
			return nil, nil, err
		}
		if len(items) != 1 {
			return nil, nil, fmt.Errorf("IMAP原邮件已不存在")
		}
		return items[0].Attachments, nil, nil
	default:
		return nil, nil, fmt.Errorf("不支持从%s补取附件", source.Provider)
	}
}

type archivedEmailAttachment struct {
	Name         string
	RelativePath string
	FilePath     string
	Inline       bool
}

func (s *Server) archivedAttachmentsForMessage(ctx context.Context, record emailStatisticsRecord) ([]archivedEmailAttachment, error) {
	messages, err := s.store.ListMessages(ctx, record.ConversationID)
	if err != nil {
		return nil, err
	}
	out := []archivedEmailAttachment{}
	for _, message := range messages {
		if normalizeMessageType(message.Type) != MessageTypeImage && normalizeMessageType(message.Type) != MessageTypeFile {
			continue
		}
		if !strings.HasPrefix(message.SourceMessageID, record.UniqueID+":attachment:") && !strings.HasPrefix(message.SourceMessageID, providerSourceMessageID(record.Provider, record.UniqueID)+":attachment:") {
			continue
		}
		_, filePath, fileErr := s.storedChatAttachmentFile(message.Metadata["url"])
		if fileErr != nil {
			continue
		}
		name := filepath.Base(firstNonEmpty(message.Metadata["fileName"], message.Body, "attachment"))
		out = append(out, archivedEmailAttachment{Name: name, FilePath: filePath, Inline: strings.EqualFold(message.Metadata["email_attachment_inline"], "true")})
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func providerSourceMessageID(provider string, uniqueID string) string {
	uniqueID = strings.TrimSpace(uniqueID)
	if strings.HasPrefix(uniqueID, strings.ToLower(strings.TrimSpace(provider))+":") || strings.HasPrefix(uniqueID, standardMailProvider+":") || strings.HasPrefix(uniqueID, cuiqiuProvider+":") {
		return uniqueID
	}
	return strings.ToLower(strings.TrimSpace(provider)) + ":" + uniqueID
}
