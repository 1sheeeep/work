package cn.xzkj.erp.platformadmin.shopifyrelease;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.audit.PlatformAdminAuditRecorder;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseCredentialCipher.StoredToken;
import cn.xzkj.erp.platformadmin.shopifyrelease.ShopifyAppReleaseRepository.StoredRelease;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ShopifyAppReleaseServiceTest {
    @Mock private ShopifyAppReleaseRepository repository;
    @Mock private ShopifyAppReleaseCredentialCipher cipher;
    @Mock private ShopifyAppReleaseExecutor executor;
    @Mock private PlatformAdminAuditRecorder auditRecorder;

    private ShopifyAppReleaseService service;
    private PlatformAdminActor actor;
    private StoredRelease configured;

    @BeforeEach
    void setUp() {
        service = new ShopifyAppReleaseService(
                repository, cipher, executor, auditRecorder);
        actor = new PlatformAdminActor(
                UUID.randomUUID(), UUID.randomUUID(), "request-1", "127.0.0.1");
        configured = new StoredRelease(
                new StoredToken("v1", new byte[12], new byte[17]),
                "CONFIGURED", null, null, null, 3, Instant.now());
    }

    @Test
    void publishesAndClearsTheDecryptedTokenFromMemory() {
        char[] decrypted = "automation-token-for-test-only".toCharArray();
        StoredRelease succeeded = new StoredRelease(
                configured.token(), "SUCCEEDED", "xinzhi-erp-20260822-120000",
                "已发布", Instant.now(), 5, Instant.now());
        when(repository.find()).thenReturn(configured, succeeded);
        when(repository.markRunning(3, actor.adminId())).thenReturn(true);
        when(cipher.decrypt(configured.token())).thenReturn(decrypted);
        when(executor.release(any())).thenReturn(
                new ShopifyAppReleaseExecutor.ReleaseResult(
                        "xinzhi-erp-20260822-120000", "已发布"));
        when(repository.finish(4, "SUCCEEDED",
                "xinzhi-erp-20260822-120000", "已发布", true,
                actor.adminId())).thenReturn(true);

        ShopifyAppReleaseService.ReleaseView result = service.release(actor, 3);

        assertThat(result.status()).isEqualTo("SUCCEEDED");
        assertThat(result.releaseVersion())
                .isEqualTo("xinzhi-erp-20260822-120000");
        assertThat(decrypted).containsOnly('\0');
        verify(auditRecorder).record(any());
    }

    @Test
    void recordsARecoverableFailureWithoutEchoingTheToken() {
        char[] decrypted = "automation-token-for-test-only".toCharArray();
        when(repository.find()).thenReturn(configured);
        when(repository.markRunning(3, actor.adminId())).thenReturn(true);
        when(cipher.decrypt(configured.token())).thenReturn(decrypted);
        when(executor.release(any())).thenThrow(
                new ShopifyAppReleaseFailedException("令牌无效"));

        assertThatThrownBy(() -> service.release(actor, 3))
                .isInstanceOf(ShopifyAppReleaseFailedException.class)
                .hasMessage("令牌无效");

        verify(repository).finish(4, "FAILED", null,
                "令牌无效", false, actor.adminId());
        assertThat(decrypted).containsOnly('\0');
        verify(auditRecorder).record(any());
    }

    @Test
    void recoversAnInterruptedReleaseAtServiceStartup() {
        service.recoverInterruptedRelease();

        verify(repository).failInterruptedRelease();
    }
}
