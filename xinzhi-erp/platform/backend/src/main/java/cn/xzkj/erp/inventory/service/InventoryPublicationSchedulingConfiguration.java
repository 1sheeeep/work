package cn.xzkj.erp.inventory.service;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableScheduling
@ConditionalOnProperty(
        name = "erp.inventory-publication.worker-enabled",
        havingValue = "true")
public class InventoryPublicationSchedulingConfiguration {
}
