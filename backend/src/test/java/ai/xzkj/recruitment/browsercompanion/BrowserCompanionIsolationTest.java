package ai.xzkj.recruitment.browsercompanion;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicyRepository;
import ai.xzkj.recruitment.boss.*;
import ai.xzkj.recruitment.candidates.CandidateJobContactRepository;
import ai.xzkj.recruitment.candidates.ConversationMessageRepository;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.organization.Company;
import org.junit.jupiter.api.Test;

import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class BrowserCompanionIsolationTest {
    @Test void rejectsPairingCodeCreationForMockAccount(){
        BossAccountRepository accounts=mock(BossAccountRepository.class);CurrentUserService users=mock(CurrentUserService.class);
        SystemUser admin=mock(SystemUser.class);BossAccount account=mock(BossAccount.class);Company company=mock(Company.class);UUID accountId=UUID.randomUUID();
        when(users.requireCurrentUser()).thenReturn(admin);when(admin.getRole()).thenReturn(UserRole.SYSTEM_ADMIN);
        when(accounts.findWithDetailsById(accountId)).thenReturn(Optional.of(account));when(account.getCompany()).thenReturn(company);when(account.getGatewayType()).thenReturn(BossGatewayType.MOCK);
        BrowserPairingCodeRepository pairings=mock(BrowserPairingCodeRepository.class);
        BrowserCompanionService service=new BrowserCompanionService(mock(BrowserDeviceRepository.class),pairings,mock(BrowserConversationBindingRepository.class),mock(BrowserSendClaimRepository.class),mock(BrowserUnreadObservationRepository.class),mock(AutoReplyPolicyRepository.class),accounts,mock(JobPositionRepository.class),mock(CandidateJobContactRepository.class),mock(ConversationMessageRepository.class),users,mock(AuditService.class),true,false);

        assertThatThrownBy(()->service.createPairing(accountId)).isInstanceOfSatisfying(ApiException.class,e->org.assertj.core.api.Assertions.assertThat(e.getCode()).isEqualTo("BROWSER_ACCOUNT_REQUIRED"));
        verifyNoInteractions(pairings);
    }
}
