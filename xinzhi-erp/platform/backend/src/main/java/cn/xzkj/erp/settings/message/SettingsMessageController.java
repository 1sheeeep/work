package cn.xzkj.erp.settings.message;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/settings/messages")
public class SettingsMessageController {
    private final SettingsMessageService service;

    public SettingsMessageController(SettingsMessageService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('settings.read')")
    public PageEnvelope<MessageResponse> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate,
            @RequestParam(defaultValue = "ALL") @Size(max = 32) String type,
            @RequestParam(defaultValue = "ALL") @Size(max = 16) String readState,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "25") @Min(1) @Max(100) int size) {
        return PageEnvelope.from(service.list(actor(principal),
                new SettingsMessageService.Filters(startDate, endDate, type,
                        readState), PageRequest.of(page, size)),
                MessageResponse::from);
    }

    @PostMapping("/mark-read")
    @PreAuthorize("hasAuthority('settings.read')")
    public MarkReadResponse markRead(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody MarkReadRequest body) {
        return new MarkReadResponse(service.markRead(actor(principal),
                body.messageIds()));
    }

    private static SettingsMessageService.Actor actor(ErpPrincipal principal) {
        return new SettingsMessageService.Actor(principal.tenantId(),
                principal.userId(), principal.systemAdminId());
    }

    public record MarkReadRequest(
            @NotEmpty @Size(max = 100) List<@NotNull UUID> messageIds) {
    }

    public record MarkReadResponse(int markedRead) {
    }

    public record MessageResponse(UUID id, String title, String content,
            String type, boolean pinned, String createdByDisplayName,
            Instant publishedAt, boolean read, Instant readAt) {
        static MessageResponse from(SettingsMessageRecord value) {
            return new MessageResponse(value.id(), value.title(), value.content(),
                    value.type(), value.pinned(),
                    value.createdByDisplayName(), value.publishedAt(),
                    value.read(), value.readAt());
        }
    }
}
