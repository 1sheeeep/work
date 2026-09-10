package cn.xzkj.erp.product.api;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.iam.application.IamAdministrationService;
import cn.xzkj.erp.iam.application.IamAdministrationService.MemberView;
import cn.xzkj.erp.iam.application.PageResult;
import cn.xzkj.erp.iam.domain.AccountStatus;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.service.ProductMasterDataService;
import cn.xzkj.erp.product.service.ProductMasterDataService.ProductCategoryExport;
import cn.xzkj.erp.product.service.ProductMasterDataService.ProductPackageMaterialExport;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {
        SecurityConfig.class,
        ProductCenterControllerIntegrationTest.WebConfiguration.class,
        ProductMasterDataControllerIntegrationTest.WebConfiguration.class
})
class ProductMasterDataControllerIntegrationTest {
    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private IamAdministrationService iamAdministrationService;
    @Autowired private ProductMasterDataService productMasterDataService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(iamAdministrationService, productMasterDataService);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity())
                .build();
    }

    @Test
    void assignableMembersRequireProductMasterDataReadAuthority() throws Exception {
        mockMvc.perform(get("/api/v1/product-center/master-data/assignable-members")
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(), "iam:user:read"))))
                .andExpect(status().isForbidden());
        verify(iamAdministrationService, never()).listMembers(
                any(), any(), any(), any(), any(Integer.class), any(Integer.class));
    }

    @Test
    void assignableMembersExposeOnlyTheMinimalActiveProductProjection()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID memberId = UUID.randomUUID();
        when(iamAdministrationService.listMembers(
                eq(tenantId), eq(null), eq(AccountStatus.ACTIVE), eq(null), eq(0), eq(100)))
                .thenReturn(PageResult.of(List.of(new MemberView(
                        memberId,
                        "member@example.com",
                        "member@example.com",
                        "+8613800000000",
                        "商品开发员",
                        AccountStatus.ACTIVE,
                        3,
                        Instant.parse("2026-07-30T10:00:00Z"),
                        Instant.parse("2026-07-30T10:00:00Z"))), 0, 100, 1));

        mockMvc.perform(get("/api/v1/product-center/master-data/assignable-members")
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.master_data.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].id").value(memberId.toString()))
                .andExpect(jsonPath("$.items[0].displayName").value("商品开发员"))
                .andExpect(jsonPath("$.items[0].email").doesNotExist())
                .andExpect(jsonPath("$.items[0].phoneNumber").doesNotExist())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void categoryExportRequiresProductMasterDataReadAuthority() throws Exception {
        mockMvc.perform(post("/api/v1/product-center/master-data/categories/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(), "products.master_data.write"))))
                .andExpect(status().isForbidden());
        verify(productMasterDataService, never()).exportCategoriesCsv(
                any(), any(), any());
    }

    @Test
    void categoryExportUsesTenantAndValidatedFilters() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(productMasterDataService.exportCategoriesCsv(
                tenantId, ProductMasterDataStatus.ACTIVE, "家居"))
                .thenReturn(new ProductCategoryExport(
                        "product-categories.csv",
                        "text/csv;charset=UTF-8",
                        1,
                        "\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n家居,10,启用,2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n"));

        mockMvc.perform(post("/api/v1/product-center/master-data/categories/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\",\"query\":\"家居\"}")
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.master_data.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename").value("product-categories.csv"))
                .andExpect(jsonPath("$.mediaType").value("text/csv;charset=UTF-8"))
                .andExpect(jsonPath("$.rowCount").value(1))
                .andExpect(jsonPath("$.content").value(org.hamcrest.Matchers.startsWith(
                        "\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n")));
        verify(productMasterDataService).exportCategoriesCsv(
                tenantId, ProductMasterDataStatus.ACTIVE, "家居");
    }

    @Test
    void packageMaterialExportUsesTenantAndValidatedFilters() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(productMasterDataService.exportPackageMaterialsCsv(
                tenantId, ProductMasterDataStatus.INACTIVE, "CNY"))
                .thenReturn(new ProductPackageMaterialExport(
                        "product-package-materials.csv",
                        "text/csv;charset=UTF-8",
                        1,
                        "\uFEFF包材名称,单价,币种,重量（克）,包材层级,长（毫米）,"
                                + "宽（毫米）,高（毫米）,状态,创建时间,更新时间\r\n"
                                + "纸箱,1.2500,CNY,500,2,300,200,150,停用,"
                                + "2026-07-30T10:00:00Z,2026-07-30T10:00:00Z\r\n"));

        mockMvc.perform(post(
                        "/api/v1/product-center/master-data/package-materials/exports")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"INACTIVE\",\"query\":\"CNY\"}")
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.master_data.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.filename")
                        .value("product-package-materials.csv"))
                .andExpect(jsonPath("$.mediaType")
                        .value("text/csv;charset=UTF-8"))
                .andExpect(jsonPath("$.rowCount").value(1))
                .andExpect(jsonPath("$.content").value(
                        org.hamcrest.Matchers.startsWith(
                                "\uFEFF包材名称,单价,币种,重量（克）,包材层级,")));
        verify(productMasterDataService).exportPackageMaterialsCsv(
                tenantId, ProductMasterDataStatus.INACTIVE, "CNY");
    }

    private static TestingAuthenticationToken tenantAuthentication(
            UUID tenantId,
            String authority) {
        return new TestingAuthenticationToken(
                new ErpPrincipal(
                        UUID.randomUUID(),
                        Instant.parse("2099-01-01T00:00:00Z"),
                        tenantId,
                        "test",
                        "Test Tenant",
                        UUID.randomUUID(),
                        "tester",
                        "Tester"),
                "not-used",
                authority);
    }

    @Configuration
    static class WebConfiguration {
        @Bean ProductMasterDataService productMasterDataService() {
            return mock(ProductMasterDataService.class);
        }

        @Bean IamAdministrationService iamAdministrationService() {
            return mock(IamAdministrationService.class);
        }

        @Bean ProductMasterDataController productMasterDataController(
                ProductMasterDataService productMasterDataService,
                IamAdministrationService iamAdministrationService) {
            return new ProductMasterDataController(
                    productMasterDataService, iamAdministrationService);
        }
    }
}
