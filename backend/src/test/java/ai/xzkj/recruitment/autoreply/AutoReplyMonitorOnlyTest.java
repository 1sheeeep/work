package ai.xzkj.recruitment.autoreply;

import ai.xzkj.recruitment.audit.AuditService;
import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.boss.BossAccount;
import ai.xzkj.recruitment.boss.BossAccountRepository;
import ai.xzkj.recruitment.boss.BossGateway;
import ai.xzkj.recruitment.boss.MockBossProfile;
import ai.xzkj.recruitment.common.ApiException;
import ai.xzkj.recruitment.organization.Company;
import ai.xzkj.recruitment.organization.GroupProfile;
import ai.xzkj.recruitment.candidates.ConversationMessageRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.LocalTime;
import java.util.Optional;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class AutoReplyMonitorOnlyTest {
    @Test
    void rejectsAutomaticReplyEnablementInMonitorOnlyMode() {
        AutoReplyPolicyRepository policies = mock(AutoReplyPolicyRepository.class);
        BossAccountRepository accounts = mock(BossAccountRepository.class);
        CurrentUserService users = mock(CurrentUserService.class);
        GroupProfile group = new GroupProfile("测试集团", "测试");
        Company company = new Company(group, "测试企业", "TEST", null, null);
        BossAccount account = new BossAccount(company, "测试账号", "test-account", MockBossProfile.FULL);
        SystemUser admin = new SystemUser("admin", "hash", "管理员", UserRole.RECRUITMENT_ADMIN);
        admin.assignCompanyScopes(Set.of(company));
        when(users.requireCurrentUser()).thenReturn(admin);
        when(accounts.findWithDetailsById(account.getId())).thenReturn(Optional.of(account));

        AutoReplyService service = new AutoReplyService(policies, mock(AutoReplyAttemptRepository.class), accounts,
                mock(ConversationMessageRepository.class), users, mock(BossGateway.class), mock(AuditService.class), true);
        AutoReplyRequest request = new AutoReplyRequest(true, AwayMode.TEMPORARY, Instant.now().plusSeconds(3600), true,
                120, 20, 180, LocalTime.of(9, 0), LocalTime.of(21, 0), "Asia/Shanghai", 3, "您好，已收到消息。");

        assertThatThrownBy(() -> service.update(account.getId(), request))
                .isInstanceOf(ApiException.class)
                .hasMessage("当前为只监测测试模式，禁止开启自动回复");
    }
}
