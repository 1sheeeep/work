package cn.xzkj.erp.iam.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.application.LoginCommand;
import cn.xzkj.erp.iam.application.LoginResult;
import cn.xzkj.erp.iam.application.LoginService;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService;
import cn.xzkj.erp.tenantaccess.TenantEntitlementService.ApplicationAccess;
import cn.xzkj.erp.tenantaccess.UserApplicationAccessService;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

class AuthControllerTest {

    @Test
    void nativePasswordChangeUsesExistingAdministrationService() {
        ErpPrincipal principal = new ErpPrincipal(SESSION_ID, EXPIRES_AT,
                TENANT_ID, "acme", "Acme", USER_ID, "operator", "Operator");
        controller.changePassword(principal,
                new AuthController.ChangePasswordRequest("OldFixture!1", "NewFixture!2"),
                new MockHttpServletRequest());
        org.mockito.Mockito.verify(administrationService).changeOwnPassword(
                org.mockito.ArgumentMatchers.argThat(actor -> actor.tenantId().equals(TENANT_ID)
                        && actor.userId().equals(USER_ID)),
                org.mockito.ArgumentMatchers.eq("OldFixture!1".toCharArray()),
                org.mockito.ArgumentMatchers.eq("NewFixture!2".toCharArray()));
    }

    private static final UUID TENANT_ID =
            UUID.fromString("10000000-0000-0000-0000-000000000001");
    private static final UUID USER_ID =
            UUID.fromString("20000000-0000-0000-0000-000000000001");
    private static final UUID SESSION_ID =
            UUID.fromString("30000000-0000-0000-0000-000000000001");
    private static final Instant EXPIRES_AT =
            Instant.parse("2026-07-28T20:00:00Z");

    private final LoginService loginService = mock(LoginService.class);
    private final IamAdministrationService administrationService =
            mock(IamAdministrationService.class);
    private final AuthController controller =
            new AuthController(loginService, administrationService);

    @Test
    void mapsLoginToCompleteWebIdentityContract() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setRemoteAddr("127.0.0.1");
        request.addHeader("X-Request-Id", "request-1");
        when(loginService.login(new LoginCommand(
                "acme", "operator", "supplied-password", "request-1", "127.0.0.1")))
                .thenReturn(new LoginResult(
                        "raw-token",
                        EXPIRES_AT,
                        TENANT_ID,
                        "acme",
                        "Acme",
                        USER_ID,
                        "operator",
                        null,
                        "Operator",
                        List.of("orders.read")));

        AuthController.LoginResponse response = controller.login(
                new AuthController.LoginRequest(
                        "acme", "operator", "supplied-password"),
                request);

        assertThat(response.tokenType()).isEqualTo("Bearer");
        assertThat(response.accessToken()).isEqualTo("raw-token");
        assertThat(response.expiresAt()).isEqualTo(EXPIRES_AT);
        assertThat(response.tenant())
                .isEqualTo(new AuthController.TenantResponse(TENANT_ID, "acme", "Acme"));
        assertThat(response.user())
                .isEqualTo(new AuthController.UserResponse(
                        USER_ID,
                        "operator",
                        null,
                        null,
                        "Operator"));
        assertThat(response.permissions()).containsExactly("orders.read");
    }

    @Test
    void mapsCurrentIdentityFromPrincipalAndGrantedAuthorities() {
        ErpPrincipal principal = new ErpPrincipal(
                SESSION_ID,
                EXPIRES_AT,
                TENANT_ID,
                "acme",
                "Acme",
                USER_ID,
                "operator",
                "Operator");
        var authentication = UsernamePasswordAuthenticationToken.authenticated(
                principal,
                null,
                List.of(
                        new SimpleGrantedAuthority("orders.read"),
                        new SimpleGrantedAuthority("inventory.read")));

        AuthController.CurrentUserResponse response =
                controller.me(principal, authentication);

        assertThat(response.tenant().id()).isEqualTo(TENANT_ID);
        assertThat(response.user().id()).isEqualTo(USER_ID);
        assertThat(response.permissions())
                .containsExactly("inventory.read", "orders.read");
        assertThat(response.expiresAt()).isEqualTo(EXPIRES_AT);
    }

    @Test
    void exposesCanonicalPhoneForPlatformTenantSession() {
        TenantEntitlementService entitlementService =
                mock(TenantEntitlementService.class);
        UserApplicationAccessService userApplicationAccessService =
                mock(UserApplicationAccessService.class);
        AuthController platformController = new AuthController(
                loginService,
                administrationService,
                entitlementService,
                userApplicationAccessService);
        when(entitlementService.platformSessionAccess()).thenReturn(List.of(
                new ApplicationAccess("ERP", List.of("ORDERS")),
                new ApplicationAccess("ZHAOYAOJING", List.of("AD_ACCOUNTS")),
                new ApplicationAccess("ASSET_REGISTRY", List.of("ASSETS"))));
        ErpPrincipal principal = new ErpPrincipal(
                SESSION_ID,
                EXPIRES_AT,
                TENANT_ID,
                "acme",
                "Acme",
                null,
                "+8618002629295",
                null,
                "System administrator",
                USER_ID);
        var authentication = UsernamePasswordAuthenticationToken.authenticated(
                principal,
                null,
                List.of(new SimpleGrantedAuthority("orders.read")));

        AuthController.CurrentUserResponse response =
                platformController.me(principal, authentication);

        assertThat(response.user()).isNull();
        assertThat(response.platformAdmin().username()).isEqualTo("+8618002629295");
        assertThat(response.platformAdmin().phoneNumber()).isEqualTo("+8618002629295");
        assertThat(response.applications())
                .extracting(ApplicationAccess::code)
                .containsExactly("ERP", "ZHAOYAOJING", "ASSET_REGISTRY");
    }
}
