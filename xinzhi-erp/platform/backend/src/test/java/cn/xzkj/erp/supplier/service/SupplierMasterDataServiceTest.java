package cn.xzkj.erp.supplier.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.ArgumentMatchers.any;

import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;

import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.supplier.domain.Supplier;
import cn.xzkj.erp.supplier.domain.SupplierStatus;
import cn.xzkj.erp.supplier.repository.SupplierRepository;
import cn.xzkj.erp.supplier.api.SupplierDtos.CreateSupplierRequest;

class SupplierMasterDataServiceTest {

    @Test
    void createNormalizesSettlementAndPersistsCoreMasterData() {
        SupplierRepository repository = mock(SupplierRepository.class);
        SecurityAuditRecorder audit = mock(SecurityAuditRecorder.class);
        SupplierMasterDataService service =
                new SupplierMasterDataService(repository, audit);
        SupplierActor actor = new SupplierActor(
                UUID.randomUUID(), UUID.randomUUID(), null,
                "request-1", "127.0.0.1");
        when(repository.save(any())).thenAnswer(invocation -> {
            Supplier supplier = invocation.getArgument(0);
            ReflectionTestUtils.setField(supplier, "id", UUID.randomUUID());
            return supplier;
        });

        Supplier created = service.create(actor, new CreateSupplierRequest(
                " sup_north ", " North Supplier ", " Alice ", " 123 ",
                " ALICE@EXAMPLE.COM ", " Shanghai ", " TAX-01 ",
                " cny ", 30, " preferred "));

        assertThat(created.getBusinessCode()).isEqualTo("SUP_NORTH");
        assertThat(created.getContactEmail()).isEqualTo("alice@example.com");
        assertThat(created.getSettlementCurrency()).isEqualTo("CNY");
        assertThat(created.getPaymentTermsDays()).isEqualTo(30);
        verify(repository).save(created);
        verify(audit).recordAtomically(any());
    }

    @Test
    void listScopesTenantAndNormalizesSearchWithoutWriting() {
        SupplierRepository repository = mock(SupplierRepository.class);
        SupplierMasterDataService service =
                new SupplierMasterDataService(
                        repository, mock(SecurityAuditRecorder.class));
        UUID tenantId = UUID.randomUUID();
        PageRequest pageable = PageRequest.of(1, 25);
        when(repository.searchByTenantId(
                tenantId,
                SupplierStatus.ACTIVE,
                true,
                "north",
                pageable)).thenReturn(Page.empty(pageable));

        Page<Supplier> result = service.list(
                tenantId,
                SupplierStatus.ACTIVE,
                "  NoRtH  ",
                pageable);

        assertThat(result).isEmpty();
        verify(repository).searchByTenantId(
                tenantId,
                SupplierStatus.ACTIVE,
                true,
                "north",
                pageable);
    }

    @Test
    void getIsTenantScopedAndMissingSuppliersStayHidden() {
        SupplierRepository repository = mock(SupplierRepository.class);
        SupplierMasterDataService service =
                new SupplierMasterDataService(
                        repository, mock(SecurityAuditRecorder.class));
        UUID tenantId = UUID.randomUUID();
        UUID supplierId = UUID.randomUUID();
        Supplier supplier = new Supplier(
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
        when(repository.findByIdAndTenantId(supplierId, tenantId))
                .thenReturn(Optional.of(supplier));

        assertThat(service.get(tenantId, supplierId)).isSameAs(supplier);

        UUID missingId = UUID.randomUUID();
        when(repository.findByIdAndTenantId(missingId, tenantId))
                .thenReturn(Optional.empty());
        assertThatThrownBy(() -> service.get(tenantId, missingId))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void tenantIdentityRemainsRequiredForReads() {
        SupplierMasterDataService service = new SupplierMasterDataService(
                mock(SupplierRepository.class),
                mock(SecurityAuditRecorder.class));

        assertThatThrownBy(() -> service.list(
                null, null, null, PageRequest.of(0, 25)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.get(null, UUID.randomUUID()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
