package cn.xzkj.erp.settings.address;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
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
import cn.xzkj.erp.settings.address.AddressMappingService.AddressType;
import cn.xzkj.erp.settings.address.AddressMappingService.MappingInput;
import cn.xzkj.erp.settings.address.AddressMappingService.Platform;

@ExtendWith(MockitoExtension.class)
class AddressMappingServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private static final UUID MAPPING_ID = UUID.randomUUID();
    @Mock private AddressMappingRepository repository;
    @Mock private SecurityAuditRecorder auditRecorder;
    private AddressMappingService service;

    @BeforeEach
    void setUp() {
        service = new AddressMappingService(repository, auditRecorder);
    }

    @Test
    void savesTenantSwitchWithOptimisticVersionAndAudit() {
        when(repository.findSetting(TENANT_ID)).thenReturn(
                setting(false, false, 0), setting(true, true, 0));

        AddressMappingSettingRecord saved = service.saveSetting(actor(), 0, true);

        assertThat(saved.enabled()).isTrue();
        verify(repository).insertSetting(TENANT_ID, true, actor());
        ArgumentCaptor<SecurityAuditEvent> audit =
                ArgumentCaptor.forClass(SecurityAuditEvent.class);
        verify(auditRecorder).recordAtomically(audit.capture());
        assertThat(audit.getValue().details())
                .containsEntry("previousEnabled", "false")
                .containsEntry("enabled", "true");
    }

    @Test
    void createsNormalizedMappingAndAuditsBusinessValues() {
        AddressMappingRecord stored = mapping("Tōkyō", "東京都", true, 0);
        when(repository.find(any(), any())).thenReturn(Optional.of(stored));
        ArgumentCaptor<MappingInput> input = ArgumentCaptor.forClass(MappingInput.class);
        ArgumentCaptor<String> sourceKey = ArgumentCaptor.forClass(String.class);

        AddressMappingRecord created = service.create(actor(), new MappingInput(
                Platform.SHOPIFY, " jp ", AddressType.PROVINCE,
                " Tōkyō ", " 東京都 ", true));

        assertThat(created.mappedValue()).isEqualTo("東京都");
        verify(repository).insert(any(), any(), input.capture(),
                sourceKey.capture(), any());
        assertThat(input.getValue().countryCode()).isEqualTo("JP");
        assertThat(input.getValue().sourceValue()).isEqualTo("Tōkyō");
        assertThat(sourceKey.getValue()).isEqualTo("tōkyō");
        verify(auditRecorder).recordAtomically(any());
    }

    @Test
    void resolvesCandidatesInOrderAndFailsOpenForInvalidConnectorCountry() {
        when(repository.resolve(TENANT_ID, Platform.SHOPIFY, "US",
                AddressType.PROVINCE, "new york"))
                .thenReturn(Optional.empty());
        when(repository.resolve(TENANT_ID, Platform.SHOPIFY, "US",
                AddressType.PROVINCE, "ny"))
                .thenReturn(Optional.of("New York State"));

        assertThat(service.resolveFirst(TENANT_ID, Platform.SHOPIFY, "us",
                AddressType.PROVINCE, List.of("New York", "NY"), "NY"))
                .isEqualTo("New York State");
        assertThat(service.resolveFirst(TENANT_ID, Platform.SHOPIFY, "USA",
                AddressType.PROVINCE, List.of("New York"), "NY"))
                .isEqualTo("NY");
        assertThat(service.resolveFirst(TENANT_ID, Platform.SHOPIFY, "US",
                AddressType.PROVINCE, List.of("x".repeat(121)), "NY"))
                .isEqualTo("NY");
    }

    @Test
    void rejectsInvalidFieldsBeforeWriting() {
        assertThatThrownBy(() -> service.create(actor(), new MappingInput(
                Platform.SHOPIFY, "JPN", AddressType.CITY,
                "Tokyo", "東京", true)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.create(actor(), new MappingInput(
                Platform.SHOPIFY, "JP", AddressType.CITY,
                " ", "東京", true)))
                .isInstanceOf(IllegalArgumentException.class);
        verify(repository, never()).insert(any(), any(), any(), any(), any());
    }

    private static AddressMappingService.Actor actor() {
        return new AddressMappingService.Actor(TENANT_ID, USER_ID, null,
                "UAT Operator", "request-1", "127.0.0.1");
    }

    private static AddressMappingSettingRecord setting(boolean configured,
            boolean enabled, long version) {
        Instant time = configured ? Instant.parse("2026-08-10T06:00:00Z") : null;
        return new AddressMappingSettingRecord(configured, enabled, version,
                configured ? "UAT Operator" : null, time, time);
    }

    private static AddressMappingRecord mapping(String source, String mapped,
            boolean enabled, long version) {
        Instant time = Instant.parse("2026-08-10T06:00:00Z");
        return new AddressMappingRecord(MAPPING_ID, Platform.SHOPIFY, "JP",
                AddressType.PROVINCE, source, mapped, enabled, version,
                "UAT Operator", time, time);
    }
}
