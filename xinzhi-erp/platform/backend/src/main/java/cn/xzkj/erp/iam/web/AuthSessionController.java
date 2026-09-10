package cn.xzkj.erp.iam.web;

import cn.xzkj.erp.iam.application.PageResult;
import cn.xzkj.erp.iam.application.SessionManagementService;
import cn.xzkj.erp.iam.application.SessionManagementService.SessionView;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/auth/sessions")
public class AuthSessionController {

    private static final java.util.regex.Pattern REQUEST_ID_FORMAT =
            java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final SessionManagementService service;

    public AuthSessionController(SessionManagementService service) {
        this.service = service;
    }

    @GetMapping
    public PageResult<SessionView> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(defaultValue = "0")
            @Min(0) @Max(SessionManagementService.MAX_PAGE_NUMBER)
            int page,
            @RequestParam(defaultValue = "20")
            @Min(1) @Max(SessionManagementService.MAX_PAGE_SIZE)
            int size) {
        return service.listOwnSessions(principal, page, size);
    }

    @DeleteMapping("/{sessionId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void revoke(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID sessionId,
            HttpServletRequest request) {
        service.revokeOwnSession(
                principal,
                sessionId,
                requestId(request),
                request.getRemoteAddr());
    }

    private static String requestId(HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null) {
            return null;
        }
        requestId = requestId.strip();
        if (requestId.isEmpty()) {
            return null;
        }
        requestId = requestId.substring(0, Math.min(100, requestId.length()));
        return REQUEST_ID_FORMAT.matcher(requestId).matches() ? requestId : null;
    }
}
