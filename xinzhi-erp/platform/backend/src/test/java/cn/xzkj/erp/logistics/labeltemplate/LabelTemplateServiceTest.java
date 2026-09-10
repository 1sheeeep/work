package cn.xzkj.erp.logistics.labeltemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageRequest;

class LabelTemplateServiceTest {
    private static final UUID TENANT_ID = UUID.randomUUID();
    private static final UUID USER_ID = UUID.randomUUID();
    private LabelTemplateRepository repository;
    private SecurityAuditRecorder audits;
    private LabelTemplateService service;

    @BeforeEach
    void setUp() {
        repository = mock(LabelTemplateRepository.class);
        audits = mock(SecurityAuditRecorder.class);
        service = new LabelTemplateService(repository, audits);
    }

    @Test
    void listsFilteredBuiltInTemplates() {
        var page = service.list(
                actor(), "STANDARD", " 地址 ", "100×100 mm", " 通用 ",
                PageRequest.of(0, 25));

        assertThat(page.getContent()).extracting(LabelTemplateRecord::name)
                .containsExactly("通用地址标签");
    }

    @Test
    void createsNormalizedCustomTemplateAndAudits() {
        when(repository.find(eq(TENANT_ID), any()))
                .thenAnswer(invocation -> record(invocation.getArgument(1)));

        LabelTemplateRecord created = service.create(
                actor(), new LabelTemplateService.TemplateInput(
                        " UAT 地址标签 ", " 地址标签 ", 100, 100,
                        " 收件人：{{recipient}} ", " UAT 验证 "));

        assertThat(created.name()).isEqualTo("UAT 地址标签");
        verify(repository).insert(any(), eq(TENANT_ID),
                eq(new LabelTemplateService.TemplateInput(
                        "UAT 地址标签", "地址标签", 100, 100,
                        "收件人：{{recipient}}", "UAT 验证")), eq(actor()));
        verify(audits).recordAtomically(any());
    }

    @Test
    void rejectsUnsupportedDimensions() {
        assertThatThrownBy(() -> service.create(
                actor(), new LabelTemplateService.TemplateInput(
                        "Bad", "地址标签", 10, 100, "text", null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("dimensions");
    }

    private static LabelTemplateService.Actor actor() {
        return new LabelTemplateService.Actor(
                TENANT_ID, USER_ID, null, "UAT Operator",
                "label-template-uat", "127.0.0.1");
    }

    private static LabelTemplateRecord record(UUID id) {
        Instant time = Instant.parse("2026-08-10T00:00:00Z");
        return new LabelTemplateRecord(
                id, "CUSTOM", "UAT 地址标签", "地址标签", 100, 100,
                "收件人：{{recipient}}", "UAT 验证", "ACTIVE",
                "UAT Operator", 0, time, time);
    }
}
