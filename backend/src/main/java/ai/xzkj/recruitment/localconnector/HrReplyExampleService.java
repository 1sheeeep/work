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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/** Stores de-identified HR answer examples and provides fact-checked references for one job. */
@Service
class HrReplyExampleService {
    record LearnedReply(String intent, String candidateMessage, String hrReply, double similarity) { }

    private final HrReplyExampleRepository examples;
    private final InboundAiReplyTaskRepository aiReplies;
    private final JobPositionRepository jobs;
    private final CurrentUserService users;

    HrReplyExampleService(HrReplyExampleRepository examples, InboundAiReplyTaskRepository aiReplies,
                          JobPositionRepository jobs, CurrentUserService users) {
        this.examples = examples; this.aiReplies = aiReplies; this.jobs = jobs; this.users = users;
    }

    @Transactional
    HrReplyExampleImportResponse importTranscript(HrReplyExampleImportRequest request) {
        SystemUser user = users.requireCurrentUser();
        HrReplyExampleTranscriptParser.ParsedTranscript parsed = HrReplyExampleTranscriptParser.parse(request.transcript());
        JobPosition job = resolveJob(parsed, jobs.findAllByStatusOrderByUpdatedAtDesc(JobPositionStatus.ACTIVE).stream()
                .filter(candidate -> canAccess(candidate, user)).toList());
        // A manual transcript import is explicitly supplied by an HR user.
        return persistExamples(job, parsed, Set.of());
    }

    @Transactional
    HrReplyExampleImportResponse importTranscriptFromDevice(BrowserDevice device, HrReplyExampleImportRequest request) {
        if (device == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "DEVICE_REQUIRED", "浏览器设备未完成配对。");
        HrReplyExampleTranscriptParser.ParsedTranscript parsed = HrReplyExampleTranscriptParser.parse(request.transcript());
        List<JobPosition> accountJobs = jobs.findAllByBossAccountIdAndStatus(
                device.getBossAccount().getId(), JobPositionStatus.ACTIVE);
        JobPosition job = resolveJob(parsed, accountJobs);
        return persistExamples(job, parsed, knownAiReplies(device, job, request.chatDigest()));
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

    private Set<String> knownAiReplies(BrowserDevice device, JobPosition job, String chatDigest) {
        if (chatDigest == null || chatDigest.isBlank()) return Set.of();
        return aiReplies.findTop500ByAccountIdAndChatDigestAndSendStatusOrderBySendCompletedAtDesc(
                        device.getBossAccount().getId(), chatDigest, "SUCCEEDED").stream()
                .filter(task -> job.getId().equals(task.getJobPositionId()))
                .map(InboundAiReplyTask::getReplyContent)
                .filter(reply -> reply != null && !reply.isBlank())
                .map(HrReplyExampleService::normalizeExampleReply)
                .collect(java.util.stream.Collectors.toSet());
    }

    private HrReplyExampleImportResponse persistExamples(JobPosition job,
            HrReplyExampleTranscriptParser.ParsedTranscript parsed, Set<String> knownAiReplies) {
        int created = 0, duplicates = 0, skipped = 0;
        for (HrReplyExampleTranscriptParser.Pair pair : parsed.pairs()) {
            String candidate = HrReplyExampleTranscriptParser.redact(pair.candidateMessage(), 1000);
            String hrReply = HrReplyExampleTranscriptParser.redact(pair.hrReply(), 500);
            if (candidate.isBlank() || hrReply.isBlank() || containsUnsafeControlText(hrReply)) { skipped++; continue; }
            // BOSS renders AI and manually sent messages identically. Never
            // feed a known AI success back into the trusted HR example pool.
            if (knownAiReplies.contains(normalizeExampleReply(hrReply))) { skipped++; continue; }
            String sourceHash = sha256(job.getId() + "|" + candidate + "|" + hrReply);
            if (examples.existsBySourceHash(sourceHash)) { duplicates++; continue; }
            examples.save(new HrReplyExample(job, classifyIntent(candidate), candidate, hrReply, sourceHash, Instant.now()));
            created++;
        }
        return new HrReplyExampleImportResponse(job.getId(), job.getTitle(), created, duplicates, skipped);
    }

    private static String normalizeExampleReply(String reply) {
        return HrReplyExampleTranscriptParser.redact(reply, 500).replaceAll("\\s+", " ").trim();
    }

    @Transactional(readOnly = true)
    String renderStyleReferences(JobPosition job, String candidateMessage, Map<String, String> approvedFacts) {
        if (job == null || candidateMessage == null || candidateMessage.isBlank()) return "";
        List<HrReplyExample> references = examples.findTop12ByJobPositionIdAndIntentOrderByCreatedAtDesc(
                job.getId(), classifyIntent(candidateMessage));
        if (references.isEmpty()) return "";
        Map<String, String> reusable = new LinkedHashMap<>();
        Map<String, String> styleOnly = new LinkedHashMap<>();
        List<HrReplyExample> ranked = references.stream()
                .sorted((left, right) -> Double.compare(similarity(candidateMessage, right.getCandidateMessage()),
                        similarity(candidateMessage, left.getCandidateMessage())))
                .toList();
        for (HrReplyExample reference : ranked) {
            Map<String, String> target = hasReusableApprovedFact(reference.getHrReply(), approvedFacts) ? reusable : styleOnly;
            if (target.size() < 3) target.put(reference.getCandidateMessage(), reference.getHrReply());
            if (reusable.size() == 3 && styleOnly.size() == 3) break;
        }
        StringBuilder result = new StringBuilder();
        if (!reusable.isEmpty()) {
            result.append("同岗位真实 HR 回复参考（按与当前消息的相似度排序；即使此前 AI 曾失败或跳过，只要真实会话中 HR 后续作答，也应学习其意图和表达。事实已与当前 ALLOWED_FACTS 匹配，可自然改写，但不得补充其他承诺）：\n");
            appendReferences(result, reusable);
        }
        if (!styleOnly.isEmpty()) {
            result.append("同岗位真实 HR 纯风格参考（相似招聘表达不应仅因口语、简短或模型置信度不足而跳过；仅学习意图、语气和沟通节奏，不得使用其中的岗位事实、数字、地点、薪资或承诺）：\n");
            appendReferences(result, styleOnly);
        }
        return result.toString();
    }

    @Transactional(readOnly = true)
    Optional<LearnedReply> findStrongSimilarReply(JobPosition job, String candidateMessage) {
        if (job == null || candidateMessage == null || candidateMessage.isBlank()) return Optional.empty();
        return examples.findTop12ByJobPositionIdAndIntentOrderByCreatedAtDesc(
                        job.getId(), classifyIntent(candidateMessage)).stream()
                .map(reference -> new LearnedReply(reference.getIntent(), reference.getCandidateMessage(),
                        reference.getHrReply(), similarity(candidateMessage, reference.getCandidateMessage())))
                .filter(reference -> reference.similarity() >= 0.78)
                .max((left, right) -> Double.compare(left.similarity(), right.similarity()));
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

    static double similarity(String left, String right) {
        String a = normalizeMessage(left);
        String b = normalizeMessage(right);
        if (a.isBlank() || b.isBlank()) return 0;
        if (a.equals(b)) return 1;
        int shorter = Math.min(a.length(), b.length());
        int longer = Math.max(a.length(), b.length());
        if (shorter >= 4 && (a.contains(b) || b.contains(a)) && (double) shorter / longer >= 0.55) return 0.88;
        Set<String> aPairs = characterPairs(a);
        Set<String> bPairs = characterPairs(b);
        if (aPairs.isEmpty() || bPairs.isEmpty()) return 0;
        long overlap = aPairs.stream().filter(bPairs::contains).count();
        return (2d * overlap) / (aPairs.size() + bPairs.size());
    }

    private static Set<String> characterPairs(String value) {
        Set<String> pairs = new LinkedHashSet<>();
        for (int index = 0; index + 1 < value.length(); index++) pairs.add(value.substring(index, index + 2));
        return pairs;
    }

    private static String normalizeMessage(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT)
                .replaceAll("^(?:boss|hr)?(?:你|您)?好[啊呀呢哈哦～~。！!，,；;\\s]*", "")
                .replaceAll("[\\s　,，。.!！?？;；:：()（）【】\\[\\]～~]+", "");
    }

    static String classifyIntent(String raw) {
        String text = raw == null ? "" : raw.toLowerCase(Locale.ROOT);
        if (text.matches(".*(不合适|不适合|不考虑|没兴趣|无法参加|不能参加|取消面试|祝.*找到).*")) return "CANDIDATE_DECLINE";
        if (text.matches(".*(工资|薪资|月薪|年薪|底薪|提成|多少钱).*")) return "SALARY";
        if (text.matches(".*(地点|地址|哪里上班|在哪上班|工作地|办公地).*")) return "LOCATION";
        if (text.matches(".*(上班时间|下班时间|几点上班|几点下班|工作时间|月休|双休|单休|大小周).*")) return "WORK_TIME";
        if (text.matches(".*(吃住|包吃|包住|宿舍|住宿|社保|公积金|五险|福利).*")) return "BENEFITS";
        if (text.matches(".*(经验要求|需要经验|几年经验|没经验|没有经验|无经验|应届|小白).*")) return "EXPERIENCE";
        if (text.matches(".*(学历|大专|本科|中专|高中|硕士|博士).*")) return "EDUCATION";
        if (text.matches(".*(做什么|干嘛|职责|工作内容|主要负责|日常工作).*")) return "RESPONSIBILITIES";
        if (text.matches(".*(稍后|晚点|一会儿|马上).*(发|投|传).*简历.*")) return "RESUME_WILL_SEND";
        if (text.matches(".*(简历.*(发|投|传)|(?:发|投|传).{0,8}简历).*")) return "RESUME_SENT";
        if (text.matches(".*(考虑一下|再看看|想想).*")) return "CANDIDATE_CONSIDERING";
        if (text.matches(".*(谢谢|感谢).*")) return "SOCIAL_THANKS";
        if (text.matches(".*(你好|您好|hello|hi).*")) return "SOCIAL_GREETING";
        if (text.matches("^[\\s，,。.!！?？～~]*(好的?|好哒|嗯+|收到|知道了|明白了|了解了?|可以|行|没问题|ok(?:ay)?)[啊呀呢哈哦的了\\s，,。.!！?？～~]*$")) return "SOCIAL_ACKNOWLEDGEMENT";
        if (text.matches(".*(还招|在招|招聘).*")) return "JOB_STATUS";
        return "GENERAL_JOB_CONSULTATION";
    }

    private boolean canAccess(JobPosition job, SystemUser user) {
        return ai.xzkj.recruitment.boss.BossAccountAccess.canAccess(job.getBossAccount(), user);
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
