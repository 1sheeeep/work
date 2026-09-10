import {
  BarChart3,
  Boxes,
  ClipboardList,
  PackageSearch,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Warehouse,
  type LucideIcon,
} from 'lucide-react'

export type ModuleStatus = 'foundation' | 'planned' | 'integration'
export type ModuleGroup = '核心业务' | '履约协同' | '经营管理' | '平台管理'
export type ModulePath =
  | '/shops'
  | '/products'
  | '/orders'
  | '/warehouses'
  | '/procurement'
  | '/warehouses/manual-movements'
  | '/logistics'
  | '/analytics'
  | '/automation'
  | '/settings'

export type ErpRouteHandle = {
  title: string
  moduleId?: string
}

export type ModuleDefinition = {
  id: string
  label: string
  path: ModulePath
  group: ModuleGroup
  icon: LucideIcon
  status: ModuleStatus
  summary: string
  capabilities: string[]
  apiNamespace: string
  requiredPermission: string
}

export const moduleStatusLabels: Record<ModuleStatus, string> = {
  foundation: '框架就绪',
  planned: '规划中',
  integration: '待业务接入',
}

export const moduleDefinitions: ModuleDefinition[] = [
  {
    id: 'shops',
    label: '店铺列表',
    path: '/shops',
    group: '核心业务',
    icon: Store,
    status: 'foundation',
    summary: '统一管理店铺、授权信息与同步状态。',
    capabilities: ['店铺档案', '平台授权状态', '同步任务', '运营归属'],
    apiNamespace: '/api/v1/shops',
    requiredPermission: 'shop:read',
  },
  {
    id: 'products',
    label: '商品中心',
    path: '/products',
    group: '核心业务',
    icon: PackageSearch,
    status: 'foundation',
    summary: '管理商品、SPU/SKU、变体、类目与素材。',
    capabilities: ['商品档案', 'SKU 与变体', '类目映射'],
    apiNamespace: '/api/v1/product-center',
    requiredPermission: 'products.read',
  },
  {
    id: 'orders',
    label: '订单中心',
    path: '/orders',
    group: '核心业务',
    icon: ShoppingCart,
    status: 'foundation',
    summary: '管理订单、审核、异常处理、拆合单与履约状态。',
    capabilities: ['订单列表', '订单审核', '异常订单', '拆合单'],
    apiNamespace: '/api/v1/orders',
    requiredPermission: 'orders.read',
  },
  {
    id: 'warehouses',
    label: '仓库与库位',
    path: '/warehouses',
    group: '履约协同',
    icon: Warehouse,
    status: 'foundation',
    summary: '管理仓库和库位基础信息。',
    capabilities: ['仓库目录', '库位目录', '状态管理', '归档约束'],
    apiNamespace: '/api/v1/warehouse-center',
    requiredPermission: 'warehouses.read',
  },
  {
    id: 'procurement',
    label: '采购单',
    path: '/procurement',
    group: '履约协同',
    icon: ClipboardList,
    status: 'foundation',
    summary: '在采购单中完成下单、审核、收货、退货和记录追溯。',
    capabilities: ['直接创建采购单', '供应商与单据快照', '采购单审核', '分批收货入库', '采购退货', '收货与退货记录', '库存事件入账', '独立读写权限'],
    apiNamespace: '/api/v1/procurement',
    requiredPermission: 'procurement.read',
  },
  {
    id: 'inventory',
    label: '手工出入库',
    path: '/warehouses/manual-movements',
    group: '履约协同',
    icon: Warehouse,
    status: 'foundation',
    summary: '创建、过账和冲销手工入库与出库单。',
    capabilities: ['手工入库', '手工出库', '库存过账', '冲销追溯'],
    apiNamespace: '/api/v1/inventory-center/manual-movements',
    requiredPermission: 'inventory.read',
  },
  {
    id: 'logistics',
    label: '物流管理',
    path: '/logistics',
    group: '履约协同',
    icon: Truck,
    status: 'foundation',
    summary: '查看物流授权分类与状态。',
    capabilities: ['物流授权入口', '授权状态筛选', '服务商接入边界'],
    apiNamespace: '/api/v1/logistics',
    requiredPermission: 'logistics.read',
  },
  {
    id: 'analytics',
    label: '报表分析',
    path: '/analytics',
    group: '经营管理',
    icon: BarChart3,
    status: 'foundation',
    summary: '提供销售、财务、商品与店铺报表的查询入口。',
    capabilities: ['销售收支入口', '营业额统计结构', '订单状态统计结构', '退款统计结构', '商品销量统计结构', '实时销量统计结构', '订单分析空态边界', '进销存与库龄报表结构', '店铺健康指标结构', '未取证筛选失败关闭', '报表写操作失败关闭'],
    apiNamespace: '/api/v1/analytics',
    requiredPermission: 'analytics.read',
  },
  {
    id: 'automation',
    label: '自动化中心',
    path: '/automation',
    group: '经营管理',
    icon: Boxes,
    status: 'planned',
    summary: '管理跨模块规则、任务和执行记录。',
    capabilities: ['规则编排', '任务队列', '执行记录', '失败重试'],
    apiNamespace: '/api/v1/automation',
    requiredPermission: 'automation.read',
  },
  {
    id: 'settings',
    label: '系统设置',
    path: '/settings',
    group: '平台管理',
    icon: Settings,
    status: 'foundation',
    summary: '管理组织、成员、权限与企业设置。',
    capabilities: ['员工与权限', '角色权限', '租户设置', '企业基础资料维护', '系统配置只读结构', '任务管理只读入口', '审计日志', '任务公告只读入口', '通用参数只读入口', '平台专项配置延后', '设置写操作失败关闭'],
    apiNamespace: '/api/v1/iam',
    requiredPermission: 'settings.read',
  },
]

export const moduleGroups: ModuleGroup[] = [
  '核心业务',
  '履约协同',
  '经营管理',
  '平台管理',
]
