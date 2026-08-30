package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.autoreply.AutoReplyAttemptRepository;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Service
public class CandidateService {
    private final CandidateJobContactRepository contactRepository;
    private final ScreeningDecisionRepository decisionRepository;
    private final ConversationMessageRepository messageRepository;
    private final CurrentUserService currentUserService;
    private final AuditService auditService;
    private final AutoReplyAttemptRepository autoReplyAttempts;

    public CandidateService(CandidateJobContactRepository contactRepository,
                            ScreeningDecisionRepository decisionRepository,
                            ConversationMessageRepository messageRepository,
                            CurrentUserService currentUserService,
                            AuditService auditService, AutoReplyAttemptRepository autoReplyAttempts) {
        this.contactRepository = contactRepository;
        this.decisionRepository = decisionRepository; this.messageRepository = messageRepository;
        this.currentUserService = currentUserService;
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
}
