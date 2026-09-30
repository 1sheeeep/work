package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.candidates.CandidateProfile;
import ai.xzkj.recruitment.candidates.CandidateProfileRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 在服务启动后对历史匿名档案执行一次幂等回填。
 * 只有 AI 结果中的姓名能够在对应简历正文中严格找到时才会更新，
 * 不读取聊天猜测，也不会修改已匿名或已合并档案。
 */
@Service
public class CandidateNameBackfillService {
    private final CandidateProfileRepository candidates;
    private final ResumeIntakeRepository intakes;
    private final AiAssistanceRunRepository runs;
    private final ResumeDocumentProcessingQueueService documentQueue;
    private final ObjectMapper mapper;
    private final TransactionTemplate transactions;
    private final AtomicBoolean started = new AtomicBoolean();

    @Value("${app.candidates.name-backfill.enabled:true}")
    private boolean enabled;

    public CandidateNameBackfillService(CandidateProfileRepository candidates,
                                        ResumeIntakeRepository intakes,
                                        AiAssistanceRunRepository runs,
                                        ResumeDocumentProcessingQueueService documentQueue,
                                        ObjectMapper mapper,
                                        PlatformTransactionManager manager) {
        this.candidates = candidates;
        this.intakes = intakes;
        this.runs = runs;
        this.documentQueue = documentQueue;
        this.mapper = mapper;
        this.transactions = new TransactionTemplate(manager);
    }

    @EventListener(ApplicationReadyEvent.class)
    public void backfillOnce() {
        if (!enabled || !started.compareAndSet(false, true)) return;
        try {
            int[] result = transactions.execute(status -> backfill());
            System.getLogger(CandidateNameBackfillService.class.getName()).log(System.Logger.Level.INFO,
                    "历史匿名候选人姓名安全回填完成，更新档案数=" + (result == null ? 0 : result[0])
                            + "，已排队重提取数=" + (result == null ? 0 : result[1]));
        } catch (RuntimeException exception) {
            // 回填不能阻断主服务启动；下次重启仍会再次幂等尝试。
            System.getLogger(CandidateNameBackfillService.class.getName()).log(System.Logger.Level.WARNING,
                    "历史匿名候选人姓名回填未完成：" + safe(exception));
        }
    }

    int[] backfill() {
        int updated = 0;
        int requeued = 0;
        List<CandidateProfile> profiles = candidates.findAll(Sort.by(Sort.Direction.DESC, "updatedAt"));
        for (CandidateProfile candidate : profiles) {
            if (!shouldBackfill(candidate)) continue;
            String verified = findVerifiedName(candidate);
            if (verified != null) {
                candidate.updateRecognizedName(verified);
                candidates.saveAndFlush(candidate);
                updated++;
                continue;
            }
            if (queueMissingTextForExtraction(candidate)) requeued++;
        }
        return new int[]{updated, requeued};
    }

    private boolean queueMissingTextForExtraction(CandidateProfile candidate) {
        for (ResumeIntake intake : intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(candidate.getId())) {
            if (intake.getSource() != ResumeIntakeSource.BOSS_VISIBLE
                    || !"READY_FOR_AI".equals(intake.getProcessingStatus())
                    || (intake.getExtractedText() != null && !intake.getExtractedText().isBlank())
                    || !intake.hasSourcePdf()) continue;
            // Reuse the existing malware-scan/extraction queue. A succeeded AI result
            // is not enqueued again by ResumeIntake.queueAnalysis().
            documentQueue.enqueue(intake);
            return true;
        }
        return false;
    }

    private boolean shouldBackfill(CandidateProfile candidate) {
        return candidate != null && !candidate.isMerged()
                && candidate.getPrivacyStatus() != ai.xzkj.recruitment.candidates.CandidatePrivacyStatus.ANONYMIZED
                && ResumeCandidateName.isAnonymousPlaceholder(candidate.getDisplayName());
    }

    private String findVerifiedName(CandidateProfile candidate) {
        for (ResumeIntake intake : intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(candidate.getId())) {
            String text = intake.getExtractedText();
            if (text == null || text.isBlank()) continue;

            for (AiAssistanceRun run : runs.findByResumeIntakeIdOrderByCreatedAtDesc(intake.getId())) {
                if (!"SUCCEEDED".equals(run.getStatus()) || run.getStructuredResult() == null) continue;
                String name = verifiedAiName(run.getStructuredResult(), text);
                if (name != null) return name;
            }
            String extracted = ResumeCandidateName.verified(ResumeCandidateName.recognize(text), text);
            if (extracted != null) return extracted;
        }
        return null;
    }

    private String verifiedAiName(String json, String text) {
        try {
            JsonNode root = mapper.readTree(json);
            String raw = findCandidateName(root, 0);
            return ResumeCandidateName.verified(raw, text);
        } catch (RuntimeException ignored) {
            return null;
        }
    }

    private String findCandidateName(JsonNode node, int depth) {
        if (node == null || depth > 4) return null;
        if (node.isObject()) {
            JsonNode direct = node.get("candidateName");
            if (direct != null && direct.isTextual() && !direct.textValue().isBlank()) return direct.textValue();
            for (String key : List.of("analysis", "result", "data")) {
                String nested = findCandidateName(node.get(key), depth + 1);
                if (nested != null) return nested;
            }
        }
        return null;
    }

    private String safe(RuntimeException exception) {
        String value = exception == null ? "未知异常" : exception.getMessage();
        if (value == null || value.isBlank()) value = exception == null ? "未知异常" : exception.getClass().getSimpleName();
        value = value.replace('\n', ' ').replace('\r', ' ').trim();
        return value.substring(0, Math.min(240, value.length()));
    }
}
