package cn.xzkj.erp.inventory.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.inventory.api.InventoryTransferDtos.TransferExportRequest;
import cn.xzkj.erp.inventory.domain.WarehouseTransferStatus;
import cn.xzkj.erp.inventory.domain.WarehouseTransferTransportMode;
import cn.xzkj.erp.inventory.service.WarehouseTransferSearchField;
import cn.xzkj.erp.inventory.service.WarehouseTransferService;
import cn.xzkj.erp.inventory.service.WarehouseTransferService.WarehouseTransferExport;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.security.access.prepost.PreAuthorize;

class WarehouseTransferControllerTest {

    @Test
    void mapsAUnifiedReceiptQueueToOneBoundedPage() {
        WarehouseTransferService service = mock(WarehouseTransferService.class);
        WarehouseTransferController controller =
                new WarehouseTransferController(service);
        UUID tenantId = UUID.randomUUID();
        ErpPrincipal principal = new ErpPrincipal(
                UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                tenantId, "test", "Test Tenant", UUID.randomUUID(),
                "tester", "Tester");
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        List<WarehouseTransferStatus> statuses = List.of(
                WarehouseTransferStatus.IN_TRANSIT,
                WarehouseTransferStatus.PARTIALLY_RECEIVED);
        PageRequest pageable = PageRequest.of(1, 20);
        when(service.list(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                isNull(), isNull(), eq(statuses), isNull(),
                eq(WarehouseTransferSearchField.BATCH), isNull(), isNull(),
                isNull(), eq(pageable)))
                .thenReturn(Page.empty(pageable));

        var response = controller.list(
                principal, null, null, statuses, null,
                WarehouseTransferSearchField.BATCH, null, null, null,
                1, 20, request);

        assertThat(response.page()).isEqualTo(1);
        assertThat(response.size()).isEqualTo(20);
        verify(service).list(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                isNull(), isNull(), eq(statuses), isNull(),
                eq(WarehouseTransferSearchField.BATCH), isNull(), isNull(),
                isNull(), eq(pageable));
    }

    @Test
    void mapsTheReadProtectedExportContractToThePrincipalTenant()
            throws Exception {
        WarehouseTransferService service = mock(WarehouseTransferService.class);
        WarehouseTransferController controller =
                new WarehouseTransferController(service);
        UUID tenantId = UUID.randomUUID();
        UUID sourceWarehouseId = UUID.randomUUID();
        UUID targetWarehouseId = UUID.randomUUID();
        ErpPrincipal principal = new ErpPrincipal(
                UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                tenantId, "test", "Test Tenant", UUID.randomUUID(),
                "tester", "Tester");
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        TransferExportRequest body = new TransferExportRequest(
                sourceWarehouseId, targetWarehouseId,
                List.of(WarehouseTransferStatus.IN_TRANSIT,
                        WarehouseTransferStatus.PARTIALLY_RECEIVED),
                WarehouseTransferTransportMode.LAND,
                WarehouseTransferSearchField.SKU, "sku-1",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1));
        when(service.exportCsv(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(sourceWarehouseId), eq(targetWarehouseId),
                eq(body.statuses()), eq(WarehouseTransferTransportMode.LAND),
                eq(WarehouseTransferSearchField.SKU), eq("sku-1"),
                eq(LocalDate.of(2026, 7, 1)), eq(LocalDate.of(2026, 8, 1))))
                .thenReturn(new WarehouseTransferExport(
                        "warehouse-transfers.csv", "text/csv;charset=utf-8", 1,
                        "\uFEFF调拨批次,状态\r\n"));

        var response = controller.export(principal, body, request);

        assertThat(response.filename()).isEqualTo("warehouse-transfers.csv");
        assertThat(response.rowCount()).isEqualTo(1);
        verify(service).exportCsv(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(sourceWarehouseId), eq(targetWarehouseId),
                eq(body.statuses()), eq(WarehouseTransferTransportMode.LAND),
                eq(WarehouseTransferSearchField.SKU), eq("sku-1"),
                eq(LocalDate.of(2026, 7, 1)), eq(LocalDate.of(2026, 8, 1)));
        PreAuthorize authorization = WarehouseTransferController.class
                .getMethod(
                        "export", ErpPrincipal.class,
                        TransferExportRequest.class, HttpServletRequest.class)
                .getAnnotation(PreAuthorize.class);
        assertThat(authorization.value())
                .isEqualTo("hasAuthority('inventory.read')");
    }
}
