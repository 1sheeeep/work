package cn.xzkj.erp.platformadmin.web;

import cn.xzkj.erp.platformadmin.application.PlatformAdminActor;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceOperationsService;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceOperationsService.ExportDownload;
import cn.xzkj.erp.platformadmin.privacy.ShopifyComplianceOperationsService.RequestView;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.util.List;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Validated
@RestController
@RequestMapping("/api/v1/erp-operator/shopify-compliance-requests")
public class ShopifyComplianceController {

    private static final java.util.regex.Pattern REQUEST_ID =
            java.util.regex.Pattern.compile("^[A-Za-z0-9._:-]{1,100}$");

    private final ShopifyComplianceOperationsService service;

    public ShopifyComplianceController(
            ShopifyComplianceOperationsService service) {
        this.service = service;
    }

    @GetMapping
    public ResponseEntity<List<RequestView>> list() {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.list());
    }

    @PostMapping("/export")
    public ResponseEntity<byte[]> export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody EventRequest body,
            HttpServletRequest request) {
        ExportDownload download = service.prepareExport(
                actor(principal, request), body.eventId());
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .contentType(MediaType.APPLICATION_JSON)
                .header(
                        HttpHeaders.CONTENT_DISPOSITION,
                        ContentDisposition.attachment()
                                .filename(
                                        download.fileName(),
                                        StandardCharsets.UTF_8)
                                .build().toString())
                .header("X-Content-Type-Options", "nosniff")
                .body(download.content());
    }

    @PostMapping("/confirm-export-delivery")
    public ResponseEntity<RequestView> confirmExportDelivery(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ConfirmationRequest body,
            HttpServletRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.confirmExportDelivered(
                        actor(principal, request),
                        body.eventId(),
                        body.confirmation()));
    }

    @PostMapping("/redact")
    public ResponseEntity<RequestView> redact(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ConfirmationRequest body,
            HttpServletRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.redact(
                        actor(principal, request),
                        body.eventId(),
                        body.confirmation()));
    }

    private static PlatformAdminActor actor(
            ErpPrincipal principal,
            HttpServletRequest request) {
        return new PlatformAdminActor(
                principal.systemAdminId(),
                principal.sessionId(),
                requestId(request),
                request.getRemoteAddr());
    }

    private static String requestId(HttpServletRequest request) {
        String value = request.getHeader("X-Request-Id");
        if (value == null) {
            return null;
        }
        value = value.strip();
        return REQUEST_ID.matcher(value).matches() ? value : null;
    }

    public record EventRequest(
            @NotBlank @Size(max = 260)
            String eventId) {
    }

    public record ConfirmationRequest(
            @NotBlank @Size(max = 260)
            String eventId,
            @NotBlank @Size(max = 64)
            String confirmation) {
    }
}
