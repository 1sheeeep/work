package cn.xzkj.erp.tenantaccess;

import cn.xzkj.erp.iam.persistence.PermissionEntity;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class TenantApplicationCatalog {

    public static final String AVAILABLE = "AVAILABLE";
    public static final String PENDING_INTEGRATION = "PENDING_INTEGRATION";

    private static final List<ApplicationDefinition> APPLICATIONS = List.of(
            new ApplicationDefinition(
                    "ERP",
                    "Xinzhi ERP",
                    "店铺、商品、订单、采购、仓库、物流与经营分析。",
                    AVAILABLE,
                    List.of(
                            module("CHANNELS", "店铺与渠道"),
                            module("PRODUCTS", "商品"),
                            module("ORDERS", "订单"),
                            module("PROCUREMENT", "采购"),
                            module("WAREHOUSE", "仓库"),
                            module("LOGISTICS", "物流"),
                            module("ANALYTICS", "报表"))),
            new ApplicationDefinition(
                    "CHAT",
                    "Xinzhi Chat",
                    "客户会话、工单与客服团队协作。",
                    AVAILABLE,
                    List.of(
                            module("WORKSPACE", "客服工作台"),
                            module("CONVERSATIONS", "会话协作"),
                            module("TICKETS", "工单管理"))),
            new ApplicationDefinition(
                    "ZHAOYAOJING",
                    "照妖镜",
                    "广告账户、广告活动与投放分析。",
                    AVAILABLE,
                    List.of(
                            module("AD_ACCOUNTS", "广告账户"),
                            module("CAMPAIGNS", "广告活动"),
                            module("REPORTING", "投放报表"))),
            new ApplicationDefinition(
                    "ASSET_REGISTRY",
                    "资产登记",
                    "资产台账、盘点与统计。",
                    AVAILABLE,
                    List.of(
                            module("ASSETS", "资产台账"),
                            module("INVENTORY", "资产盘点"),
                            module("REPORTING", "资产报表"))));

    private static final Map<String, ApplicationDefinition> BY_CODE;

    static {
        Map<String, ApplicationDefinition> applications = new LinkedHashMap<>();
        for (ApplicationDefinition application : APPLICATIONS) {
            applications.put(application.code(), application);
        }
        BY_CODE = Map.copyOf(applications);
    }

    private TenantApplicationCatalog() {
    }

    public static List<ApplicationDefinition> applications() {
        return APPLICATIONS;
    }

    public static ApplicationDefinition application(String code) {
        return BY_CODE.get(code);
    }

    public static boolean isAvailable(String applicationCode) {
        ApplicationDefinition application = application(applicationCode);
        return application != null && AVAILABLE.equals(application.integrationStatus());
    }

    public static boolean containsModule(String applicationCode, String moduleCode) {
        ApplicationDefinition application = application(applicationCode);
        return application != null && application.modules().stream()
                .anyMatch(module -> module.code().equals(moduleCode));
    }

    public static boolean permissionAllowed(
            PermissionEntity permission,
            Set<EnabledModule> enabledModules) {
        String module = permission.getModule();
        if ("iam".equals(module) || "settings".equals(module)) {
            return true;
        }
        String code = permission.getCode();
        if ("customer_service".equals(module)) {
            if (code.startsWith("customer_service.conversation.")) {
                return enabledModules.contains(new EnabledModule("CHAT", "CONVERSATIONS"));
            }
            if (code.startsWith("customer_service.ticket.")) {
                return enabledModules.contains(new EnabledModule("CHAT", "TICKETS"));
            }
            return enabledModules.contains(new EnabledModule("CHAT", "WORKSPACE"));
        }
        String applicationModule = switch (module) {
            case "platform", "shop" -> "CHANNELS";
            case "products" -> "PRODUCTS";
            case "orders" -> "ORDERS";
            case "procurement", "suppliers" -> "PROCUREMENT";
            case "warehouses", "inventory" -> "WAREHOUSE";
            case "logistics" -> "LOGISTICS";
            case "analytics" -> "ANALYTICS";
            default -> null;
        };
        return applicationModule != null
                && enabledModules.contains(new EnabledModule("ERP", applicationModule));
    }

    private static ModuleDefinition module(String code, String name) {
        return new ModuleDefinition(code, name);
    }

    public record ApplicationDefinition(
            String code,
            String name,
            String description,
            String integrationStatus,
            List<ModuleDefinition> modules) {

        public ApplicationDefinition {
            modules = List.copyOf(modules);
        }
    }

    public record ModuleDefinition(String code, String name) {
    }

    public record EnabledModule(String applicationCode, String moduleCode) {
    }
}
