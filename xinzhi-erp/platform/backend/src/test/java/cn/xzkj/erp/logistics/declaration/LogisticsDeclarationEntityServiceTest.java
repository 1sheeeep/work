package cn.xzkj.erp.logistics.declaration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;

@ExtendWith(MockitoExtension.class)
class LogisticsDeclarationEntityServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID ENTITY_ID = UUID.randomUUID();
    private static final UUID SHOP_ID = UUID.randomUUID();
    @Mock private LogisticsDeclarationEntityRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private LogisticsDeclarationEntityService service;

    @BeforeEach
    void setUp() {
        service = new LogisticsDeclarationEntityService(repository, auditRecorder);
    }

    @Test
    void createsNormalizedEntityWithoutAuditingEnterpriseCodeOrShopIds() {
        when(repository.countBindableShops(TENANT_ID, Set.of(SHOP_ID)))
                .thenReturn(1L);
        when(repository.find(eq(TENANT_ID), any())).thenAnswer(invocation ->
                record(invocation.getArgument(1), "ACTIVE", 0));

        LogisticsDeclarationEntityRecord created = service.create(actor(), input());

        ArgumentCaptor<LogisticsDeclarationEntityService.EntityInput> value =
                ArgumentCaptor.forClass(
                        LogisticsDeclarationEntityService.EntityInput.class);
        verify(repository).insert(eq(created.id()), eq(TENANT_ID), value.capture(),
                eq(USER_ID), eq(null), eq("request-1"));
        assertThat(value.getValue().name()).isEqualTo("新知生产销售企业");
        assertThat(value.getValue().enterpriseCode()).isEqualTo("CN-91310000ABC");
        assertThat(value.getValue().shopIds()).containsExactly(SHOP_ID);
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details()).containsOnlyKeys("bindingCount");
        assertThat(audit.getValue().details().toString())
                .doesNotContain("CN-91310000ABC", SHOP_ID.toString());
    }

    @Test
    void rejectsUnknownOrArchivedShopBeforeWriting() {
        when(repository.countBindableShops(TENANT_ID, Set.of(SHOP_ID)))
                .thenReturn(0L);
        assertThatThrownBy(() -> service.create(actor(), input()))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).insert(any(), any(), any(), any(), any(), any());
    }

    @Test
    void rejectsMalformedEnterpriseCodeBeforeShopLookup() {
        var invalid = new LogisticsDeclarationEntityService.EntityInput(
                "企业", "<script>", Set.of());
        assertThatThrownBy(() -> service.create(actor(), invalid))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).countBindableShops(any(), any());
    }

    @Test
    void updateUsesExpectedVersionAndFailsClosedOnConflict() {
        when(repository.find(TENANT_ID, ENTITY_ID))
                .thenReturn(record(ENTITY_ID, "ACTIVE", 3));
        when(repository.countBindableShops(TENANT_ID, Set.of(SHOP_ID)))
                .thenReturn(1L);
        when(repository.update(eq(ENTITY_ID), eq(TENANT_ID), eq(3L), any(),
                eq(USER_ID), eq(null), eq("request-1"))).thenReturn(false);

        assertThatThrownBy(() -> service.update(actor(), ENTITY_ID, 3, input()))
                .isInstanceOf(ConflictException.class);
        verify(auditRecorder, never()).recordAtomically(any());
    }

    @Test
    void archivesOnlyAnActiveExpectedVersion() {
        when(repository.find(TENANT_ID, ENTITY_ID)).thenReturn(
                record(ENTITY_ID, "ACTIVE", 2),
                record(ENTITY_ID, "ARCHIVED", 3));
        when(repository.archive(TENANT_ID, ENTITY_ID, 2, USER_ID, null,
                "request-1")).thenReturn(true);

        assertThat(service.archive(actor(), ENTITY_ID, 2).status())
                .isEqualTo("ARCHIVED");
        verify(auditRecorder).recordAtomically(any());
    }

    private static LogisticsDeclarationEntityService.Actor actor() {
        return new LogisticsDeclarationEntityService.Actor(
                TENANT_ID, USER_ID, null, "request-1", "127.0.0.1");
    }

    private static LogisticsDeclarationEntityService.EntityInput input() {
        return new LogisticsDeclarationEntityService.EntityInput(
                " 新知生产销售企业 ", " cn-91310000abc ", Set.of(SHOP_ID));
    }

    private static LogisticsDeclarationEntityRecord record(
            UUID id, String status, long version) {
        Instant time = Instant.parse("2026-08-07T00:00:00Z");
        return new LogisticsDeclarationEntityRecord(
                id, "新知生产销售企业", "CN-91310000ABC", List.of(
                        new LogisticsDeclarationEntityRecord.ShopBinding(
                                SHOP_ID, "Shop A", "ACTIVE", "SHOPIFY", "Shopify")),
                status, version, time, time);
    }
}
