package ai.xzkj.recruitment.candidates;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.resumes.ResumeIntake;
import ai.xzkj.recruitment.resumes.ResumeIntakeRepository;
import ai.xzkj.recruitment.resumes.AiAssistanceRun;
import ai.xzkj.recruitment.resumes.AiAssistanceRunRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class TalentCandidateService {
    private final CandidateProfileRepository profiles;
    private final CandidateJobContactRepository contacts;
    private final ResumeIntakeRepository intakes;
    private final CurrentUserService users;
    private final ConversationMessageRepository messages;
    private final AiAssistanceRunRepository analyses;
    private final ObjectMapper mapper;

    @Autowired
    public TalentCandidateService(CandidateProfileRepository profiles,
                                  CandidateJobContactRepository contacts,
                                  ResumeIntakeRepository intakes,
                                  CurrentUserService users,
                                  ConversationMessageRepository messages,
                                  AiAssistanceRunRepository analyses,
                                  ObjectMapper mapper) {
        this.profiles = profiles;
        this.contacts = contacts;
        this.intakes = intakes;
        this.users = users;
        this.messages = messages;
        this.analyses = analyses;
        this.mapper = mapper;
    }

    /** Keeps the first-version unit tests and simple callers source-compatible. */
    TalentCandidateService(CandidateProfileRepository profiles,
                           CandidateJobContactRepository contacts,
                           ResumeIntakeRepository intakes,
                           CurrentUserService users) {
        this(profiles, contacts, intakes, users, null, null, null);
    }

    @Transactional(readOnly = true)
    public List<TalentCandidateResponse> list(String keyword, CandidateSource source,
                                              CandidatePrivacyStatus privacyStatus) {
        return query(keyword, source, privacyStatus, null, null, null, null);
    }

    @Transactional(readOnly = true)
    public TalentCandidatePageResponse page(String keyword, CandidateSource source,
                                             CandidatePrivacyStatus privacyStatus, UUID companyId,
                                             UUID jobPositionId, CandidateContactStatus contactStatus,
                                             String analysisStatus, int page, int pageSize) {
        List<TalentCandidateResponse> all = query(keyword, source, privacyStatus, companyId,
                jobPositionId, contactStatus, analysisStatus);
        int safePage = Math.max(0, page);
        int safePageSize = Math.min(Math.max(1, pageSize), 100);
        int from = Math.min(safePage * safePageSize, all.size());
        int to = Math.min(from + safePageSize, all.size());
        long withResume = all.stream().filter(item -> item.resumeCount() > 0).count();
        long analyzed = all.stream().filter(item -> "SUCCEEDED".equals(item.latestAnalysisStatus())).count();
        long processing = all.stream().filter(item -> "PROCESSING".equals(item.latestResumeStatus())
                || "ANALYZING".equals(item.latestAnalysisStatus())
                || "QUEUED".equals(item.latestAnalysisQueueStatus())
                || "PROCESSING".equals(item.latestAnalysisQueueStatus())
                || "RETRY_WAIT".equals(item.latestAnalysisQueueStatus())).count();
        long failed = all.stream().filter(item -> "FAILED".equals(item.latestResumeStatus())
                || "FAILED".equals(item.latestAnalysisStatus())).count();
        return new TalentCandidatePageResponse(all.subList(from, to), safePage, safePageSize, all.size(),
                new TalentCandidatePageResponse.Counts(all.size(), withResume, analyzed, processing, failed));
    }

    @Transactional(readOnly = true)
    public TalentCandidateAuditResponse audit() {
        SystemUser user = users.requireCurrentUser();
        List<CandidateProfile> visibleProfiles = profiles.findAllByOrderByUpdatedAtDesc().stream()
                .filter(profile -> canAccess(profile.getCompany().getId(), user)).toList();
        Set<UUID> visibleCandidateIds = visibleProfiles.stream().map(CandidateProfile::getId).collect(Collectors.toSet());
        List<CandidateJobContact> visibleContacts = contacts.findAllByOrderByUpdatedAtDesc().stream()
                .filter(contact -> contact.getCandidate() != null
                        && visibleCandidateIds.contains(contact.getCandidate().getId()))
                .toList();
        Set<UUID> visibleContactIds = visibleContacts.stream().map(CandidateJobContact::getId).collect(Collectors.toSet());
        List<ResumeIntake> visibleIntakes = intakes.findAllByOrderByReceivedAtDesc().stream()
                .filter(intake -> intake.getContact() != null && visibleContactIds.contains(intake.getContact().getId()))
                .toList();
        List<AiAssistanceRun> visibleRuns = analyses == null ? List.of() : analyses.findAll().stream()
                .filter(run -> run.getResumeIntake() != null
                        && visibleIntakeIds(visibleIntakes).contains(run.getResumeIntake().getId()))
                .toList();
        List<ConversationMessage> visibleMessages = messages == null ? List.of() : messages.findAll().stream()
                .filter(message -> message.getContact() != null && visibleContactIds.contains(message.getContact().getId()))
                .toList();

        Map<String, Long> candidateKeyCounts = visibleProfiles.stream().collect(Collectors.groupingBy(
                profile -> profile.getCompany().getId() + ":" + profile.getSource() + ":" + profile.getDedupKey(),
                Collectors.counting()));
        Map<UUID, Long> resumeCounts = visibleIntakes.stream().collect(Collectors.groupingBy(
                intake -> intake.getContact().getCandidate().getId(), Collectors.counting()));
        Set<UUID> runsByIntake = visibleRuns.stream().map(run -> run.getResumeIntake().getId()).collect(Collectors.toSet());
        Set<UUID> failedRunsByIntake = visibleRuns.stream()
                .filter(run -> "FAILED".equals(run.getStatus()))
                .map(run -> run.getResumeIntake().getId()).collect(Collectors.toSet());
        Set<UUID> contactsWithMessages = visibleMessages.stream()
                .map(message -> message.getContact().getId()).collect(Collectors.toSet());

        long pendingReviewWithSuccess = visibleIntakes.stream()
                .filter(intake -> intake.getStatus() == ai.xzkj.recruitment.resumes.ResumeIntakeStatus.PENDING_REVIEW
                        && "SUCCEEDED".equals(intake.getAnalysisStatus()))
                .count();
        long succeededWithoutRun = visibleIntakes.stream()
                .filter(intake -> "SUCCEEDED".equals(intake.getAnalysisStatus()) && !runsByIntake.contains(intake.getId()))
                .count();
        long failedWithoutRun = visibleIntakes.stream()
                .filter(intake -> "FAILED".equals(intake.getAnalysisStatus()) && !failedRunsByIntake.contains(intake.getId()))
                .count();
        long contactsOnClosedJobs = visibleContacts.stream()
                .filter(contact -> contact.getJobPosition() != null
                        && contact.getJobPosition().getStatus() == ai.xzkj.recruitment.jobs.JobPositionStatus.CLOSED)
                .count();
        return new TalentCandidateAuditResponse(Instant.now(), new TalentCandidateAuditResponse.Counts(
                visibleProfiles.size(), visibleContacts.size(), visibleIntakes.size(), visibleRuns.size(),
                visibleMessages.size(), visibleProfiles.stream().map(profile -> profile.getCompany().getId()).distinct().count(),
                visibleProfiles.stream().filter(profile -> profile.getPrivacyStatus() == CandidatePrivacyStatus.ANONYMIZED).count(),
                resumeCounts.values().stream().filter(count -> count > 1).count(),
                candidateKeyCounts.values().stream().filter(count -> count > 1).count(),
                pendingReviewWithSuccess, succeededWithoutRun, failedWithoutRun,
                visibleContacts.stream().filter(contact -> !contactsWithMessages.contains(contact.getId())).count(),
                contactsOnClosedJobs));
    }

    /**
     * Read-only duplicate scan. It deliberately returns a preview only; no candidate,
     * contact, resume or message relationship is changed here.
     */
    @Transactional(readOnly = true)
    public CandidateDuplicatePreviewResponse duplicatePreview() {
        SystemUser user = users.requireCurrentUser();
        List<CandidateProfile> allProfiles = profiles.findAllByOrderByUpdatedAtDesc().stream()
                .filter(profile -> canAccess(profile.getCompany().getId(), user)).toList();
        List<CandidateProfile> visibleProfiles = allProfiles.stream()
                .filter(profile -> !profile.isMerged())
                .toList();
        Map<UUID, Integer> indexes = new HashMap<>();
        for (int i = 0; i < visibleProfiles.size(); i++) indexes.put(visibleProfiles.get(i).getId(), i);
        DuplicateGroups groups = new DuplicateGroups(visibleProfiles.size(), indexes);
        Map<String, List<UUID>> phone = new HashMap<>(), email = new HashMap<>(), names = new HashMap<>(), resumes = new HashMap<>();
        for (CandidateProfile profile : visibleProfiles) {
            UUID id = profile.getId();
            add(phone, profile.getIdentityPhoneDigest(), id);
            add(email, profile.getIdentityEmailDigest(), id);
            String name = normalizedName(profile.getDisplayName());
            if (name != null) add(names, name, id);
        }
        Set<UUID> visibleIds = indexes.keySet();
        for (ResumeIntake intake : intakes.findAllByOrderByReceivedAtDesc()) {
            if (intake.getContact() == null || intake.getContact().getCandidate() == null) continue;
            UUID candidateId = intake.getContact().getCandidate().getId();
            if (visibleIds.contains(candidateId) && intake.getResumeDigest() != null) add(resumes, intake.getResumeDigest(), candidateId);
        }
        groups.connect(phone, "手机号身份摘要一致", true);
        groups.connect(email, "邮箱身份摘要一致", true);
        groups.connect(resumes, "简历文件摘要一致", true);
        groups.connect(names, "候选人姓名一致（仅作疑似重复依据）", false);

        Map<Integer, List<CandidateProfile>> byRoot = new LinkedHashMap<>();
        for (CandidateProfile profile : visibleProfiles) byRoot.computeIfAbsent(groups.root(indexes.get(profile.getId())), ignored -> new ArrayList<>()).add(profile);
        List<CandidateDuplicatePreviewResponse.Group> result = new ArrayList<>();
        for (List<CandidateProfile> profilesInGroup : byRoot.values()) {
            if (profilesInGroup.size() < 2) continue;
            Set<UUID> ids = profilesInGroup.stream().map(CandidateProfile::getId).collect(Collectors.toSet());
            List<String> reasons = groups.reasons(ids);
            boolean strong = reasons.stream().anyMatch(reason -> reason.startsWith("手机号") || reason.startsWith("邮箱") || reason.startsWith("简历文件"));
            boolean ambiguous = groups.ambiguous(ids);
            String confidence = strong ? (ambiguous ? "MEDIUM" : "HIGH") : "LOW";
            String recommendation = strong && !ambiguous ? "MANUAL_CONFIRM" : "MANUAL_REVIEW";
            CandidateProfile primary = profilesInGroup.stream().max(Comparator
                    .comparingInt(this::candidateInformationScore)
                    .thenComparing(CandidateProfile::getCreatedAt, Comparator.reverseOrder())).orElse(profilesInGroup.getFirst());
            result.add(new CandidateDuplicatePreviewResponse.Group(
                    UUID.nameUUIDFromBytes(profilesInGroup.stream().map(CandidateProfile::getId).sorted().map(UUID::toString).collect(Collectors.joining(",")).getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                    confidence, recommendation, primary.getId(), reasons,
                    profilesInGroup.stream().map(profile -> duplicateCandidate(profile, user)).toList()));
        }
        result.sort(Comparator.comparing(CandidateDuplicatePreviewResponse.Group::confidence).reversed());
        return new CandidateDuplicatePreviewResponse(Instant.now(), visibleProfiles.size(), result.size(), result);
    }

    private CandidateDuplicatePreviewResponse.Candidate duplicateCandidate(CandidateProfile profile, SystemUser user) {
        List<CandidateJobContact> candidateContacts = contacts.findByCandidateIdOrderByUpdatedAtDesc(profile.getId()).stream()
                .filter(contact -> canAccess(contact.getCandidate().getCompany().getId(), user)).toList();
        List<ResumeIntake> candidateIntakes = intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(profile.getId());
        long successful = candidateIntakes.stream().filter(intake -> "SUCCEEDED".equals(intake.getAnalysisStatus())).count();
        String latest = candidateIntakes.isEmpty() ? null : candidateIntakes.getFirst().getAnalysisStatus();
        return new CandidateDuplicatePreviewResponse.Candidate(profile.getId(), profile.getSource(), profile.getDisplayName(),
                profile.getCompany().getName(), candidateIntakes.size(), candidateContacts.size(), successful, latest,
                profile.getIdentityPhoneDigest() != null, profile.getIdentityEmailDigest() != null,
                profile.getCreatedAt(), profile.getUpdatedAt());
    }

    private int candidateInformationScore(CandidateProfile profile) {
        int score = 0;
        if (profile.getIdentityPhoneDigest() != null) score += 4;
        if (profile.getIdentityEmailDigest() != null) score += 4;
        if (profile.getCurrentTitle() != null && !profile.getCurrentTitle().isBlank()) score += 2;
        if (profile.getEducation() != null && !profile.getEducation().isBlank()) score++;
        if (profile.getSkillsSummary() != null && !profile.getSkillsSummary().isBlank()) score += 2;
        if (profile.getPrivacyStatus() == CandidatePrivacyStatus.ACTIVE) score++;
        return score;
    }

    private void add(Map<String, List<UUID>> index, String key, UUID candidateId) {
        if (key != null && !key.isBlank()) index.computeIfAbsent(key, ignored -> new ArrayList<>()).add(candidateId);
    }

    private String normalizedName(String value) {
        if (value == null) return null;
        String name = value.replaceAll("\\s+", "").trim().toLowerCase(Locale.ROOT);
        if (name.isBlank() || name.contains("匿名候选人") || name.contains("已匿名")) return null;
        return name;
    }

    private static final class DuplicateGroups {
        private final int[] parent;
        private final Map<Set<UUID>, Evidence> evidence = new HashMap<>();
        private final Map<UUID, Integer> index;
        private final Set<UUID> strongMembers = new HashSet<>();

        private DuplicateGroups(int size, Map<UUID, Integer> index) {
            parent = new int[size]; java.util.Arrays.setAll(parent, i -> i); this.index = index;
        }

        private void connect(Map<String, List<UUID>> values, String reason, boolean strong) {
            for (List<UUID> candidates : values.values()) {
                if (candidates.size() < 2) continue;
                // 姓名只能形成独立的低置信度提示，不能把两个已有强身份组
                // 通过同名候选人传递性地连接起来。
                if (!strong && candidates.stream().anyMatch(strongMembers::contains)) continue;
                UUID first = candidates.getFirst();
                for (UUID id : candidates) union(index.get(first), index.get(id));
                Set<UUID> key = new LinkedHashSet<>(candidates);
                evidence.computeIfAbsent(key, ignored -> new Evidence()).add(reason, strong, candidates.size() > 2);
                if (strong) strongMembers.addAll(candidates);
            }
        }

        private int root(int candidateIndex) { if (candidateIndex < 0) return -1; int current = candidateIndex; while (parent[current] != current) { parent[current] = parent[parent[current]]; current = parent[current]; } return current; }
        private void union(int left, int right) { int a = root(left), b = root(right); if (a != b) parent[b] = a; }
        private List<String> reasons(Set<UUID> ids) { return evidence.entrySet().stream().filter(entry -> !Collections.disjoint(entry.getKey(), ids)).flatMap(entry -> entry.getValue().reasons.stream()).distinct().toList(); }
        private boolean ambiguous(Set<UUID> ids) { return evidence.entrySet().stream().filter(entry -> !Collections.disjoint(entry.getKey(), ids)).anyMatch(entry -> entry.getValue().ambiguous); }

        private static final class Evidence {
            private final List<String> reasons = new ArrayList<>();
            private boolean ambiguous;
            private void add(String reason, boolean strong, boolean ambiguous) { reasons.add(reason); this.ambiguous |= strong && ambiguous; }
        }
    }

    private Set<UUID> visibleIntakeIds(List<ResumeIntake> visibleIntakes) {
        return visibleIntakes.stream().map(ResumeIntake::getId).collect(Collectors.toSet());
    }

    private List<TalentCandidateResponse> query(String keyword, CandidateSource source,
                                                 CandidatePrivacyStatus privacyStatus, UUID companyId,
                                                 UUID jobPositionId, CandidateContactStatus contactStatus,
                                                 String analysisStatus) {
        SystemUser user = users.requireCurrentUser();
        String normalized = keyword == null ? "" : keyword.trim().toLowerCase(Locale.ROOT);
        List<CandidateProfile> allProfiles = profiles.findAllByOrderByUpdatedAtDesc().stream()
                .filter(profile -> canAccess(profile.getCompany().getId(), user)).toList();
        Map<UUID, CandidateProfile> profilesById = allProfiles.stream()
                .collect(Collectors.toMap(CandidateProfile::getId, profile -> profile));
        List<CandidateProfile> visibleProfiles = allProfiles.stream().filter(profile -> !profile.isMerged()).toList();

        Map<UUID, List<CandidateJobContact>> contactsByCandidate = contacts.findAllByOrderByUpdatedAtDesc().stream()
                .filter(contact -> canAccess(contact.getCandidate().getCompany().getId(), user))
                .filter(contact -> companyId == null || companyId.equals(contact.getCandidate().getCompany().getId()))
                .filter(contact -> jobPositionId == null || jobPositionId.equals(contact.getJobPosition().getId()))
                .filter(contact -> contactStatus == null || contactStatus == contact.getStatus())
                .collect(Collectors.groupingBy(contact -> canonicalId(contact.getCandidate(), profilesById), LinkedHashMap::new, Collectors.toList()));
        Map<UUID, List<ResumeIntake>> intakesByCandidate = intakes.findAllByOrderByReceivedAtDesc().stream()
                .filter(intake -> intake.getContact() != null && intake.getContact().getCandidate() != null)
                .collect(Collectors.groupingBy(intake -> canonicalId(intake.getContact().getCandidate(), profilesById)));

        return visibleProfiles.stream()
                .filter(profile -> source == null || source == profile.getSource())
                .filter(profile -> privacyStatus == null || privacyStatus == profile.getPrivacyStatus())
                .filter(profile -> contactsByCandidate.containsKey(profile.getId()))
                .filter(profile -> matches(profile, contactsByCandidate.get(profile.getId()), normalized))
                .filter(profile -> analysisStatus == null || analysisStatus.equals(latestAnalysisStatus(intakesByCandidate.get(profile.getId()))))
                .map(profile -> response(profile,
                        contactsByCandidate.getOrDefault(profile.getId(), List.of()),
                        intakesByCandidate.getOrDefault(profile.getId(), List.of())))
                .toList();
    }

    @Transactional(readOnly = true)
    public TalentCandidateDetailResponse detail(UUID candidateId) {
        SystemUser user = users.requireCurrentUser();
        CandidateProfile profile = profiles.findById(candidateId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TALENT_CANDIDATE_NOT_FOUND", "人才库候选人不存在"));
        if (!canAccess(profile.getCompany().getId(), user)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业数据");
        }
        if (profile.isMerged()) {
            UUID primaryId = profile.getMergedIntoId();
            CandidateProfile primary = profiles.findById(primaryId).orElseThrow(() ->
                    new ApiException(HttpStatus.CONFLICT, "TALENT_CANDIDATE_PRIMARY_MISSING", "合并主档案不存在"));
            List<UUID> ids = new ArrayList<>(); ids.add(primary.getId());
            profiles.findByMergedIntoId(primary.getId()).stream().map(CandidateProfile::getId).forEach(ids::add);
            List<CandidateJobContact> aggregateContacts = ids.stream().flatMap(id -> contacts.findByCandidateIdOrderByUpdatedAtDesc(id).stream()).toList();
            List<ResumeIntake> aggregateIntakes = ids.stream().flatMap(id -> intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(id).stream()).toList();
            TalentCandidateResponse summary = response(primary, aggregateContacts, aggregateIntakes);
            List<TalentCandidateDetailResponse.ContactSummary> contactSummaries = aggregateContacts.stream().map(this::contactSummary).toList();
            List<TalentCandidateDetailResponse.ResumeSummary> resumeSummaries = aggregateIntakes.stream().map(this::resumeSummary).toList();
            List<AiAssistanceRun> candidateAnalyses = analyses == null ? List.of() : ids.stream()
                    .flatMap(id -> analyses.findByResumeIntake_Contact_Candidate_IdOrderByCreatedAtDesc(id).stream()).toList();
            List<TalentCandidateDetailResponse.AnalysisSummary> analysisSummaries = candidateAnalyses.stream().map(this::analysisSummary).toList();
            return new TalentCandidateDetailResponse(summary, contactSummaries, resumeSummaries, analysisSummaries,
                    timeline(aggregateIntakes, candidateAnalyses, aggregateContacts));
        }
        List<CandidateJobContact> candidateContacts = contacts.findByCandidateIdOrderByUpdatedAtDesc(candidateId);
        List<ResumeIntake> candidateIntakes = intakes.findByContact_Candidate_IdOrderByReceivedAtDesc(candidateId);
        TalentCandidateResponse summary = response(profile, candidateContacts, candidateIntakes);
        List<TalentCandidateDetailResponse.ContactSummary> contactSummaries = candidateContacts.stream()
                .map(this::contactSummary).toList();
        List<TalentCandidateDetailResponse.ResumeSummary> resumeSummaries = candidateIntakes.stream()
                .map(this::resumeSummary).toList();
        List<AiAssistanceRun> candidateAnalyses = analyses == null ? List.of()
                : analyses.findByResumeIntake_Contact_Candidate_IdOrderByCreatedAtDesc(candidateId);
        List<TalentCandidateDetailResponse.AnalysisSummary> analysisSummaries = candidateAnalyses.stream()
                .map(this::analysisSummary).toList();
        return new TalentCandidateDetailResponse(summary, contactSummaries, resumeSummaries, analysisSummaries,
                timeline(candidateIntakes, candidateAnalyses, candidateContacts));
    }

    private TalentCandidateDetailResponse.ContactSummary contactSummary(CandidateJobContact contact) {
        List<ConversationMessage> history = messages == null ? List.of()
                : messages.findTop100ByContactIdAndSupersededAtIsNullOrderByCreatedAtDesc(contact.getId());
        ConversationMessage latest = history.isEmpty() ? null : history.getFirst();
        String preview = latest == null ? null : latest.getContent();
        if (preview != null && preview.length() > 120) preview = preview.substring(0, 120) + "…";
        return new TalentCandidateDetailResponse.ContactSummary(
                contact.getId(), contact.getJobPosition().getId(), contact.getJobPosition().getTitle(),
                contact.getBossAccount().getId(), contact.getBossAccount().getDisplayName(), contact.getStatus().name(),
                contact.isHumanTakenOver(), contact.getAssignedHr() == null ? null : contact.getAssignedHr().getDisplayName(),
                latest == null ? null : latest.getCreatedAt(), preview);
    }

    private TalentCandidateDetailResponse.ResumeSummary resumeSummary(ResumeIntake intake) {
        return new TalentCandidateDetailResponse.ResumeSummary(
                intake.getId(), intake.getContact().getId(), intake.getSource(), intake.getDisplayLabel(), intake.getReceivedAt(),
                intake.getStatus().name(), intake.getProcessingStatus(), intake.getDocumentType(), intake.getFailureCode(),
                intake.getFailureReason(), intake.getAnalysisStatus(), intake.getAnalysisFailureCode(), intake.getAnalysisFailureReason(),
                intake.getAnalysisQueueStatus(), intake.getAnalysisQueueAttempts(), intake.getProcessedAt(), intake.getAnalysisCompletedAt());
    }

    private TalentCandidateDetailResponse.AnalysisSummary analysisSummary(AiAssistanceRun run) {
        return new TalentCandidateDetailResponse.AnalysisSummary(
                run.getId(), run.getResumeIntake().getId(), run.getProvider(), run.getModelVersion(), run.getStatus(),
                run.getOrigin(), parseResult(run.getStructuredResult(), run.getResultPurgedAt()), run.getErrorMessage(),
                run.getCreatedAt(), run.getResultExpiresAt(), run.getResultPurgedAt());
    }

    private JsonNode parseResult(String value, Instant purgedAt) {
        if (value == null || value.isBlank() || purgedAt != null || mapper == null) return null;
        try { return mapper.readTree(value); }
        catch (RuntimeException ignored) { return null; }
    }

    private List<TalentCandidateDetailResponse.TimelineEvent> timeline(List<ResumeIntake> candidateIntakes,
                                                                         List<AiAssistanceRun> candidateAnalyses,
                                                                         List<CandidateJobContact> candidateContacts) {
        List<TalentCandidateDetailResponse.TimelineEvent> events = new ArrayList<>();
        for (ResumeIntake intake : candidateIntakes) {
            events.add(new TalentCandidateDetailResponse.TimelineEvent("RESUME_RECEIVED", "收到简历", intake.getStatus().name(),
                    intake.getId(), intake.getReceivedAt(), intake.getDisplayLabel()));
            if (intake.getProcessedAt() != null) {
                events.add(new TalentCandidateDetailResponse.TimelineEvent("RESUME_PROCESSED", "简历文本已处理",
                        intake.getProcessingStatus(), intake.getId(), intake.getProcessedAt(), intake.getDocumentType()));
            }
        }
        for (AiAssistanceRun run : candidateAnalyses) {
            events.add(new TalentCandidateDetailResponse.TimelineEvent("AI_ANALYSIS", "AI 简历分析",
                    run.getStatus(), run.getId(), run.getCreatedAt(), run.getErrorMessage()));
        }
        if (messages != null) for (CandidateJobContact contact : candidateContacts) {
            for (ConversationMessage message : ConversationMessageDeduplicator.forDisplay(
                    messages.findTop100ByContactIdAndSupersededAtIsNullOrderByCreatedAtDesc(contact.getId()))) {
                events.add(new TalentCandidateDetailResponse.TimelineEvent("CONVERSATION", "沟通记录",
                        message.getDeliveryStatus().name(), message.getId(), message.getCreatedAt(),
                        message.getContent() == null ? null : message.getContent().length() > 120
                                ? message.getContent().substring(0, 120) + "…" : message.getContent()));
            }
        }
        events.sort(Comparator.comparing(TalentCandidateDetailResponse.TimelineEvent::occurredAt,
                Comparator.nullsLast(Comparator.reverseOrder())));
        return events.stream().limit(200).toList();
    }

    private String latestAnalysisStatus(List<ResumeIntake> candidateIntakes) {
        return candidateIntakes == null || candidateIntakes.isEmpty() ? null : candidateIntakes.getFirst().getAnalysisStatus();
    }

    private TalentCandidateResponse response(CandidateProfile profile,
                                             List<CandidateJobContact> candidateContacts,
                                             List<ResumeIntake> candidateIntakes) {
        List<TalentCandidateResponse.JobSummary> jobs = candidateContacts.stream()
                .map(CandidateJobContact::getJobPosition)
                .filter(Objects::nonNull)
                .collect(Collectors.toMap(
                        job -> job.getId(),
                        job -> new TalentCandidateResponse.JobSummary(job.getId(), job.getTitle()),
                        (first, ignored) -> first,
                        LinkedHashMap::new))
                .values().stream().toList();
        ResumeIntake latest = candidateIntakes.stream().findFirst().orElse(null);
        return new TalentCandidateResponse(
                profile.getId(),
                new TalentCandidateResponse.CompanySummary(profile.getCompany().getId(), profile.getCompany().getName(), profile.getCompany().getCode()),
                profile.getSource(),
                profile.getSource() + " · " + profile.getDedupKey().substring(0, 8),
                profile.getDisplayName(), profile.getCurrentTitle(), profile.getYearsExperience(), profile.getEducation(),
                profile.getSkillsSummary(), profile.getPrivacyStatus(), candidateIntakes.size(),
                latest == null ? null : latest.getProcessingStatus(),
                latest == null ? null : latest.getAnalysisStatus(),
                latest == null ? null : latest.getAnalysisQueueStatus(),
                latest == null ? null : latest.getAnalysisCompletedAt(), jobs,
                profile.getCreatedAt(), profile.getUpdatedAt());
    }

    private boolean matches(CandidateProfile profile, List<CandidateJobContact> candidateContacts, String keyword) {
        if (keyword.isBlank()) return true;
        if (contains(profile.getDisplayName(), keyword)
                || contains(profile.getCurrentTitle(), keyword)
                || contains(profile.getEducation(), keyword)
                || contains(profile.getSkillsSummary(), keyword)) return true;
        return candidateContacts.stream().anyMatch(contact -> contains(contact.getJobPosition().getTitle(), keyword));
    }

    private boolean contains(String value, String keyword) {
        return value != null && value.toLowerCase(Locale.ROOT).contains(keyword);
    }

    private UUID canonicalId(CandidateProfile profile, Map<UUID, CandidateProfile> profilesById) {
        UUID current = profile.getId();
        Set<UUID> visited = new HashSet<>();
        while (visited.add(current)) {
            CandidateProfile currentProfile = profilesById.get(current);
            if (currentProfile == null || currentProfile.getMergedIntoId() == null) return current;
            current = currentProfile.getMergedIntoId();
        }
        return profile.getId();
    }

    private boolean canAccess(UUID companyId, SystemUser user) {
        return user.getRole() == UserRole.SYSTEM_ADMIN
                || user.getCompanyScopes().stream().map(Company::getId).anyMatch(companyId::equals);
    }
}
