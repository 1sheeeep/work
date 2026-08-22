package ai.xzkj.recruitment.config;

import ai.xzkj.recruitment.auth.SystemUser;
import ai.xzkj.recruitment.auth.SystemUserRepository;
import ai.xzkj.recruitment.auth.UserRole;
import ai.xzkj.recruitment.organization.GroupProfile;
import ai.xzkj.recruitment.organization.GroupProfileRepository;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;

@Component
public class BootstrapDataInitializer implements ApplicationRunner {
    private final SystemUserRepository userRepository;
    private final GroupProfileRepository groupRepository;
    private final PasswordEncoder passwordEncoder;
    private final BootstrapProperties properties;

    public BootstrapDataInitializer(
            SystemUserRepository userRepository,
            GroupProfileRepository groupRepository,
            PasswordEncoder passwordEncoder,
            BootstrapProperties properties
    ) {
        this.userRepository = userRepository;
        this.groupRepository = groupRepository;
        this.passwordEncoder = passwordEncoder;
        this.properties = properties;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (userRepository.count() == 0) {
            String username = require(properties.adminUsername(), "APP_BOOTSTRAP_ADMIN_USERNAME").toLowerCase(Locale.ROOT);
            String password = require(properties.adminPassword(), "APP_BOOTSTRAP_ADMIN_PASSWORD");
            if (password.length() < 12) {
                throw new IllegalStateException("APP_BOOTSTRAP_ADMIN_PASSWORD 至少需要 12 个字符");
            }
            userRepository.save(new SystemUser(
                    username,
                    passwordEncoder.encode(password),
                    "系统管理员",
                    UserRole.SYSTEM_ADMIN
            ));
        }

        if (groupRepository.count() == 0) {
            groupRepository.save(new GroupProfile(
                    require(properties.groupName(), "APP_BOOTSTRAP_GROUP_NAME"),
                    require(properties.groupShortName(), "APP_BOOTSTRAP_GROUP_SHORT_NAME")
            ));
        }
    }

    private String require(String value, String environmentName) {
        if (value == null || value.isBlank()) {
            throw new IllegalStateException(environmentName + " 未配置，无法初始化空数据库");
        }
        return value.trim();
    }
}
