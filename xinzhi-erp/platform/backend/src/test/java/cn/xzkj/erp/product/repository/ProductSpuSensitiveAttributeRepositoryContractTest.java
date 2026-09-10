package cn.xzkj.erp.product.repository;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.UUID;

import org.junit.jupiter.api.Test;

class ProductSpuSensitiveAttributeRepositoryContractTest {

    @Test
    void everyPublicDataOperationRequiresTenantScope() {
        assertThat(Arrays.stream(
                        ProductSpuSensitiveAttributeRepository.class
                                .getDeclaredMethods())
                .filter(method -> !method.isSynthetic())
                .filter(method -> java.lang.reflect.Modifier.isPublic(
                        method.getModifiers()))
                .toList())
                .allSatisfy(
                        ProductSpuSensitiveAttributeRepositoryContractTest::
                                assertTenantScoped);
    }

    private static void assertTenantScoped(Method method) {
        assertThat(method.getParameterTypes())
                .as(method.getName())
                .isNotEmpty()
                .startsWith(UUID.class);
        assertThat(method.getName()).contains("TenantId");
    }
}
