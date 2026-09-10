package cn.xzkj.erp.warehouse.documents;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.warehouse.documents.WarehouseDocumentService.WarehouseDocumentExport;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = WarehouseDocumentControllerTest.WebConfiguration.class)
class WarehouseDocumentControllerTest {
    private static final String PATH =
            "/api/v1/inventory-center/documents/exports";
    private static final String REQUEST = """
            {
              "direction": "INBOUND",
              "source": "INVENTORY_COUNT",
              "status": "POSTED",
              "searchField": "DOCUMENT_NO",
              "keyword": "IC-2026",
              "occurredFrom": "2026-08-01T00:00:00Z",
              "occurredTo": "2026-08-02T23:59:59Z"
            }
            """;

    @Autowired private WebApplicationContext context;
    @Autowired private WarehouseDocumentService service;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        reset(service);
        mockMvc = MockMvcBuilders.webAppContextSetup(context)
                .apply(springSecurity())
                .build();
    }

    @Test
    void requiresInventoryReadAndReturnsTheExportContract() throws Exception {
        when(service.exportCsv(
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any()))
                .thenReturn(new WarehouseDocumentExport(
                        "warehouse-documents-inbound.csv",
                        "text/csv;charset=utf-8",
                        1,
                        "\uFEFF单号,单据方向\r\nIC-1,入库\r\n"));

        mockMvc.perform(post(PATH)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REQUEST))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(post(PATH)
                        .with(authentication(auth("orders.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REQUEST))
                .andExpect(status().isForbidden());
        mockMvc.perform(post(PATH)
                        .with(authentication(auth("inventory.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(REQUEST))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("warehouse-documents-inbound.csv"))
                .andExpect(jsonPath("$.mediaType")
                        .value("text/csv;charset=utf-8"))
                .andExpect(jsonPath("$.rowCount").value(1))
                .andExpect(jsonPath("$.content")
                        .value("\uFEFF单号,单据方向\r\nIC-1,入库\r\n"));
        verify(service).exportCsv(
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any());
    }

    @Test
    void rejectsAnIncompleteExportRequestBeforeTheService() throws Exception {
        mockMvc.perform(post(PATH)
                        .with(authentication(auth("inventory.read")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"searchField\":\"DOCUMENT_NO\"}"))
                .andExpect(status().isBadRequest());
        verify(service, never()).exportCsv(
                any(), any(), any(), any(), any(), any(), any(), any(),
                any(), any());
    }

    private static TestingAuthenticationToken auth(String authority) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(), Instant.parse("2099-01-01T00:00:00Z"),
                        UUID.randomUUID(), "tenant", "Tenant", UUID.randomUUID(),
                        "tester", "Tester"),
                "not-used", authority);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    @EnableMethodSecurity
    static class WebConfiguration {
        @Bean
        WarehouseDocumentService service() {
            return mock(WarehouseDocumentService.class);
        }

        @Bean
        WarehouseDocumentController controller(WarehouseDocumentService service) {
            return new WarehouseDocumentController(service);
        }

        @Bean
        ApiExceptionHandler apiExceptionHandler() {
            return new ApiExceptionHandler();
        }

        @Bean
        SecurityFilterChain securityFilterChain(HttpSecurity http)
                throws Exception {
            return http.csrf(csrf -> csrf.disable())
                    .httpBasic(Customizer.withDefaults())
                    .authorizeHttpRequests(authorize -> authorize
                            .anyRequest().authenticated())
                    .exceptionHandling(exceptions -> exceptions
                            .authenticationEntryPoint((request, response, error) ->
                                    response.sendError(401)))
                    .build();
        }
    }
}
