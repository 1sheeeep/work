package ai.xzkj.recruitment.boss;

import ai.xzkj.recruitment.auth.*;
import ai.xzkj.recruitment.organization.*;
import org.junit.jupiter.api.Test;
import java.util.Set;
import static org.assertj.core.api.Assertions.*;

class BossAccountAccessTest {
    @Test void sameCompanyIsNotEnoughAndRevocationTakesEffectImmediately() {
        Company company = new Company(new GroupProfile("集团", "测试"), "公司", "C", null, null);
        BossAccount a = new BossAccount(company, "A", "a");
        BossAccount b = new BossAccount(company, "B", "b");
        SystemUser first = new SystemUser("甲", "hash", "甲", UserRole.RECRUITER);
        SystemUser second = new SystemUser("乙", "hash", "乙", UserRole.RECRUITER);
        first.assignCompanyScopes(Set.of(company)); second.assignCompanyScopes(Set.of(company));
        assertThat(BossAccountAccess.canAccess(a, first)).isFalse();
        a.assignRecruiters(Set.of(first.getId())); b.assignRecruiters(Set.of(second.getId()));
        assertThat(BossAccountAccess.canAccess(a, first)).isTrue();
        assertThat(BossAccountAccess.canAccess(a, second)).isFalse();
        assertThat(BossAccountAccess.canAccess(b, first)).isFalse();
        a.assignRecruiters(Set.of(second.getId()));
        assertThatThrownBy(() -> BossAccountAccess.requireAccess(a, first)).hasMessageContaining("无权");
        second.assignCompanyScopes(Set.of());
        assertThat(BossAccountAccess.canAccess(a, second)).isFalse();
        SystemUser admin = new SystemUser("admin", "hash", "admin", UserRole.RECRUITMENT_ADMIN);
        admin.assignCompanyScopes(Set.of(company));
        assertThat(BossAccountAccess.canAccess(b, admin)).isTrue();
    }
}
