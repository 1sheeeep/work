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

/**
 * 简历入库编排器。页面请求只读取并保存来源文件，耗时的安全扫描、OCR/文本提取交给后台队列。
 */
@Service
public class ResumeDocumentPipelineService {
    private final CandidateProfileRepository candidates;
    private final CandidateJobContactRepository contacts;
    private final ResumeIntakeRepository intakes;
    private final ResumeDocumentTextExtractor documents;
    private final ResumeDocumentProcessingQueueService documentQueue;
    private final ResumeAnalysisQueueService analysisQueue;
    private final AuditService audit;
    private final CandidateIdentityService identity;

    public ResumeDocumentPipelineService(CandidateProfileRepository candidates,
                                         CandidateJobContactRepository contacts,
                                         ResumeIntakeRepository intakes,
                                         ResumeDocumentTextExtractor documents,
                                         ResumeDocumentProcessingQueueService documentQueue,
                                         ResumeAnalysisQueueService analysisQueue,
                                         AuditService audit) {
        this(candidates, contacts, intakes, documents, documentQueue, analysisQueue, audit, null);
    }

    @Autowired
    public ResumeDocumentPipelineService(CandidateProfileRepository candidates,
                                         CandidateJobContactRepository contacts,
                                         ResumeIntakeRepository intakes,
                                         ResumeDocumentTextExtractor documents,
                                         ResumeDocumentProcessingQueueService documentQueue,
                                         ResumeAnalysisQueueService analysisQueue,
                                         AuditService audit,
                                         CandidateIdentityService identity) {
        this.candidates = candidates;
        this.contacts = contacts;
        this.intakes = intakes;
        this.documents = documents;
        this.documentQueue = documentQueue;
        this.analysisQueue = analysisQueue;
        this.audit = audit;
        this.identity = identity;
    }

    @Transactional
    public ResumeDocumentProcessingResponse processVisibleResume(JobPosition job, String chatDigest, String sourceEventDigest,
                                                                  java.util.UUID sourceActionTaskId, MultipartFile file) {
        byte[] content = documents.readBytes(file);
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
            if ("READY_FOR_AI".equals(existing.getProcessingStatus())
                    && !"SUCCEEDED".equals(existing.getAnalysisStatus())) {
                if (existing.getExtractedText() != null && !existing.getExtractedText().isBlank()) {
                    analysisQueue.enqueue(existing);
                } else {
                    existing.queueDocumentProcessing(Instant.now());
                    documentQueue.enqueue(existing);
                }
            }
            audit.systemSuccess("DEDUPLICATE_VISIBLE_RESUME", "RESUME_INTAKE", existing.getId(),
                    "简历摘要 " + documentDigest.substring(0, 12),
                    "同一候选人和岗位已处理相同文件；未重新占用 BOSS 页面执行 OCR 或文本提取");
            return ResumeDocumentProcessingResponse.from(existing, true);
        }

        String intakeSourceEventDigest = sameEvent == null
                ? sourceEventDigest
                : hash(sourceEventDigest + "|" + documentDigest);
        ResumeIntake intake = intakes.save(new ResumeIntake(contact, ResumeIntakeSource.BOSS_VISIBLE,
                documentDigest, "BOSS 简历 " + documentDigest.substring(0, 8), Instant.now()));
        intake.attachSourceEvent(intakeSourceEventDigest);
        if (sourceActionTaskId != null) intake.attachSourceActionTask(sourceActionTaskId);
        intake.storeSourcePdf(content);
        documentQueue.enqueue(intake);
        audit.systemSuccess("QUEUE_VISIBLE_RESUME_PROCESSING", "RESUME_INTAKE", intake.getId(),
                "简历摘要 " + documentDigest.substring(0, 12),
                "已保存原始 PDF 并进入后台安全扫描、OCR/文本提取队列；页面锁无需等待耗时处理");
        return ResumeDocumentProcessingResponse.from(intake, false);
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
                "当前 BOSS 在线简历已在浏览器完成必要文本提取；仅保存摘要并进入 AI 分析队列");
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
        String name = ResumeCandidateName.verified(ResumeCandidateName.recognize(text), text);
        if (name != null) candidate.updateRecognizedName(name);
    }
}
