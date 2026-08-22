package ai.xzkj.recruitment.organization;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record GroupUpdateRequest(
        @NotBlank(message = "请输入集团名称") @Size(max = 120, message = "集团名称不能超过 120 个字符") String name,
        @NotBlank(message = "请输入集团简称") @Size(max = 60, message = "集团简称不能超过 60 个字符") String shortName,
        @NotBlank(message = "请选择时区") @Size(max = 60, message = "时区不能超过 60 个字符") String timezone,
        @Size(max = 500, message = "集团说明不能超过 500 个字符") String description
) {
}
