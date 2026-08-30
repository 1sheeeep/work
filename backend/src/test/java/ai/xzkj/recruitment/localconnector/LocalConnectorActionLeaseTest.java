package ai.xzkj.recruitment.localconnector;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.boss.BossAccount;
import org.junit.jupiter.api.Test;
import java.time.Instant;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.mock;

class LocalConnectorActionLeaseTest {
    private final Instant now=Instant.parse("2026-08-30T11:00:00Z");
    @Test void issuesOneShortLeaseAndAcceptsAnIdempotentReceipt(){LocalConnectorActionTask task=task("READY");LocalConnectorActionLease lease=new LocalConnectorActionLease(task,mock(BrowserDevice.class),"a".repeat(64),now);assertThat(task.getStatus()).isEqualTo("LEASED");assertThat(lease.getLeaseUntil()).isEqualTo(now.plusSeconds(30));assertThat(lease.receipt("SUCCEEDED","b".repeat(64),"页面明确成功",now.plusSeconds(5))).isTrue();assertThat(lease.receipt("SUCCEEDED","b".repeat(64),"重复回执",now.plusSeconds(6))).isFalse();assertThat(task.getStatus()).isEqualTo("SUCCEEDED");}
    @Test void rejectsAConflictingSecondReceipt(){LocalConnectorActionLease lease=new LocalConnectorActionLease(task("READY"),mock(BrowserDevice.class),"a".repeat(64),now);lease.receipt("FAILED","b".repeat(64),"页面明确失败",now.plusSeconds(5));assertThatThrownBy(()->lease.receipt("SUCCEEDED","c".repeat(64),"冲突结果",now.plusSeconds(6))).hasMessage("租约已有不同结果，禁止覆盖");}
    @Test void expiresToUnknownAndNeverReturnsToReady(){LocalConnectorActionTask task=task("READY");LocalConnectorActionLease lease=new LocalConnectorActionLease(task,mock(BrowserDevice.class),"a".repeat(64),now);lease.expire(now.plusSeconds(31));assertThat(lease.getStatus()).isEqualTo("EXPIRED");assertThat(task.getStatus()).isEqualTo("UNKNOWN");}
    @Test void refusesToLeaseAnUnapprovedTask(){assertThatThrownBy(()->new LocalConnectorActionLease(task("WAITING_MANUAL_TEST"),mock(BrowserDevice.class),"a".repeat(64),now)).hasMessage("动作任务尚未批准执行");}
    private LocalConnectorActionTask task(String status){return new LocalConnectorActionTask(mock(BossAccount.class),null,"SEND_MESSAGE",status,mock(SystemUser.class),"测试");}
}
