package cn.xzkj.erp.warehouse.documents;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.PageEnvelope;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.ApprovalStatus;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Direction;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.SearchField;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Source;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentView.Status;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.Set;
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
@RequestMapping("/api/v1/inventory-center/documents")
public class WarehouseDocumentController {
    private static final int MAX_PAGE_SIZE = 200;
    private final WarehouseDocumentService service;

    public WarehouseDocumentController(WarehouseDocumentService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<Response> list(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) Direction direction,
            @RequestParam(required = false) Source source,
            @RequestParam(required = false) Status status,
            @RequestParam(required = false) ApprovalStatus approvalStatus,
            @RequestParam(defaultValue = "DOCUMENT_NO") SearchField searchField,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant occurredFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
            Instant occurredTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50") @Min(1) @Max(MAX_PAGE_SIZE) int size) {
        return PageEnvelope.from(service.list(
                        new WarehouseDocumentActor(
                                principal.tenantId(), principal.userId(),
                                principal.systemAdminId()),
                        warehouseId, direction, source, status, approvalStatus,
                        searchField, keyword, occurredFrom, occurredTo,
                        pageable(page, size)),
                Response::from);
    }

    @PostMapping("/exports")
    @PreAuthorize("hasAuthority('inventory.read')")
    public ExportResponse export(
            @AuthenticationPrincipal ErpPrincipal principal,
            @Valid @RequestBody ExportRequest request) {
        var result = service.exportCsv(
                new WarehouseDocumentActor(
                        principal.tenantId(), principal.userId(),
                        principal.systemAdminId()),
                request.warehouseId(), request.direction(), request.source(),
                request.status(), request.approvalStatus(), request.searchField(),
                request.keyword(), request.occurredFrom(), request.occurredTo());
        return new ExportResponse(
                result.filename(), result.mediaType(), result.rowCount(),
                result.content());
    }

    private static PageRequest pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }

    public record Response(
            UUID id,
            UUID relatedDocumentId,
            Source source,
            Direction direction,
            String documentNo,
            String sourceReference,
            String documentType,
            UUID warehouseId,
            String warehouseCode,
            String warehouseName,
            Status status,
            ApprovalStatus approvalStatus,
            long lineCount,
            long totalQuantity,
            BigDecimal totalAmount,
            String currency,
            String operatorDisplayName,
            Instant occurredAt,
            Instant postedAt) {
        static Response from(WarehouseDocumentView value) {
            return new Response(
                    value.id(), value.relatedDocumentId(), value.source(), value.direction(),
                    value.documentNo(), value.sourceReference(),
                    value.documentType(), value.warehouseId(),
                    value.warehouseCode(), value.warehouseName(),
                    value.status(), value.approvalStatus(), value.lineCount(),
                    value.totalQuantity(), value.totalAmount(), value.currency(),
                    value.operatorDisplayName(), value.occurredAt(),
                    value.postedAt());
        }
    }

    public record ExportRequest(
            UUID warehouseId,
            @NotNull Direction direction,
            Source source,
            Status status,
            ApprovalStatus approvalStatus,
            @NotNull SearchField searchField,
            @Size(max = 100) String keyword,
            Instant occurredFrom,
            Instant occurredTo) {}

    public record ExportResponse(
            String filename,
            String mediaType,
            int rowCount,
            String content) {}
}
