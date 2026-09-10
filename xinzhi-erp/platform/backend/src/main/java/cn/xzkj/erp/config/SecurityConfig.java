package cn.xzkj.erp.config;

import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.customer.service.CustomerServiceWorkloadAuthenticationFilter;
import cn.xzkj.erp.platformadmin.security.PlatformAdminAuthorities;
import cn.xzkj.erp.platformadmin.security.PlatformAdminTenantWriteAuditFilter;
import java.io.IOException;
import java.security.SecureRandom;
import java.time.Clock;
import java.util.Map;
import jakarta.servlet.DispatcherType;
import org.springframework.boot.autoconfigure.condition.ConditionalOnWebApplication;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.authorization.AuthorizationDecision;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.http.HttpMethod;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.DelegatingPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.access.ExceptionTranslationFilter;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.security.web.authentication.logout.LogoutFilter;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    @ConditionalOnWebApplication(type = ConditionalOnWebApplication.Type.SERVLET)
    @Order(2)
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            ObjectProvider<CustomerServiceWorkloadAuthenticationFilter>
                    customerServiceWorkloadFilterProvider,
            BearerTokenAuthenticationFilter bearerTokenFilter,
            TenantContextFilter tenantContextFilter,
            ObjectProvider<PlatformAdminTenantWriteAuditFilter>
                    tenantWriteAuditFilterProvider)
            throws Exception {
        CustomerServiceWorkloadAuthenticationFilter customerServiceWorkloadFilter =
                customerServiceWorkloadFilterProvider.getIfAvailable(
                        () -> new CustomerServiceWorkloadAuthenticationFilter(""));
        http
                .csrf(csrf -> csrf.disable())
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint((request, response, exception) ->
                                writeSecurityError(
                                        response,
                                        401,
                                        "authentication_required",
                                        "Authentication is required"))
                        .accessDeniedHandler((request, response, exception) ->
                                writeSecurityError(
                                        response,
                                        403,
                                        "permission_denied",
                                        "Permission is required")))
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(
                                "/actuator/health",
                                "/actuator/health/**",
                                "/api/v1/system/info",
                                "/api/v1/auth/login",
                                "/api/v1/auth/password-credentials/redeem",
                                "/api/v1/platform-admin/auth/login",
                                "/api/v1/platform-admin/auth/password-credentials/redeem"
                        ).permitAll()
                        .requestMatchers(
                                "/actuator",
                                "/actuator/**"
                        ).denyAll()
                        .requestMatchers(
                                HttpMethod.DELETE,
                                "/api/v1/platform-admin/tenant-session")
                        .hasAuthority(PlatformAdminAuthorities.TENANT_SESSION)
                        .requestMatchers("/api/v1/erp-operator/**")
                        .hasAuthority(PlatformAdminAuthorities.TENANT_SESSION)
                        .requestMatchers("/api/v1/platform-admin/**")
                        .hasAuthority(PlatformAdminAuthorities.SYSTEM_ADMIN)
                        .anyRequest()
                        .access((authentication, context) -> {
                            var current = authentication.get();
                            boolean platformBaseSession =
                                    current.getAuthorities().stream()
                                            .anyMatch(authority ->
                                                    PlatformAdminAuthorities
                                                            .SYSTEM_ADMIN
                                                            .equals(authority
                                                                    .getAuthority()));
                            return new AuthorizationDecision(
                                    current.isAuthenticated()
                                            && !(current instanceof
                                                    AnonymousAuthenticationToken)
                                            && !platformBaseSession);
                        })
                )
                .addFilterBefore(customerServiceWorkloadFilter, LogoutFilter.class)
                .addFilterBefore(bearerTokenFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(tenantContextFilter, AnonymousAuthenticationFilter.class);
        PlatformAdminTenantWriteAuditFilter tenantWriteAuditFilter =
                tenantWriteAuditFilterProvider.getIfAvailable();
        if (tenantWriteAuditFilter != null) {
            http.addFilterBefore(
                    tenantWriteAuditFilter,
                    ExceptionTranslationFilter.class);
        }
        return http.build();
    }

    @Bean
    PasswordEncoder passwordEncoder() {
        BCryptPasswordEncoder bcrypt = new BCryptPasswordEncoder(12);
        Argon2PasswordEncoder argon2id =
                Argon2PasswordEncoder.defaultsForSpringSecurity_v5_8();
        return new DelegatingPasswordEncoder(
                "argon2id",
                Map.of("argon2id", argon2id, "bcrypt", bcrypt));
    }

    @Bean
    SecureRandom secureRandom() {
        return new SecureRandom();
    }

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }

    private static void writeSecurityError(
            jakarta.servlet.http.HttpServletResponse response,
            int status,
            String code,
            String message)
            throws IOException {
        response.setStatus(status);
        response.setCharacterEncoding(java.nio.charset.StandardCharsets.UTF_8.name());
        response.setContentType("application/json");
        response.getWriter().write("{\"code\":\"" + code + "\",\"message\":\""
                + message + "\"}");
    }
}
