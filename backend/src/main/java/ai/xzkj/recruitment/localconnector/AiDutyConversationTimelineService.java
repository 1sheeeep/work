package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.candidates.CandidateJobContact;
import ai.xzkj.recruitment.candidates.CandidateJobContactRepository;
import ai.xzkj.recruitment.candidates.CandidateProfileRepository;
import ai.xzkj.recruitment.candidates.CandidateSource;
import ai.xzkj.recruitment.candidates.ConversationMessageRepository;
import ai.xzkj.recruitment.candidates.ConversationMessageResponse;
import ai.xzkj.recruitment.candidates.ConversationMessageDeduplicator;
import ai.xzkj.recruitment.common.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

/**
 * Read-only bridge from a duty observation to the imported candidate timeline.
 * The lookup is always scoped by the authenticated user's company access and
 * the observation's Boss account, so an observation cannot read another tenant.
 */
@Service
class AiDutyConversationTimelineService {
    private final BrowserUnreadObservationRepository observations;
    private final CandidateProfileRepository profiles;
    private final CandidateJobContactRepository contacts;
    private final ConversationMessageRepository messages;
    private final CurrentUserService users;

    AiDutyConversationTimelineService(BrowserUnreadObservationRepository observations,
                                      CandidateProfileRepository profiles,
                                      CandidateJobContactRepository contacts,
                                      ConversationMessageRepository messages,
                                      CurrentUserService users) {
        this.observations = observations;
        this.profiles = profiles;
        this.contacts = contacts;
        this.messages = messages;
        this.users = users;
    }

    @Transactional(readOnly = true)
    AiDutyConversationTimelineResponse timeline(UUID observationId) {
        SystemUser user = users.requireCurrentUser();
        BrowserUnreadObservation observation = observations.findWithAccountById(observationId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "DUTY_OBSERVATION_NOT_FOUND", "值守会话不存在或已过期"));
        UUID companyId = observation.getAccount().getCompany().getId();
        if (!ai.xzkj.recruitment.boss.BossAccountAccess.canAccess(observation.getAccount(), user)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "COMPANY_SCOPE_FORBIDDEN", "当前账号无权访问该企业会话");
        }

        String anonymousKey = safeAnonymousKey(observation.getChatDigest());
        var profile = profiles.findByCompanyIdAndSourceAndDedupKey(
                        companyId, CandidateSource.BOSS, observation.getChatDigest())
                .orElse(null);
        if (profile == null) {
            return unavailable(observationId, anonymousKey, "该会话尚未导入人才库时间线");
        }

        UUID matchedJobId = observation.getMatchedJobPositionId();
        CandidateJobContact contact = contacts.findByCandidateIdOrderByUpdatedAtDesc(profile.getId()).stream()
                .filter(item -> item.getBossAccount() != null
                        && observation.getAccount().getId().equals(item.getBossAccount().getId()))
                .filter(item -> matchedJobId == null || matchedJobId.equals(item.getJobPosition().getId()))
                .findFirst()
                .orElse(null);
        if (contact == null) {
            return unavailable(observationId, anonymousKey, "该会话尚未建立对应岗位沟通关系");
        }

        List<ConversationMessageResponse> timeline = ConversationMessageDeduplicator.forDisplay(
                        messages.findByContactIdAndSupersededAtIsNullOrderByCreatedAtAsc(contact.getId()))
                .stream().map(ConversationMessageResponse::from).toList();
        return new AiDutyConversationTimelineResponse(observationId, anonymousKey, contact.getId(), true, null, timeline);
    }

    private AiDutyConversationTimelineResponse unavailable(UUID observationId, String anonymousKey, String reason) {
        return new AiDutyConversationTimelineResponse(observationId, anonymousKey, null, false, reason, List.of());
    }

    private String safeAnonymousKey(String digest) {
        if (digest == null || digest.isBlank()) return "匿名会话";
        return digest.substring(0, Math.min(12, digest.length()));
    }
}
