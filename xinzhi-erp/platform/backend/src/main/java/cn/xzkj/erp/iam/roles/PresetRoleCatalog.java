package cn.xzkj.erp.iam.roles;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

public final class PresetRoleCatalog {

    public static final String ENTERPRISE_ADMIN_CODE = "tenant_admin";
    public static final String ENTERPRISE_ADMIN_NAME = "企业管理员";
    public static final String ENTERPRISE_ADMIN_DESCRIPTION =
            "企业内最高权限角色，拥有全部功能权限并受系统保护";

    public static final List<Definition> DEFINITIONS = List.of(
            role(
                    "customer_service_agent",
                    "客服专员",
                    "处理客户会话与日常客服事项",
                    "customer_service.read",
                    "customer_service.conversation.claim",
                    "customer_service.conversation.reply",
                    "customer_service.conversation.close",
                    "orders.read"),
            role(
                    "customer_service_manager",
                    "客服主管",
                    "负责客服团队转交、工单管理与服务分析",
                    "customer_service.read",
                    "customer_service.conversation.claim",
                    "customer_service.conversation.reply",
                    "customer_service.conversation.transfer",
                    "customer_service.conversation.close",
                    "customer_service.ticket.manage",
                    "orders.read",
                    "analytics.read"),
            role(
                    "procurement_specialist",
                    "采购专员",
                    "维护供货关系并执行采购业务",
                    "procurement.read",
                    "procurement.write",
                    "suppliers.read",
                    "products.read",
                    "inventory.read",
                    "warehouses.read"),
            role(
                    "procurement_manager",
                    "采购主管",
                    "负责供应商维护、采购决策与数据分析",
                    "procurement.read",
                    "procurement.write",
                    "suppliers.read",
                    "suppliers.write",
                    "products.read",
                    "inventory.read",
                    "warehouses.read",
                    "analytics.read"),
            role(
                    "warehouse_operator",
                    "仓库专员",
                    "执行入出库、拣货、包装与发货作业",
                    "warehouses.read",
                    "inventory.read",
                    "inventory.manual.write",
                    "inventory.manual.post",
                    "fulfillments.read",
                    "fulfillments.pick.write",
                    "fulfillments.pack.write",
                    "fulfillments.ship.write",
                    "orders.transfer.read",
                    "logistics.read"),
            role(
                    "warehouse_manager",
                    "仓库主管",
                    "负责仓库配置、库存审批、异常与作业管理",
                    "warehouses.read",
                    "warehouses.write",
                    "warehouses.shipping_config.write",
                    "inventory.read",
                    "inventory.adjust",
                    "inventory.manual.configure",
                    "inventory.manual.write",
                    "inventory.manual.approve",
                    "inventory.manual.post",
                    "inventory.reverse",
                    "fulfillments.read",
                    "fulfillments.allocate.write",
                    "fulfillments.pick.write",
                    "fulfillments.pack.write",
                    "fulfillments.ship.write",
                    "fulfillments.ship.correct.write",
                    "fulfillments.weigh.override",
                    "fulfillments.cancel.write",
                    "fulfillments.exception.write",
                    "orders.transfer.read",
                    "orders.transfer.write",
                    "logistics.read"),
            role(
                    "finance_specialist",
                    "财务专员",
                    "查看财务信息；财务业务功能恢复前不含写入权限",
                    "finance.read"),
            role(
                    "finance_manager",
                    "财务主管",
                    "查看财务与分析信息；财务业务功能恢复前不含写入和审批权限",
                    "finance.read",
                    "analytics.read"),
            role(
                    "business_specialist",
                    "商务专员",
                    "查看平台、店铺、同步和经营数据",
                    "platform:read",
                    "shop:read",
                    "shop:sync:read",
                    "orders.read",
                    "analytics.read"),
            role(
                    "business_manager",
                    "商务主管",
                    "负责店铺资料和同步管理；店铺授权由企业管理员手工处理",
                    "platform:read",
                    "shop:read",
                    "shop:write",
                    "shop:sync:read",
                    "shop:sync:write",
                    "orders.read",
                    "analytics.read"),
            role(
                    "operations_specialist",
                    "运营专员",
                    "维护商品、在线商品与订单业务",
                    "products.read",
                    "products.write",
                    "products.listing.read",
                    "products.listing.write",
                    "products.master_data.read",
                    "products.master_data.write",
                    "inventory.read",
                    "orders.read",
                    "orders.write",
                    "shop:read",
                    "shop:sync:read",
                    "analytics.read"),
            role(
                    "operations_manager",
                    "运营主管",
                    "负责商品、重量、订单与同步管理；店铺外部写入需单独授权",
                    "products.read",
                    "products.write",
                    "products.listing.read",
                    "products.listing.write",
                    "products.master_data.read",
                    "products.master_data.write",
                    "products.weight.write",
                    "inventory.read",
                    "orders.read",
                    "orders.write",
                    "shop:read",
                    "shop:sync:read",
                    "shop:sync:write",
                    "analytics.read"));

    private PresetRoleCatalog() {
    }

    public static Set<String> permissionCodes() {
        LinkedHashSet<String> codes = new LinkedHashSet<>();
        DEFINITIONS.forEach(definition ->
                codes.addAll(definition.permissionCodes()));
        return Set.copyOf(codes);
    }

    private static Definition role(
            String code,
            String name,
            String description,
            String... permissionCodes) {
        return new Definition(
                code,
                name,
                description,
                List.of(permissionCodes));
    }

    public record Definition(
            String code,
            String name,
            String description,
            List<String> permissionCodes) {
    }
}
