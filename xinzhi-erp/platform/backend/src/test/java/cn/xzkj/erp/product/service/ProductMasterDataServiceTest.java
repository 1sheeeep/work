package cn.xzkj.erp.product.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;

import cn.xzkj.erp.iam.audit.SecurityAuditRecorder;
import cn.xzkj.erp.platform.service.ConflictException;
import cn.xzkj.erp.product.domain.ProductCategory;
import cn.xzkj.erp.product.domain.ProductMasterDataStatus;
import cn.xzkj.erp.product.domain.ProductPackageMaterial;
import cn.xzkj.erp.product.repository.ProductCategoryRepository;
import cn.xzkj.erp.product.repository.ProductPackageMaterialRepository;
import cn.xzkj.erp.product.repository.ProductSpuRepository;

class ProductMasterDataServiceTest {
    private ProductCategoryRepository categoryRepository;
    private ProductPackageMaterialRepository packageRepository;
    private ProductMasterDataService service;

    @BeforeEach
    void setUp() {
        categoryRepository = mock(ProductCategoryRepository.class);
        packageRepository = mock(ProductPackageMaterialRepository.class);
        service = new ProductMasterDataService(
                categoryRepository,
                packageRepository,
                mock(ProductSpuRepository.class),
                mock(SecurityAuditRecorder.class));
    }

    @Test
    void exportsTenantFilteredCategoriesWithSpreadsheetFormulaProtection() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageRequest = PageRequest.of(0, 10_001);
        ProductCategory category = mock(ProductCategory.class);
        when(category.getName()).thenReturn("=WEBSERVICE(\"bad\")");
        when(category.getSortOrder()).thenReturn(10);
        when(category.getStatus()).thenReturn(ProductMasterDataStatus.ACTIVE);
        when(category.getCreatedAt()).thenReturn(
                Instant.parse("2026-07-30T10:00:00Z"));
        when(category.getUpdatedAt()).thenReturn(
                Instant.parse("2026-07-30T10:05:00Z"));
        when(categoryRepository.search(
                tenantId,
                ProductMasterDataStatus.ACTIVE,
                true,
                "家居",
                pageRequest))
                .thenReturn(new PageImpl<>(List.of(category), pageRequest, 1));

        var result = service.exportCategoriesCsv(
                tenantId, ProductMasterDataStatus.ACTIVE, " 家居 ");

        assertThat(result.filename()).isEqualTo("product-categories.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=UTF-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF类目名称,排序,状态,创建时间,更新时间\r\n")
                .contains("\"'=WEBSERVICE(\"\"bad\"\")\",10,启用,");
        verify(categoryRepository).search(
                tenantId,
                ProductMasterDataStatus.ACTIVE,
                true,
                "家居",
                pageRequest);
    }

    @Test
    void rejectsCategoryExportsAboveTheBoundedRowLimit() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageRequest = PageRequest.of(0, 10_001);
        when(categoryRepository.search(
                tenantId, null, false, "", pageRequest))
                .thenReturn(new PageImpl<>(List.of(), pageRequest, 10_001));

        assertThatThrownBy(() -> service.exportCategoriesCsv(
                tenantId, null, null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("row limit");
    }

    @Test
    void exportsTenantFilteredPackageMaterialsWithCompleteOptionalColumns() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageRequest = PageRequest.of(0, 10_001);
        ProductPackageMaterial material = mock(ProductPackageMaterial.class);
        when(material.getName()).thenReturn("=纸箱,大号");
        when(material.getUnitPrice()).thenReturn(new BigDecimal("1.2500"));
        when(material.getCurrencyCode()).thenReturn("CNY");
        when(material.getWeightGrams()).thenReturn(500L);
        when(material.getPackageLevel()).thenReturn(2);
        when(material.getLengthMm()).thenReturn(300L);
        when(material.getWidthMm()).thenReturn(200L);
        when(material.getHeightMm()).thenReturn(150L);
        when(material.getStatus()).thenReturn(ProductMasterDataStatus.INACTIVE);
        when(material.getCreatedAt()).thenReturn(
                Instant.parse("2026-07-30T10:00:00Z"));
        when(material.getUpdatedAt()).thenReturn(
                Instant.parse("2026-07-30T10:05:00Z"));
        when(packageRepository.search(
                tenantId,
                ProductMasterDataStatus.INACTIVE,
                true,
                "cny",
                pageRequest))
                .thenReturn(new PageImpl<>(List.of(material), pageRequest, 1));

        var result = service.exportPackageMaterialsCsv(
                tenantId, ProductMasterDataStatus.INACTIVE, " CNY ");

        assertThat(result.filename())
                .isEqualTo("product-package-materials.csv");
        assertThat(result.mediaType()).isEqualTo("text/csv;charset=UTF-8");
        assertThat(result.rowCount()).isEqualTo(1);
        assertThat(result.content())
                .startsWith("\uFEFF包材名称,单价,币种,重量（克）,包材层级,"
                        + "长（毫米）,宽（毫米）,高（毫米）,状态,创建时间,更新时间\r\n")
                .contains("\"'=纸箱,大号\",1.2500,CNY,500,2,300,200,150,停用,");
        verify(packageRepository).search(
                tenantId,
                ProductMasterDataStatus.INACTIVE,
                true,
                "cny",
                pageRequest);
    }

    @Test
    void rejectsPackageMaterialExportsAboveTheBoundedRowLimit() {
        UUID tenantId = UUID.randomUUID();
        PageRequest pageRequest = PageRequest.of(0, 10_001);
        when(packageRepository.search(
                tenantId, null, false, "", pageRequest))
                .thenReturn(new PageImpl<>(List.of(), pageRequest, 10_001));

        assertThatThrownBy(() -> service.exportPackageMaterialsCsv(
                tenantId, null, null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("row limit");
    }

    @Test
    void rejectsPackageMaterialsWithPartialDimensions() {
        assertThatThrownBy(() -> service.createPackageMaterial(
                new ProductActor(
                        UUID.randomUUID(), UUID.randomUUID(), null,
                        "product-master-data-test", "127.0.0.1"),
                new ProductMasterDataService.PackageMaterialValues(
                        "测试纸箱", null, null, 120L, null,
                        300L, null, null)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("lengthMm, widthMm, and heightMm");
    }
}
