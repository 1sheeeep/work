package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyAttemptRepository;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.*;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPosition;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.jobs.JobPositionStatus;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class CandidateService {
    private final CandidateProfileRepository profileRepository;
    private final CandidateJobContactRepository contactRepository;
    private final ScreeningDecisionRepository decisionRepository;
    private final ConversationMessageRepository messageRepository;
    private final JobPositionRepository jobRepository;
    private final CurrentUserService currentUserService;
    private final AuditService auditService;
    private final AutoReplyAttemptRepository autoReplyAttempts;

    public CandidateService(CandidateProfileRepository profileRepository,
                            CandidateJobContactRepository contactRepository,
                            ScreeningDecisionRepository decisionRepository,
                            ConversationMessageRepository messageRepository,
                            JobPositionRepository jobRepository, CurrentUserService currentUserService,
                            AuditService auditService, AutoReplyAttemptRepository autoReplyAttempts) {
        this.profileRepository = profileRepository; this.contactRepository = contactRepository;
        this.decisionRepository = decisionRepository; this.messageRepository = messageRepository;
        this.jobRepository = jobRepository; this.currentUserService = currentUserService;
        this.auditService = auditService; this.autoReplyAttempts = autoReplyAttempts;
    }

    @Transactional(readOnly = true)
    public List<CandidateContactResponse> list(String keyword, UUID companyId, UUID jobPositionId,
                                               CandidateContactStatus status, Boolean humanTakenOver) {
        SystemUser user = currentUserService.requireCurrentUser();
        requireCompanyAccessIfSelected(companyId, user);
        String normalized = cleanOptional(keyword) == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        return contactRepository.findAllByOrderByUpdatedAtDesc().stream()
                .filter(contact -> canAccess(contact.getCandidate().getCompany().getId(), user))
                .filter(contact -> companyId == null || companyId.equals(contact.getCandidate().getCompany().getId()))
                .filter(contact -> jobPositionId == null || jobPositionId.equals(contact.getJobPosition().getId()))
                .filter(contact -> status == null || status == contact.getStatus())
                .filter(contact -> humanTakenOver == null || humanTakenOver == contact.isHumanTakenOver())
                .filter(contact -> normalized.isBlank()
                        || contact.getCandidate().getDisplayName().toLowerCase(Locale.ROOT).contains(normalized)
                        || nullableContains(contact.getCandidate().getCurrentTitle(), normalized)
                        || contact.getJobPosition().getTitle().toLowerCase(Locale.ROOT).contains(normalized))
                .map(this::response)
                .sorted(java.util.Comparator.comparing(CandidateContactResponse::needsHrFollowUp).reversed()
                        .thenComparing(CandidateContactResponse::latestMessageAt, java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())))
                .toList();
    }

    @Transactional(readOnly = true)
    public CandidateDetailResponse detail(UUID id) {
        CandidateJobContact contact = requireAccessibleContact(id, currentUserService.requireCurrentUser());
        List<ScreeningDecision> decisions = decisionRepository.findByContactIdOrderByCreatedAtDesc(id);
        return new CandidateDetailResponse(summary(contact, decisions),
                decisions.stream().map(ScreeningDecisionResponse::from).toList(),
                messageRepository.findTop50ByContactIdOrderByCreatedAtAsc(id).stream().map(ConversationMessageResponse::from).toList());
    }

    @Transactional
    public CandidateCreateResponse create(CandidateCreateRequest request) {
        SystemUser user = currentUserService.requireCurrentUser();
        JobPosition job = requireEligibleJob(request.jobPositionId(), user);
        String dedupKey = hash(job.getCompany().getId() + "|" + request.source() + "|"
                + cleanRequired(request.externalCandidateId()).toLowerCase(Locale.ROOT));
        CandidateProfile profile = profileRepository.findByCompanyIdAndSourceAndDedupKey(
                        job.getCompany().getId(), request.source(), dedupKey)
                .orElseGet(() -> profileRepository.save(new CandidateProfile(job.getCompany(), request.source(), dedupKey,
                        cleanRequired(request.displayName()), cleanOptional(request.currentTitle()), request.yearsExperience(),
                        cleanOptional(request.education()), cleanOptional(request.skillsSummary()))));
        var existing = contactRepository.findByCandidateIdAndJobPositionId(profile.getId(), job.getId());
        if (existing.isPresent()) return new CandidateCreateResponse(response(requireAccessibleContact(existing.get().getId(), user)), true);
        profile.refresh(cleanRequired(request.displayName()), cleanOptional(request.currentTitle()), request.yearsExperience(),
                cleanOptional(request.education()), cleanOptional(request.skillsSummary()));
        CandidateJobContact contact = contactRepository.save(new CandidateJobContact(profile, job, job.getBossAccount()));
        decisionRepository.save(new ScreeningDecision(contact, ScreeningDecisionType.HARD_RULE, request.hardRuleOutcome(),
                "hard-rules-v1", null, null, cleanRequired(request.hardRuleRationale()), user));
        decisionRepository.save(new ScreeningDecision(contact, ScreeningDecisionType.AI_SUGGESTION, request.aiOutcome(),
                null, cleanRequired(request.modelVersion()), cleanRequired(request.promptVersion()),
                cleanRequired(request.aiRationale()), user));
        contact.applyScreening(request.hardRuleOutcome(), request.aiOutcome());
        auditService.success("CREATE_CANDIDATE_CONTACT", "CANDIDATE_CONTACT", contact.getId(), auditLabel(profile),
                "新增候选人与职位接触关系，原始外部候选人 ID 未持久化");
        return new CandidateCreateResponse(response(contact), false);
    }

    @Transactional
    public CandidateContactResponse takeOver(UUID id) {
        SystemUser user = currentUserService.requireCurrentUser();
        CandidateJobContact contact = requireAccessibleContact(id, user);
        contact.takeOver(user);
        auditService.success("TAKE_OVER_CANDIDATE", "CANDIDATE_CONTACT", id, auditLabel(contact.getCandidate()), "HR 人工接管会话");
        return response(contact);
    }

    @Transactional
    public CandidateContactResponse release(UUID id) {
        SystemUser user = currentUserService.requireCurrentUser();
        CandidateJobContact contact = requireAccessibleContact(id, user);
        contact.release();
        auditService.success("RELEASE_CANDIDATE", "CANDIDATE_CONTACT", id, auditLabel(contact.getCandidate()), "释放人工接管");
        return response(contact);
    }

    @Transactional
    public CandidateContactResponse humanDecision(UUID id, HumanDecisionRequest request) {
        SystemUser user = currentUserService.requireCurrentUser();
        CandidateJobContact contact = requireAccessibleContact(id, user);
        contact.takeOver(user); contact.applyHumanDecision(request.outcome());
        decisionRepository.save(new ScreeningDecision(contact, ScreeningDecisionType.HUMAN_OVERRIDE, request.outcome(),
                "human", null, null, cleanRequired(request.rationale()), user));
        auditService.success("OVERRIDE_CANDIDATE_SCREENING", "CANDIDATE_CONTACT", id, auditLabel(contact.getCandidate()),
                "人工筛选结论 " + request.outcome().name());
        return response(contact);
    }

    @Transactional
    public CandidateContactResponse anonymize(UUID id) {
        SystemUser user = requireManager();
        CandidateJobContact contact = requireAccessibleContact(id, user);
        CandidateProfile profile = contact.getCandidate();
        profile.anonymize();
        contactRepository.findByCandidateId(profile.getId()).forEach(candidateContact -> {
            decisionRepository.findByContactIdOrderByCreatedAtDesc(candidateContact.getId()).forEach(ScreeningDecision::anonymize);
            messageRepository.findByContactIdOrderByCreatedAtAsc(candidateContact.getId()).forEach(ConversationMessage::anonymize);
        });
        auditService.success("ANONYMIZE_CANDIDATE", "CANDIDATE_CONTACT", id, "已匿名候选人", "清除候选人业务资料与会话正文，保留去重摘要和审计链");
        return response(contact);
    }

    private CandidateContactResponse response(CandidateJobContact contact) {
        return summary(contact, decisionRepository.findByContactIdOrderByCreatedAtDesc(contact.getId()));
    }
    private CandidateContactResponse summary(CandidateJobContact contact, List<ScreeningDecision> decisions) {
        return CandidateContactResponse.from(contact, decisions,
                messageRepository.findFirstByContactIdOrderByCreatedAtDescIdDesc(contact.getId()).orElse(null),
                autoReplyAttempts.findFirstByContactIdOrderByCreatedAtDesc(contact.getId()).orElse(null));
    }
    private CandidateJobContact requireAccessibleContact(UUID id, SystemUser user) {
        CandidateJobContact contact = contactRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CANDIDATE_CONTACT_NOT_FOUND", "候选人职位关系不存在"));
        requireCompanyAccess(contact.getCandidate().getCompany().getId(), user); return contact;
    }
    private JobPosition requireEligibleJob(UUID id, SystemUser user) {
        JobPosition job = jobRepository.findWithDetailsById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "JOB_POSITION_NOT_FOUND", "职位不存在"));
        requireCompanyAccess(job.getCompany().getId(), user);
        if (job.getStatus() != JobPositionStatus.ACTIVE) throw new ApiException(HttpStatus.BAD_REQUEST, "JOB_POSITION_NOT_ACTIVE", "只能为已启用职位新增候选人");
        BossAccount account = job.getBossAccount();
        if (account.getStatus() != BossAccountStatus.ACTIVE || !account.getCapabilities().contains(BossCapability.CANDIDATE_READ)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CANDIDATE_READ_UNAVAILABLE", "职位 BOSS 账号不具备候选人读取能力");
        }
        return job;
    }
    private SystemUser requireManager() {
        SystemUser user = currentUserService.requireCurrentUser();
        if (user.getRole() == UserRole.RECRUITER) throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "当前账号没有候选人匿名化权限");
        return user;
    }
    private void requireCompanyAccessIfSelected(UUID companyId, SystemUser user) { if (companyId != null) requireCompanyAccess(companyId, user); }
    private void requireCompanyAccess(UUID companyId, SystemUser user) {
        if (!canAccess(companyId, user)) throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
    }
    private boolean canAccess(UUID companyId, SystemUser user) {
        return user.getRole() == UserRole.SYSTEM_ADMIN || allowedCompanyIds(user).contains(companyId);
    }
    private Set<UUID> allowedCompanyIds(SystemUser user) { return user.getCompanyScopes().stream().map(Company::getId).collect(Collectors.toSet()); }
    private boolean nullableContains(String value, String normalized) { return value != null && value.toLowerCase(Locale.ROOT).contains(normalized); }
    private String cleanRequired(String value) { return value.trim(); }
    private String cleanOptional(String value) { return value == null || value.isBlank() ? null : value.trim(); }
    private String auditLabel(CandidateProfile profile) { return profile.getSource() + " · " + profile.getDedupKey().substring(0, 8); }
    private String hash(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch (NoSuchAlgorithmException exception) { throw new IllegalStateException("SHA-256 unavailable", exception); }
    }
}
