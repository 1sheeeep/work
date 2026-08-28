package ai.xzkj.recruitment.auth;

import ai.xzkj.recruitment.common.ApiException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;

import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CurrentUserServiceTest {
    @Mock private SystemUserRepository repository;

    @AfterEach
    void clearContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void rejectsDisabledUserEvenWhenAnOldSessionAuthenticationExists() {
        SystemUser user = new SystemUser("disabled.user", "hash", "已停用用户", UserRole.RECRUITER);
        user.changeEnabled(false);
        SecurityContextHolder.getContext().setAuthentication(
                UsernamePasswordAuthenticationToken.authenticated(user.getUsername(), "n/a", java.util.List.of()));
        when(repository.findByUsernameIgnoreCase(user.getUsername())).thenReturn(Optional.of(user));

        assertThatThrownBy(() -> new CurrentUserService(repository).requireCurrentUser())
                .isInstanceOf(ApiException.class)
                .hasMessage("当前账号已停用，请联系管理员");
    }
}
