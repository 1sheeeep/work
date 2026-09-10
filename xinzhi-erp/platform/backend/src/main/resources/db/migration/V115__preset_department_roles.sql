ALTER TABLE roles
    ADD COLUMN preset_role BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT ck_roles_managed_kind
        CHECK (NOT (system_role AND preset_role));

UPDATE roles
SET name = '企业管理员',
    description = '企业内最高权限角色，拥有全部功能权限并受系统保护',
    updated_at = now()
WHERE system_role = true
  AND code = 'tenant_admin';

-- The module and permission codes are stable technical identifiers. Names and
-- descriptions are Chinese product copy returned by the IAM API.
UPDATE permissions AS permission
SET name = translation.name,
    description = translation.description
FROM (VALUES
    ('platform:read', '查看经营平台', '查看系统支持的电商平台目录'),
    ('platform:write', '管理经营平台', '管理系统支持的电商平台定义'),
    ('shop:read', '查看店铺', '查看企业店铺及授权摘要'),
    ('shop:write', '管理店铺', '新增和维护企业店铺资料'),
    ('shop:authorization:write', '管理店铺授权', '管理企业店铺的授权状态'),
    ('shop:sync:read', '查看店铺同步', '查看企业店铺的同步任务'),
    ('shop:sync:write', '执行店铺同步', '创建企业店铺的同步任务'),
    ('iam:user:read', '查看员工', '查看企业员工目录'),
    ('iam:user:write', '管理员工', '新增和管理企业员工及其登录凭据'),
    ('iam:role:read', '查看角色', '查看企业角色'),
    ('iam:role:write', '管理角色', '新增和管理企业自定义角色'),
    ('iam:permission:read', '查看权限目录', '查看系统权限目录'),
    ('iam:permission:assign', '分配角色权限', '为企业自定义角色分配权限'),
    ('iam:audit:read', '查看权限审计', '查看企业组织与权限审计日志'),
    ('iam:warehouse:scope:read', '查看仓库数据范围', '查看员工的仓库数据范围'),
    ('iam:warehouse:scope:write', '管理仓库数据范围', '配置员工可访问的仓库范围'),
    ('products.read', '查看商品', '查看企业商品主数据'),
    ('products.write', '管理商品', '维护企业商品主数据'),
    ('products.listing.read', '查看在线商品', '查看企业在线商品映射'),
    ('products.listing.write', '管理在线商品', '维护企业在线商品映射'),
    ('products.master_data.read', '查看商品资料', '查看企业商品基础资料'),
    ('products.master_data.write', '管理商品资料', '维护企业商品基础资料'),
    ('products.weight.write', '维护商品重量', '维护商品和 SKU 的重量数据'),
    ('inventory.shopify.publish', '发布 Shopify 库存', '将已确认的库存数量发布到 Shopify'),
    ('inventory.read', '查看库存', '查看企业仓库库存数量和记录'),
    ('inventory.adjust', '调整库存', '调整库存并记录可追溯事实'),
    ('inventory.manual.configure', '配置手工出入库', '管理手工出入库分类和本地流程设置'),
    ('inventory.manual.write', '编辑手工出入库', '创建和编辑手工出入库草稿'),
    ('inventory.manual.approve', '审批手工出入库', '审批或驳回已提交的手工出入库单'),
    ('inventory.manual.post', '过账手工出入库', '将手工出入库单记入库存台账'),
    ('inventory.reverse', '冲销库存事实', '追加已过账单据和库存调整的冲销记录'),
    ('orders.read', '查看订单', '查看企业订单数据'),
    ('orders.write', '管理订单', '创建订单并维护订单处理状态'),
    ('orders.shopify_edit.write', '修改 Shopify 订单', '向 Shopify 提交受控的订单行数量修改'),
    ('customer_service.read', '进入客服工作台', '进入企业客服工作台并查看已分配的客户上下文'),
    ('customer_service.conversation.claim', '领取客户会话', '领取企业内可处理的客户会话'),
    ('customer_service.conversation.reply', '回复客户会话', '在已分配的客户会话中发送回复'),
    ('customer_service.conversation.transfer', '转交客户会话', '转交已分配的客户会话'),
    ('customer_service.conversation.close', '结束客户会话', '结束或重新打开已分配的客户会话'),
    ('customer_service.ticket.manage', '管理客服工单', '创建和更新企业客服工单'),
    ('fulfillments.read', '查看订单履约', '查看企业订单履约、包裹与发货记录'),
    ('fulfillments.allocate.write', '分配订单履约', '为履约行分配仓库并建立库存引用'),
    ('fulfillments.pick.write', '执行拣货', '记录订单拣货事实'),
    ('fulfillments.pack.write', '执行包装验货', '记录包装验货与包裹编排事实'),
    ('fulfillments.ship.write', '执行称重出库', '记录称重与发货交接事实'),
    ('fulfillments.ship.correct.write', '冲销发货交接', '追加受保护的发货交接冲销事实'),
    ('fulfillments.weigh.override', '改写称重结果', '在受控条件下改写称重结果并留存原因'),
    ('fulfillments.cancel.write', '取消订单履约', '取消尚未发货的履约数量'),
    ('fulfillments.exception.write', '处理履约异常', '暂停、恢复和处理订单履约异常'),
    ('orders.transfer.read', '查看订单导入导出', '查看订单导入、导出和批处理任务'),
    ('orders.transfer.write', '执行订单导入导出', '创建订单导入、导出和批处理任务'),
    ('logistics.read', '查看物流', '查看物流配置与运输信息'),
    ('logistics.address.write', '管理地址库', '维护物流发件地址资料'),
    ('logistics.declaration_entity.write', '管理报关主体', '维护物流报关主体资料'),
    ('logistics.tracking_number.write', '管理跟踪号', '维护物流跟踪号资源'),
    ('logistics.shipping_fee.write', '管理运费规则', '维护物流运费规则'),
    ('logistics.label_template.write', '管理面单模板', '维护物流面单模板'),
    ('logistics.matching_rule.write', '管理匹配规则', '维护物流匹配规则'),
    ('logistics.authorization.write', '管理物流授权', '维护物流服务商授权配置'),
    ('logistics.forecast.write', '管理物流预报', '创建和维护物流预报任务'),
    ('logistics.fee.write', '管理物流费用', '创建和维护物流费用记录'),
    ('logistics.inquiry.write', '管理物流询价', '创建和维护物流询价任务'),
    ('suppliers.read', '查看供应商', '查看采购所需的供应商主数据'),
    ('suppliers.write', '管理供应商', '维护采购所需的供应商主数据'),
    ('procurement.read', '查看采购管理', '查看采购计划、采购单、到货与采购统计'),
    ('procurement.write', '管理采购业务', '创建和维护采购计划、采购单与采购处理状态'),
    ('finance.read', '查看财务管理', '查看财务信息；当前财务业务功能仍处于暂停范围'),
    ('analytics.read', '查看报表分析', '查看销售、商品、店铺与经营报表'),
    ('warehouses.read', '查看仓库', '查看企业仓库及受控的仓库资料'),
    ('warehouses.write', '管理仓库', '维护企业仓库及受控的仓库资料'),
    ('warehouses.shipping_config.write', '管理仓库发货配置', '维护仓库发货预设、面单配置和批次规则'),
    ('settings.read', '查看系统设置', '查看企业系统设置'),
    ('settings.task.write', '管理任务公告', '创建和维护企业任务与公告'),
    ('settings.notice.write', '管理消息通知', '创建和维护企业内部消息通知'),
    ('settings.enterprise.write', '管理企业信息', '维护企业资料与品牌信息'),
    ('settings.parameter.write', '管理系统参数', '维护企业级系统参数')
) AS translation(code, name, description)
WHERE permission.code = translation.code;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM roles role
        JOIN tenants tenant ON tenant.id = role.tenant_id
        WHERE tenant.deleted_at IS NULL
          AND role.code IN (
            'customer_service_agent', 'customer_service_manager',
            'procurement_specialist', 'procurement_manager',
            'warehouse_operator', 'warehouse_manager',
            'finance_specialist', 'finance_manager',
            'business_specialist', 'business_manager',
            'operations_specialist', 'operations_manager'
        )
          AND role.preset_role = false
    ) THEN
        RAISE EXCEPTION 'A preset role code conflicts with an existing custom role';
    END IF;
END $$;

WITH definitions(code, name, description) AS (VALUES
    ('customer_service_agent', '客服专员', '处理客户会话与日常客服事项'),
    ('customer_service_manager', '客服主管', '负责客服团队转交、工单管理与服务分析'),
    ('procurement_specialist', '采购专员', '维护供货关系并执行采购业务'),
    ('procurement_manager', '采购主管', '负责供应商维护、采购决策与数据分析'),
    ('warehouse_operator', '仓库专员', '执行入出库、拣货、包装与发货作业'),
    ('warehouse_manager', '仓库主管', '负责仓库配置、库存审批、异常与作业管理'),
    ('finance_specialist', '财务专员', '查看财务信息；财务业务功能恢复前不含写入权限'),
    ('finance_manager', '财务主管', '查看财务与分析信息；财务业务功能恢复前不含写入和审批权限'),
    ('business_specialist', '商务专员', '查看平台、店铺、同步和经营数据'),
    ('business_manager', '商务主管', '负责店铺资料和同步管理；店铺授权由企业管理员手工处理'),
    ('operations_specialist', '运营专员', '维护商品、在线商品与订单业务'),
    ('operations_manager', '运营主管', '负责商品、重量、订单与同步管理；店铺外部写入需单独授权')
)
INSERT INTO roles (
    id, tenant_id, code, name, description, system_role, preset_role,
    created_at, updated_at
)
SELECT
    gen_random_uuid(), tenant.id, definition.code, definition.name,
    definition.description, false, true, now(), now()
FROM tenants tenant
CROSS JOIN definitions definition
WHERE tenant.deleted_at IS NULL
ON CONFLICT (tenant_id, code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    system_role = false,
    preset_role = true,
    updated_at = now();

DELETE FROM role_permissions assignment
USING roles role
WHERE assignment.tenant_id = role.tenant_id
  AND assignment.role_id = role.id
  AND role.preset_role = true
  AND role.code IN (
      'customer_service_agent', 'customer_service_manager',
      'procurement_specialist', 'procurement_manager',
      'warehouse_operator', 'warehouse_manager',
      'finance_specialist', 'finance_manager',
      'business_specialist', 'business_manager',
      'operations_specialist', 'operations_manager'
  );

WITH definitions(role_code, permission_codes) AS (VALUES
    ('customer_service_agent', ARRAY[
        'customer_service.read', 'customer_service.conversation.claim',
        'customer_service.conversation.reply', 'customer_service.conversation.close',
        'orders.read'
    ]),
    ('customer_service_manager', ARRAY[
        'customer_service.read', 'customer_service.conversation.claim',
        'customer_service.conversation.reply', 'customer_service.conversation.transfer',
        'customer_service.conversation.close', 'customer_service.ticket.manage',
        'orders.read', 'analytics.read'
    ]),
    ('procurement_specialist', ARRAY[
        'procurement.read', 'procurement.write', 'suppliers.read',
        'products.read', 'inventory.read', 'warehouses.read'
    ]),
    ('procurement_manager', ARRAY[
        'procurement.read', 'procurement.write', 'suppliers.read', 'suppliers.write',
        'products.read', 'inventory.read', 'warehouses.read', 'analytics.read'
    ]),
    ('warehouse_operator', ARRAY[
        'warehouses.read', 'inventory.read', 'inventory.manual.write',
        'inventory.manual.post', 'fulfillments.read', 'fulfillments.pick.write',
        'fulfillments.pack.write', 'fulfillments.ship.write',
        'orders.transfer.read', 'logistics.read'
    ]),
    ('warehouse_manager', ARRAY[
        'warehouses.read', 'warehouses.write', 'warehouses.shipping_config.write',
        'inventory.read', 'inventory.adjust', 'inventory.manual.configure',
        'inventory.manual.write', 'inventory.manual.approve',
        'inventory.manual.post', 'inventory.reverse', 'fulfillments.read',
        'fulfillments.allocate.write', 'fulfillments.pick.write',
        'fulfillments.pack.write', 'fulfillments.ship.write',
        'fulfillments.ship.correct.write', 'fulfillments.weigh.override',
        'fulfillments.cancel.write', 'fulfillments.exception.write',
        'orders.transfer.read', 'orders.transfer.write', 'logistics.read'
    ]),
    ('finance_specialist', ARRAY['finance.read']),
    ('finance_manager', ARRAY['finance.read', 'analytics.read']),
    ('business_specialist', ARRAY[
        'platform:read', 'shop:read', 'shop:sync:read',
        'orders.read', 'analytics.read'
    ]),
    ('business_manager', ARRAY[
        'platform:read', 'shop:read', 'shop:write',
        'shop:sync:read', 'shop:sync:write', 'orders.read', 'analytics.read'
    ]),
    ('operations_specialist', ARRAY[
        'products.read', 'products.write', 'products.listing.read',
        'products.listing.write', 'products.master_data.read',
        'products.master_data.write', 'inventory.read', 'orders.read',
        'orders.write', 'shop:read', 'shop:sync:read', 'analytics.read'
    ]),
    ('operations_manager', ARRAY[
        'products.read', 'products.write', 'products.listing.read',
        'products.listing.write', 'products.master_data.read',
        'products.master_data.write', 'products.weight.write', 'inventory.read',
        'orders.read', 'orders.write', 'shop:read', 'shop:sync:read',
        'shop:sync:write', 'analytics.read'
    ])
)
INSERT INTO role_permissions (tenant_id, role_id, permission_id)
SELECT role.tenant_id, role.id, permission.id
FROM roles role
JOIN definitions definition ON definition.role_code = role.code
CROSS JOIN LATERAL unnest(definition.permission_codes) permission_code
JOIN permissions permission ON permission.code = permission_code
WHERE role.preset_role = true
ON CONFLICT (role_id, permission_id) DO NOTHING;
