package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.candidates.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import org.springframework.http.HttpStatus;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

@Service
public class ResumeDocumentPipelineService {
    private final CandidateProfileRepository candidates;
    private final CandidateJobContactRepository contacts;
    private final ResumeIntakeRepository intakes;
    private final ResumeDocumentTextExtractor documents;
    private final ResumeMalwareScanner malware;
    private final ResumeImageOcrClient ocr;
    private final ResumeAnalysisQueueService analysisQueue;
    private final AuditService audit;
    private final CandidateIdentityService identity;

    public ResumeDocumentPipelineService(CandidateProfileRepository candidates,
                                         CandidateJobContactRepository contacts,
                                         ResumeIntakeRepository intakes,
                                         ResumeDocumentTextExtractor documents,
                                         ResumeMalwareScanner malware,
                                         ResumeImageOcrClient ocr,
                                         ResumeAnalysisQueueService analysisQueue,
                                         AuditService audit) {
        this(candidates, contacts, intakes, documents, malware, ocr, analysisQueue, audit, null);
    }

    @Autowired
    public ResumeDocumentPipelineService(CandidateProfileRepository candidates,
                                         CandidateJobContactRepository contacts,
                                         ResumeIntakeRepository intakes,
                                         ResumeDocumentTextExtractor documents,
                                         ResumeMalwareScanner malware,
                                         ResumeImageOcrClient ocr,
                                         ResumeAnalysisQueueService analysisQueue,
                                         AuditService audit, CandidateIdentityService identity) {
        this.candidates = candidates;
        this.contacts = contacts;
        this.intakes = intakes;
        this.documents = documents;
        this.malware = malware;
        this.ocr = ocr;
        this.analysisQueue = analysisQueue;
        this.audit = audit;
        this.identity = identity;
    }

    @Transactional
    public ResumeDocumentProcessingResponse processVisibleResume(JobPosition job, String chatDigest, String sourceEventDigest,
                                                                  java.util.UUID sourceActionTaskId, MultipartFile file) {
        byte[] content;
        try {
            content = documents.readBytes(file);
        } catch (ApiException exception) {
            throw exception;
        }
        String documentDigest = hash(content);
        CandidateProfile candidate = candidates.findByCompanyIdAndSourceAndDedupKey(
                        job.getCompany().getId(), CandidateSource.BOSS, chatDigest)
                .orElseGet(() -> candidates.save(new CandidateProfile(job.getCompany(), CandidateSource.BOSS,
                        chatDigest, "匿名候选人 " + chatDigest.substring(0, 8), null, null, null, null)));
        CandidateJobContact contact = contacts.findByCandidateIdAndJobPositionId(candidate.getId(), job.getId())
                .orElseGet(() -> contacts.save(new CandidateJobContact(candidate, job, job.getBossAccount())));
        ResumeIntake sameEvent = intakes.findByContactIdAndSourceEventDigest(contact.getId(), sourceEventDigest).orElse(null);
        ResumeIntake existing = intakes.findByContactIdAndResumeDigest(contact.getId(), documentDigest).orElse(null);
        if (existing != null) {
            if (existing.getSourcePdf() == null) existing.storeSourcePdf(content);
            refreshRecognizedNameFromPdf(candidate, existing.getSourcePdf());
            if ("READY_FOR_AI".equals(existing.getProcessingStatus())
                    && !"SUCCEEDED".equals(existing.getAnalysisStatus())) {
                if (existing.getExtractedText() != null && !existing.getExtractedText().isBlank()) {
                    analysisQueue.enqueue(existing);
                } else {
                    retryExistingAnalysis(existing, candidate, content, documentDigest);
                }
            }
            audit.systemSuccess("DEDUPLICATE_VISIBLE_RESUME", "RESUME_INTAKE", existing.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12), "同一候选人和岗位已处理相同文件；分析不可用时已尝试重新提取并调用 AI");
            return ResumeDocumentProcessingResponse.from(existing, true);
        }
        // 同一聊天事件可能包含不同的附件。只有文件摘要相同才算重复，
        // 不同文件必须创建新的简历记录，并使用派生事件摘要避开唯一约束。
        String intakeSourceEventDigest = sameEvent == null
                ? sourceEventDigest
                : hash(sourceEventDigest + "|" + documentDigest);
        ResumeIntake intake = intakes.save(new ResumeIntake(contact, ResumeIntakeSource.BOSS_VISIBLE,
                documentDigest, "BOSS 简历 " + documentDigest.substring(0, 8), Instant.now()));
        intake.attachSourceEvent(intakeSourceEventDigest);
        if (sourceActionTaskId != null) intake.attachSourceActionTask(sourceActionTaskId);
        intake.processing();
        try {
            ResumeMalwareScanner.ScanResult scan = malware.scan(content);
            boolean malwareScanned = scan.scanned();
            String type;
            String text;
            if (ocr.supports(content)) {
                type = "IMAGE_OCR";
                text = ocr.extract(content).text();
            } else {
                ResumeDocumentTextExtractor.ExtractedResumeDocument extracted = documents.extract(content);
                type = extracted.type();
                text = extracted.text();
            }
            intake.readyForAi(type, hash(text), malwareScanned, Instant.now());
            intake.storeExtractedText(text);
            intake.autoApproveForAi(Instant.now());
            updateRecognizedName(candidate, text);
            if (identity != null) identity.updateFromResume(candidate, identity.extractPhone(text), identity.extractEmail(text));
            intake.storeSourcePdf(content);
            audit.systemSuccess("PROCESS_VISIBLE_RESUME", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12),
                    "已完成" + (malwareScanned ? "病毒扫描、" : "") + "去重和 " + type + " 文本提取；已保存 PDF 供 HR 重新分析");
            analysisQueue.enqueue(intake);
        } catch (ApiException exception) {
            intake.processingFailed(cleanCode(exception.getCode()), cleanReason(exception.getMessage()), Instant.now());
            audit.systemSuccess("QUEUE_RESUME_PROCESSING_EXCEPTION", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12),
                    "简历处理已转入 HR 异常队列；原因代码 " + cleanCode(exception.getCode()));
        } catch (RuntimeException exception) {
            intake.processingFailed("RESUME_PROCESSING_FAILED", "简历处理未完成，请 HR 重新检查文件", Instant.now());
            audit.systemSuccess("QUEUE_RESUME_PROCESSING_EXCEPTION", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12), "简历处理出现非预期错误，已转入 HR 异常队列；审计不包含原文");
        }
        return ResumeDocumentProcessingResponse.from(intake, false);
    }

    private void retryExistingAnalysis(ResumeIntake intake, CandidateProfile candidate, byte[] content,
                                       String documentDigest) {
        try {
            ResumeMalwareScanner.ScanResult scan = malware.scan(content);
            String type;
            String text;
            if (ocr.supports(content)) {
                type = "IMAGE_OCR";
                text = ocr.extract(content).text();
            } else {
                ResumeDocumentTextExtractor.ExtractedResumeDocument extracted = documents.extract(content);
                type = extracted.type();
                text = extracted.text();
            }
            intake.processing();
            intake.readyForAi(type, hash(text), scan.scanned(), Instant.now());
            intake.storeExtractedText(text);
            intake.autoApproveForAi(Instant.now());
            updateRecognizedName(candidate, text);
            if (identity != null) identity.updateFromResume(candidate, identity.extractPhone(text), identity.extractEmail(text));
            intake.storeSourcePdf(content);
            analysisQueue.enqueue(intake);
            audit.systemSuccess("RETRY_RESUME_ANALYSIS", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12), "重复简历原分析不可用，已重新提取并提交 AI 分析");
        } catch (RuntimeException exception) {
            audit.systemSuccess("RETRY_RESUME_ANALYSIS_FAILED", "RESUME_INTAKE", intake.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12), "重复简历重新分析失败，已保留原处理状态供 HR 重试");
        }
    }

    @Transactional
    public ResumeDocumentProcessingResponse processVisibleResumeText(JobPosition job, String chatDigest,
                                                                      String sourceEventDigest, String visibleText) {
        String text = visibleText == null ? "" : visibleText.replace('\u0000', ' ').replaceAll("[\\t\\x0B\\f\\r ]+", " ").trim();
        if (text.length() < 100 || text.length() > 30_000)
            throw new ApiException(HttpStatus.BAD_REQUEST, "VISIBLE_RESUME_TEXT_INVALID", "在线简历文本长度无效");
        String documentDigest = hash(text);
        CandidateProfile candidate = identity == null
                ? candidates.findByCompanyIdAndSourceAndDedupKey(job.getCompany().getId(), CandidateSource.BOSS, chatDigest)
                    .orElseGet(() -> candidates.save(new CandidateProfile(job.getCompany(), CandidateSource.BOSS,
                            chatDigest, "匿名候选人 " + chatDigest.substring(0, 8), null, null, null, null)))
                : identity.resolve(job.getCompany(), CandidateSource.BOSS, chatDigest,
                    "匿名候选人 " + chatDigest.substring(0, Math.min(8, chatDigest.length())),
                    null, null, null, null, identity.extractPhone(text), identity.extractEmail(text));
        CandidateJobContact contact = contacts.findByCandidateIdAndJobPositionId(candidate.getId(), job.getId())
                .orElseGet(() -> contacts.save(new CandidateJobContact(candidate, job, job.getBossAccount())));
        ResumeIntake sameEvent = intakes.findByContactIdAndSourceEventDigest(contact.getId(), sourceEventDigest).orElse(null);
        ResumeIntake existing = intakes.findByContactIdAndResumeDigest(contact.getId(), documentDigest).orElse(null);
        if (existing != null) return ResumeDocumentProcessingResponse.from(existing, true);
        String intakeSourceEventDigest = sameEvent == null
                ? sourceEventDigest
                : hash(sourceEventDigest + "|" + documentDigest);

        ResumeIntake intake = intakes.save(new ResumeIntake(contact, ResumeIntakeSource.BOSS_VISIBLE,
                documentDigest, "BOSS 在线简历 " + documentDigest.substring(0, 8), Instant.now()));
        intake.attachSourceEvent(intakeSourceEventDigest);
        intake.processing();
        intake.readyForAi("BOSS_VISIBLE_TEXT", hash(text), false, Instant.now());
        intake.storeExtractedText(text);
        intake.autoApproveForAi(Instant.now());
        updateRecognizedName(candidate, text);
        if (identity != null) identity.updateFromResume(candidate, identity.extractPhone(text), identity.extractEmail(text));
        audit.systemSuccess("PROCESS_VISIBLE_RESUME_TEXT", "RESUME_INTAKE", intake.getId(),
                "简历摘要 " + documentDigest.substring(0, 12),
                "已从当前真实 BOSS 在线简历提取必要文本并绑定当前会话与岗位；仅保存摘要，不保存正文");
        analysisQueue.enqueue(intake);
        return ResumeDocumentProcessingResponse.from(intake, false);
    }

    private String hash(byte[] value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value)); }
        catch (Exception exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }

    private String hash(String value) { return hash(value.getBytes(StandardCharsets.UTF_8)); }

    private void updateRecognizedName(CandidateProfile candidate, String text) {
        if (candidate == null || !ResumeCandidateName.isAnonymousPlaceholder(candidate.getDisplayName())) return;
        String name = ResumeCandidateName.verified(recognizeName(text), text);
        if (name != null) candidate.updateRecognizedName(name);
    }

    private void refreshRecognizedNameFromPdf(CandidateProfile candidate, byte[] pdf) {
        if (pdf == null || pdf.length == 0) return;
        try {
            ResumeDocumentTextExtractor.ExtractedResumeDocument extracted = documents.extract(pdf);
            updateRecognizedName(candidate, extracted.text());
        } catch (RuntimeException ignored) {
            // 重复记录的姓名补识别不能阻断正常的去重返回。
        }
    }

    private String recognizeName(String text) {
        return ResumeCandidateName.recognize(text);
    }
    private String cleanCode(String value) { return value == null || value.isBlank() ? "RESUME_PROCESSING_FAILED" : value.substring(0, Math.min(80, value.length())); }
    private String cleanReason(String value) { String clean=value==null?"简历处理未完成":value.replace('\n',' ').replace('\r',' ').trim();return clean.substring(0,Math.min(300,clean.length())); }
}
