package cn.xzkj.erp.iam.domain;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class IamPermissionCodesTest {

    @Test
    void exposesExactAdministrationContractWithoutGrantingIt() {
        assertThat(IamPermissionCodes.all())
                .containsExactlyInAnyOrder(
                        "iam:user:read",
                        "iam:user:write",
                        "iam:role:read",
                        "iam:role:write",
                        "iam:permission:read",
                        "iam:permission:assign",
                        "iam:audit:read",
                        "iam:warehouse:scope:read",
                        "iam:warehouse:scope:write")
                .allSatisfy(code ->
                        assertThat(new PermissionCode(code).value()).isEqualTo(code));
    }
}
