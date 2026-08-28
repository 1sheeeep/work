package ai.xzkj.recruitment.audit;

import ai.xzkj.recruitment.auth.CurrentUserService;
import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.UserRole;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class AuditServiceTest {
    @Mock AuditLogRepository repository;
    @Mock CurrentUserService currentUserService;

    @Test void redactsSecretsAndRemovesLineBreaks() {
        SystemUser user = new SystemUser("admin", "hash", "管理员", UserRole.SYSTEM_ADMIN);
        when(currentUserService.requireCurrentUser()).thenReturn(user);
        AuditService service = new AuditService(repository, currentUserService);
        service.success("TEST", "SYSTEM", null, "对象", "password=plain-text\ntoken:abc123");

        ArgumentCaptor<AuditLog> captor = ArgumentCaptor.forClass(AuditLog.class);
        verify(repository).save(captor.capture());
        assertThat(captor.getValue().getDetails()).isEqualTo("password=[REDACTED] token:[REDACTED]");
        assertThat(captor.getValue().getRequestId()).isEqualTo("system");
    }
}
