package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.candidates.CandidateJobContactRepository;
import ai.xzkj.recruitment.candidates.CandidateProfileRepository;
import ai.xzkj.recruitment.candidates.ConversationMessageRepository;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AiDutyConversationTimelineServiceTest {
    @Test
    void returnsAnExplicitUnavailableStateWhenTranscriptWasNotImported() {
        BrowserUnreadObservationRepository observations = mock(BrowserUnreadObservationRepository.class);
        CandidateProfileRepository profiles = mock(CandidateProfileRepository.class);
        CandidateJobContactRepository contacts = mock(CandidateJobContactRepository.class);
        ConversationMessageRepository messages = mock(ConversationMessageRepository.class);
        CurrentUserService users = mock(CurrentUserService.class);
        SystemUser user = mock(SystemUser.class);
        BrowserUnreadObservation observation = mock(BrowserUnreadObservation.class);
        BossAccount account = mock(BossAccount.class);
        Company company = mock(Company.class);
        UUID observationId = UUID.randomUUID();
        UUID companyId = UUID.randomUUID();
        String digest = "a".repeat(64);

        when(users.requireCurrentUser()).thenReturn(user);
        when(user.getRole()).thenReturn(UserRole.SYSTEM_ADMIN);
        when(observations.findWithAccountById(observationId)).thenReturn(Optional.of(observation));
        when(observation.getAccount()).thenReturn(account);
        when(account.getCompany()).thenReturn(company);
        when(company.getId()).thenReturn(companyId);
        when(observation.getChatDigest()).thenReturn(digest);
        when(profiles.findByCompanyIdAndSourceAndDedupKey(companyId, ai.xzkj.recruitment.candidates.CandidateSource.BOSS, digest))
                .thenReturn(Optional.empty());

        AiDutyConversationTimelineResponse response = new AiDutyConversationTimelineService(
                observations, profiles, contacts, messages, users).timeline(observationId);

        assertThat(response.available()).isFalse();
        assertThat(response.contactId()).isNull();
        assertThat(response.messages()).isEmpty();
        assertThat(response.reason()).contains("尚未导入");
    }
}
