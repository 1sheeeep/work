package cn.xzkj.erp.iam.bootstrap;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

public class InitialAdminBootstrapRunner implements ApplicationRunner {

    private final InitialAdminBootstrapProperties properties;
    private final InitialAdminBootstrapService service;

    public InitialAdminBootstrapRunner(
            InitialAdminBootstrapProperties properties,
            InitialAdminBootstrapService service) {
        this.properties = properties;
        this.service = service;
    }

    @Override
    public void run(ApplicationArguments arguments) {
        service.provision(properties.toCommand());
    }
}
