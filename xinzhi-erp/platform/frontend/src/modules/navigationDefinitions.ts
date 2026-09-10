import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  Building2,
  ClipboardCheck,
  FileText,
  Layers3,
  Link2,
  MapPin,
  PackageSearch,
  Rocket,
  Settings,
  ShieldAlert,
  ShieldCheck,
  ShoppingCart,
  Store,
  Truck,
  Users,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { PermissionChecker } from "./moduleAccess";
import { masterListPath } from "../pages/productMasterPaths";

export type SecondaryNavigationItem = {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  permissions: string[];
  productView?: string;
  orderStage?: OrderNavigationStage;
};

export type OrderNavigationStage =
  | "ALL"
  | "UNPAID"
  | "REVIEW_PENDING"
  | "MERGE_PENDING"
  | "PROCESSING"
  | "FULFILLING"
  | "SHIPPED"
  | "DELIVERED"
  | "CANCELLED";

export type SecondaryNavigationGroup = {
  id: string;
  label: string;
  items: SecondaryNavigationItem[];
};

export type PrimaryNavigationItem = {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  permissions: string[];
  pathPrefixes: string[];
  groups: SecondaryNavigationGroup[];
};

export type NavigationTarget = {
  pathname: string;
  search?: Record<string, string>;
};

const iamReadPermissions = [
  "iam:user:read",
  "iam:role:read",
  "iam:permission:read",
  "iam:audit:read",
];

export const tenantNavigation: PrimaryNavigationItem[] = [
  {
    id: "dashboard",
    label: "工作台",
    to: "/",
    icon: Boxes,
    permissions: [],
    pathPrefixes: ["/"],
    groups: [],
  },
  {
    id: "orders",
    label: "订单",
    to: "/orders",
    icon: ShoppingCart,
    permissions: ["orders.read"],
    pathPrefixes: ["/orders"],
    groups: [
      {
        id: "order-management",
        label: "订单管理",
        items: [
          {
            id: "order-list",
            label: "全部订单",
            to: "/orders",
            icon: ShoppingCart,
            permissions: ["orders.read"],
            orderStage: "ALL",
          },
          {
            id: "order-unpaid",
            label: "未付款",
            to: "/orders?stage=UNPAID",
            icon: FileText,
            permissions: ["orders.read"],
            orderStage: "UNPAID",
          },
          {
            id: "order-review-pending",
            label: "待审核",
            to: "/orders?stage=REVIEW_PENDING",
            icon: ClipboardCheck,
            permissions: ["orders.read"],
            orderStage: "REVIEW_PENDING",
          },
          {
            id: "order-merge-pending",
            label: "待合并",
            to: "/orders?stage=MERGE_PENDING",
            icon: Layers3,
            permissions: ["orders.read"],
            orderStage: "MERGE_PENDING",
          },
          {
            id: "order-processing",
            label: "待处理",
            to: "/orders?stage=PROCESSING",
            icon: Boxes,
            permissions: ["orders.read"],
            orderStage: "PROCESSING",
          },
          {
            id: "order-fulfilling",
            label: "配货中",
            to: "/orders?stage=FULFILLING",
            icon: PackageSearch,
            permissions: ["orders.read"],
            orderStage: "FULFILLING",
          },
          {
            id: "order-shipped",
            label: "已发货",
            to: "/orders?stage=SHIPPED",
            icon: Truck,
            permissions: ["orders.read"],
            orderStage: "SHIPPED",
          },
          {
            id: "order-delivered",
            label: "已妥投",
            to: "/orders?stage=DELIVERED",
            icon: ShieldCheck,
            permissions: ["orders.read"],
            orderStage: "DELIVERED",
          },
          {
            id: "order-cancelled",
            label: "已作废",
            to: "/orders?stage=CANCELLED",
            icon: ShieldAlert,
            permissions: ["orders.read"],
            orderStage: "CANCELLED",
          },
          {
            id: "customer-directory",
            label: "客户档案",
            to: "/orders/customers",
            icon: Users,
            permissions: ["orders.read"],
          },
        ],
      },
      {
        id: "after-sales",
        label: "售后管理",
        items: [
          {
            id: "order-returns",
            label: "退货与退款",
            to: "/orders/returns",
            icon: ArrowLeftRight,
            permissions: ["orders.read"],
          },
          {
            id: "order-disputes",
            label: "拒付管理",
            to: "/orders/disputes",
            icon: ShieldAlert,
            permissions: ["orders.read"],
          },
        ],
      },
    ],
  },
  {
    id: "products",
    label: "商品",
    to: "/products?view=online",
    icon: PackageSearch,
    permissions: ["products.read", "inventory.read"],
    pathPrefixes: ["/products"],
    groups: [
      {
        id: "product-management",
        label: "商品管理",
        items: [
          { id: "online", label: "在线商品匹配", to: "/products?view=online", icon: Link2, permissions: ["products.read"], productView: "online" },
          { id: "master", label: "主 SKU", to: "/products?view=master", icon: PackageSearch, permissions: ["products.read"], productView: "master" },
          { id: "inventory", label: "库存 SKU", to: "/products?view=inventory", icon: Boxes, permissions: ["products.read"], productView: "inventory" },
          { id: "bundle", label: "组合 SKU", to: "/products?view=bundle", icon: Layers3, permissions: ["products.read"], productView: "bundle" },
          { id: "supply-price", label: "商品供货价管理", to: "/products?view=supply-price", icon: ShoppingCart, permissions: ["products.read"], productView: "supply-price" },
          { id: "aging", label: "库龄分析", to: "/products?view=aging", icon: Warehouse, permissions: ["inventory.read"], productView: "aging" },
          { id: "inventory-report", label: "进销存报表", to: "/products?view=inventory-report", icon: PackageSearch, permissions: ["inventory.read"], productView: "inventory-report" },
          { id: "inventory-query", label: "库存查询", to: "/products/inventory-query", icon: Warehouse, permissions: ["inventory.read"] },
        ],
      },
      {
        id: "inventory-sync",
        label: "同步库存",
        items: [
          { id: "sync-rules", label: "同步规则管理", to: "/products?view=sync-rules", icon: Settings, permissions: ["products.read"], productView: "sync-rules" },
          { id: "sync-exceptions", label: "库存同步异常", to: "/products?view=sync-exceptions", icon: ShieldCheck, permissions: ["products.read"], productView: "sync-exceptions" },
        ],
      },
    ],
  },
  {
    id: "supply-chain",
    label: "供应链",
    to: "/procurement/orders",
    icon: Building2,
    permissions: ["procurement.read", "suppliers.read"],
    pathPrefixes: ["/procurement"],
    groups: [
      {
        id: "procurement-flow",
        label: "采购流程",
        items: [
          { id: "procurement-orders", label: "采购单", to: "/procurement/orders", icon: ShoppingCart, permissions: ["procurement.read"] },
        ],
      },
      {
        id: "procurement-master-data",
        label: "基础资料",
        items: [
          { id: "suppliers", label: "供应商", to: "/procurement/suppliers", icon: Building2, permissions: ["suppliers.read"] },
        ],
      },
      {
        id: "procurement-statistics",
        label: "数据统计",
        items: [
          { id: "purchaser-performance", label: "采购员绩效", to: "/procurement/statistics/purchaser-performance", icon: ClipboardCheck, permissions: ["procurement.read"] },
        ],
      },
    ],
  },
  {
    id: "warehouse",
    label: "仓库",
    to: "/warehouses",
    icon: Warehouse,
    permissions: ["warehouses.read", "inventory.read"],
    pathPrefixes: ["/warehouses"],
    groups: [
      {
        id: "warehouse-information",
        label: "仓库信息",
        items: [
          { id: "warehouse-list", label: "仓库列表", to: "/warehouses", icon: Warehouse, permissions: ["warehouses.read"] },
          { id: "location-list", label: "库位列表", to: "/warehouses/locations", icon: MapPin, permissions: ["warehouses.read"] },
          {
            id: "manual-movements",
            label: "手工出入库",
            to: "/warehouses/manual-movements",
            icon: Boxes,
            permissions: ["inventory.read"],
          },
          {
            id: "inventory-counts",
            label: "库存盘点",
            to: "/warehouses/counts",
            icon: ClipboardCheck,
            permissions: ["inventory.read"],
          },
          {
            id: "warehouse-transfers",
            label: "分仓调拨",
            to: "/warehouses/transfers",
            icon: ArrowLeftRight,
            permissions: ["inventory.read"],
          },
          {
            id: "warehouse-documents",
            label: "入 / 出库单",
            to: "/warehouses/documents",
            icon: FileText,
            permissions: ["inventory.read"],
          },
        ],
      },
    ],
  },
  {
    id: "logistics",
    label: "物流",
    to: "/logistics/declaration-entities",
    icon: Truck,
    permissions: ["logistics.read"],
    pathPrefixes: ["/logistics"],
    groups: [
      {
        id: "logistics-management",
        label: "物流管理",
        items: [
          {
            id: "logistics-declaration-entities",
            label: "企业申报信息管理",
            to: "/logistics/declaration-entities",
            icon: Building2,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-authorizations",
            label: "物流授权",
            to: "/logistics/authorizations",
            icon: Link2,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-matching-rules",
            label: "物流匹配规则",
            to: "/logistics/matching-rules",
            icon: Settings,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-custom-fees",
            label: "自定义运费",
            to: "/logistics/custom-fees",
            icon: FileText,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-label-templates",
            label: "标签模板",
            to: "/logistics/label-templates",
            icon: FileText,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-tracking-numbers",
            label: "运单号管理",
            to: "/logistics/tracking-numbers",
            icon: FileText,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-addresses",
            label: "地址管理",
            to: "/logistics/addresses",
            icon: MapPin,
            permissions: ["logistics.read"],
          },
        ],
      },
      {
        id: "logistics-value-added",
        label: "增值服务",
        items: [
          {
            id: "logistics-fees",
            label: "物流费用",
            to: "/logistics/fees",
            icon: FileText,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-tracking",
            label: "物流跟踪",
            to: "/logistics/tracking",
            icon: PackageSearch,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-forecasts",
            label: "上传预报单",
            to: "/logistics/forecasts",
            icon: FileText,
            permissions: ["logistics.read"],
          },
          {
            id: "logistics-inquiries",
            label: "物流询价",
            to: "/logistics/inquiries",
            icon: Link2,
            permissions: ["logistics.read"],
          },
        ],
      },
      {
        id: "logistics-statistics",
        label: "数据统计",
        items: [
          {
            id: "logistics-statistics-overview",
            label: "物流统计",
            to: "/logistics/statistics",
            icon: ClipboardCheck,
            permissions: ["logistics.read"],
          },
        ],
      },
    ],
  },
  {
    id: "analytics",
    label: "报表",
    to: "/analytics/sales/order-status",
    icon: BarChart3,
    permissions: ["analytics.read"],
    pathPrefixes: ["/analytics"],
    groups: [
      {
        id: "analytics-sales-reports",
        label: "销售报告",
        items: [
          { id: "analytics-order-status", label: "订单状态报表", to: "/analytics/sales/order-status", icon: ClipboardCheck, permissions: ["analytics.read"] },
          { id: "analytics-product-sales", label: "商品销量报表", to: "/analytics/sales/product-sales", icon: PackageSearch, permissions: ["analytics.read"] },
          { id: "analytics-order-analysis", label: "订单分析", to: "/analytics/sales/order-analysis", icon: BarChart3, permissions: ["analytics.read"] },
          { id: "analytics-listing-realtime", label: "Listing实时销量", to: "/analytics/sales/listing-realtime", icon: Store, permissions: ["analytics.read"] },
          { id: "analytics-inventory-realtime", label: "库存实时销量", to: "/analytics/sales/inventory-realtime", icon: Warehouse, permissions: ["analytics.read"] },
        ],
      },
      {
        id: "analytics-product-reports",
        label: "商品报告",
        items: [
          { id: "analytics-inventory-report", label: "进销存报表", to: "/analytics/products/inventory-report", icon: PackageSearch, permissions: ["analytics.read"] },
          { id: "analytics-inventory-aging", label: "库龄分析", to: "/analytics/products/inventory-aging", icon: Warehouse, permissions: ["analytics.read"] },
        ],
      },
      {
        id: "analytics-store-reports",
        label: "店铺报告",
        items: [
          { id: "analytics-store-health", label: "店铺健康", to: "/analytics/stores/health", icon: Store, permissions: ["analytics.read"] },
        ],
      },
    ],
  },
  {
    id: "settings",
    label: "设置",
    to: "/settings/iam",
    icon: Settings,
    permissions: [
      ...iamReadPermissions,
      "shop:read",
      "settings.read",
      "PLATFORM_ADMIN_TENANT_SESSION",
    ],
    pathPrefixes: ["/settings", "/shops"],
    groups: [
      {
        id: "settings-task-announcements",
        label: "任务公告",
        items: [
          { id: "settings-approvals", label: "审核单据", to: "/settings/tasks/approvals", icon: ClipboardCheck, permissions: ["settings.read"] },
          { id: "settings-task-list", label: "任务列表", to: "/settings/tasks/list", icon: FileText, permissions: ["settings.read"] },
          { id: "settings-messages", label: "消息中心", to: "/settings/tasks/messages", icon: FileText, permissions: ["settings.read"] },
          { id: "settings-import-export", label: "导入/导出任务", to: "/settings/tasks/import-export", icon: ArrowLeftRight, permissions: ["settings.read"] },
          { id: "settings-attachments", label: "附件下载", to: "/settings/tasks/attachments", icon: FileText, permissions: ["settings.read"] },
          { id: "settings-task-center", label: "任务中心", to: "/settings/tasks/center", icon: Layers3, permissions: ["settings.read"] },
          { id: "settings-notices", label: "内部公告", to: "/settings/tasks/notices", icon: FileText, permissions: ["settings.read"] },
        ],
      },
      {
        id: "organization-access",
        label: "组织与权限",
        items: [
          { id: "iam", label: "员工与权限", to: "/settings/iam", icon: ShieldCheck, permissions: iamReadPermissions },
          { id: "member-application-access", label: "员工应用权限", to: "/settings/application-access", icon: ShieldCheck, permissions: ["iam:user:read"] },
        ],
      },
      {
        id: "settings-system",
        label: "系统设置",
        items: [
          { id: "settings-general", label: "基础设置", to: "/settings/system/general", icon: Settings, permissions: ["settings.read"] },
          { id: "settings-enterprise", label: "企业信息", to: "/settings/system/enterprise", icon: Building2, permissions: ["settings.read"] },
          { id: "settings-task-management", label: "任务管理", to: "/settings/system/task-management", icon: ClipboardCheck, permissions: ["settings.read"] },
          { id: "settings-erp-operator", label: "ERP 运维", to: "/settings/system/erp-operator", icon: Rocket, permissions: ["PLATFORM_ADMIN_TENANT_SESSION"] },
        ],
      },
      {
        id: "settings-parameters",
        label: "参数设置",
        items: [
          { id: "settings-aliases", label: "别名管理", to: "/settings/parameters/aliases", icon: FileText, permissions: ["settings.read"] },
          { id: "settings-order-exceptions", label: "订单异常分类处理配置", to: "/settings/parameters/order-exceptions", icon: ShieldAlert, permissions: ["settings.read"] },
          { id: "settings-shipping-deadline", label: "订单发货期限设置", to: "/settings/parameters/shipping-deadline", icon: Truck, permissions: ["settings.read"] },
          { id: "settings-approval-rules", label: "审批规则设置", to: "/settings/parameters/approval-rules", icon: ShieldCheck, permissions: ["settings.read"] },
          { id: "settings-address-mappings", label: "地址映射配置", to: "/settings/parameters/address-mappings", icon: MapPin, permissions: ["settings.read"] },
        ],
      },
      {
        id: "channel-authorization",
        label: "渠道授权",
        items: [
          { id: "shop-list", label: "店铺列表", to: "/shops", icon: Store, permissions: ["shop:read"] },
        ],
      },
    ],
  },
];

function isPermitted(permissions: readonly string[], hasPermission: PermissionChecker) {
  return permissions.length === 0 || permissions.some(hasPermission);
}

export function getAccessibleTenantNavigation(hasPermission: PermissionChecker) {
  return tenantNavigation
    .filter((primary) => isPermitted(primary.permissions, hasPermission))
    .map((primary) => {
      const groups = primary.groups
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => isPermitted(item.permissions, hasPermission)),
        }))
        .filter((group) => group.items.length > 0);
      const firstAccessibleTarget = groups.flatMap((group) => group.items)[0]?.to;
      return {
        ...primary,
        to: firstAccessibleTarget ?? primary.to,
        groups,
      };
    });
}

export function getCurrentPrimaryNavigation(pathname: string, hasPermission: PermissionChecker) {
  const available = getAccessibleTenantNavigation(hasPermission);
  if (pathname === "/") return available.find((item) => item.id === "dashboard");
  return available.find((item) =>
    item.pathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)),
  );
}

export type SecondaryNavigationMatch = {
  item: SecondaryNavigationItem;
  matchType: "product-view" | "path-exact" | "path-prefix";
};

export function getCurrentSecondaryNavigation(
  items: readonly SecondaryNavigationItem[],
  pathname: string,
  search: string,
): SecondaryNavigationMatch | undefined {
  const searchParams = new URLSearchParams(search);
  // Master create/detail routes belong to the existing query-based SKU list.
  // Resolve from accessible items only, so breadcrumbs do not add permissions.
  if (pathname.startsWith("/products/master/")) {
    const master = items.find(item => item.productView === "master");
    if (master) return { item: master, matchType: "path-prefix" };
  }
  const productView = searchParams.get("view") ?? "online";
  const currentProductItem = items.find(
    (item) => pathname === "/products" && item.productView === productView,
  );
  if (currentProductItem) {
    return { item: currentProductItem, matchType: "product-view" };
  }

  const orderView = searchParams.get("view") ?? "orders";
  const orderStage = searchParams.get("stage") ?? "ALL";
  const currentOrderStageItem = items.find(
    (item) =>
      pathname === "/orders" &&
      orderView !== "queue" &&
      item.orderStage === orderStage,
  );
  if (currentOrderStageItem) {
    return { item: currentOrderStageItem, matchType: "path-exact" };
  }

  const exactPathItem = items.find(
    (item) => !item.productView && pathname === item.to,
  );
  if (exactPathItem) {
    return { item: exactPathItem, matchType: "path-exact" };
  }

  const parentItem = items
    .filter((item) => !item.productView && pathname.startsWith(`${item.to}/`))
    .sort((left, right) => right.to.length - left.to.length)[0];
  return parentItem ? { item: parentItem, matchType: "path-prefix" } : undefined;
}

export function resolveSecondaryNavigationTarget(
  item: SecondaryNavigationItem,
  currentSearch: string,
  currentPathname?: string,
) {
  if (item.productView === "master" && currentPathname?.startsWith("/products/master/")) {
    return masterListPath(currentSearch);
  }
  if (!item.orderStage) return item.to;

  const search = new URLSearchParams(currentSearch);
  search.delete("page");
  search.delete("status");
  search.delete("view");
  if (item.orderStage === "ALL") search.delete("stage");
  else search.set("stage", item.orderStage);
  const query = search.toString();
  return query ? `/orders?${query}` : "/orders";
}

export function splitNavigationTarget(to: string): NavigationTarget {
  const [pathname, query] = to.split("?", 2);
  if (!query) return { pathname };
  return {
    pathname,
    search: Object.fromEntries(new URLSearchParams(query)),
  };
}
