package cn.xzkj.erp.settings.general;

import java.time.Instant;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.UUID;

import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Pattern;

@RestController
@Validated
@RequestMapping("/api/v1/settings/system-general")
public class SystemGeneralSettingController {
    private static final DateTimeFormatter TIME = DateTimeFormatter.ofPattern("HH:mm");
    private final SystemGeneralSettingService service;

    public SystemGeneralSettingController(SystemGeneralSettingService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public Response get(@AuthenticationPrincipal ErpPrincipal principal,
            HttpServletRequest request) {
        return Response.from(service.get(actor(principal, request)));
    }

    @PutMapping
    @PreAuthorize("hasAuthority('settings.parameter.write')")
    public Response save(@AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody SaveRequest body,
            HttpServletRequest request) {
        LocalTime start = parseTime(body.orderPullBlackoutStart());
        LocalTime end = parseTime(body.orderPullBlackoutEnd());
        return Response.from(service.save(actor(principal, request),
                body.expectedVersion(), body.defaultCurrency(), start, end));
    }

    private static LocalTime parseTime(String value) {
        return value == null ? null : LocalTime.parse(value, TIME);
    }

    private static SystemGeneralSettingService.Actor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        String requestId = request.getHeader("X-Request-Id");
        if (requestId == null || !requestId.matches("^[A-Za-z0-9._:-]{1,100}$")) {
            requestId = UUID.randomUUID().toString();
        }
        return new SystemGeneralSettingService.Actor(
                principal.tenantId(), principal.userId(),
                principal.systemAdminId(), principal.displayName(), requestId,
                request.getRemoteAddr());
    }

    public record SaveRequest(@Min(0) long expectedVersion,
            @Pattern(regexp = "^[A-Z]{3}$") String defaultCurrency,
            @Pattern(regexp = "^(?:[01]\\d|2[0-3]):[0-5]\\d$")
            String orderPullBlackoutStart,
            @Pattern(regexp = "^(?:[01]\\d|2[0-3]):[0-5]\\d$")
            String orderPullBlackoutEnd) {
    }

    public record Response(boolean configured, String defaultCurrency,
            String orderPullBlackoutStart, String orderPullBlackoutEnd,
            long version, String updatedByDisplayName,
            Instant createdAt, Instant updatedAt) {
        static Response from(SystemGeneralSettingRecord source) {
            return new Response(source.configured(), source.defaultCurrency(),
                    formatTime(source.orderPullBlackoutStart()),
                    formatTime(source.orderPullBlackoutEnd()), source.version(),
                    source.updatedByDisplayName(), source.createdAt(),
                    source.updatedAt());
        }

        private static String formatTime(LocalTime value) {
            return value == null ? null : value.format(TIME);
        }
    }
}
