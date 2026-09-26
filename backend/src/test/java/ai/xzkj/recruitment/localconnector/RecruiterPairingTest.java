package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.*;
import ai.xzkj.recruitment.autoreply.AutoReplyPolicyRepository;
import ai.xzkj.recruitment.boss.*;
import ai.xzkj.recruitment.jobs.JobPositionRepository;
import ai.xzkj.recruitment.organization.*;
import ai.xzkj.recruitment.common.ApiException;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.any;
import static org.assertj.core.api.Assertions.*;

class RecruiterPairingTest {
    @Test void recruiterPairsOnlyWithinScopeAndDeletedUsersCannotUseCodes() {
        Company company = new Company(new GroupProfile("集团", "测试"), "企业", "TEST", null, null);
        SystemUser user = new SystemUser("hr", "hash", "专员", UserRole.RECRUITER);
        user.assignCompanyScopes(Set.of(company));
        BossAccount account = new BossAccount(company, "招聘账号", "boss");
        account.assignRecruiters(Set.of(user.getId()));
        CurrentUserService users = mock(CurrentUserService.class);
        when(users.requireCurrentUser()).thenReturn(user);
        BossAccountRepository accounts = mock(BossAccountRepository.class);
        when(accounts.findWithDetailsById(account.getId())).thenReturn(Optional.of(account));
        BrowserPairingCodeRepository codes = mock(BrowserPairingCodeRepository.class);
        when(codes.save(any())).thenAnswer(invocation -> invocation.getArgument(0));
        LocalConnectorService service = new LocalConnectorService(mock(BrowserDeviceRepository.class), codes,
                mock(BrowserUnreadObservationRepository.class), mock(LocalConnectorCapabilityRepository.class),
                mock(LocalConnectorActionTaskRepository.class), mock(LocalConnectorValidationCaseRepository.class),
                mock(AutoReplyPolicyRepository.class), accounts, mock(JobPositionRepository.class), users,
                mock(AuditService.class), mock(InboundAiReplyQueueService.class));
        assertThat(service.createPairing(account.getId()).pairingToken()).isNotBlank();
        user.assignCompanyScopes(Set.of());
        assertThatThrownBy(() -> service.createPairing(account.getId())).isInstanceOf(ApiException.class);
        BrowserPairingCode code = new BrowserPairingCode(account, "hash", user);
        assertThat(code.usable(Instant.now())).isTrue();
        user.deleteAccount();
        assertThat(code.usable(Instant.now())).isFalse();
    }
}
