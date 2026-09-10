package cn.xzkj.erp.supplier.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.math.BigDecimal;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.product.repository.ProductSkuRepository;
import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.domain.SupplierSkuMappingStatus;
import cn.xzkj.erp.supplier.repository.SupplierRepository;
import cn.xzkj.erp.supplier.repository.SupplierSkuMappingRepository;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.supplier.api.SupplierSkuMappingDtos.CreateMappingRequest;
import cn.xzkj.erp.supplier.domain.SupplierSkuMapping;

class SupplierSkuMappingServiceTest {

    @Test
    void createPersistsPriceMoqLeadTimeAndPreferredRelationship() {
        SupplierRepository suppliers = mock(SupplierRepository.class);
        SupplierSkuMappingRepository mappings = mock(SupplierSkuMappingRepository.class);
        ProductSkuRepository skus = mock(ProductSkuRepository.class);
        SecurityAuditRecorder audit = mock(SecurityAuditRecorder.class);
        SupplierSkuMappingService service = new SupplierSkuMappingService(
                suppliers, mappings, skus, audit);
        UUID tenantId = UUID.randomUUID();
        SupplierActor actor = new SupplierActor(
                tenantId, UUID.randomUUID(), null, "request-1", "127.0.0.1");
        Supplier supplier = supplier(tenantId);
        ReflectionTestUtils.setField(supplier, "id", UUID.randomUUID());
        ProductSku sku = new ProductSku(
                tenantId, UUID.randomUUID(), "SKU_ONE", "SKU One", null);
        sku.update("SKU One", null, ProductStatus.ACTIVE);
        ReflectionTestUtils.setField(sku, "id", UUID.randomUUID());
        when(suppliers.findForUpdateByIdAndTenantId(
                supplier.getId(), tenantId)).thenReturn(Optional.of(supplier));
        when(skus.findByIdAndTenantId(sku.getId(), tenantId))
                .thenReturn(Optional.of(sku));
        when(mappings.save(any())).thenAnswer(invocation -> {
            SupplierSkuMapping mapping = invocation.getArgument(0);
            ReflectionTestUtils.setField(mapping, "id", UUID.randomUUID());
            return mapping;
        });

        SupplierSkuMapping created = service.create(
                actor, supplier.getId(), new CreateMappingRequest(
                        sku.getId(), " FACTORY-01 ",
                        SupplierSkuMappingStatus.ACTIVE, true, 7,
                        new BigDecimal("12.5000"), " cny ", 10L))
                .mapping();

        assertThat(created.getSupplierSkuCode()).isEqualTo("FACTORY-01");
        assertThat(created.getUnitPrice()).isEqualByComparingTo("12.5000");
        assertThat(created.getCurrencyCode()).isEqualTo("CNY");
        assertThat(created.getMinimumOrderQuantity()).isEqualTo(10L);
        assertThat(created.isPreferred()).isTrue();
        verify(audit).recordAtomically(any());
    }

    @Test
    void listKeepsTenantScopedHistoricalMappingsReadable() {
        SupplierRepository suppliers = mock(SupplierRepository.class);
        SupplierSkuMappingRepository mappings =
                mock(SupplierSkuMappingRepository.class);
        SupplierSkuMappingService service =
                service(suppliers, mappings);
        UUID tenantId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(0, 25);
        when(suppliers.findByIdAndTenantId(supplierId, tenantId))
                .thenReturn(Optional.of(supplier(tenantId)));
        when(mappings.search(
                tenantId,
                supplierId,
                SupplierSkuMappingStatus.ACTIVE,
                true,
                "factory blue",
                pageable)).thenReturn(Page.empty(pageable));

        assertThat(service.list(
                tenantId,
                supplierId,
                SupplierSkuMappingStatus.ACTIVE,
                " Factory Blue ",
                pageable)).isEmpty();
        verify(mappings).search(
                tenantId,
                supplierId,
                SupplierSkuMappingStatus.ACTIVE,
                true,
                "factory blue",
                pageable);
    }

    @Test
    void listRejectsSuppliersOutsideTheTenant() {
        SupplierRepository suppliers = mock(SupplierRepository.class);
        SupplierSkuMappingRepository mappings =
                mock(SupplierSkuMappingRepository.class);
        SupplierSkuMappingService service =
                service(suppliers, mappings);
        UUID tenantId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        when(suppliers.findByIdAndTenantId(supplierId, tenantId))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.list(
                tenantId,
                supplierId,
                null,
                null,
                PageRequest.of(0, 25)))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void preferredSupplierFactsRemainBoundedAndTenantScoped() {
        SupplierRepository suppliers = mock(SupplierRepository.class);
        SupplierSkuMappingRepository mappings =
                mock(SupplierSkuMappingRepository.class);
        SupplierSkuMappingService service =
                service(suppliers, mappings);
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        PreferredSupplierSkuSummary summary =
                new PreferredSupplierSkuSummary(
                        skuId,
                        "FACTORY_BLUE",
                        UUID.randomUUID(),
                        "SUP_ONE",
                        "Supplier one");
        when(mappings.findPreferredByTenantIdAndSkuIdIn(
                tenantId, java.util.Set.of(skuId)))
                .thenReturn(List.of(summary));

        assertThat(service.listPreferredSuppliers(
                tenantId, List.of(skuId))).containsExactly(summary);
        verify(mappings).findPreferredByTenantIdAndSkuIdIn(
                tenantId, java.util.Set.of(skuId));

        assertThatThrownBy(() -> service.listPreferredSuppliers(
                tenantId, List.of(skuId, skuId)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.listPreferredSuppliers(
                null, List.of(skuId)))
                .isInstanceOf(IllegalArgumentException.class);
    }

    private static Supplier supplier(UUID tenantId) {
        return new Supplier(
                tenantId,
                "SUP_ONE",
                "Supplier one",
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null);
    }

    private static SupplierSkuMappingService service(
            SupplierRepository suppliers,
            SupplierSkuMappingRepository mappings) {
        return new SupplierSkuMappingService(
                suppliers,
                mappings,
                mock(ProductSkuRepository.class),
                mock(SecurityAuditRecorder.class));
    }
}
