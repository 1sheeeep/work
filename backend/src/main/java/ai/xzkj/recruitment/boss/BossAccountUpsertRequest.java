package ai.xzkj.recruitment.boss;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record BossAccountUpsertRequest(
        @NotNull(message = "请选择归属企业") UUID companyId,
        @NotBlank(message = "请输入账号名称") @Size(max = 100, message = "账号名称不能超过 100 个字符") String displayName,
        @NotBlank(message = "请输入外部标识") @Size(max = 120, message = "外部标识不能超过 120 个字符") String externalIdentifier,
        MockBossProfile mockProfile,
        @NotNull(message = "请选择账号连接方式") BossGatewayType gatewayType
) {
    public BossAccountUpsertRequest(UUID companyId,String displayName,String externalIdentifier,MockBossProfile mockProfile){this(companyId,displayName,externalIdentifier,mockProfile,BossGatewayType.MOCK);}
}
