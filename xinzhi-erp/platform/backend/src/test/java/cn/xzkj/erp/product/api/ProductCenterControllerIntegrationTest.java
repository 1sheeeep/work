package cn.xzkj.erp.product.api;

import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.not;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.authentication;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;
import org.springframework.test.context.web.WebAppConfiguration;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

import cn.xzkj.erp.config.SecurityConfig;
import cn.xzkj.erp.iam.application.SessionTokenService;
import cn.xzkj.erp.iam.persistence.AuthSessionRepository;
import cn.xzkj.erp.iam.persistence.PermissionRepository;
import cn.xzkj.erp.iam.security.BearerTokenAuthenticationFilter;
import cn.xzkj.erp.iam.security.ErpPrincipal;
import cn.xzkj.erp.iam.security.TenantContextFilter;
import cn.xzkj.erp.platform.connector.ChannelConnectorGateway;
import cn.xzkj.erp.platform.api.ApiExceptionHandler;
import cn.xzkj.erp.platform.service.ResourceNotFoundException;
import cn.xzkj.erp.platform.service.ShopifyAuthorizationConflictException;
import cn.xzkj.erp.product.domain.ProductSensitiveAttributeCode;
import cn.xzkj.erp.product.domain.ProductStatus;
import cn.xzkj.erp.product.domain.ProductListing;
import cn.xzkj.erp.product.domain.ProductSku;
import cn.xzkj.erp.product.domain.ProductSpu;
import cn.xzkj.erp.product.domain.ProductSpuImage;
import cn.xzkj.erp.product.service.ProductCenterService;
import cn.xzkj.erp.product.service.ProductImageService;
import cn.xzkj.erp.product.service.ProductShopifyCatalogImportService;
import cn.xzkj.erp.product.service.ProductShopifyCatalogPreviewService;
import cn.xzkj.erp.product.service.ProductSpuBusinessCodeConflictException;
import cn.xzkj.erp.product.service.SkuListingSummary;
import cn.xzkj.erp.product.storage.ProductImageStorageUnavailableException;
import cn.xzkj.erp.product.service.ProductCenterService.ListingSearchField;
import cn.xzkj.erp.product.service.ProductCenterService.SkuSummary;
import cn.xzkj.erp.product.service.ProductCenterService.ListingWithSku;
import cn.xzkj.erp.product.service.ProductCenterService.SpuWithSummary;

@SpringJUnitConfig
@WebAppConfiguration
@ContextConfiguration(classes = {SecurityConfig.class, ProductCenterControllerIntegrationTest.WebConfiguration.class})
class ProductCenterControllerIntegrationTest {
    @Autowired private WebApplicationContext webApplicationContext;
    @Autowired private ProductCenterService service;
    @Autowired private ProductImageService imageService;
    @Autowired private ProductShopifyCatalogImportService shopifyCatalogImportService;
    @Autowired private ProductShopifyCatalogPreviewService shopifyCatalogPreviewService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        SecurityContextHolder.clearContext();
        reset(service);
        reset(imageService);
        reset(shopifyCatalogImportService);
        reset(shopifyCatalogPreviewService);
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext).apply(springSecurity()).build();
    }

    @Test
    void securityFilterChainRejectsUnauthenticatedProductReads() throws Exception {
        mockMvc.perform(get("/api/v1/product-center/spus")).andExpect(status().isUnauthorized());
        verify(service, never()).listSpus(
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void methodSecurityRequiresProductAuthority() throws Exception {
        mockMvc.perform(get("/api/v1/product-center/spus")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "shop:read"))))
                .andExpect(status().isForbidden());
        verify(service, never()).listSpus(
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void supplierBackedSkuSearchRequiresSupplierReadAuthority()
            throws Exception {
        UUID tenantId = UUID.randomUUID();

        for (String searchField :
                List.of("DEFAULT_SUPPLIER", "ORIGINAL_SKU")) {
            mockMvc.perform(get("/api/v1/product-center/skus")
                            .param("searchField", searchField)
                            .param("keyword", "private supplier value")
                            .with(authentication(tenantAuthentication(
                                    tenantId, "products.read"))))
                    .andExpect(status().isForbidden());
        }

        verifyNoInteractions(service);

        when(service.listSkusWithMasterIdentity(
                eq(tenantId), isNull(), isNull(), eq("factory"),
                isNull(), isNull(), isNull(), isNull(), isNull(), isNull(),
                isNull(), isNull(),
                eq("ORIGINAL_SKU"), eq("CONTAINS"),
                eq("BUSINESS_CODE"), eq(false),
                eq(PageRequest.of(0, 50))))
                .thenReturn(Page.empty(PageRequest.of(0, 50)));

        mockMvc.perform(get("/api/v1/product-center/skus")
                        .param("searchField", "ORIGINAL_SKU")
                        .param("keyword", "factory")
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.read",
                                "suppliers.read"))))
                .andExpect(status().isOk());
    }

    @Test
    void forgedTenantHeaderCannotReadAnotherTenantsSpu() throws Exception {
        UUID authenticatedTenant = UUID.randomUUID();
        UUID forgedTenant = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        when(service.getSpu(authenticatedTenant, spuId))
                .thenThrow(new ResourceNotFoundException("credential://tenant/private-token"));

        mockMvc.perform(get("/api/v1/product-center/spus/{spuId}", spuId)
                        .header("X-Tenant-Id", forgedTenant)
                        .with(authentication(tenantAuthentication(authenticatedTenant, "products.read"))))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.message").value("Requested resource was not found"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-token"))));
        verify(service).getSpu(authenticatedTenant, spuId);
        verify(service, never()).getSpu(forgedTenant, spuId);
    }

    @Test
    void inventorySkuSearchFieldIsForwardedFromAuthenticatedRequest()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID imageId = UUID.randomUUID();
        UUID categoryId = UUID.randomUUID();
        UUID developerId = UUID.randomUUID();
        UUID developerAssistantId = UUID.randomUUID();
        UUID salesMemberId = UUID.randomUUID();
        UUID artMemberId = UUID.randomUUID();
        UUID creatorId = UUID.randomUUID();
        Instant createdFrom = Instant.parse("2026-06-30T16:00:00Z");
        Instant createdTo = Instant.parse("2026-07-31T16:00:00Z");
        UUID packageMaterialId = UUID.randomUUID();
        ProductSpu master = new ProductSpu(
                tenantId, "MASTER_WIDGET", "Widget master", null, null);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "id", spuId);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "brandName", "Example brand");
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "categoryId", categoryId);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "categoryNameSnapshot", "服装");
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "developerMemberId", developerId);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "developerMemberNameSnapshot", "开发员");
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "actualWeightGrams", 320L);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "lengthMm", 300L);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "widthMm", 200L);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "heightMm", 40L);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "packageMaterialId", packageMaterialId);
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "packageMaterialNameSnapshot", "纸箱");
        org.springframework.test.util.ReflectionTestUtils.setField(
                master, "packageableCount", 2);
        ProductSku sku = new ProductSku(
                tenantId, spuId, "SKU_WIDGET", "Widget", null);
        org.springframework.test.util.ReflectionTestUtils.setField(
                sku, "id", skuId);
        ProductSpuImage image = new ProductSpuImage(
                tenantId,
                spuId,
                new ProductSpuImage.StoredImage(
                        "a".repeat(32) + ".png",
                        "image/png",
                        ".png",
                        1,
                        "b".repeat(64),
                        1,
                        1),
                0,
                true,
                "TENANT_USER",
                UUID.randomUUID());
        org.springframework.test.util.ReflectionTestUtils.setField(
                image, "id", imageId);
        when(service.listSkusWithMasterIdentity(
                eq(tenantId),
                isNull(),
                isNull(),
                eq("Widget"),
                eq(categoryId),
                eq(developerId),
                eq(developerAssistantId),
                eq(salesMemberId),
                eq(artMemberId),
                eq(creatorId),
                eq(createdFrom),
                eq(createdTo),
                eq("NAME_EN"),
                eq("STARTS_WITH"),
                eq("CREATED_AT"),
                eq(true),
                eq(PageRequest.of(0, 25))))
                .thenReturn(new PageImpl<>(
                        List.of(new ProductCenterService.SkuWithMasterIdentity(
                                sku, master, image, "创建用户")),
                        PageRequest.of(0, 25),
                        1));

        mockMvc.perform(get("/api/v1/product-center/skus")
                        .param("keyword", "Widget")
                        .param("categoryId", categoryId.toString())
                        .param("developerMemberId", developerId.toString())
                        .param("developerAssistantMemberId",
                                developerAssistantId.toString())
                        .param("salesMemberId", salesMemberId.toString())
                        .param("artMemberId", artMemberId.toString())
                        .param("creatorId", creatorId.toString())
                        .param("createdFrom", createdFrom.toString())
                        .param("createdTo", createdTo.toString())
                        .param("searchField", "NAME_EN")
                        .param("matchMode", "STARTS_WITH")
                        .param("sortBy", "CREATED_AT")
                        .param("descending", "true")
                        .param("size", "25")
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.items[0].id")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].masterSku.id")
                        .value(spuId.toString()))
                .andExpect(jsonPath("$.items[0].masterSku.businessCode")
                        .value("MASTER_WIDGET"))
                .andExpect(jsonPath("$.items[0].masterSku.name")
                        .value("Widget master"))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.thumbnailImageId")
                        .value(imageId.toString()))
                .andExpect(jsonPath("$.items[0].masterSku.brandName")
                        .value("Example brand"))
                .andExpect(jsonPath("$.items[0].masterSku.category.id")
                        .value(categoryId.toString()))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.category.displayName")
                        .value("服装"))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.developerMember.id")
                        .value(developerId.toString()))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.developerMember.displayName")
                        .value("开发员"))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.actualWeightGrams")
                        .value(320))
                .andExpect(jsonPath("$.items[0].masterSku.lengthMm")
                        .value(300))
                .andExpect(jsonPath("$.items[0].masterSku.widthMm")
                        .value(200))
                .andExpect(jsonPath("$.items[0].masterSku.heightMm")
                        .value(40))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.packageMaterial.id")
                        .value(packageMaterialId.toString()))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.packageMaterial.displayName")
                        .value("纸箱"))
                .andExpect(jsonPath(
                        "$.items[0].masterSku.packageableCount")
                        .value(2))
                .andExpect(jsonPath("$.items[0].creatorName")
                        .value("创建用户"));

        verify(service).listSkusWithMasterIdentity(
                tenantId,
                null,
                null,
                "Widget",
                categoryId,
                developerId,
                developerAssistantId,
                salesMemberId,
                artMemberId,
                creatorId,
                createdFrom,
                createdTo,
                "NAME_EN",
                "STARTS_WITH",
                "CREATED_AT",
                true,
                PageRequest.of(0, 25));
    }

    @Test
    void validatesRequestsAndDoesNotEchoMetadataNote() throws Exception {
        mockMvc.perform(post("/api/v1/product-center/listings")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "products.listing.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"shopId":null,"skuId":null,"externalListingRef":"","metadataNote":"Bearer secret-token"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.details.shopId").value("invalid"))
                .andExpect(jsonPath("$.details.skuId").value("invalid"))
                .andExpect(jsonPath("$.details.externalListingRef").value("invalid"))
                .andExpect(content().string(not(containsString("secret-token"))));
        verify(service, never()).createListing(any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void mapsV43SpuFoundationFieldsWithoutBreakingLegacyName()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(
                tenantId,
                "SPU_FOUNDATION",
                "中文名称",
                "English name",
                null,
                "Independent note",
                null, null, null, null, null, 5000,
                null, null, null,
                null, null, null, null,
                null, null, null, null, null);
        UUID spuId = UUID.randomUUID();
        org.springframework.test.util.ReflectionTestUtils.setField(
                spu,
                "id",
                spuId);
        when(service.createSpuWithInitialSkus(
                any(),
                eq("SPU_FOUNDATION"),
                argThat(values -> values.nameZh().equals("中文名称")
                        && values.nameEn().equals("English name")
                        && values.productNote().equals("Independent note")),
                eq(List.of(
                        ProductSensitiveAttributeCode.BATTERY,
                        ProductSensitiveAttributeCode.FLAMMABLE)),
                eq(List.of())))
                .thenReturn(new SpuWithSummary(
                        spu,
                        SkuSummary.EMPTY,
                        List.of(
                                ProductSensitiveAttributeCode.BATTERY,
                                ProductSensitiveAttributeCode.FLAMMABLE)));

        mockMvc.perform(post("/api/v1/product-center/spus")
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "businessCode":"SPU_FOUNDATION",
                                  "nameZh":"中文名称",
                                  "nameEn":"English name",
                                  "productNote":"Independent note",
                                  "sensitiveAttributeCodes":[
                                    "BATTERY",
                                    "FLAMMABLE"
                                  ]
                                }
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(spuId.toString()))
                .andExpect(jsonPath("$.name").value("中文名称"))
                .andExpect(jsonPath("$.nameZh").value("中文名称"))
                .andExpect(jsonPath("$.nameEn").value("English name"))
                .andExpect(jsonPath("$.productNote")
                        .value("Independent note"))
                .andExpect(jsonPath("$.sensitiveAttributeCodes[0]")
                        .value("BATTERY"))
                .andExpect(jsonPath("$.sensitiveAttributeCodes[1]")
                        .value("FLAMMABLE"));
    }

    @Test
    void createsNewSpuAndDirectImagesInOneAuthenticatedRequest()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(tenantId, "SPU_IMAGE", "图片商品",
                null, null);
        org.springframework.test.util.ReflectionTestUtils.setField(spu, "id", spuId);
        when(service.createSpuWithInitialSkus(
                any(), eq("SPU_IMAGE"), any(), isNull(), eq(List.of())))
                .thenReturn(new SpuWithSummary(spu, SkuSummary.EMPTY, List.of()));
        MockMultipartFile request = new MockMultipartFile("request", "",
                MediaType.APPLICATION_JSON_VALUE,
                "{\"businessCode\":\"SPU_IMAGE\",\"nameZh\":\"图片商品\"}".getBytes());
        MockMultipartFile image = new MockMultipartFile("images", "product.png",
                MediaType.IMAGE_PNG_VALUE, new byte[] {1, 2, 3});

        mockMvc.perform(multipart("/api/v1/product-center/spus/with-images")
                        .file(request).file(image)
                        .with(authentication(tenantAuthentication(tenantId, "products.write"))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(spuId.toString()));

        verify(imageService).upload(argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(spuId), any(), eq("product.png"), eq(MediaType.IMAGE_PNG_VALUE),
                eq(0), eq(true));
    }

    @Test
    void identifiesDuplicateMasterCodesWithoutMisclassifyingOtherConflicts()
            throws Exception {
        when(service.createSpuWithInitialSkus(
                any(), eq("SPU_DUPLICATE"), any(), isNull(), eq(List.of())))
                .thenThrow(new ProductSpuBusinessCodeConflictException());
        MockMultipartFile request = new MockMultipartFile("request", "",
                MediaType.APPLICATION_JSON_VALUE,
                "{\"businessCode\":\"SPU_DUPLICATE\",\"nameZh\":\"重复商品\"}".getBytes());
        MockMultipartFile image = new MockMultipartFile("images", "product.png",
                MediaType.IMAGE_PNG_VALUE, new byte[] {1, 2, 3});

        mockMvc.perform(multipart("/api/v1/product-center/spus/with-images")
                        .file(request).file(image)
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(), "products.write"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("spu_business_code_conflict"));
    }

    @Test
    void reportsUnavailableImageStorageAsServiceUnavailable()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID spuId = UUID.randomUUID();
        ProductSpu spu = new ProductSpu(
                tenantId, "SPU_STORAGE", "图片商品", null, null);
        org.springframework.test.util.ReflectionTestUtils.setField(
                spu, "id", spuId);
        when(service.createSpuWithInitialSkus(
                any(), eq("SPU_STORAGE"), any(), isNull(), eq(List.of())))
                .thenReturn(new SpuWithSummary(
                        spu, SkuSummary.EMPTY, List.of()));
        when(imageService.upload(any(), eq(spuId), any(),
                eq("product.png"), eq(MediaType.IMAGE_PNG_VALUE),
                eq(0), eq(true)))
                .thenThrow(new ProductImageStorageUnavailableException(
                        "private storage path"));
        MockMultipartFile request = new MockMultipartFile("request", "",
                MediaType.APPLICATION_JSON_VALUE,
                "{\"businessCode\":\"SPU_STORAGE\",\"nameZh\":\"图片商品\"}".getBytes());
        MockMultipartFile image = new MockMultipartFile("images", "product.png",
                MediaType.IMAGE_PNG_VALUE, new byte[] {1, 2, 3});

        mockMvc.perform(multipart("/api/v1/product-center/spus/with-images")
                        .file(request).file(image)
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.write"))))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code")
                        .value("product_image_storage_unavailable"))
                .andExpect(jsonPath("$.message")
                        .value("Product image storage is temporarily unavailable"))
                .andExpect(content().string(not(containsString(
                        "private storage path"))));
    }

    @Test
    void rejectsDirectImageCreateWithoutAnImageBeforeCreatingTheSpu()
            throws Exception {
        MockMultipartFile request = new MockMultipartFile("request", "",
                MediaType.APPLICATION_JSON_VALUE,
                "{\"businessCode\":\"SPU_NO_IMAGE\",\"nameZh\":\"缺少图片\"}".getBytes());

        mockMvc.perform(multipart("/api/v1/product-center/spus/with-images")
                        .file(request)
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(), "products.write"))))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").value("The request is invalid"));

        verify(service, never()).createSpuWithInitialSkus(any(), any(), any(), any(), any());
    }

    @Test
    void rejectsUnknownSensitiveAttributeCodeBeforeService()
            throws Exception {
        mockMvc.perform(post("/api/v1/product-center/spus")
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(),
                                "products.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "businessCode":"SPU_UNKNOWN_CODE",
                                  "name":"Legacy name",
                                  "sensitiveAttributeCodes":["UNKNOWN"]
                                }
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(
                        containsString("credential://"))));
        verify(service, never()).createSpuWithInitialSkus(any(), any(), any(), any(), any());
    }

    @Test
    void crossTenantListingShopUsesTheSafeNotFoundEnvelope() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        when(service.createListing(
                any(),
                eq(shopId),
                eq(skuId),
                eq("listing-1"),
                isNull(),
                isNull(),
                isNull()
        )).thenThrow(new ResourceNotFoundException(
                "Shop was not found: credential://tenant/private-token"));

        mockMvc.perform(post("/api/v1/product-center/listings")
                        .with(authentication(tenantAuthentication(
                                tenantId, "products.listing.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "shopId":"%s",
                                  "skuId":"%s",
                                  "externalListingRef":"listing-1"
                                }
                                """.formatted(shopId, skuId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("resource_not_found"))
                .andExpect(jsonPath("$.message").value(
                        "Requested resource was not found"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-token"))));

        verify(service).createListing(
                argThat(actor -> tenantId.equals(actor.tenantId())),
                eq(shopId),
                eq(skuId),
                eq("listing-1"),
                isNull(),
                isNull(),
                isNull());
    }

    @Test
    void rejectsMalformedProductJsonWithSafeProtocol() throws Exception {
        mockMvc.perform(post("/api/v1/product-center/spus")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "products.write")))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"businessCode\":"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("invalid_request"))
                .andExpect(jsonPath("$.message").value("Request body is invalid"))
                .andExpect(jsonPath("$.details").isEmpty());
        verify(service, never()).createSpuWithInitialSkus(any(), any(), any(), any(), any());
    }

    @Test
    void returnsStableDefaultPaginationForSpus() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(service.listSpus(eq(tenantId), eq(null), eq(null), eq("ALL"), eq(null), eq(null), eq(null), eq(null), eq(null), eq("BUSINESS_CODE"), eq(false), any())).thenReturn(Page.empty(PageRequest.of(0, 50)));
        mockMvc.perform(get("/api/v1/product-center/spus")
                        .with(authentication(tenantAuthentication(tenantId, "products.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(50))
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    void authenticatedInternalFailureReturnsSafe500InsteadOf401() throws Exception {
        UUID tenantId = UUID.randomUUID();
        when(service.listSpus(eq(tenantId), eq(null), eq(null), eq("ALL"), eq(null), eq(null), eq(null), eq(null), eq(null), eq("BUSINESS_CODE"), eq(false), any()))
                .thenThrow(new RuntimeException("jdbc:postgresql://private-host/internal-secret"));

        mockMvc.perform(get("/api/v1/product-center/spus")
                        .with(authentication(tenantAuthentication(tenantId, "products.read"))))
                .andExpect(status().isInternalServerError())
                .andExpect(jsonPath("$.code").value("internal_error"))
                .andExpect(jsonPath("$.message").value("An internal error occurred"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("private-host"))))
                .andExpect(content().string(not(containsString("internal-secret"))));
    }

    @Test
    void rejectsMissingListingVersionWithValidationProtocol() throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID listingId = UUID.randomUUID();

        mockMvc.perform(put("/api/v1/product-center/listings/{listingId}", listingId)
                        .with(authentication(tenantAuthentication(tenantId, "products.listing.write")))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"status\":\"ACTIVE\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.details.version").value("invalid"));
        verify(service, never()).updateListing(any(), any(), anyLong(), any(), any(), any());
    }

    @Test
    void rejectsInvalidPageAndSizeWithSafeValidationProtocol() throws Exception {
        UUID tenantId = UUID.randomUUID();

        mockMvc.perform(get("/api/v1/product-center/spus")
                        .param("page", "-1")
                        .with(authentication(tenantAuthentication(tenantId, "products.read"))))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.message").value("Request validation failed"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("-1"))));
        verify(service, never()).listSpus(
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());

        mockMvc.perform(get("/api/v1/product-center/spus")
                        .param("size", "201")
                        .with(authentication(tenantAuthentication(tenantId, "products.read"))))
                .andExpect(status().isBadRequest())
                .andExpect(content().contentTypeCompatibleWith(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.code").value("validation_failed"))
                .andExpect(jsonPath("$.details").isEmpty())
                .andExpect(content().string(not(containsString("201"))));
        verify(service, never()).listSpus(
                any(), any(), any(), any(), any(), any(),
                any(), any(), any(), any(), anyBoolean(), any());
    }

    @Test
    void listingEndpointsRequireTheirOwnAuthority() throws Exception {
        mockMvc.perform(get("/api/v1/product-center/listings")
                        .with(authentication(tenantAuthentication(UUID.randomUUID(), "products.read"))))
                .andExpect(status().isForbidden());
        verify(service, never()).listListingsWithSku(
                any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void listingListReturnsTenantResolvedSkuBusinessIdentity()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID listingId = UUID.randomUUID();
        ProductSku sku = new ProductSku(
                tenantId,
                UUID.randomUUID(),
                "SKU_LOCAL_001",
                "本地库存商品",
                null);
        org.springframework.test.util.ReflectionTestUtils.setField(
                sku,
                "id",
                skuId);
        ProductListing listing = new ProductListing(
                tenantId,
                UUID.randomUUID(),
                UUID.randomUUID(),
                skuId,
                "listing-1",
                "variant-1",
                "online",
                null);
        org.springframework.test.util.ReflectionTestUtils.setField(
                listing,
                "id",
                listingId);
        when(service.listListingsWithSku(
                eq(tenantId),
                isNull(),
                isNull(),
                isNull(),
                isNull(),
                eq(ListingSearchField.ALL),
                eq(PageRequest.of(0, 50))))
                .thenReturn(new PageImpl<>(
                        List.of(new ListingWithSku(listing, sku)),
                        PageRequest.of(0, 50),
                        1));

        mockMvc.perform(get("/api/v1/product-center/listings")
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].sku.id")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].sku.businessCode")
                        .value("SKU_LOCAL_001"))
                .andExpect(jsonPath("$.items[0].sku.name")
                        .value("本地库存商品"));
    }

    @Test
    void listingListRejectsUnknownSearchFieldBeforeCallingService()
            throws Exception {
        mockMvc.perform(get("/api/v1/product-center/listings")
                        .param("searchField", "UNKNOWN")
                        .with(authentication(tenantAuthentication(
                                UUID.randomUUID(),
                                "products.listing.read"))))
                .andExpect(status().isBadRequest());
        verify(service, never()).listListingsWithSku(
                any(), any(), any(), any(), any(), any(), any());
    }

    @Test
    void shopifyCatalogPreviewRequiresListingReadAuthorityAndForwardsRequest()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        Instant fetchedAt = Instant.parse("2026-07-31T06:00:00Z");
        when(shopifyCatalogPreviewService.preview(
                eq(tenantId),
                eq(shopId),
                eq(25),
                isNull(),
                eq("status:active")))
                .thenReturn(new ProductShopifyCatalogPreviewService.ShopifyCatalogPreview(
                        ChannelConnectorGateway.ConnectorMode.XZ_ERP_APP,
                        ChannelConnectorGateway.ConnectionStatus.CONNECTED,
                        "cursor-next",
                        true,
                        fetchedAt,
                        List.of(new ProductShopifyCatalogPreviewService.ShopifyCatalogProductPreview(
                                "gid://shopify/Product/1",
                                "HD Sunglasses",
                                "hd-sunglasses",
                                "ACTIVE",
                                "2026-07-31T05:59:00Z",
                                List.of(new ProductShopifyCatalogPreviewService.ShopifyCatalogVariantPreview(
                                        "gid://shopify/ProductVariant/10",
                                        "gid://shopify/InventoryItem/20",
                                        "HD-B-M",
                                        "Black / M",
                                        "19.99",
                                        "USD",
                                        true,
                                        true,
                                        ProductShopifyCatalogPreviewService.ShopifyCatalogMatchStatus.EXACT_SKU_MATCH,
                                        new ProductShopifyCatalogPreviewService.LocalSkuMatch(
                                                skuId,
                                                "HD-B-M",
                                                "HD Sunglasses Black M",
                                                ProductStatus.ACTIVE)))))));

        mockMvc.perform(get("/api/v1/product-center/listings/shopify/catalog-preview")
                        .param("shopId", shopId.toString())
                        .param("limit", "25")
                        .param("query", "status:active")
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.mode").value("XZ_ERP_APP"))
                .andExpect(jsonPath("$.connectionStatus").value("CONNECTED"))
                .andExpect(jsonPath("$.cursor").value("cursor-next"))
                .andExpect(jsonPath("$.hasNextPage").value(true))
                .andExpect(jsonPath("$.products[0].externalListingRef")
                        .value("gid://shopify/Product/1"))
                .andExpect(jsonPath("$.products[0].variants[0].platformSku")
                        .value("HD-B-M"))
                .andExpect(jsonPath("$.products[0].variants[0].matchStatus")
                        .value("EXACT_SKU_MATCH"))
                .andExpect(jsonPath("$.products[0].variants[0].localSku.id")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.products[0].variants[0].localSku.businessCode")
                        .value("HD-B-M"));

        verify(shopifyCatalogPreviewService).preview(
                tenantId,
                shopId,
                25,
                null,
                "status:active");

        mockMvc.perform(get("/api/v1/product-center/listings/shopify/catalog-preview")
                        .param("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.read"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void shopifyCatalogPreviewReturnsMachineReadableAuthorizationConflict()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopifyCatalogPreviewService.preview(
                eq(tenantId),
                eq(shopId),
                eq(50),
                isNull(),
                isNull()))
                .thenThrow(ShopifyAuthorizationConflictException.missingScope(
                        "read_products"));

        mockMvc.perform(get("/api/v1/product-center/listings/shopify/catalog-preview")
                        .param("shopId", shopId.toString())
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.read"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("shopify_authorization_conflict"))
                .andExpect(jsonPath("$.message")
                        .value("Shopify authorization must be connected and include the required scope"))
                .andExpect(jsonPath("$.details.reason")
                        .value("shopify_scope_missing"))
                .andExpect(jsonPath("$.details.scope")
                        .value("read_products"));
    }

    @Test
    void shopifyCatalogImportRequiresListingWriteAuthorityAndForwardsActor()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        UUID skuId = UUID.randomUUID();
        UUID listingId = UUID.randomUUID();
        when(shopifyCatalogImportService.importSelectedListings(
                argThat(actor -> actor != null
                        && tenantId.equals(actor.tenantId())
                        && actor.userId() != null),
                eq(shopId),
                eq(25),
                isNull(),
                eq("status:active"),
                eq(List.of("gid://shopify/ProductVariant/10"))))
                .thenReturn(new ProductShopifyCatalogImportService.ShopifyCatalogImportResult(
                        1,
                        1,
                        0,
                        List.of(new ProductShopifyCatalogImportService.ShopifyCatalogImportItemResult(
                                "gid://shopify/Product/1",
                                "gid://shopify/ProductVariant/10",
                                "HD-B-M",
                                skuId,
                                listingId,
                                ProductShopifyCatalogImportService.ShopifyCatalogImportStatus.IMPORTED_OR_ALREADY_BOUND,
                                null))));

        mockMvc.perform(post("/api/v1/product-center/listings/shopify/catalog-import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "shopId":"%s",
                                  "limit":25,
                                  "query":"status:active",
                                  "externalVariantRefs":["gid://shopify/ProductVariant/10"]
                                }
                                """.formatted(shopId))
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.write"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.requestedCount").value(1))
                .andExpect(jsonPath("$.importedCount").value(1))
                .andExpect(jsonPath("$.skippedCount").value(0))
                .andExpect(jsonPath("$.items[0].externalListingRef")
                        .value("gid://shopify/Product/1"))
                .andExpect(jsonPath("$.items[0].externalVariantRef")
                        .value("gid://shopify/ProductVariant/10"))
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(skuId.toString()))
                .andExpect(jsonPath("$.items[0].listingId")
                        .value(listingId.toString()))
                .andExpect(jsonPath("$.items[0].status")
                        .value("IMPORTED_OR_ALREADY_BOUND"));

        mockMvc.perform(post("/api/v1/product-center/listings/shopify/catalog-import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "shopId":"%s",
                                  "externalVariantRefs":["gid://shopify/ProductVariant/10"]
                                }
                                """.formatted(shopId))
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.read"))))
                .andExpect(status().isForbidden());
    }

    @Test
    void shopifyCatalogImportReturnsMachineReadableAuthorizationConflict()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID shopId = UUID.randomUUID();
        when(shopifyCatalogImportService.importSelectedListings(
                any(),
                eq(shopId),
                eq(50),
                isNull(),
                isNull(),
                eq(List.of("gid://shopify/ProductVariant/10"))))
                .thenThrow(ShopifyAuthorizationConflictException.missingScope(
                        "read_products"));

        mockMvc.perform(post("/api/v1/product-center/listings/shopify/catalog-import")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "shopId":"%s",
                                  "externalVariantRefs":["gid://shopify/ProductVariant/10"]
                                }
                                """.formatted(shopId))
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.write"))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code")
                        .value("shopify_authorization_conflict"))
                .andExpect(jsonPath("$.details.reason")
                        .value("shopify_scope_missing"))
                .andExpect(jsonPath("$.details.scope")
                        .value("read_products"));
    }

    @Test
    void listingSummaryUsesAuthenticatedTenantAndListingReadAuthority()
            throws Exception {
        UUID tenantId = UUID.randomUUID();
        UUID firstSkuId = UUID.randomUUID();
        UUID secondSkuId = UUID.randomUUID();
        when(service.listSkuListingSummaries(
                tenantId, List.of(firstSkuId, secondSkuId)))
                .thenReturn(List.of(new SkuListingSummary(firstSkuId, 2)));

        mockMvc.perform(get("/api/v1/product-center/skus/listing-summaries")
                        .param("skuId", firstSkuId.toString())
                        .param("skuId", secondSkuId.toString())
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.listing.read"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].skuId")
                        .value(firstSkuId.toString()))
                .andExpect(jsonPath("$.items[0].activeListingCount")
                        .value(2))
                .andExpect(content().string(not(containsString("shopId"))))
                .andExpect(content().string(not(containsString("platformId"))));
        verify(service).listSkuListingSummaries(
                tenantId, List.of(firstSkuId, secondSkuId));

        mockMvc.perform(get("/api/v1/product-center/skus/listing-summaries")
                        .param("skuId", firstSkuId.toString())
                        .with(authentication(tenantAuthentication(
                                tenantId,
                                "products.read"))))
                .andExpect(status().isForbidden());
    }

    private static TestingAuthenticationToken tenantAuthentication(
            UUID tenantId,
            String... authorities) {
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
                authorities);
    }

    @Configuration
    @EnableWebMvc
    @EnableWebSecurity
    static class WebConfiguration {
        @Bean ProductCenterService productCenterService() { return mock(ProductCenterService.class); }
        @Bean ProductImageService productImageService() { return mock(ProductImageService.class); }
        @Bean ProductShopifyCatalogImportService productShopifyCatalogImportService() {
            return mock(ProductShopifyCatalogImportService.class);
        }
        @Bean ProductShopifyCatalogPreviewService productShopifyCatalogPreviewService() {
            return mock(ProductShopifyCatalogPreviewService.class);
        }
        @Bean ProductCenterController productCenterController(
                ProductCenterService service,
                ProductImageService imageService,
                ProductShopifyCatalogImportService shopifyCatalogImportService,
                ProductShopifyCatalogPreviewService shopifyCatalogPreviewService) {
            return new ProductCenterController(
                    service,
                    imageService,
                    shopifyCatalogImportService,
                    shopifyCatalogPreviewService);
        }
        @Bean ApiExceptionHandler apiExceptionHandler() { return new ApiExceptionHandler(); }
        @Bean AuthSessionRepository authSessionRepository() { return mock(AuthSessionRepository.class); }
        @Bean PermissionRepository permissionRepository() { return mock(PermissionRepository.class); }
        @Bean SessionTokenService sessionTokenService() { return mock(SessionTokenService.class); }
        @Bean
        BearerTokenAuthenticationFilter bearerTokenAuthenticationFilter(
                AuthSessionRepository sessionRepository,
                PermissionRepository permissionRepository,
                SessionTokenService tokenService,
                java.time.Clock clock) {
            return new BearerTokenAuthenticationFilter(
                    sessionRepository,
                    permissionRepository,
                    tokenService,
                    clock);
        }
        @Bean TenantContextFilter tenantContextFilter() { return new TenantContextFilter(); }
    }
}
