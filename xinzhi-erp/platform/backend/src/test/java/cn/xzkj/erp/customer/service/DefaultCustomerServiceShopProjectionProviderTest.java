package cn.xzkj.erp.customer.service;

import static org.assertj.core.api.Assertions.assertThat;
import cn.xzkj.erp.platform.domain.AuthorizationStatus;
import cn.xzkj.erp.platform.domain.ShopAuthorization;
import cn.xzkj.erp.platform.domain.TenantShop;
import cn.xzkj.erp.platform.repository.ShopAuthorizationRepository;
import cn.xzkj.erp.platform.repository.TenantShopRepository;
import java.lang.reflect.Field;
import java.lang.reflect.Proxy;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.PageImpl;

class DefaultCustomerServiceShopProjectionProviderTest {

    @Test
    void projectsOnlySafeShopFactsAndCredentialPresence() {
        UUID tenantId = UUID.fromString("10000000-0000-4000-8000-000000000001");
        UUID shopId = UUID.fromString("50000000-0000-4000-8000-000000000001");
        TenantShop shop = new TenantShop(
                tenantId,
                UUID.fromString("60000000-0000-4000-8000-000000000001"),
                "erp-store.myshopify.com",
                "ERP Store");
        setId(shop, shopId);
        ShopAuthorization authorization = new ShopAuthorization(tenantId, shopId);
        authorization.update(
                AuthorizationStatus.AUTHORIZED,
                "vault://never-expose-this-reference",
                null,
                null,
                null,
                null,
                null,
                null);
        TenantShopRepository shops = proxy(TenantShopRepository.class, (method, args) -> {
            if (method.equals("findAllByTenantIdAndStatusNotOrderByDisplayNameAscIdAsc")) {
                return new PageImpl<>(List.of(shop));
            }
            throw new UnsupportedOperationException(method);
        });
        ShopAuthorizationRepository authorizations = proxy(ShopAuthorizationRepository.class, (method, args) -> {
            if (method.equals("findAllByTenantIdAndShopIdIn")) {
                return List.of(authorization);
            }
            throw new UnsupportedOperationException(method);
        });

        var result = new DefaultCustomerServiceShopProjectionProvider(shops, authorizations)
                .shopsForTenant(tenantId);

        assertThat(result).containsExactly(new CustomerServiceShopProjectionProvider.ShopProjection(
                shopId,
                "ERP Store",
                "erp-store.myshopify.com",
                "ACTIVE",
                "AUTHORIZED",
                true,
                "XZ_ERP_APP"));
        assertThat(result.toString()).doesNotContain("vault://");
    }

    private static void setId(TenantShop shop, UUID shopId) {
        try {
            Field field = shop.getClass().getSuperclass().getDeclaredField("id");
            field.setAccessible(true);
            field.set(shop, shopId);
        } catch (ReflectiveOperationException exception) {
            throw new AssertionError(exception);
        }
    }

    @SuppressWarnings("unchecked")
    private static <T> T proxy(Class<T> type, TestInvocation invocation) {
        return (T) Proxy.newProxyInstance(
                type.getClassLoader(),
                new Class<?>[] {type},
                (instance, method, args) -> {
                    if (method.getDeclaringClass() == Object.class) {
                        return switch (method.getName()) {
                            case "toString" -> type.getSimpleName() + "TestProxy";
                            case "hashCode" -> System.identityHashCode(instance);
                            case "equals" -> instance == args[0];
                            default -> null;
                        };
                    }
                    return invocation.invoke(method.getName(), args == null ? new Object[0] : args);
                });
    }

    @FunctionalInterface
    private interface TestInvocation {
        Object invoke(String method, Object[] args);
    }
}
