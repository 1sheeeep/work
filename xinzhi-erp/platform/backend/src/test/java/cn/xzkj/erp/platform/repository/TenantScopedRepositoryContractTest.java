package cn.xzkj.erp.platform.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;

import cn.xzkj.erp.product.repository.ProductListingRepository;
import cn.xzkj.erp.product.repository.ProductSkuRepository;
import cn.xzkj.erp.product.repository.ProductSpuRepository;
import jakarta.persistence.LockModeType;

class TenantScopedRepositoryContractTest {

    @Test
    void repositoriesDoNotExposeUnscopedReadsOrDestructiveDeletes() {
        List<Class<?>> repositories = List.of(
                TenantShopRepository.class,
                ShopAuthorizationRepository.class,
                ShopSyncJobRepository.class,
                ProductSpuRepository.class,
                ProductSkuRepository.class,
                ProductListingRepository.class
        );

        for (Class<?> repository : repositories) {
            assertThat(repository.getMethods())
                    .extracting(Method::getName)
                    .doesNotContain("findById", "findAll", "delete", "deleteById", "deleteAll");
        }
    }

    @Test
    void systemPlatformCatalogAllowsGlobalReadsButNotDestructiveDeletes() {
        assertThat(PlatformCatalogRepository.class.getMethods())
                .extracting(Method::getName)
                .contains("findById")
                .doesNotContain("delete", "deleteById", "deleteAll");
    }

    @Test
    void filteredShopListKeepsTenantPredicatesForShopsAndAuthorizations() throws Exception {
        Method method = TenantShopRepository.class.getMethod(
                "findAllForTenantShopList",
                java.util.UUID.class,
                boolean.class,
                cn.xzkj.erp.platform.domain.ShopStatus.class,
                String.class,
                java.util.UUID.class,
                cn.xzkj.erp.platform.domain.ShopStatus.class,
                cn.xzkj.erp.platform.domain.AuthorizationStatus.class,
                org.springframework.data.domain.Pageable.class
        );
        String query = method.getAnnotation(Query.class).value();

        assertThat(query)
                .contains("shop.tenantId = :tenantId")
                .contains("authorization.tenantId = :tenantId")
                .contains("shop.platformId = :platformId")
                .contains("order by shop.displayName asc, shop.id asc");
    }

    @Test
    void parentWriteQueriesUseDatabaseLocksAndKeepTenantScope() throws Exception {
        Method platformLock = PlatformCatalogRepository.class.getMethod(
                "findForUpdateById",
                java.util.UUID.class
        );
        Method shopLock = TenantShopRepository.class.getMethod(
                "findForUpdateByIdAndTenantId",
                java.util.UUID.class,
                java.util.UUID.class
        );

        assertThat(platformLock.getAnnotation(Lock.class).value())
                .isEqualTo(LockModeType.PESSIMISTIC_WRITE);
        assertThat(platformLock.getAnnotation(Query.class).value())
                .contains("platform.id = :id");
        assertThat(shopLock.getAnnotation(Lock.class).value())
                .isEqualTo(LockModeType.PESSIMISTIC_WRITE);
        assertThat(shopLock.getAnnotation(Query.class).value())
                .contains("shop.id = :id")
                .contains("shop.tenantId = :tenantId");
    }
}
