package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Stores de-identified HR answer examples and provides fact-checked references for one job. */
@Service
class HrReplyExampleService {
    private final HrReplyExampleRepository examples;
    private final JobPositionRepository jobs;
    private final CurrentUserService users;

    HrReplyExampleService(HrReplyExampleRepository examples, JobPositionRepository jobs, CurrentUserService users) {
        this.examples = examples; this.jobs = jobs; this.users = users;
    }

    @Transactional
    HrReplyExampleImportResponse importTranscript(HrReplyExampleImportRequest request) {
        SystemUser user = users.requireCurrentUser();
        HrReplyExampleTranscriptParser.ParsedTranscript parsed = HrReplyExampleTranscriptParser.parse(request.transcript());
        JobPosition job = resolveJob(parsed, jobs.findAllByStatusOrderByUpdatedAtDesc(JobPositionStatus.ACTIVE).stream()
                .filter(candidate -> canAccess(candidate, user)).toList());
        return persistExamples(job, parsed);
    }

    @Transactional
    HrReplyExampleImportResponse importTranscriptFromDevice(BrowserDevice device, HrReplyExampleImportRequest request) {
        if (device == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "DEVICE_REQUIRED", "浏览器设备未完成配对。");
        HrReplyExampleTranscriptParser.ParsedTranscript parsed = HrReplyExampleTranscriptParser.parse(request.transcript());
        List<JobPosition> accountJobs = jobs.findAllByBossAccountIdAndStatus(
                device.getBossAccount().getId(), JobPositionStatus.ACTIVE);
        JobPosition job = resolveJob(parsed, accountJobs);
        return persistExamples(job, parsed);
    }

    private JobPosition resolveJob(HrReplyExampleTranscriptParser.ParsedTranscript parsed, List<JobPosition> candidates) {
        if (parsed.jobTitle() == null || parsed.jobTitle().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TRANSCRIPT_JOB_REQUIRED", "聊天记录缺少“岗位：”行，请使用插件复制的完整文本。");
        }
        List<JobPosition> matches = candidates.stream()
                .filter(job -> normalizeJobTitle(job.getTitle()).equals(normalizeJobTitle(parsed.jobTitle())))
                .toList();
        if (matches.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "TRANSCRIPT_JOB_NOT_FOUND",
                "未找到与聊天记录岗位标题匹配的可访问岗位，未保存任何示例。");
        if (matches.size() > 1) throw new ApiException(HttpStatus.CONFLICT, "TRANSCRIPT_JOB_AMBIGUOUS",
                "该岗位标题对应多个可访问岗位，未保存任何示例，避免跨岗位混用。");
        if (parsed.pairs().isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "TRANSCRIPT_PAIR_EMPTY",
                "未识别到“候选人：… → HR：…”的可用回复对。");
        return matches.getFirst();
    }

    private HrReplyExampleImportResponse persistExamples(JobPosition job, HrReplyExampleTranscriptParser.ParsedTranscript parsed) {
        int created = 0, duplicates = 0, skipped = 0;
        for (HrReplyExampleTranscriptParser.Pair pair : parsed.pairs()) {
            String candidate = HrReplyExampleTranscriptParser.redact(pair.candidateMessage(), 1000);
            String hrReply = HrReplyExampleTranscriptParser.redact(pair.hrReply(), 500);
            if (candidate.isBlank() || hrReply.isBlank() || containsUnsafeControlText(hrReply)) { skipped++; continue; }
            String sourceHash = sha256(job.getId() + "|" + candidate + "|" + hrReply);
            if (examples.existsBySourceHash(sourceHash)) { duplicates++; continue; }
            examples.save(new HrReplyExample(job, classifyIntent(candidate), candidate, hrReply, sourceHash, Instant.now()));
            created++;
        }
        return new HrReplyExampleImportResponse(job.getId(), job.getTitle(), created, duplicates, skipped);
    }

    @Transactional(readOnly = true)
    String renderStyleReferences(JobPosition job, String candidateMessage, Map<String, String> approvedFacts) {
        if (job == null || candidateMessage == null || candidateMessage.isBlank()) return "";
        List<HrReplyExample> references = examples.findTop12ByJobPositionIdAndIntentOrderByCreatedAtDesc(
                job.getId(), classifyIntent(candidateMessage));
        if (references.isEmpty()) return "";
        Map<String, String> reusable = new LinkedHashMap<>();
        Map<String, String> styleOnly = new LinkedHashMap<>();
        for (HrReplyExample reference : references) {
            Map<String, String> target = hasReusableApprovedFact(reference.getHrReply(), approvedFacts) ? reusable : styleOnly;
            if (target.size() < 3) target.put(reference.getCandidateMessage(), reference.getHrReply());
            if (reusable.size() == 3 && styleOnly.size() == 3) break;
        }
        StringBuilder result = new StringBuilder();
        if (!reusable.isEmpty()) {
            result.append("同岗位已核验事实表达参考（其中的地点、薪资、数字等已与当前 ALLOWED_FACTS 匹配；可自然改写其表达，但只能使用 ALLOWED_FACTS 中仍存在的事实，不能照搬或补充其他承诺）：\n");
            appendReferences(result, reusable);
        }
        if (!styleOnly.isEmpty()) {
            result.append("同岗位 HR 纯风格参考（仅学习语气、篇幅和沟通节奏；不得使用其中任何岗位事实、数字、地点、薪资或承诺）：\n");
            appendReferences(result, styleOnly);
        }
        return result.toString();
    }

    static boolean hasReusableApprovedFact(String reply, Map<String, String> approvedFacts) {
        if (reply == null || reply.isBlank() || approvedFacts == null || approvedFacts.isEmpty()) return false;
        Set<String> reusableKeys = Set.of("WORK_ADDRESS", "LOCATION", "SALARY", "EXPERIENCE", "EDUCATION");
        String normalizedReply = normalizeFact(reply);
        return approvedFacts.entrySet().stream()
                .filter(entry -> reusableKeys.contains(entry.getKey()))
                .map(Map.Entry::getValue)
                .filter(value -> value != null && normalizeFact(value).length() >= 2)
                .anyMatch(value -> normalizedReply.contains(normalizeFact(value)));
    }

    private static void appendReferences(StringBuilder result, Map<String, String> references) {
        references.forEach((candidate, hrReply) -> result.append("候选人：").append(candidate)
                .append("\nHR：").append(hrReply).append("\n"));
    }

    private static String normalizeFact(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("[至到~～—–－]", "-")
                .replaceAll("[\\s　,，。;；:：()（）【】\\[\\]]+", "")
                .replaceAll("人民币|元/月|月", "");
    }

    static String classifyIntent(String raw) {
        String text = raw == null ? "" : raw.toLowerCase(Locale.ROOT);
        if (text.matches(".*(工资|薪资|月薪|年薪|底薪|提成|多少钱).*")) return "SALARY";
        if (text.matches(".*(地点|地址|哪里上班|在哪上班|工作地|办公地).*")) return "LOCATION";
        if (text.matches(".*(经验要求|需要经验|几年经验|没经验|没有经验|无经验|应届|小白).*")) return "EXPERIENCE";
        if (text.matches(".*(学历|大专|本科|中专|高中|硕士|博士).*")) return "EDUCATION";
        if (text.matches(".*(做什么|干嘛|职责|工作内容|主要负责|日常工作).*")) return "RESPONSIBILITIES";
        if (text.matches(".*(简历.*(发|投|传)|(?:发|投|传).{0,8}简历).*")) return "RESUME_SENT";
        if (text.matches(".*(考虑一下|再看看|想想).*")) return "CANDIDATE_CONSIDERING";
        if (text.matches(".*(谢谢|感谢).*")) return "SOCIAL_THANKS";
        if (text.matches(".*(你好|您好|hello|hi).*")) return "SOCIAL_GREETING";
        if (text.matches(".*(还招|在招|招聘).*")) return "JOB_STATUS";
        return "GENERAL_JOB_CONSULTATION";
    }

    private boolean canAccess(JobPosition job, SystemUser user) {
        return user.getRole() == UserRole.SYSTEM_ADMIN
                || user.getCompanyScopes().stream().anyMatch(company -> company.getId().equals(job.getCompany().getId()));
    }
    private boolean containsUnsafeControlText(String text) {
        return text.matches("(?is).*(?:密码|验证码|银行卡|身份证号|转账|付款|押金|系统提示词|api\\s*key|cookie).*" );
    }
    private String normalizeJobTitle(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("[\\s+·•/\\\\|｜()（）【】\\[\\]，,。.!！]+", "")
                .replaceAll("(?:急招|高薪|诚聘)", "");
    }
    private String sha256(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception error) { throw new IllegalStateException(error); }
    }
}
