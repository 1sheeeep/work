package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.resumes.ResumeIntake;
import ai.xzkj.recruitment.resumes.ResumeIntakeRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.*;

@Service
public class CandidateMergeService {
    private final CandidateProfileRepository profiles;
    private final CandidateMergeOperationRepository operations;
    private final CandidateMergeItemRepository items;
    private final CurrentUserService users;
    private final AuditService audit;
    private final CandidateJobContactRepository contacts;
    private final ResumeIntakeRepository intakes;
    private final ConversationMessageRepository messages;

    @Autowired
    public CandidateMergeService(CandidateProfileRepository profiles,
                                 CandidateMergeOperationRepository operations,
                                 CandidateMergeItemRepository items,
                                 CurrentUserService users, AuditService audit,
                                 CandidateJobContactRepository contacts, ResumeIntakeRepository intakes,
                                 ConversationMessageRepository messages) {
        this.profiles = profiles; this.operations = operations; this.items = items; this.users = users; this.audit = audit;
        this.contacts = contacts; this.intakes = intakes; this.messages = messages;
    }

    CandidateMergeService(CandidateProfileRepository profiles, CandidateMergeOperationRepository operations,
                          CandidateMergeItemRepository items, CurrentUserService users, AuditService audit) {
        this(profiles, operations, items, users, audit, null, null, null);
    }

    @Transactional
    public CandidateMergeOperationResponse merge(CandidateMergeRequest request) {
        SystemUser user = requireManager();
        UUID primaryId = request.primaryCandidateId();
        LinkedHashSet<UUID> sourceIds = new LinkedHashSet<>(request.duplicateCandidateIds());
        if (sourceIds.isEmpty() || sourceIds.contains(primaryId)) throw bad("CANDIDATE_MERGE_TARGET_INVALID", "主候选人和重复候选人列表无效");
        CandidateProfile primary = requireVisible(primaryId, user);
        if (primary.isMerged()) throw conflict("CANDIDATE_PRIMARY_ALREADY_MERGED", "主候选人已经是合并别名，不能作为主档案");
        List<CandidateProfile> sources = sourceIds.stream().map(id -> requireVisible(id, user)).toList();
        for (CandidateProfile source : sources) {
            if (source.isMerged()) throw conflict("CANDIDATE_ALREADY_MERGED", "重复候选人中包含已合并档案，请刷新预览后重试");
            if (!primary.getCompany().getId().equals(source.getCompany().getId())) throw forbidden();
        }
        Instant now = Instant.now();
        CandidateMergeOperation operation = operations.save(new CandidateMergeOperation(primary.getCompany(), primary, user, now));
        for (CandidateProfile source : sources) {
            source.markMerged(primary.getId(), user, now);
            items.save(new CandidateMergeItem(operation, source, primary));
        }
        audit.success("MERGE_TALENT_CANDIDATES", "CANDIDATE_PROFILE", primary.getId(),
                "人才库候选人合并", "管理员确认将 " + sources.size() + " 个候选人档案归入主档案；原档案保留为可撤销别名");
        return response(operation, sources.stream().map(CandidateProfile::getId).toList());
    }

    @Transactional(readOnly = true)
    public CandidateMergePreviewResponse preview(CandidateMergeRequest request) {
        SystemUser user = requireManager();
        UUID primaryId = request.primaryCandidateId();
        LinkedHashSet<UUID> ids = new LinkedHashSet<>(request.duplicateCandidateIds());
        if (ids.isEmpty() || ids.contains(primaryId)) throw bad("CANDIDATE_MERGE_TARGET_INVALID", "主候选人和重复候选人列表无效");
        CandidateProfile primary = requireVisible(primaryId, user);
        List<CandidateProfile> candidatesToMerge = ids.stream().map(id -> requireVisible(id, user)).toList();
        if (primary.isMerged() || candidatesToMerge.stream().anyMatch(CandidateProfile::isMerged))
            throw conflict("CANDIDATE_ALREADY_MERGED", "选择中包含已合并档案，请刷新重复预览");
        if (candidatesToMerge.stream().anyMatch(candidate -> !primary.getCompany().getId().equals(candidate.getCompany().getId())))
            throw forbidden();
        List<UUID> allIds = new ArrayList<>(); allIds.add(primaryId); allIds.addAll(ids);
        // Counts are read through repositories and are intentionally aggregate-only.
        int contactCount = 0, resumeCount = 0, messageCount = 0;
        long successful = 0;
        List<String> warnings = new ArrayList<>();
        Set<UUID> jobIds = new HashSet<>();
        for (UUID id : allIds) {
            List<CandidateJobContact> candidateContacts = loadContacts(id);
            contactCount += candidateContacts.size();
            List<ResumeIntake> resumes = loadResumes(id);
            resumeCount += resumes.size();
            successful += resumes.stream().filter(resume -> "SUCCEEDED".equals(resume.getAnalysisStatus())).count();
            for (CandidateJobContact contact : candidateContacts) {
                if (!jobIds.add(contact.getJobPosition().getId())) warnings.add("多个档案关联同一岗位，合并后按同一候选人岗位关系展示");
            }
            messageCount += loadMessages(id);
        }
        return new CandidateMergePreviewResponse(primaryId, List.copyOf(ids), allIds.size(), contactCount,
                resumeCount, successful, messageCount, warnings.stream().distinct().toList());
    }

    @Transactional(readOnly = true)
    public List<CandidateMergeOperationResponse> operations(boolean activeOnly) {
        SystemUser user = requireManager();
        return operations.findAllByOrderByCreatedAtDesc().stream()
                .filter(operation -> !activeOnly || "ACTIVE".equals(operation.getStatus()))
                .filter(operation -> hasCompanyAccess(operation.getCompany().getId(), user))
                .map(operation -> response(operation, items.findByOperationId(operation.getId()).stream()
                        .map(item -> item.getSourceCandidate().getId()).toList()))
                .toList();
    }

    private List<CandidateJobContact> loadContacts(UUID candidateId) {
        return new ArrayList<>(contacts.findByCandidateIdOrderByUpdatedAtDesc(candidateId));
    }

    private List<ResumeIntake> loadResumes(UUID candidateId) {
        return new ArrayList<>(intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(candidateId));
    }

    private int loadMessages(UUID candidateId) {
        return loadContacts(candidateId).stream().mapToInt(contact -> messages.findByContactIdOrderByCreatedAtAsc(contact.getId()).size()).sum();
    }

    @Transactional
    public CandidateMergeOperationResponse undo(UUID operationId) {
        SystemUser user = requireManager();
        CandidateMergeOperation operation = operations.findByIdAndStatus(operationId, "ACTIVE")
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "CANDIDATE_MERGE_OPERATION_NOT_FOUND", "可撤销的合并操作不存在"));
        requireCompanyAccess(operation.getCompany().getId(), user);
        List<CandidateMergeItem> mergeItems = items.findByOperationId(operationId);
        if (mergeItems.isEmpty()) throw conflict("CANDIDATE_MERGE_ITEMS_MISSING", "合并操作没有可恢复的档案记录");
        for (CandidateMergeItem item : mergeItems) {
            CandidateProfile source = item.getSourceCandidate();
            if (!source.isMerged() || !operation.getPrimaryCandidate().getId().equals(source.getMergedIntoId())) {
                throw conflict("CANDIDATE_MERGE_STATE_CHANGED", "候选人合并状态已变化，禁止盲目撤销");
            }
            source.undoMerge();
        }
        operation.undo(user, Instant.now());
        audit.success("UNDO_TALENT_CANDIDATE_MERGE", "CANDIDATE_MERGE_OPERATION", operationId,
                "撤销人才库候选人合并", "已恢复 " + mergeItems.size() + " 个候选人别名档案的独立展示状态");
        return response(operation, mergeItems.stream().map(item -> item.getSourceCandidate().getId()).toList());
    }

    private CandidateMergeOperationResponse response(CandidateMergeOperation operation, List<UUID> ids) {
        return new CandidateMergeOperationResponse(operation.getId(), operation.getStatus(),
                operation.getPrimaryCandidate().getId(), ids, operation.getCreatedAt(), operation.getUndoneAt());
    }

    private CandidateProfile requireVisible(UUID id, SystemUser user) {
        CandidateProfile profile = profiles.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TALENT_CANDIDATE_NOT_FOUND", "人才库候选人不存在"));
        requireCompanyAccess(profile.getCompany().getId(), user);
        return profile;
    }

    private SystemUser requireManager() {
        SystemUser user = users.requireCurrentUser();
        if (user.getRole() != UserRole.SYSTEM_ADMIN && user.getRole() != UserRole.RECRUITMENT_ADMIN)
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "只有招聘管理员可以确认或撤销候选人合并");
        return user;
    }

    private void requireCompanyAccess(UUID companyId, SystemUser user) {
        if (user.getRole() == UserRole.SYSTEM_ADMIN) return;
        if (!hasCompanyAccess(companyId, user)) throw forbidden();
    }

    private boolean hasCompanyAccess(UUID companyId, SystemUser user) {
        return user.getRole() == UserRole.SYSTEM_ADMIN
                || user.getCompanyScopes().stream().map(Company::getId).anyMatch(companyId::equals);
    }

    private ApiException forbidden() { return new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权操作其他企业候选人"); }
    private ApiException bad(String code, String message) { return new ApiException(HttpStatus.BAD_REQUEST, code, message); }
    private ApiException conflict(String code, String message) { return new ApiException(HttpStatus.CONFLICT, code, message); }
}
