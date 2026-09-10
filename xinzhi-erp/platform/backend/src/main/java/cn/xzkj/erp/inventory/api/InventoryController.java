package cn.xzkj.erp.inventory.api;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.inventory.api.InventoryDtos.AdjustmentRequest;
import cn.xzkj.erp.inventory.api.InventoryDtos.BalanceResponse;
import cn.xzkj.erp.inventory.api.InventoryDtos.MutationResponse;
import cn.xzkj.erp.inventory.api.InventoryDtos.ReversalRequest;
import cn.xzkj.erp.inventory.api.InventoryDtos.SkuSummaryResponse;
import cn.xzkj.erp.inventory.api.InventoryDtos.SkuSummariesResponse;
import cn.xzkj.erp.inventory.service.InventoryActor;
import cn.xzkj.erp.inventory.service.InventoryBalanceSearchField;
import cn.xzkj.erp.inventory.service.InventoryService;
import cn.xzkj.erp.platform.api.PageEnvelope;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolationException;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Validated
@RequestMapping("/api/v1/inventory-center")
public class InventoryController {
    private static final int MAX_PAGE_SIZE = 200;
    private final InventoryService service;

    public InventoryController(InventoryService service) {
        this.service = service;
    }

    @GetMapping("/balances")
    @PreAuthorize("hasAuthority('inventory.read')")
    public PageEnvelope<BalanceResponse> listBalances(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(required = false) UUID warehouseId,
            @RequestParam(required = false) UUID skuId,
            @RequestParam(required = false) UUID categoryId,
            @RequestParam(defaultValue = "ALL")
            InventoryBalanceSearchField searchField,
            @RequestParam(required = false) @Size(max = 100) String keyword,
            @RequestParam(required = false) Long onHandMin,
            @RequestParam(required = false) Long onHandMax,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate updatedFrom,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE)
            LocalDate updatedTo,
            @RequestParam(defaultValue = "0") @Min(0) int page,
            @RequestParam(defaultValue = "50")
            @Min(1) @Max(MAX_PAGE_SIZE) int size,
            HttpServletRequest request) {
        return PageEnvelope.from(
                service.listBalances(
                        actor(principal, request),
                        warehouseId,
                        skuId,
                        categoryId,
                        searchField,
                        keyword,
                        onHandMin,
                        onHandMax,
                        updatedFrom,
                        updatedTo,
                        pageable(page, size)),
                BalanceResponse::from);
    }

    @GetMapping("/balances/{balanceId}")
    @PreAuthorize("hasAuthority('inventory.read')")
    public BalanceResponse getBalance(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID balanceId,
            HttpServletRequest request) {
        return BalanceResponse.from(service.getBalance(
                actor(principal, request), balanceId));
    }

    @GetMapping("/balance-summaries")
    @PreAuthorize("hasAuthority('inventory.read')")
    public SkuSummariesResponse listSkuSummaries(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestParam(name = "skuId")
            @Size(min = 1, max = 50)
            List<@NotNull UUID> skuIds,
            HttpServletRequest request) {
        return new SkuSummariesResponse(
                service.listSkuSummaries(
                                actor(principal, request),
                                skuIds)
                        .stream()
                        .map(SkuSummaryResponse::from)
                        .toList());
    }

    @PostMapping("/adjustments")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public MutationResponse adjust(
            @AuthenticationPrincipal ErpPrincipal principal,
            @RequestHeader("Idempotency-Key")
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody AdjustmentRequest body,
            HttpServletRequest request) {
        return MutationResponse.from(service.adjust(
                actor(principal, request, requestId),
                body.type(),
                body.skuId(),
                body.warehouseId(),
                body.signedDelta(),
                body.expectedVersion(),
                body.reason(),
                body.note(),
                idempotencyKey));
    }

    @PostMapping("/ledger-events/{eventId}/reversal")
    @PreAuthorize("hasAuthority('inventory.adjust')")
    public MutationResponse reverse(
            @AuthenticationPrincipal ErpPrincipal principal,
            @PathVariable UUID eventId,
            @RequestHeader("Idempotency-Key")
            @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
            String idempotencyKey,
            @RequestHeader("X-Request-Id")
            @Pattern(regexp = "^[A-Za-z0-9._:-]{1,100}$")
            String requestId,
            @Valid @RequestBody ReversalRequest body,
            HttpServletRequest request) {
        return MutationResponse.from(service.reverse(
                actor(principal, request, requestId),
                eventId,
                body.expectedVersion(),
                body.reason(),
                body.note(),
                idempotencyKey));
    }

    private static InventoryActor actor(
            ErpPrincipal principal, HttpServletRequest request) {
        return actor(principal, request, null);
    }

    private static InventoryActor actor(
            ErpPrincipal principal,
            HttpServletRequest request,
            String requestId) {
        return new InventoryActor(
                principal.tenantId(),
                principal.userId(),
                principal.systemAdminId(),
                requestId,
                request.getRemoteAddr());
    }

    private static Pageable pageable(int page, int size) {
        if (page < 0 || size < 1 || size > MAX_PAGE_SIZE) {
            throw new ConstraintViolationException(Set.of());
        }
        return PageRequest.of(page, size);
    }
}
