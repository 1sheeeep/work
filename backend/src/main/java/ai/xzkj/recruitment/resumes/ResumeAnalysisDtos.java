package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.common.ApiException;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.http.HttpStatus;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.ArrayList;
import java.util.Locale;
import java.util.UUID;

record ResumeAnalysisRequest(
        @NotBlank @Size(max = 30000) String resumeText,
        @AssertTrue(message = "请确认已获授权将该简历内容发送给配置的大模型分析") boolean externalProcessingConfirmed
) {}

record ResumeDocumentPreviewResponse(
        String documentType,
        String extractedText,
        String documentHashPrefix,
        boolean malwareScanned,
        String reviewMessage
) {}

record ExternalResumeAnalysisResponse(
        ResumeIntakeResponse intake,
        ResumeAnalysisResponse analysis,
        int comparedJobCount
) {}

record ResumeAnalysisFeedbackRequest(
        @NotNull ResumeAnalysisFeedbackType feedbackType,
        @NotBlank @Size(max = 1000) String note
) {}

record ResumeAnalysisResponse(
        UUID id,
        UUID resumeIntakeId,
        String candidateName,
        String jobTitle,
        String provider,
        String modelVersion,
        String status,
        String origin,
        ResumeAnalysisResult result,
        String errorMessage,
        List<ResumeAnalysisFeedbackResponse> feedback,
        String createdBy,
        Instant createdAt,
        Instant resultExpiresAt,
        Instant resultPurgedAt
) {
    static ResumeAnalysisResponse from(AiAssistanceRun run, ObjectMapper mapper, List<ResumeAnalysisFeedback> feedback) {
        ResumeAnalysisResult result = run.getStructuredResult() == null ? null
                : ResumeAnalysisResult.parseStored(run.getStructuredResult(), mapper);
        ResumeIntake intake = run.getResumeIntake();
        return new ResumeAnalysisResponse(
                run.getId(), intake.getId(), intake.getContact().getCandidate().getDisplayName(),
                intake.getContact().getJobPosition().getTitle(), run.getProvider(), run.getModelVersion(),
                run.getStatus(), run.getOrigin(), result, run.getErrorMessage(), feedback.stream().map(ResumeAnalysisFeedbackResponse::from).toList(),
                run.getCreatedBy() == null ? "系统自动分析" : run.getCreatedBy().getDisplayName(), run.getCreatedAt(), run.getResultExpiresAt(), run.getResultPurgedAt()
        );
    }
}

record ResumeAnalysisFeedbackResponse(
        UUID id,
        ResumeAnalysisFeedbackType feedbackType,
        String note,
        String createdBy,
        Instant createdAt
) {
    static ResumeAnalysisFeedbackResponse from(ResumeAnalysisFeedback feedback) {
        return new ResumeAnalysisFeedbackResponse(feedback.getId(), feedback.getFeedbackType(), feedback.getNote(),
                feedback.getCreatedBy().getDisplayName(), feedback.getCreatedAt());
    }
}

record ResumeAnalysisResult(
        String candidateName,
        String recommendation,
        String summary,
        List<ResumeAnalysisEvidence> evidence,
        List<String> gaps,
        List<String> risks,
        List<String> followUpQuestions,
        List<ResumeJobComparison> jobComparisons
) {
    private static final List<String> RECOMMENDATIONS = List.of("PRIORITY_VIEW", "NORMAL_VIEW", "INFORMATION_NEEDED");

    ResumeAnalysisResult(String candidateName, String recommendation, String summary,
                         List<ResumeAnalysisEvidence> evidence, List<String> gaps,
                         List<String> risks, List<String> followUpQuestions) {
        this(candidateName, recommendation, summary, evidence, gaps, risks, followUpQuestions, new ArrayList<>());
    }

    static ResumeAnalysisResult parseExternal(String json, ObjectMapper mapper) {
        try {
            JsonNode root = mapper.readTree(extractJsonObject(json));
            JsonNode analysis = analysisNode(root, mapper);
            return validate(normalize(readLenientAnalysis(analysis)));
        } catch (IllegalArgumentException exception) {
            System.getLogger(ResumeAnalysisResult.class.getName())
                    .log(System.Logger.Level.WARNING, "简历分析 JSON 校验失败: " + exception.getMessage());
            throw new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_RESPONSE_INVALID",
                    "大模型返回的简历分析格式无效: " + exception.getMessage());
        } catch (RuntimeException exception) {
            System.getLogger(ResumeAnalysisResult.class.getName())
                    .log(System.Logger.Level.WARNING, "简历分析 JSON 解析异常: " + exception.getMessage());
            throw new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_RESPONSE_INVALID", "大模型返回的简历分析格式无效，未生成可用结论");
        }
    }

    /**
     * Compatible providers may satisfy json_object while returning an optional field with a
     * wrong type. Read fields independently so one malformed comparison cannot discard a
     * valid core result or the other job comparisons.
     */
    private static ResumeAnalysisResult readLenientAnalysis(JsonNode analysis) {
        if (analysis == null || !analysis.isObject()) throw new IllegalArgumentException("analysis 不是 JSON 对象");
        List<ResumeAnalysisEvidence> evidence = new ArrayList<>();
        JsonNode evidenceNode = analysis.path("evidence");
        if (evidenceNode.isArray()) for (JsonNode item : evidenceNode) {
            String criterion = boundedText(text(item.path("criterion")), 160, null);
            String finding = boundedText(text(item.path("finding")), 600, null);
            if (meaningful(criterion) && meaningful(finding)) {
                evidence.add(new ResumeAnalysisEvidence(criterion, finding, normalizeEvidenceStatus(text(item.path("status")))));
            }
            if (evidence.size() == 8) break;
        }
        List<ResumeJobComparison> comparisons = new ArrayList<>();
        JsonNode comparisonsNode = analysis.path("jobComparisons");
        if (comparisonsNode.isArray()) for (JsonNode item : comparisonsNode) {
            String title = boundedText(text(item.path("jobTitle")), 160, null);
            if (!meaningful(title)) continue;
            comparisons.add(new ResumeJobComparison(
                    boundedText(text(item.path("jobId")), 80, null), title,
                    boundedText(text(item.path("summary")), 600, "未生成该岗位摘要"),
                    responsibilityMatches(item.path("responsibilities")), skillMatches(item.path("skillMatches")),
                    textList(item.path("gaps"), 8, 400), textList(item.path("risks"), 8, 400)));
            if (comparisons.size() == 20) break;
        }
        return new ResumeAnalysisResult(
                boundedText(text(analysis.path("candidateName")), 100, null),
                text(analysis.path("recommendation")),
                boundedText(text(analysis.path("summary")), 1200, "大模型未返回明确摘要，请结合岗位要求和简历原文由 HR 复核。"),
                evidence, textList(analysis.path("gaps"), 8, 400), textList(analysis.path("risks"), 8, 400),
                textList(analysis.path("followUpQuestions"), 5, 400), comparisons);
    }

    private static List<ResumeResponsibilityMatch> responsibilityMatches(JsonNode node) {
        List<ResumeResponsibilityMatch> matches = new ArrayList<>();
        if (!node.isArray()) return matches;
        for (JsonNode item : node) {
            String responsibility = boundedText(text(item.path("responsibility")), 400, null);
            if (!meaningful(responsibility)) continue;
            matches.add(new ResumeResponsibilityMatch(responsibility,
                    boundedText(text(item.path("resumeEvidence")), 600, "未在简历中找到明确证据"),
                    safeEvidenceStatus(text(item.path("status")))));
            if (matches.size() == 12) break;
        }
        return matches;
    }

    private static List<ResumeSkillMatch> skillMatches(JsonNode node) {
        List<ResumeSkillMatch> matches = new ArrayList<>();
        if (!node.isArray()) return matches;
        for (JsonNode item : node) {
            String skill = boundedText(text(item.path("skill")), 160, null);
            if (!meaningful(skill)) continue;
            matches.add(new ResumeSkillMatch(skill,
                    boundedText(text(item.path("requirement")), 400, "岗位未明确提供该技能要求"),
                    boundedText(text(item.path("resumeEvidence")), 600, "未在简历中找到明确证据"),
                    safeEvidenceStatus(text(item.path("status")))));
            if (matches.size() == 12) break;
        }
        return matches;
    }

    private static List<String> textList(JsonNode node, int maxItems, int maxLength) {
        List<String> values = new ArrayList<>();
        if (!node.isArray()) return values;
        for (JsonNode item : node) {
            String value = boundedText(text(item), maxLength, null);
            if (meaningful(value)) values.add(value);
            if (values.size() == maxItems) break;
        }
        return values;
    }

    private static String text(JsonNode node) { return node == null ? null : node.stringValueOpt().orElse(null); }

    private static String boundedText(String value, int maxLength, String fallback) {
        if (value == null || value.isBlank()) return fallback;
        String clean = value.trim();
        return clean.length() <= maxLength ? clean : clean.substring(0, maxLength);
    }

    private static String extractJsonObject(String value) {
        if (value == null) throw new IllegalArgumentException("Missing JSON response");
        String clean = value.replaceAll("(?s)<think>.*?</think>", "").trim();
        if (clean.startsWith("```")) {
            int firstLineEnd = clean.indexOf('\n');
            int closingFence = clean.lastIndexOf("```");
            if (firstLineEnd >= 0 && closingFence > firstLineEnd) {
                clean = clean.substring(firstLineEnd + 1, closingFence).trim();
            }
        }
        int start = clean.indexOf('{');
        int end = clean.lastIndexOf('}');
        if (start < 0 || end < start) throw new IllegalArgumentException("Missing JSON object");
        return clean.substring(start, end + 1);
    }

    private static JsonNode analysisNode(JsonNode root, ObjectMapper mapper) {
        JsonNode node = root;
        for (int i = 0; i < 3; i++) {
            if (node == null || node.isNull()) break;
            JsonNode nested = node.path("analysis");
            if (!nested.isMissingNode() && !nested.isNull()) {
                if (nested.isTextual()) {
                    return mapper.readTree(extractJsonObject(nested.textValue()));
                }
                return nested;
            }
            JsonNode result = node.path("result");
            if (!result.isMissingNode() && result.isObject()) { node = result; continue; }
            JsonNode data = node.path("data");
            if (!data.isMissingNode() && data.isObject()) { node = data; continue; }
            break;
        }
        return node;
    }

    static ResumeAnalysisResult parseStored(String json, ObjectMapper mapper) {
        try {
            return validate(normalize(mapper.readValue(json, ResumeAnalysisResult.class)));
        } catch (RuntimeException exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "RESUME_ANALYSIS_RECORD_INVALID", "已保存的简历分析记录无法读取");
        }
    }

    private static ResumeAnalysisResult normalize(ResumeAnalysisResult value) {
        if (value == null) return null;
        List<ResumeAnalysisEvidence> evidence = value.evidence() == null ? new ArrayList<>() : value.evidence().stream()
                .filter(item -> item != null && meaningful(item.criterion()) && meaningful(item.finding()))
                .map(item -> new ResumeAnalysisEvidence(item.criterion().trim(), item.finding().trim(),
                        normalizeEvidenceStatus(item.status())))
                .limit(8).toList();
        if (evidence.isEmpty()) {
            evidence = List.of(new ResumeAnalysisEvidence("整体岗位匹配", "大模型未返回明确证据，请由 HR 复核。", "UNCLEAR"));
        }
        List<String> followUpQuestions = new ArrayList<>(cleanTextList(value.followUpQuestions()).stream().limit(5).toList());
        List<String> defaults = List.of("请补充说明最近一份工作的主要职责？", "请介绍一个与岗位相关的项目成果？", "最快何时可以到岗？");
        for (String question : defaults) {
            if (followUpQuestions.size() >= 3) break;
            if (!followUpQuestions.contains(question)) followUpQuestions.add(question);
        }
        List<ResumeJobComparison> comparisons = value.jobComparisons() == null ? new ArrayList<>() : value.jobComparisons().stream()
                .filter(item -> item != null && meaningful(item.jobTitle()))
                .map(item -> new ResumeJobComparison(trim(item.jobId()), item.jobTitle().trim(), item.summary() == null || item.summary().isBlank() ? "未生成该岗位摘要" : item.summary().trim(),
                        item.responsibilities() == null ? new ArrayList<>() : item.responsibilities().stream()
                                .filter(detail -> detail != null && meaningful(detail.responsibility()))
                                .map(detail -> new ResumeResponsibilityMatch(detail.responsibility().trim(), detail.resumeEvidence() == null || detail.resumeEvidence().isBlank() ? "未在简历中找到明确证据" : detail.resumeEvidence().trim(), safeEvidenceStatus(detail.status())))
                                .toList(), item.skillMatches() == null ? new ArrayList<>() : item.skillMatches().stream()
                                .filter(skill -> skill != null && meaningful(skill.skill()))
                                .map(skill -> new ResumeSkillMatch(skill.skill().trim(), skill.requirement() == null || skill.requirement().isBlank() ? "岗位未明确提供该技能要求" : skill.requirement().trim(), skill.resumeEvidence() == null || skill.resumeEvidence().isBlank() ? "未在简历中找到明确证据" : skill.resumeEvidence().trim(), safeEvidenceStatus(skill.status())))
                                .limit(12).toList(), cleanTextList(item.gaps()), cleanTextList(item.risks())))
                .limit(20)
                .toList();
        String summary = trim(value.summary());
        if (!meaningful(summary)) summary = "大模型未返回明确摘要，请结合岗位要求和简历原文由 HR 复核。";
        return new ResumeAnalysisResult(trim(value.candidateName()), normalizeRecommendation(value.recommendation()), summary, evidence,
                cleanTextList(value.gaps()).stream().limit(8).toList(), cleanTextList(value.risks()).stream().limit(8).toList(), followUpQuestions, comparisons);
    }

    private static String normalizeRecommendation(String value) {
        if (value == null || value.isBlank()) return "INFORMATION_NEEDED";
        return switch (value.trim().toUpperCase(Locale.ROOT)) {
            case "PRIORITY_VIEW", "INTERVIEW_RECOMMENDED", "STRONG_MATCH", "HIGH_MATCH", "RECOMMENDED", "PRIORITY" -> "PRIORITY_VIEW";
            case "NORMAL_VIEW", "MATCHED", "PARTIAL_MATCH", "NORMAL", "REVIEW" -> "NORMAL_VIEW";
            case "INFORMATION_NEEDED", "NEEDS_MORE_INFO", "INSUFFICIENT_INFO", "UNCERTAIN", "UNKNOWN" -> "INFORMATION_NEEDED";
            default -> "INFORMATION_NEEDED";
        };
    }

    private static String normalizeEvidenceStatus(String value) {
        if (value == null) return "UNCLEAR";
        String normalized = value.trim().toUpperCase(Locale.ROOT).replaceAll("[\\s-]+", "_");
        return switch (normalized) {
            case "FOUND", "MATCH", "MATCHED", "PRESENT", "YES", "TRUE", "PASS", "符合", "匹配", "存在" -> "FOUND";
            case "NOT_FOUND", "MISS", "MISSING", "ABSENT", "NOT_PRESENT", "NO", "FALSE", "FAIL", "未找到", "不匹配", "缺失" -> "NOT_FOUND";
            case "UNCLEAR", "UNKNOWN", "UNDETERMINED", "UNCERTAIN", "NOT_SURE", "UNSURE", "不明确", "未知", "无法判断" -> "UNCLEAR";
            default -> normalized;
        };
    }

    private static String safeEvidenceStatus(String value) {
        String normalized = normalizeEvidenceStatus(value);
        return List.of("FOUND", "NOT_FOUND", "UNCLEAR").contains(normalized) ? normalized : "UNCLEAR";
    }

    private static List<String> cleanTextList(List<String> values) {
        return values == null ? new ArrayList<>() : values.stream().filter(ResumeAnalysisResult::meaningful).map(String::trim).toList();
    }

    private static String trim(String value) { return value == null ? null : value.trim(); }

    private static ResumeAnalysisResult validate(ResumeAnalysisResult value) {
        if (value == null)
            throw new IllegalArgumentException("value is null");
        if (value.candidateName() != null && value.candidateName().length() > 100)
            throw new IllegalArgumentException("candidateName 过长");
        if (!RECOMMENDATIONS.contains(value.recommendation()))
            throw new IllegalArgumentException("recommendation 无效: '" + value.recommendation() + "'");
        if (!usable(value.summary(), 1200))
            throw new IllegalArgumentException("summary 无效: " + (value.summary() == null ? "null" : "长度=" + value.summary().length()));
        if (!validTextList(value.gaps(), 8, 400))
            throw new IllegalArgumentException("gaps 无效: 数量=" + (value.gaps() == null ? "null" : value.gaps().size()));
        if (!validTextList(value.risks(), 8, 400))
            throw new IllegalArgumentException("risks 无效: 数量=" + (value.risks() == null ? "null" : value.risks().size()));
        if (!validTextList(value.followUpQuestions(), 5, 400))
            throw new IllegalArgumentException("followUpQuestions 无效: 数量=" + (value.followUpQuestions() == null ? "null" : value.followUpQuestions().size()));
        if (value.followUpQuestions().size() < 3)
            throw new IllegalArgumentException("followUpQuestions 不足3个: 实际=" + value.followUpQuestions().size());
        if (value.evidence() == null)
            throw new IllegalArgumentException("evidence is null");
        if (value.evidence().isEmpty())
            throw new IllegalArgumentException("evidence 为空(可能全部被 normalize 过滤)");
        if (value.evidence().size() > 8)
            throw new IllegalArgumentException("evidence 超过8条: " + value.evidence().size());
        for (int i = 0; i < value.evidence().size(); i++) {
            ResumeAnalysisEvidence item = value.evidence().get(i);
            if (item == null)
                throw new IllegalArgumentException("evidence[" + i + "] is null");
            if (!usable(item.criterion(), 160))
                throw new IllegalArgumentException("evidence[" + i + "].criterion 无效: " + (item.criterion() == null ? "null" : "长度=" + item.criterion().length()));
            if (!usable(item.finding(), 600))
                throw new IllegalArgumentException("evidence[" + i + "].finding 无效: " + (item.finding() == null ? "null" : "长度=" + item.finding().length()));
            if (!List.of("FOUND", "NOT_FOUND", "UNCLEAR").contains(item.status()))
                throw new IllegalArgumentException("evidence[" + i + "].status 无效: '" + item.status() + "'");
        }
        return value;
    }

    private static boolean validTextList(List<String> values, int maxCount, int maxLength) {
        return values != null && values.size() <= maxCount && values.stream().allMatch(value -> usable(value, maxLength));
    }

    private static boolean usable(String value, int maxLength) {
        return meaningful(value) && value.length() <= maxLength;
    }

    private static boolean meaningful(String value) {
        return value != null && !value.isBlank() && value.codePoints().anyMatch(Character::isLetterOrDigit);
    }
}

record ResumeAnalysisEvidence(String criterion, String finding, String status) {}

record ResumeJobComparison(
        String jobId,
        String jobTitle,
        String summary,
        List<ResumeResponsibilityMatch> responsibilities,
        List<ResumeSkillMatch> skillMatches,
        List<String> gaps,
        List<String> risks
) {}

record ResumeResponsibilityMatch(String responsibility, String resumeEvidence, String status) {}

record ResumeSkillMatch(String skill, String requirement, String resumeEvidence, String status) {}
