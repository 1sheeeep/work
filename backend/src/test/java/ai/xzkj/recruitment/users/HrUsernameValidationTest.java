package ai.xzkj.recruitment.users;

import ai.xzkj.recruitment.auth.UserRole;
import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;
import java.util.Set;
import java.util.UUID;
import static org.assertj.core.api.Assertions.assertThat;

class HrUsernameValidationTest {
    @Test void acceptsChineseAndMixedNamesButRejectsSpacesAndPunctuation() {
        try (var factory = Validation.buildDefaultValidatorFactory()) {
            var validator = factory.getValidator();
            for (String name : new String[]{"张三", "招聘小李", "招聘HR_01", "hr-beijing.2"}) {
                assertThat(validator.validate(new HrUserCreateRequest(name, name, UserRole.RECRUITER,
                        "SecurePass123", Set.of(UUID.randomUUID())))).isEmpty();
            }
            for (String name : new String[]{"张 三", "张三@公司", "😀", ""}) {
                assertThat(validator.validate(new HrUserCreateRequest(name, "专员", UserRole.RECRUITER,
                        "SecurePass123", Set.of(UUID.randomUUID())))).isNotEmpty();
            }
        }
    }
}
