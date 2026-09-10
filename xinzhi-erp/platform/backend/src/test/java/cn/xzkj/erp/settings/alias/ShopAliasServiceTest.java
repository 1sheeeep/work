package cn.xzkj.erp.settings.alias;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import cn.xzkj.erp.iam.audit.SecurityAuditEvent;
import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;

@ExtendWith(MockitoExtension.class)
class ShopAliasServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID SHOP_ID = UUID.randomUUID();
    @Mock private ShopAliasRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private ShopAliasService service;

    @BeforeEach
    void setUp() {
        service = new ShopAliasService(repository, auditRecorder);
    }

    @Test
    void normalizesAndSavesAllLanguageAliasesWithAudit() {
        when(repository.find(TENANT_ID, SHOP_ID)).thenReturn(
                Optional.of(record(false, 0, null, null)),
                Optional.of(record(true, 0, "Test Shop", "测试店铺")));
        ArgumentCaptor<ShopAliasService.AliasInput> input =
                ArgumentCaptor.forClass(ShopAliasService.AliasInput.class);

        ShopAliasRecord saved = service.save(actor(), SHOP_ID, 0,
                new ShopAliasService.AliasInput(" Test Shop ", " 测试店铺 ",
                        null, null, null, null, null, null, null));

        assertThat(saved.aliasZhCn()).isEqualTo("测试店铺");
        verify(repository).insert(any(), any(), input.capture(), any());
        assertThat(input.getValue().aliasEn()).isEqualTo("Test Shop");
        assertThat(input.getValue().aliasZhCn()).isEqualTo("测试店铺");
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("configuredLanguages", "2")
                .containsEntry("shopDisplayName", "Canonical Shop");
    }

    @Test
    void resolvesOnlyTheRequestedInterfaceLanguageAndFallsBackByOmission() {
        when(repository.findAliases(TENANT_ID, List.of(SHOP_ID))).thenReturn(Map.of(
                SHOP_ID, new ShopAliasRepository.AliasNames("Test Shop", "测试店铺")));

        assertThat(service.localizedName(TENANT_ID, SHOP_ID, "zh-CN"))
                .isEqualTo("测试店铺");
        assertThat(service.localizedName(TENANT_ID, SHOP_ID, "en-US,en;q=0.9"))
                .isEqualTo("Test Shop");
        assertThat(service.localizedName(TENANT_ID, SHOP_ID, "fr"))
                .isNull();
    }

    @Test
    void rejectsControlCharactersBeforeWriting() {
        assertThatThrownBy(() -> service.save(actor(), SHOP_ID, 0,
                new ShopAliasService.AliasInput("bad\nname", null, null, null,
                        null, null, null, null, null)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).insert(any(), any(), any(), any());
    }

    private static ShopAliasService.Actor actor() {
        return new ShopAliasService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "request-1", "127.0.0.1");
    }

    private static ShopAliasRecord record(boolean configured, long version,
            String english, String chinese) {
        return new ShopAliasRecord(SHOP_ID, "Canonical Shop", "SHOPIFY",
                english, chinese, null, null, null, null, null, null, null,
                configured, version, configured ? "UAT Operator" : null,
                configured ? Instant.parse("2026-08-10T07:00:00Z") : null);
    }
}
