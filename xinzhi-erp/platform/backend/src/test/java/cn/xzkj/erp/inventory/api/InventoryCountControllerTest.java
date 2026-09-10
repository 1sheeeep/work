package cn.xzkj.erp.inventory.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.inventory.api.InventoryCountDtos.CountExportRequest;
import cn.xzkj.erp.inventory.domain.InventoryCountStatus;
import cn.xzkj.erp.inventory.service.InventoryCountSearchField;
import cn.xzkj.erp.inventory.service.InventoryCountService;
import cn.xzkj.erp.inventory.service.InventoryCountService.InventoryCountExport;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.access.prepost.PreAuthorize;

class InventoryCountControllerTest {

    @Test
    void mapsTheReadProtectedExportContractToThePrincipalTenant() throws Exception {
        InventoryCountService service = mock(InventoryCountService.class);
        InventoryCountController controller = new InventoryCountController(service);
        UUID tenantId = UUID.randomUUID();
        ErpPrincipal principal = new ErpPrincipal(
                UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                tenantId, "test", "Test Tenant", UUID.randomUUID(),
                "tester", "Tester");
        HttpServletRequest request = mock(HttpServletRequest.class);
        when(request.getRemoteAddr()).thenReturn("127.0.0.1");
        CountExportRequest body = new CountExportRequest(
                null, InventoryCountStatus.APPROVAL,
                InventoryCountSearchField.SKU, "sku-1",
                LocalDate.of(2026, 7, 1), LocalDate.of(2026, 8, 1),
                -2L, 5L);
        when(service.exportCsv(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(null), eq(InventoryCountStatus.APPROVAL),
                eq(InventoryCountSearchField.SKU), eq("sku-1"),
                eq(LocalDate.of(2026, 7, 1)), eq(LocalDate.of(2026, 8, 1)),
                eq(-2L), eq(5L)))
                .thenReturn(new InventoryCountExport(
                        "inventory-counts.csv", "text/csv;charset=utf-8", 1,
                        "\uFEFF盘点批次,仓库编码\r\n"));

        var response = controller.export(principal, body, request);

        assertThat(response.filename()).isEqualTo("inventory-counts.csv");
        assertThat(response.rowCount()).isEqualTo(1);
        verify(service).exportCsv(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(null), eq(InventoryCountStatus.APPROVAL),
                eq(InventoryCountSearchField.SKU), eq("sku-1"),
                eq(LocalDate.of(2026, 7, 1)), eq(LocalDate.of(2026, 8, 1)),
                eq(-2L), eq(5L));
        PreAuthorize authorization = InventoryCountController.class
                .getMethod(
                        "export", ErpPrincipal.class, CountExportRequest.class,
                        HttpServletRequest.class)
                .getAnnotation(PreAuthorize.class);
        assertThat(authorization.value())
                .isEqualTo("hasAuthority('inventory.read')");
    }
}
