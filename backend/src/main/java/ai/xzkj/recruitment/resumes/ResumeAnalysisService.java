package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

@Service
public class ResumeAnalysisService {
    private final ResumeIntakeRepository intakes;
    private final AiAssistanceRunRepository runs;
    private final CurrentUserService users;
    private final OpenAiResumeClient client;
    private final OpenAiProperties properties;
    private final ObjectMapper mapper;
    private final AuditService audit;

    public ResumeAnalysisService(ResumeIntakeRepository intakes, AiAssistanceRunRepository runs,
                                 CurrentUserService users, OpenAiResumeClient client, OpenAiProperties properties,
                                 ObjectMapper mapper, AuditService audit) {
        this.intakes = intakes;
        this.runs = runs;
        this.users = users;
        this.client = client;
        this.properties = properties;
        this.mapper = mapper;
        this.audit = audit;
    }

    @Transactional(noRollbackFor = ApiException.class)
    public ResumeAnalysisResponse analyze(UUID intakeId, ResumeAnalysisRequest request) {
        SystemUser user = users.requireCurrentUser();
        ResumeIntake intake = requireApprovedIntake(intakeId, user);
        String resumeText = cleanResumeText(request.resumeText());
        String inputHash = hash(resumeText);
        try {
            ResumeAnalysisResult result = client.analyze(intake.getContact().getJobPosition(), resumeText, actorHash(user));
            AiAssistanceRun run = runs.save(AiAssistanceRun.succeeded(
                    intake, user, properties.getModel(), inputHash, result.summary(), mapper.writeValueAsString(result)
            ));
            audit.success("REQUEST_OPENAI_RESUME_ANALYSIS", "RESUME_INTAKE", intake.getId(), intake.getDisplayLabel(),
                    "HR 已确认外部 OpenAI 分析；仅保存输入摘要和结构化结果，不保存简历原文");
            return ResumeAnalysisResponse.from(run, mapper);
        } catch (ApiException exception) {
            recordFailure(intake, user, inputHash, exception.getCode());
            throw exception;
        } catch (Exception exception) {
            recordFailure(intake, user, inputHash, "OPENAI_RESULT_PERSIST_FAILED");
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "RESUME_ANALYSIS_SAVE_FAILED", "简历分析结果保存失败，未生成可用结论");
        }
    }

    @Transactional(readOnly = true)
    public List<ResumeAnalysisResponse> list(UUID intakeId) {
        SystemUser user = users.requireCurrentUser();
        ResumeIntake intake = requireIntake(intakeId, user);
        return runs.findByResumeIntakeIdOrderByCreatedAtDesc(intake.getId()).stream()
                .map(run -> ResumeAnalysisResponse.from(run, mapper)).toList();
    }

    private void recordFailure(ResumeIntake intake, SystemUser user, String inputHash, String code) {
        runs.save(AiAssistanceRun.failed(intake, user, properties.getModel(), inputHash, code));
        audit.failure("REQUEST_OPENAI_RESUME_ANALYSIS", "RESUME_INTAKE", intake.getId(), intake.getDisplayLabel(),
                "OpenAI 简历分析未完成，原因代码：" + code + "；简历原文未写入审计");
    }

    private ResumeIntake requireApprovedIntake(UUID id, SystemUser user) {
        ResumeIntake intake = requireIntake(id, user);
        if (intake.getStatus() != ResumeIntakeStatus.APPROVED_FOR_AI) {
            throw new ApiException(HttpStatus.CONFLICT, "RESUME_AI_NOT_APPROVED", "该简历尚未获 HR 授权，不能发送给 OpenAI 分析");
        }
        return intake;
    }

    private ResumeIntake requireIntake(UUID id, SystemUser user) {
        ResumeIntake intake = intakes.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "RESUME_INTAKE_NOT_FOUND", "简历登记不存在"));
        boolean allowed = user.getRole() == UserRole.SYSTEM_ADMIN || user.getCompanyScopes().stream()
                .map(Company::getId).anyMatch(intake.getContact().getCandidate().getCompany().getId()::equals);
        if (!allowed) throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
        return intake;
    }

    private String cleanResumeText(String value) {
        if (value == null) throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_TEXT_REQUIRED", "请粘贴已审核简历的必要文本");
        String clean = value.replace("\u0000", "").trim();
        if (clean.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_TEXT_REQUIRED", "请粘贴已审核简历的必要文本");
        if (clean.length() > 30000) throw new ApiException(HttpStatus.BAD_REQUEST, "RESUME_TEXT_TOO_LONG", "单次简历文本不能超过 30000 个字符");
        return clean;
    }

    private String actorHash(SystemUser user) { return hash("resume-ai-actor:" + user.getId()); }

    private String hash(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception exception) {
            throw new IllegalStateException("SHA-256 unavailable", exception);
        }
    }
}
