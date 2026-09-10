package platform

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	emailExportStatusQueued    = "queued"
	emailExportStatusRunning   = "running"
	emailExportStatusCompleted = "completed"
	emailExportStatusFailed    = "failed"
	emailExportClaimRetryDelay = 30 * time.Second
)

func (s *Server) notifyEmailExportWorker() {
	select {
	case s.emailExportWake <- struct{}{}:
	default:
	}
}

type emailExportJobResponse struct {
	ID                  string    `json:"id"`
	Status              string    `json:"status"`
	Filename            string    `json:"filename,omitempty"`
	RowCount            int       `json:"rowCount"`
	ProgressStage       string    `json:"progressStage,omitempty"`
	AttachmentTotal     int       `json:"attachmentTotal"`
	AttachmentProcessed int       `json:"attachmentProcessed"`
	AttachmentSucceeded int       `json:"attachmentSucceeded"`
	AttachmentFailed    int       `json:"attachmentFailed"`
	LastError           string    `json:"lastError,omitempty"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
	CompletedAt         time.Time `json:"completedAt,omitempty"`
	ExpiresAt           time.Time `json:"expiresAt"`
}

func publicEmailExportJob(job EmailExportJob) emailExportJobResponse {
	return emailExportJobResponse{
		ID: job.ID, Status: job.Status, Filename: job.Filename, RowCount: job.RowCount,
		ProgressStage: job.ProgressStage, AttachmentTotal: job.AttachmentTotal,
		AttachmentProcessed: job.AttachmentProcessed, AttachmentSucceeded: job.AttachmentSucceeded, AttachmentFailed: job.AttachmentFailed,
		LastError: job.LastError, CreatedAt: job.CreatedAt, UpdatedAt: job.UpdatedAt,
		CompletedAt: job.CompletedAt, ExpiresAt: job.ExpiresAt,
	}
}

func (s *Server) handleCreateEmailStatisticsExport(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionEmailStatisticsView)
	if !ok {
		return
	}
	store, ok := s.store.(emailExportJobStore)
	if !ok {
		writeError(w, errors.New("email export queue storage is unavailable"))
		return
	}
	filter, err := parseEmailStatisticsFilter(r)
	if err != nil {
		writeError(w, err)
		return
	}
	if err := validateEmailStatisticsExportFilter(filter); err != nil {
		writeError(w, err)
		return
	}
	encoded, err := json.Marshal(filter)
	if err != nil {
		writeError(w, fmt.Errorf("encode email export filter: %w", err))
		return
	}
	job, err := store.CreateEmailExportJob(r.Context(), EmailExportJob{
		RequestedBy: user.ID, Filter: string(encoded), ExpiresAt: time.Now().UTC().Add(24 * time.Hour),
	})
	if err != nil {
		writeError(w, err)
		return
	}
	s.notifyEmailExportWorker()
	writeJSONResponse(w, http.StatusAccepted, publicEmailExportJob(job))
}

func (s *Server) handleEmailStatisticsExportSubroutes(w http.ResponseWriter, r *http.Request) {
	user, ok := s.requirePermission(w, r, PermissionEmailStatisticsView)
	if !ok {
		return
	}
	store, ok := s.store.(emailExportJobStore)
	if !ok {
		writeError(w, errors.New("email export queue storage is unavailable"))
		return
	}
	parts := splitPath(strings.TrimPrefix(r.URL.Path, "/api/v1/email-statistics/exports/"))
	if len(parts) == 0 || len(parts) > 2 {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	job, err := store.GetEmailExportJob(r.Context(), parts[0])
	if err != nil {
		writeError(w, err)
		return
	}
	if user.ID != job.RequestedBy && user.Role != UserRoleAdmin {
		writeError(w, ErrForbidden)
		return
	}
	if len(parts) == 1 {
		writeJSONResponse(w, http.StatusOK, publicEmailExportJob(job))
		return
	}
	if parts[1] != "download" || job.Status != emailExportStatusCompleted {
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	filePath, err := s.safeEmailExportPath(job.FilePath)
	if err != nil {
		writeError(w, ErrNotFound)
		return
	}
	file, err := os.Open(filePath)
	if err != nil {
		writeError(w, ErrNotFound)
		return
	}
	defer file.Close()
	stat, err := file.Stat()
	if err != nil || stat.IsDir() {
		writeError(w, ErrNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename*=UTF-8''%s", url.QueryEscape(job.Filename)))
	http.ServeContent(w, r, job.Filename, stat.ModTime(), file)
}

func (s *Server) StartEmailStatisticsExports(ctx context.Context) {
	store, ok := s.store.(emailExportJobStore)
	if !ok {
		log.Printf("email export queue: durable store is unavailable")
		return
	}
	if recovered, err := store.RecoverEmailExportJobs(ctx, time.Now().UTC().Add(-10*time.Minute)); err != nil {
		if ctx.Err() == nil {
			log.Printf("email export queue: recover interrupted jobs failed: %v", err)
		}
	} else if recovered > 0 {
		log.Printf("email export queue: recovered %d interrupted job(s)", recovered)
	}
	go s.runEmailStatisticsExportWorker(ctx, store)
	go s.runEmailStatisticsExportCleanup(ctx, store)
}

func (s *Server) runEmailStatisticsExportWorker(ctx context.Context, store emailExportJobStore) {
	for {
		job, err := store.ClaimEmailExportJob(ctx)
		if err == nil {
			s.processEmailStatisticsExport(ctx, store, job)
			continue
		}
		claimFailed := !errors.Is(err, ErrNotFound)
		if claimFailed && ctx.Err() == nil {
			log.Printf("email export queue: claim failed: %v", err)
		}
		var retry <-chan time.Time
		var timer *time.Timer
		if claimFailed {
			timer = time.NewTimer(emailExportClaimRetryDelay)
			retry = timer.C
		}
		select {
		case <-ctx.Done():
			if timer != nil && !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			return
		case <-s.emailExportWake:
			if timer != nil && !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
		case <-retry:
		}
	}
}

func (s *Server) processEmailStatisticsExport(parent context.Context, store emailExportJobStore, job EmailExportJob) {
	finish := func(status string, filename string, filePath string, rowCount int, lastError string) {
		finishCtx, cancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
		defer cancel()
		updated, err := store.FinishEmailExportJob(finishCtx, job.ID, status, filename, filePath, rowCount, lastError)
		if err != nil {
			log.Printf("email export queue: finish %s failed: %v", job.ID, err)
			return
		}
		s.broadcast(Event{Type: "email_export.updated", EntityID: job.ID, Payload: publicEmailExportJob(updated), CreatedAt: time.Now().UTC()})
		if status == emailExportStatusFailed {
			s.recordEmailRuntimeEvent(finishCtx, EmailRuntimeEvent{
				Category: "export.failed", Severity: "error", EntityID: job.ID, Message: "邮件统计后台导出失败",
			})
		}
	}
	var filter emailStatisticsFilter
	if err := json.Unmarshal([]byte(job.Filter), &filter); err != nil {
		finish(emailExportStatusFailed, "", "", 0, "导出筛选条件已损坏")
		return
	}
	user, err := s.store.GetUser(parent, job.RequestedBy)
	if err != nil || user.Status != UserStatusActive || !userHasPermission(user, PermissionEmailStatisticsView) {
		finish(emailExportStatusFailed, "", "", 0, "导出账号已失效或权限不足")
		return
	}
	updateProgress := func(stage string, total int, processed int, succeeded int, failed int) {
		progressCtx, cancel := context.WithTimeout(context.WithoutCancel(parent), 5*time.Second)
		defer cancel()
		updated, progressErr := store.UpdateEmailExportProgress(progressCtx, job.ID, stage, total, processed, succeeded, failed)
		if progressErr == nil {
			s.broadcast(Event{Type: "email_export.updated", EntityID: job.ID, Payload: publicEmailExportJob(updated), CreatedAt: time.Now().UTC()})
		}
	}
	updateProgress("准备邮件数据", 0, 0, 0, 0)
	data, err := s.emailStatisticsData(parent, user, filter, false)
	if err != nil {
		if parent.Err() != nil {
			finish(emailExportStatusQueued, "", "", 0, "")
			return
		}
		finish(emailExportStatusFailed, "", "", 0, "读取邮件统计数据失败，请稍后重试")
		return
	}
	attachments, attachmentSummary := s.prepareEmailStatisticsExportAttachments(parent, data.Records, updateProgress)
	if parent.Err() != nil {
		finish(emailExportStatusQueued, "", "", 0, "")
		return
	}
	content, err := buildEmailStatisticsWorkbook(data.Records, data.Bodies, time.Now())
	if err != nil {
		finish(emailExportStatusFailed, "", "", 0, "生成邮件统计表格失败，请缩小筛选范围后重试")
		return
	}
	updateProgress("压缩附件", attachmentSummary.Total, attachmentSummary.Processed, attachmentSummary.Succeeded, attachmentSummary.Failed)
	exportDir, err := s.emailExportDir()
	if err != nil {
		finish(emailExportStatusFailed, "", "", 0, "导出文件存储暂不可用")
		return
	}
	if err := os.MkdirAll(exportDir, 0o750); err != nil {
		finish(emailExportStatusFailed, "", "", 0, "导出文件存储暂不可用")
		return
	}
	filename := fmt.Sprintf("Xzdesk_邮件统计_%s.zip", time.Now().In(shanghaiLocation()).Format("20060102_150405"))
	filePath := filepath.Join(exportDir, job.ID+".zip")
	temporaryPath := filePath + ".tmp"
	if err := writeEmailStatisticsArchive(temporaryPath, content, attachments); err != nil {
		finish(emailExportStatusFailed, "", "", 0, "写入导出文件失败，请稍后重试")
		return
	}
	if err := os.Rename(temporaryPath, filePath); err != nil {
		_ = os.Remove(temporaryPath)
		finish(emailExportStatusFailed, "", "", 0, "保存导出文件失败，请稍后重试")
		return
	}
	updateProgress("导出完成", attachmentSummary.Total, attachmentSummary.Processed, attachmentSummary.Succeeded, attachmentSummary.Failed)
	finish(emailExportStatusCompleted, filename, filePath, len(data.Records), "")
}

type emailStatisticsExportAttachmentSummary struct {
	Total     int
	Processed int
	Succeeded int
	Failed    int
}

func (s *Server) prepareEmailStatisticsExportAttachments(ctx context.Context, records []emailStatisticsRecord, progress func(string, int, int, int, int)) ([]archivedEmailAttachment, emailStatisticsExportAttachmentSummary) {
	all := []archivedEmailAttachment{}
	summary := emailStatisticsExportAttachmentSummary{}
	for index := range records {
		if !records[index].HasAttachments {
			records[index].AttachmentCount = 0
			records[index].AttachmentExportResult = "无附件"
			continue
		}
		knownCount := records[index].AttachmentCount
		if knownCount < len(records[index].AttachmentNames) {
			knownCount = len(records[index].AttachmentNames)
		}
		if knownCount == 0 {
			knownCount = 1
		}
		summary.Total += knownCount
	}
	progress("补取附件", summary.Total, 0, 0, 0)
	lastProgress := time.Now()
	for index := range records {
		record := &records[index]
		if !record.HasAttachments {
			continue
		}
		archived, listErr := s.archivedAttachmentsForMessage(ctx, *record)
		archiveErr := listErr
		knownCount := record.AttachmentCount
		if knownCount < len(record.AttachmentNames) {
			knownCount = len(record.AttachmentNames)
		}
		initialExpected := knownCount
		if initialExpected == 0 {
			initialExpected = 1
		}
		message, messageErr := s.store.GetMessage(ctx, record.ConversationID, record.MessageID)
		archiveCompleted := messageErr == nil && strings.EqualFold(message.Metadata["email_attachment_archive_status"], "completed")
		attachmentsAlreadyComplete := (knownCount > 0 && len(archived) >= knownCount) || (knownCount == 0 && archiveCompleted && len(archived) > 0)
		if messageErr != nil && archiveErr == nil {
			archiveErr = messageErr
		}
		if messageErr == nil && !attachmentsAlreadyComplete {
			providerMessageID := providerMessageIDForAttachmentArchive(record.Provider, message)
			if providerMessageID == "" {
				archiveErr = fmt.Errorf("原邮件标识缺失，无法补取")
			} else if s.waitForEmailAttachmentSource(ctx, record.SourceID) {
				_, archiveErr = s.archiveEmailAttachments(ctx, EmailAttachmentJob{
					ShopID: record.ShopID, SourceID: record.SourceID, ConversationID: record.ConversationID,
					MessageID: record.MessageID, Provider: record.Provider, ProviderMessageID: providerMessageID,
					Priority: emailAttachmentPriorityExport,
				})
				s.releaseEmailAttachmentSource(record.SourceID)
			} else {
				archiveErr = ctx.Err()
			}
			archived, listErr = s.archivedAttachmentsForMessage(ctx, *record)
			if listErr != nil && archiveErr == nil {
				archiveErr = listErr
			}
		}
		directory := fmt.Sprintf("附件/%06d_%s", index+1, safeEmailExportPathSegment(record.UniqueID, 42))
		usedNames := map[string]int{}
		paths := make([]string, 0, len(archived))
		for attachmentIndex := range archived {
			name := safeEmailExportFileName(archived[attachmentIndex].Name)
			key := strings.ToLower(name)
			usedNames[key]++
			if usedNames[key] > 1 {
				extension := filepath.Ext(name)
				name = strings.TrimSuffix(name, extension) + "_" + strconv.Itoa(usedNames[key]) + extension
			}
			folder := directory
			if archived[attachmentIndex].Inline {
				folder += "/正文图片"
			}
			archived[attachmentIndex].RelativePath = folder + "/" + name
			paths = append(paths, archived[attachmentIndex].RelativePath)
			all = append(all, archived[attachmentIndex])
		}
		expected := knownCount
		if expected < len(archived) {
			expected = len(archived)
		}
		if expected == 0 {
			expected = 1
		}
		if expected > initialExpected {
			summary.Total += expected - initialExpected
		}
		record.AttachmentCount = expected
		record.AttachmentDirectory = directory
		succeeded := len(archived)
		failed := expected - succeeded
		if failed < 0 {
			failed = 0
		}
		if archiveErr != nil && failed == 0 {
			failed = 1
		}
		summary.Processed += succeeded + failed
		summary.Succeeded += succeeded
		summary.Failed += failed
		if archiveErr != nil {
			record.AttachmentExportResult = fmt.Sprintf("部分成功 %d/%d；%s", succeeded, expected, attachmentExportErrorLabel(archiveErr))
		} else if failed > 0 {
			record.AttachmentExportResult = fmt.Sprintf("部分成功 %d/%d；部分附件无法取得", succeeded, expected)
		} else {
			record.AttachmentExportResult = fmt.Sprintf("成功 %d/%d", succeeded, expected)
		}
		if len(paths) > 0 {
			record.AttachmentDirectory = directory
		}
		if time.Since(lastProgress) >= time.Second || index == len(records)-1 {
			progress("补取附件", summary.Total, summary.Processed, summary.Succeeded, summary.Failed)
			lastProgress = time.Now()
		}
	}
	if summary.Processed < summary.Total {
		summary.Processed = summary.Total
	}
	return all, summary
}

func (s *Server) waitForEmailAttachmentSource(ctx context.Context, sourceID string) bool {
	ticker := time.NewTicker(200 * time.Millisecond)
	defer ticker.Stop()
	for {
		if s.reserveEmailAttachmentSource(sourceID) {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-ticker.C:
		}
	}
}

func attachmentExportErrorLabel(err error) string {
	if err == nil {
		return ""
	}
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "authorization"), strings.Contains(message, "token"), strings.Contains(message, "授权"):
		return "邮箱授权已失效"
	case strings.Contains(message, "not found"), strings.Contains(message, "不存在"), strings.Contains(message, "404"):
		return "原邮件或附件已不存在"
	case strings.Contains(message, "limit"), strings.Contains(message, "too many"), strings.Contains(message, "限流"):
		return "邮箱服务商暂时限流"
	case strings.Contains(message, "25 mb"), strings.Contains(message, "too large"):
		return "附件超过25 MB"
	default:
		return truncateEmailPreview(err.Error(), 160)
	}
}

func safeEmailExportPathSegment(value string, maximum int) string {
	value = strings.TrimSpace(value)
	var builder strings.Builder
	for _, current := range value {
		if current == '/' || current == '\\' || current == ':' || current == '*' || current == '?' || current == '"' || current == '<' || current == '>' || current == '|' || current < 32 {
			builder.WriteRune('_')
		} else {
			builder.WriteRune(current)
		}
	}
	value = strings.Trim(builder.String(), " ._")
	if value == "" {
		value = "邮件"
	}
	runes := []rune(value)
	if len(runes) > maximum {
		value = string(runes[:maximum])
	}
	return value
}

func safeEmailExportFileName(value string) string {
	value = filepath.Base(strings.TrimSpace(value))
	if value == "." || value == "" {
		return "attachment"
	}
	return safeEmailExportPathSegment(value, 120)
}

func writeEmailStatisticsArchive(path string, workbook []byte, attachments []archivedEmailAttachment) (returnErr error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := file.Close(); returnErr == nil {
			returnErr = closeErr
		}
		if returnErr != nil {
			_ = os.Remove(path)
		}
	}()
	archive := zip.NewWriter(file)
	defer func() {
		if closeErr := archive.Close(); returnErr == nil {
			returnErr = closeErr
		}
	}()
	workbookEntry, err := archive.Create("邮件统计.xlsx")
	if err != nil {
		return err
	}
	if _, err := workbookEntry.Write(workbook); err != nil {
		return err
	}
	sort.SliceStable(attachments, func(i, j int) bool { return attachments[i].RelativePath < attachments[j].RelativePath })
	for _, attachment := range attachments {
		entry, err := archive.Create(filepath.ToSlash(attachment.RelativePath))
		if err != nil {
			return err
		}
		source, err := os.Open(attachment.FilePath)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(entry, source)
		closeErr := source.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func (s *Server) runEmailStatisticsExportCleanup(ctx context.Context, store emailExportJobStore) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	cleanup := func() {
		paths, err := store.DeleteExpiredEmailExportJobs(ctx, time.Now().UTC())
		if err != nil {
			if ctx.Err() == nil {
				log.Printf("email export queue: cleanup failed: %v", err)
			}
			return
		}
		for _, path := range paths {
			if safePath, safeErr := s.safeEmailExportPath(path); safeErr == nil {
				_ = os.Remove(safePath)
			}
		}
	}
	cleanup()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			cleanup()
		}
	}
}

func (s *Server) emailExportDir() (string, error) {
	return filepath.Abs(filepath.Join(s.uploadDir, "email-exports"))
}

func (s *Server) safeEmailExportPath(path string) (string, error) {
	base, err := s.emailExportDir()
	if err != nil {
		return "", err
	}
	candidate, err := filepath.Abs(filepath.Clean(strings.TrimSpace(path)))
	if err != nil {
		return "", err
	}
	relative, err := filepath.Rel(base, candidate)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("email export path is outside the export directory")
	}
	return candidate, nil
}
