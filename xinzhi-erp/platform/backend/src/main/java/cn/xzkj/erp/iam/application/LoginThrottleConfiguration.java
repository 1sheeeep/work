package cn.xzkj.erp.iam.application;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(LoginThrottleProperties.class)
public class LoginThrottleConfiguration {
}
