package cn.xzkj.erp.iam.roles;

import static org.assertj.core.api.Assertions.assertThat;

import cn.xzkj.erp.iam.bootstrap.TenantAdminPermissionCodes;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

class PresetRoleCatalogTest {

    @Test
    void definesSixDepartmentsWithSpecialistAndManagerRoles() {
        assertThat(PresetRoleCatalog.DEFINITIONS)
                .hasSize(12)
                .extracting(PresetRoleCatalog.Definition::code)
                .doesNotHaveDuplicates()
                .containsExactly(
                        "customer_service_agent",
                        "customer_service_manager",
                        "procurement_specialist",
                        "procurement_manager",
                        "warehouse_operator",
                        "warehouse_manager",
                        "finance_specialist",
                        "finance_manager",
                        "business_specialist",
                        "business_manager",
                        "operations_specialist",
                        "operations_manager");
        assertThat(PresetRoleCatalog.DEFINITIONS)
                .extracting(PresetRoleCatalog.Definition::name)
                .containsExactly(
                        "客服专员", "客服主管",
                        "采购专员", "采购主管",
                        "仓库专员", "仓库主管",
                        "财务专员", "财务主管",
                        "商务专员", "商务主管",
                        "运营专员", "运营主管");
    }

    @Test
    void eachManagerIncludesItsDepartmentSpecialistPermissions() {
        Map<String, PresetRoleCatalog.Definition> definitions =
                PresetRoleCatalog.DEFINITIONS.stream()
                        .collect(Collectors.toMap(
                                PresetRoleCatalog.Definition::code,
                                Function.identity()));

        assertManagerContainsSpecialist(
                definitions, "customer_service_manager", "customer_service_agent");
        assertManagerContainsSpecialist(
                definitions, "procurement_manager", "procurement_specialist");
        assertManagerContainsSpecialist(
                definitions, "warehouse_manager", "warehouse_operator");
        assertManagerContainsSpecialist(
                definitions, "finance_manager", "finance_specialist");
        assertManagerContainsSpecialist(
                definitions, "business_manager", "business_specialist");
        assertManagerContainsSpecialist(
                definitions, "operations_manager", "operations_specialist");
    }

    @Test
    void presetsUseOnlyReviewedPermissionsAndDoNotGrantIamAdministration() {
        assertThat(TenantAdminPermissionCodes.EXACT_CODES)
                .containsAll(PresetRoleCatalog.permissionCodes());
        assertThat(PresetRoleCatalog.permissionCodes())
                .noneMatch(code -> code.startsWith("iam:"));
        assertThat(PresetRoleCatalog.permissionCodes())
                .doesNotContain(
                        "shop:authorization:write",
                        "inventory.shopify.publish",
                        "orders.shopify_edit.write");
        assertThat(definition("finance_specialist").permissionCodes())
                .containsExactly("finance.read");
        assertThat(definition("finance_manager").permissionCodes())
                .containsExactly("finance.read", "analytics.read");
    }

    private static void assertManagerContainsSpecialist(
            Map<String, PresetRoleCatalog.Definition> definitions,
            String manager,
            String specialist) {
        assertThat(definitions.get(manager).permissionCodes())
                .containsAll(definitions.get(specialist).permissionCodes());
    }

    private static PresetRoleCatalog.Definition definition(String code) {
        return PresetRoleCatalog.DEFINITIONS.stream()
                .filter(definition -> definition.code().equals(code))
                .findFirst()
                .orElseThrow();
    }
}
