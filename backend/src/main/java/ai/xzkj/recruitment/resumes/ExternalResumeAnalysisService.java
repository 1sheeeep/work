package ai.xzkj.recruitment.resumes;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.candidates.CandidateJobContactRepository;
import ai.xzkj.recruitment.candidates.CandidateProfile;
import ai.xzkj.recruitment.candidates.CandidateProfileRepository;
import ai.xzkj.recruitment.candidates.CandidateSource;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;

@Service
public class ExternalResumeAnalysisService {
    private final JobPositionRepository jobs;
    private final CandidateProfileRepository candidates;
    private final CandidateJobContactRepository contacts;
    private final ResumeIntakeRepository intakes;
    private final AiAssistanceRunRepository runs;
    private final CurrentUserService users;
    private final ResumeDocumentTextExtractor documents;
    private final ResumeMalwareScanner malware;
    private final ExternalResumeAiClient client;
    private final OpenAiProperties properties;
    private final ResumeAnalysisRetentionProperties retention;
    private final ObjectMapper mapper;
    private final AuditService audit;

    public ExternalResumeAnalysisService(JobPositionRepository jobs, CandidateProfileRepository candidates,
                                         CandidateJobContactRepository contacts, ResumeIntakeRepository intakes,
                                         AiAssistanceRunRepository runs, CurrentUserService users,
                                         ResumeDocumentTextExtractor documents, ResumeMalwareScanner malware,
                                         ExternalResumeAiClient client, OpenAiProperties properties,
                                         ResumeAnalysisRetentionProperties retention, ObjectMapper mapper,
                                         AuditService audit) {
        this.jobs = jobs;
        this.candidates = candidates;
        this.contacts = contacts;
        this.intakes = intakes;
        this.runs = runs;
        this.users = users;
        this.documents = documents;
        this.malware = malware;
        this.client = client;
        this.properties = properties;
        this.retention = retention;
        this.mapper = mapper;
        this.audit = audit;
    }

    @Transactional(noRollbackFor = ApiException.class)
    public ExternalResumeAnalysisResponse analyze(MultipartFile file, boolean confirmed) {
        if (!confirmed) throw new ApiException(HttpStatus.BAD_REQUEST, "EXTERNAL_RESUME_AI_CONFIRMATION_REQUIRED",
                "拖入外部 PDF 前请确认该文件可发送给 AI 进行岗位匹配");
        SystemUser user = users.requireCurrentUser();
        byte[] content = documents.readBytes(file);
        ResumeDocumentTextExtractor.ExtractedResumeDocument document = documents.extract(content);
        if (!"PDF".equals(document.type())) throw new ApiException(HttpStatus.BAD_REQUEST,
                "EXTERNAL_RESUME_PDF_REQUIRED", "外部简历分析当前仅支持 PDF 文件");
        ResumeMalwareScanner.ScanResult scan = malware.scan(content);
        List<JobPosition> accessibleJobs = jobs.findAllByStatusOrderByUpdatedAtDesc(JobPositionStatus.ACTIVE).stream()
                .filter(job -> canAccess(job.getCompany(), user)).toList();
        if (accessibleJobs.isEmpty()) throw new ApiException(HttpStatus.CONFLICT, "ACTIVE_JOB_REQUIRED",
                "当前权限范围内没有已启用岗位，无法进行岗位匹配");

        String inputHash = hash(document.text());
        ExternalResumeAiClient.ExternalResumeMatch match = client.match(accessibleJobs, document.text(), actorHash(user));
        JobPosition matchedJob = accessibleJobs.stream().filter(job -> job.getId().equals(match.matchedJobId())).findFirst()
                .orElseThrow(() -> new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_MATCHED_JOB_INVALID",
                        "AI 返回的匹配岗位不在当前可用岗位范围内"));
        String candidateName = cleanName(match.candidateName());
        Company company = matchedJob.getCompany();
        String documentHash = document.documentHash();
        CandidateProfile candidate = candidates.findByCompanyIdAndSourceAndDedupKey(company.getId(), CandidateSource.MANUAL, documentHash)
                .orElseGet(() -> candidates.save(new CandidateProfile(company, CandidateSource.MANUAL, documentHash,
                        candidateName, null, null, null, null)));
        candidate.refresh(candidateName, candidate.getCurrentTitle(), candidate.getYearsExperience(),
                candidate.getEducation(), candidate.getSkillsSummary());
        CandidateJobContact contact = contacts.findByCandidateIdAndJobPositionId(candidate.getId(), matchedJob.getId())
                .orElseGet(() -> contacts.save(new CandidateJobContact(candidate, matchedJob, matchedJob.getBossAccount())));
        ResumeIntake intake = intakes.findByContactIdAndResumeDigest(contact.getId(), documentHash).orElseGet(() ->
                intakes.save(new ResumeIntake(contact, ResumeIntakeSource.MANUAL, documentHash,
                        "外部 PDF · " + candidateName, Instant.now())));
        intake.processing();
        intake.readyForAi("PDF", inputHash, scan.scanned(), Instant.now());
        intake.review(ResumeIntakeStatus.APPROVED_FOR_AI, "外部 PDF 拖入并确认 AI 岗位匹配", user, Instant.now());
        intake.analysisStarted();
        AiAssistanceRun run = runs.save(AiAssistanceRun.succeeded(intake, user, properties.getModel(), inputHash,
                match.analysis().summary(), mapper.writeValueAsString(match.analysis()), retention.expiresFrom(Instant.now())));
        intake.analysisSucceeded(Instant.now());
        audit.success("ANALYZE_EXTERNAL_RESUME_PDF", "RESUME_INTAKE", intake.getId(),
                "外部 PDF 摘要 " + documentHash.substring(0, 12),
                "HR 拖入外部 PDF 并确认 AI 处理；已识别姓名并在 " + accessibleJobs.size()
                        + " 个授权启用岗位中完成匹配；不保存 PDF 原文或提取文本");
        return new ExternalResumeAnalysisResponse(ResumeIntakeResponse.from(intake),
                ResumeAnalysisResponse.from(run, mapper, List.of()), accessibleJobs.size());
    }

    private boolean canAccess(Company company, SystemUser user) {
        return user.getRole() == UserRole.SYSTEM_ADMIN || user.getCompanyScopes().stream()
                .map(Company::getId).anyMatch(company.getId()::equals);
    }

    private String cleanName(String value) {
        String clean = value == null ? "" : value.replace('\n', ' ').replace('\r', ' ').trim();
        if (clean.isBlank()) throw new ApiException(HttpStatus.BAD_GATEWAY, "OPENAI_CANDIDATE_NAME_MISSING",
                "AI 未能从 PDF 中识别候选人姓名");
        return clean.substring(0, Math.min(100, clean.length()));
    }

    private String actorHash(SystemUser user) { return hash("external-resume-actor:" + user.getId()); }
    private String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }
}
