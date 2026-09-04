package ai.xzkj.recruitment.auth;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;

public class RememberMeAuthenticationFilter extends OncePerRequestFilter {
    private final RememberMeService rememberMeService;
    private final UserDetailsService userDetailsService;
    private final SecurityContextRepository securityContextRepository;

    public RememberMeAuthenticationFilter(RememberMeService rememberMeService, UserDetailsService userDetailsService,
                                          SecurityContextRepository securityContextRepository) {
        this.rememberMeService = rememberMeService;
        this.userDetailsService = userDetailsService;
        this.securityContextRepository = securityContextRepository;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (SecurityContextHolder.getContext().getAuthentication() == null) {
            rememberMeService.restore(request, response).ifPresent(username -> {
                var user = userDetailsService.loadUserByUsername(username);
                var authentication = UsernamePasswordAuthenticationToken.authenticated(
                        user, null, user.getAuthorities());
                var context = SecurityContextHolder.createEmptyContext();
                context.setAuthentication(authentication);
                SecurityContextHolder.setContext(context);
                securityContextRepository.saveContext(context, request, response);
            });
        }
        filterChain.doFilter(request, response);
    }
}
