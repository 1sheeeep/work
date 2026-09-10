import { type ElementType, useEffect, useRef } from "react";
import {
  Outlet,
  Navigate,
  RouterProvider,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  parseSearchWith,
  stringifySearchWith,
  notFound,
  redirect,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { useAuth } from "./auth/AuthContext";
import { usePlatformAdmin } from "./platform/PlatformAdminContext";
import { PlatformProtectedRoute } from "./platform/PlatformProtectedRoute";
import { ModuleAccessGate } from "./auth/ModuleAccessGate";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { sanitizePostLoginRedirect } from "./auth/redirects";
import { AppShell } from "./components/AppShell";
import {
  moduleDefinitions,
  type ErpRouteHandle,
  type ModuleDefinition,
} from "./modules/moduleDefinitions";
import { LoginPage } from "./pages/LoginPage";
import { CustomerServiceEntryPage } from "./pages/CustomerServiceEntryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { RouteErrorPage } from "./pages/RouteErrorPage";
import type { AuthContextValue } from "./auth/types";

type AppRouterContext = {
  auth: AuthContextValue;
  platform: ReturnType<typeof usePlatformAdmin>;
};

const LazyPlatformAdminLoginPage = lazyRouteComponent(
  () => import("./pages/PlatformAdminLoginPage"), "PlatformAdminLoginPage",
);
const LazyPlatformAdminConsolePage = lazyRouteComponent(
  () => import("./pages/PlatformAdminConsolePage"), "PlatformAdminConsolePage",
);
const LazyPlatformCredentialPage = lazyRouteComponent(
  () => import("./pages/PlatformCredentialPage"), "PlatformCredentialPage",
);

const LazyDashboardPage = lazyRouteComponent(
  () => import("./pages/DashboardPage"),
  "DashboardPage",
);
const LazyShopifyNativeLinkPage = lazyRouteComponent(
  () => import("./pages/ShopifyNativeLinkPage"),
  "ShopifyNativeLinkPage",
);
const LazyMemberApplicationAccessPage = lazyRouteComponent(
  () => import("./pages/MemberApplicationAccessPage"),
  "MemberApplicationAccessPage",
);
const LazyModulePage = lazyRouteComponent(
  () => import("./pages/ModulePage"),
  "ModulePage",
);
const LazyShopCenterPage = lazyRouteComponent(
  () => import("./pages/ShopCenterPage"),
  "ShopCenterPage",
);
const LazyShopDetailPage = lazyRouteComponent(
  () => import("./pages/ShopDetailPage"),
  "ShopDetailPage",
);
const LazyProductCenterPage = lazyRouteComponent(
  () => import("./pages/ProductCenterPage"),
  "ProductCenterPage",
);
const LazyProductMasterDataPage = lazyRouteComponent(
  () => import("./pages/ProductMasterDataPage"),
  "ProductMasterDataPage",
);
const LazyOrderCenterPage = lazyRouteComponent(
  () => import("./pages/OrderCenterPage"),
  "OrderCenterPage",
);
const LazyOrderDetailPage = lazyRouteComponent(
  () => import("./pages/OrderDetailPage"),
  "OrderDetailPage",
);
const LazyShopifyCustomerDirectoryPage = lazyRouteComponent(
  () => import("./pages/ShopifyCustomerDirectoryPage"),
  "ShopifyCustomerDirectoryPage",
);
const LazyShopifyReturnRefundPage = lazyRouteComponent(
  () => import("./pages/ShopifyAfterSalesPages"),
  "ShopifyReturnRefundPage",
);
const LazyShopifyDisputePage = lazyRouteComponent(
  () => import("./pages/ShopifyAfterSalesPages"),
  "ShopifyDisputePage",
);
const LazyWarehouseCenterPage = lazyRouteComponent(
  () => import("./pages/WarehouseCenterPage"),
  "WarehouseCenterPage",
);
const LazyManualMovementPage = lazyRouteComponent(
  () => import("./pages/ManualMovementPage"),
  "ManualMovementPage",
);
const LazyInventoryQueryPage = lazyRouteComponent(
  () => import("./pages/InventoryQueryPage"),
  "InventoryQueryPage",
);
const LazyInventoryCountPage = lazyRouteComponent(
  () => import("./pages/InventoryCountPage"),
  "InventoryCountPage",
);
const LazyWarehouseTransferPage = lazyRouteComponent(
  () => import("./pages/WarehouseTransferPage"),
  "WarehouseTransferPage",
);
const LazyInboundOutboundDocumentsPage = lazyRouteComponent(
  () => import("./pages/InboundOutboundDocumentsPage"),
  "InboundOutboundDocumentsPage",
);
const LazyLogisticsAuthorizationPage = lazyRouteComponent(
  () => import("./pages/LogisticsAuthorizationPage"),
  "LogisticsAuthorizationPage",
);
const LazyLogisticsAuthorizationChannelsPage = lazyRouteComponent(
  () => import("./pages/LogisticsAuthorizationChannelsPage"),
  "LogisticsAuthorizationChannelsPage",
);
const LazyLogisticsMatchingRulesPage = lazyRouteComponent(
  () => import("./pages/LogisticsMatchingRulesPage"),
  "LogisticsMatchingRulesPage",
);
const LazyLogisticsAddressManagementPage = lazyRouteComponent(
  () => import("./pages/LogisticsAddressManagementPage"),
  "LogisticsAddressManagementPage",
);
const LazyLogisticsTrackingNumberPage = lazyRouteComponent(
  () => import("./pages/LogisticsTrackingNumberPage"),
  "LogisticsTrackingNumberPage",
);
const LazyLogisticsTrackingPage = lazyRouteComponent(
  () => import("./pages/LogisticsTrackingPage"),
  "LogisticsTrackingPage",
);
const LazyLogisticsFeePage = lazyRouteComponent(
  () => import("./pages/LogisticsFeePage"),
  "LogisticsFeePage",
);
const LazyLogisticsForecastPage = lazyRouteComponent(
  () => import("./pages/LogisticsForecastPage"),
  "LogisticsForecastPage",
);
const LazyLogisticsStatisticsPage = lazyRouteComponent(
  () => import("./pages/LogisticsStatisticsPage"),
  "LogisticsStatisticsPage",
);
const LazyLogisticsInquiryPage = lazyRouteComponent(
  () => import("./pages/LogisticsInquiryPage"),
  "LogisticsInquiryPage",
);
const LazyLogisticsDeclarationEntityPage = lazyRouteComponent(
  () => import("./pages/LogisticsDeclarationEntityPage"),
  "LogisticsDeclarationEntityPage",
);
const LazyCustomShippingFeePage = lazyRouteComponent(
  () => import("./pages/CustomShippingFeePage"),
  "CustomShippingFeePage",
);
const LazyLogisticsLabelTemplatePage = lazyRouteComponent(
  () => import("./pages/LogisticsLabelTemplatePage"),
  "LogisticsLabelTemplatePage",
);
const LazyLogisticsTrackingWorkbenchPage = lazyRouteComponent(
  () => import("./pages/LogisticsTrackingWorkbenchPage"),
  "LogisticsTrackingWorkbenchPage",
);
const LazyPurchaserPerformancePage = lazyRouteComponent(
  () => import("./pages/PurchaserPerformancePage"),
  "PurchaserPerformancePage",
);
const LazyProcurementLedgerPage = lazyRouteComponent(
  () => import("./pages/ProcurementLedgerPage"),
  "ProcurementLedgerPage",
);
const LazyAnalyticsOrderStatusReportPage = lazyRouteComponent(
  () => import("./pages/AnalyticsSalesReportPages"),
  "AnalyticsOrderStatusReportPage",
);
const LazyAnalyticsProductSalesReportPage = lazyRouteComponent(
  () => import("./pages/AnalyticsSalesReportPages"),
  "AnalyticsProductSalesReportPage",
);
const LazyAnalyticsOrderAnalysisPage = lazyRouteComponent(
  () => import("./pages/AnalyticsRealtimeSalesPages"),
  "AnalyticsOrderAnalysisPage",
);
const LazyAnalyticsListingRealtimeSalesPage = lazyRouteComponent(
  () => import("./pages/AnalyticsRealtimeSalesPages"),
  "AnalyticsListingRealtimeSalesPage",
);
const LazyAnalyticsInventoryRealtimeSalesPage = lazyRouteComponent(
  () => import("./pages/AnalyticsRealtimeSalesPages"),
  "AnalyticsInventoryRealtimeSalesPage",
);
const LazyAnalyticsInventoryReportPage = lazyRouteComponent(
  () => import("./pages/AnalyticsProductStoreReports"),
  "AnalyticsInventoryReportPage",
);
const LazyAnalyticsInventoryAgingReportPage = lazyRouteComponent(
  () => import("./pages/AnalyticsProductStoreReports"),
  "AnalyticsInventoryAgingReportPage",
);
const LazyAnalyticsStoreHealthPage = lazyRouteComponent(
  () => import("./pages/AnalyticsProductStoreReports"),
  "AnalyticsStoreHealthPage",
);
const LazySettingsApprovalDocumentsPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsApprovalDocumentsPage");
const LazySettingsTaskListPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsTaskListPage");
const LazySettingsMessageCenterPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsMessageCenterPage");
const LazySettingsImportExportTasksPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsImportExportTasksPage");
const LazySettingsAttachmentDownloadsPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsAttachmentDownloadsPage");
const LazySettingsTaskCenterPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsTaskCenterPage");
const LazySettingsInternalNoticesPage = lazyRouteComponent(() => import("./pages/SettingsTaskAnnouncementPages"), "SettingsInternalNoticesPage");
const LazySettingsAliasManagementPage = lazyRouteComponent(() => import("./pages/SettingsParameterPages"), "SettingsAliasManagementPage");
const LazySettingsOrderExceptionConfigPage = lazyRouteComponent(() => import("./pages/SettingsParameterPages"), "SettingsOrderExceptionConfigPage");
const LazySettingsShippingDeadlinePage = lazyRouteComponent(() => import("./pages/SettingsParameterPages"), "SettingsShippingDeadlinePage");
const LazySettingsApprovalRulesPage = lazyRouteComponent(() => import("./pages/SettingsParameterPages"), "SettingsApprovalRulesPage");
const LazySettingsAddressMappingPage = lazyRouteComponent(() => import("./pages/SettingsParameterPages"), "SettingsAddressMappingPage");
const LazySettingsTaskManagementPage = lazyRouteComponent(() => import("./pages/SettingsSystemPages"), "SettingsTaskManagementPage");
const LazySettingsGeneralConfigurationPage = lazyRouteComponent(() => import("./pages/SettingsSystemPages"), "SettingsGeneralConfigurationPage");
const LazySettingsEnterpriseInformationPage = lazyRouteComponent(() => import("./pages/SettingsSystemPages"), "SettingsEnterpriseInformationPage");
const LazyErpOperatorConsolePage = lazyRouteComponent(() => import("./pages/ErpOperatorConsolePage"), "ErpOperatorConsolePage");
const LazyProcurementPlanPage = lazyRouteComponent(
  () => import("./pages/ProcurementPlanPage"),
  "ProcurementPlanPage",
);
const LazySmartProcurementGenerationPage = lazyRouteComponent(
  () => import("./pages/SmartProcurementGenerationPage"),
  "SmartProcurementGenerationPage",
);
const LazyProcurementOrderPage = lazyRouteComponent(
  () => import("./pages/ProcurementOrderPage"),
  "ProcurementOrderPage",
);
const LazySupplierManagementPage = lazyRouteComponent(
  () => import("./pages/SupplierManagementPage"),
  "SupplierManagementPage",
);
const LazyProcurementReviewPage = lazyRouteComponent(
  () => import("./pages/ProcurementReviewPage"),
  "ProcurementReviewPage",
);
const LazyProcurementReceivingPage = lazyRouteComponent(
  () => import("./pages/ProcurementReceivingPage"),
  "ProcurementReceivingPage",
);
const LazyProcurementReturnPage = lazyRouteComponent(
  () => import("./pages/ProcurementReturnPage"),
  "ProcurementReturnPage",
);
const LazyProcurementFollowUpPage = lazyRouteComponent(
  () => import("./pages/ProcurementFollowUpPage"),
  "ProcurementFollowUpPage",
);
const LazyIamConsolePage = lazyRouteComponent(
  () => import("./pages/IamConsolePage"),
  "IamConsolePage",
);
const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: Outlet,
  errorComponent: RouteErrorPage,
  notFoundComponent: NotFoundPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "login",
  validateSearch: (search: Record<string, unknown>) => ({
    redirect: sanitizePostLoginRedirect(search.redirect),
    application: search.application === "ERP" ? "ERP" as const : undefined,
    returnTo: sanitizePostLoginRedirect(search.returnTo),
    state: typeof search.state === "string" ? search.state : undefined,
  }),
  staticData: { title: "登录" } satisfies ErpRouteHandle,
  component: LoginPage,
});

const platformLoginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "platform-admin/login",
  component: LazyPlatformAdminLoginPage,
});
const platformCredentialRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "platform-admin/activate",
  component: LazyPlatformCredentialPage,
});
const platformLogoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "platform-admin/logout",
  component: PlatformAdminLogoutPage,
});
const platformAuthenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "platform-authenticated",
  beforeLoad: ({ context }) => {
    if (context.platform.status === "unauthenticated")
      throw redirect({ to: "/platform-admin/login", replace: true });
  },
  component: PlatformProtectedRoute,
});
const platformConsoleRoute = createRoute({
  getParentRoute: () => platformAuthenticatedRoute,
  path: "platform-admin",
  component: LazyPlatformAdminConsolePage,
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "authenticated",
  beforeLoad: ({ context, location }) => {
    if (context.auth.status === "unauthenticated") {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
          application: undefined,
          returnTo: undefined,
          state: undefined,
        },
        replace: true,
      });
    }
  },
  component: ProtectedRoute,
});

const appShellRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  id: "app-shell",
  component: AppShell,
});

const dashboardRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "/",
  staticData: { title: "工作台" } satisfies ErpRouteHandle,
  component: LazyDashboardPage,
});

const memberApplicationAccessRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "settings/application-access",
  staticData: { title: "员工应用权限" } satisfies ErpRouteHandle,
  component: LazyMemberApplicationAccessPage,
});

const shopsModule = moduleDefinitions.find((module) => module.id === "shops")!;
const ordersModule = moduleDefinitions.find((module) => module.id === "orders")!;
const productsModule = moduleDefinitions.find(
  (module) => module.id === "products",
)!;
const procurementModule = moduleDefinitions.find(
  (module) => module.id === "procurement",
)!;
const supplierModule: ModuleDefinition = {
  ...procurementModule,
  id: "suppliers",
  label: "供应商",
  requiredPermission: "suppliers.read",
};
const warehousesModule = moduleDefinitions.find(
  (module) => module.id === "warehouses",
)!;
const inventoryModule = moduleDefinitions.find(
  (module) => module.id === "inventory",
)!;
const logisticsModule = moduleDefinitions.find(
  (module) => module.id === "logistics",
)!;
const analyticsModule = moduleDefinitions.find((module) => module.id === "analytics")!;
const settingsModule = moduleDefinitions.find((module) => module.id === "settings")!;
const employeeListModule: ModuleDefinition = {
  ...settingsModule,
  id: "employees",
  label: "员工列表",
  requiredPermission: "iam:user:read",
};

const warehouseLocationsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "warehouses/locations",
  staticData: {
    title: "库位列表",
    moduleId: warehousesModule.id,
  } satisfies ErpRouteHandle,
  component: function WarehouseLocationsRoute() {
    return (
      <ModuleAccessGate module={warehousesModule}>
        <LazyWarehouseCenterPage view="locations" />
      </ModuleAccessGate>
    );
  },
});

const shopDetailRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "shops/$shopId",
  staticData: {
    title: "店铺详情",
    moduleId: shopsModule.id,
  } satisfies ErpRouteHandle,
  component: function ShopDetailRoute() {
    const params = useParams({ strict: false });
    const shopId =
      "shopId" in params && typeof params.shopId === "string"
        ? params.shopId
        : "";
    return (
      <ModuleAccessGate module={shopsModule}>
        <LazyShopDetailPage shopId={shopId} />
      </ModuleAccessGate>
    );
  },
});

const orderDetailRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "orders/$orderId",
  staticData: {
    title: "订单详情",
    moduleId: ordersModule.id,
  } satisfies ErpRouteHandle,
  component: function OrderDetailRoute() {
    const params = useParams({ strict: false });
    const orderId =
      "orderId" in params && typeof params.orderId === "string"
        ? params.orderId
        : "";
    return (
      <ModuleAccessGate module={ordersModule}>
        <LazyOrderDetailPage orderId={orderId} />
      </ModuleAccessGate>
    );
  },
});

const shopifyCustomerDirectoryRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "orders/customers",
  staticData: {
    title: "客户档案",
    moduleId: ordersModule.id,
  } satisfies ErpRouteHandle,
  component: function ShopifyCustomerDirectoryRoute() {
    return <ModuleAccessGate module={ordersModule}><LazyShopifyCustomerDirectoryPage /></ModuleAccessGate>;
  },
});

const shopifyReturnRefundRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "orders/returns",
  staticData: {
    title: "退货与退款",
    moduleId: ordersModule.id,
  } satisfies ErpRouteHandle,
  component: function ShopifyReturnRefundRoute() {
    return <ModuleAccessGate module={ordersModule}><LazyShopifyReturnRefundPage /></ModuleAccessGate>;
  },
});

const shopifyDisputeRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "orders/disputes",
  staticData: {
    title: "拒付管理",
    moduleId: ordersModule.id,
  } satisfies ErpRouteHandle,
  component: function ShopifyDisputeRoute() {
    return <ModuleAccessGate module={ordersModule}><LazyShopifyDisputePage /></ModuleAccessGate>;
  },
});

const productMasterNewRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "products/master/new",
  staticData: {
    title: "新增主商品",
    moduleId: productsModule.id,
  } satisfies ErpRouteHandle,
  component: function ProductMasterNewRoute() {
    return (
      <ModuleAccessGate module={productsModule}>
        <LazyProductMasterDataPage initialMode="edit" />
      </ModuleAccessGate>
    );
  },
});

const inventoryQueryRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "products/inventory-query",
  staticData: {
    title: "库存查询",
    moduleId: productsModule.id,
  } satisfies ErpRouteHandle,
  component: function InventoryQueryRoute() {
    return (
      <ModuleAccessGate module={inventoryModule}>
        <LazyInventoryQueryPage />
      </ModuleAccessGate>
    );
  },
});

const inventoryCountRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "warehouses/counts",
  staticData: {
    title: "库存盘点",
    moduleId: warehousesModule.id,
  } satisfies ErpRouteHandle,
  component: function InventoryCountRoute() {
    return (
      <ModuleAccessGate module={inventoryModule}>
        <LazyInventoryCountPage />
      </ModuleAccessGate>
    );
  },
});

const warehouseTransferRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "warehouses/transfers",
  staticData: {
    title: "分仓调拨",
    moduleId: warehousesModule.id,
  } satisfies ErpRouteHandle,
  component: function WarehouseTransferRoute() {
    return (
      <ModuleAccessGate module={inventoryModule}>
        <LazyWarehouseTransferPage />
      </ModuleAccessGate>
    );
  },
});

const inboundOutboundDocumentsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "warehouses/documents",
  staticData: {
    title: "入 / 出库单",
    moduleId: warehousesModule.id,
  } satisfies ErpRouteHandle,
  component: function InboundOutboundDocumentsRoute() {
    return (
      <ModuleAccessGate module={inventoryModule}>
        <LazyInboundOutboundDocumentsPage />
      </ModuleAccessGate>
    );
  },
});

const logisticsAuthorizationRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/authorizations",
  staticData: {
    title: "物流授权",
    moduleId: logisticsModule.id,
  } satisfies ErpRouteHandle,
  component: function LogisticsAuthorizationRoute() {
    return (
      <ModuleAccessGate module={logisticsModule}>
        <LazyLogisticsAuthorizationPage />
      </ModuleAccessGate>
    );
  },
});

const logisticsAuthorizationChannelsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/authorizations/$authorizationId/channels",
  staticData: {
    title: "物流渠道",
    moduleId: logisticsModule.id,
  } satisfies ErpRouteHandle,
  component: function LogisticsAuthorizationChannelsRoute() {
    const params = useParams({ strict: false });
    const authorizationId =
      "authorizationId" in params && typeof params.authorizationId === "string"
        ? params.authorizationId
        : "";
    return (
      <ModuleAccessGate module={logisticsModule}>
        <LazyLogisticsAuthorizationChannelsPage authorizationId={authorizationId} />
      </ModuleAccessGate>
    );
  },
});

const logisticsMatchingRulesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/matching-rules",
  staticData: {
    title: "物流匹配规则",
    moduleId: logisticsModule.id,
  } satisfies ErpRouteHandle,
  component: function LogisticsMatchingRulesRoute() {
    return (
      <ModuleAccessGate module={logisticsModule}>
        <LazyLogisticsMatchingRulesPage />
      </ModuleAccessGate>
    );
  },
});

const logisticsAddressManagementRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/addresses",
  staticData: {
    title: "地址管理",
    moduleId: logisticsModule.id,
  } satisfies ErpRouteHandle,
  component: function LogisticsAddressManagementRoute() {
    return (
      <ModuleAccessGate module={logisticsModule}>
        <LazyLogisticsAddressManagementPage />
      </ModuleAccessGate>
    );
  },
});

const logisticsTrackingNumberRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/tracking-numbers",
  staticData: {
    title: "运单号管理",
    moduleId: logisticsModule.id,
  } satisfies ErpRouteHandle,
  component: function LogisticsTrackingNumberRoute() {
    return (
      <ModuleAccessGate module={logisticsModule}>
        <LazyLogisticsTrackingNumberPage />
      </ModuleAccessGate>
    );
  },
});

const logisticsTrackingRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/tracking",
  staticData: {
    title: "物流跟踪",
    moduleId: logisticsModule.id,
  } satisfies ErpRouteHandle,
  component: function LogisticsTrackingRoute() {
    return (
      <ModuleAccessGate module={logisticsModule}>
        <LazyLogisticsTrackingPage />
      </ModuleAccessGate>
    );
  },
});

const logisticsFeeRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/fees",
  staticData: { title: "物流费用", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsFeeRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsFeePage /></ModuleAccessGate>;
  },
});

const logisticsForecastRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/forecasts",
  staticData: { title: "上传预报单", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsForecastRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsForecastPage /></ModuleAccessGate>;
  },
});

const logisticsStatisticsRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/statistics",
  staticData: { title: "物流统计", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsStatisticsRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsStatisticsPage /></ModuleAccessGate>;
  },
});

const logisticsInquiryRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/inquiries",
  staticData: { title: "物流询价", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsInquiryRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsInquiryPage /></ModuleAccessGate>;
  },
});

const logisticsDeclarationEntityRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/declaration-entities",
  staticData: { title: "企业申报信息管理", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsDeclarationEntityRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsDeclarationEntityPage /></ModuleAccessGate>;
  },
});

const customShippingFeeRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/custom-fees",
  staticData: { title: "自定义运费", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function CustomShippingFeeRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyCustomShippingFeePage /></ModuleAccessGate>;
  },
});

const logisticsLabelTemplateRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/label-templates",
  staticData: { title: "标签模板", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsLabelTemplateRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsLabelTemplatePage /></ModuleAccessGate>;
  },
});

const logisticsTrackingWorkbenchRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "logistics/tracking/workbench",
  staticData: { title: "物流跟踪工作台", moduleId: logisticsModule.id } satisfies ErpRouteHandle,
  component: function LogisticsTrackingWorkbenchRoute() {
    return <ModuleAccessGate module={logisticsModule}><LazyLogisticsTrackingWorkbenchPage /></ModuleAccessGate>;
  },
});

const productMasterRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "products/master/$spuId",
  staticData: {
    title: "主商品详情",
    moduleId: productsModule.id,
  } satisfies ErpRouteHandle,
  component: function ProductMasterRoute() {
    const params = useParams({ strict: false });
    const search = useRouterState({
      select: (state) => state.location.searchStr,
    });
    const spuId =
      "spuId" in params && typeof params.spuId === "string"
        ? params.spuId
        : "";
    return (
      <ModuleAccessGate module={productsModule}>
        <LazyProductMasterDataPage
          spuId={spuId}
          initialMode={
            new URLSearchParams(search).get("mode") === "edit"
              ? "edit"
              : undefined
          }
        />
      </ModuleAccessGate>
    );
  },
});

const procurementPlanRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/plans",
  staticData: {
    title: "历史采购计划",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function ProcurementPlanRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazyProcurementPlanPage />
      </ModuleAccessGate>
    );
  },
});

const smartProcurementGenerationRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/smart-generation",
  staticData: {
    title: "智能生成采购单",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function SmartProcurementGenerationRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazySmartProcurementGenerationPage />
      </ModuleAccessGate>
    );
  },
});

const procurementOrderRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/orders",
  staticData: {
    title: "采购单",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function ProcurementOrderRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazyProcurementOrderPage />
      </ModuleAccessGate>
    );
  },
});

const supplierManagementRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/suppliers",
  staticData: {
    title: "供应商",
    moduleId: supplierModule.id,
  } satisfies ErpRouteHandle,
  component: function SupplierManagementRoute() {
    return (
      <ModuleAccessGate module={supplierModule}>
        <LazySupplierManagementPage />
      </ModuleAccessGate>
    );
  },
});

const procurementReviewRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/reviews",
  staticData: {
    title: "采购审核",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function ProcurementReviewRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazyProcurementReviewPage />
      </ModuleAccessGate>
    );
  },
});

const procurementReceivingRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/receiving",
  staticData: {
    title: "签收入库",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function ProcurementReceivingRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazyProcurementReceivingPage />
      </ModuleAccessGate>
    );
  },
});

const procurementReturnRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/returns",
  staticData: {
    title: "退货管理",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function ProcurementReturnRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazyProcurementReturnPage />
      </ModuleAccessGate>
    );
  },
});

const procurementFollowUpRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/follow-up",
  staticData: {
    title: "采购跟单",
    moduleId: procurementModule.id,
  } satisfies ErpRouteHandle,
  component: function ProcurementFollowUpRoute() {
    return (
      <ModuleAccessGate module={procurementModule}>
        <LazyProcurementFollowUpPage />
      </ModuleAccessGate>
    );
  },
});

const purchaserPerformanceRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/statistics/purchaser-performance",
  staticData: { title: "采购员绩效", moduleId: procurementModule.id } satisfies ErpRouteHandle,
  component: function PurchaserPerformanceRoute() {
    return <ModuleAccessGate module={procurementModule}><LazyPurchaserPerformancePage /></ModuleAccessGate>;
  },
});

const procurementLedgerRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "procurement/statistics/ledger",
  staticData: { title: "采购流水", moduleId: procurementModule.id } satisfies ErpRouteHandle,
  component: function ProcurementLedgerRoute() {
    return <ModuleAccessGate module={procurementModule}><LazyProcurementLedgerPage /></ModuleAccessGate>;
  },
});

const analyticsInventoryReportRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/products/inventory-report",
  staticData: { title: "进销存报表", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsInventoryReportRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsInventoryReportPage /></ModuleAccessGate>;
  },
});

const analyticsInventoryAgingReportRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/products/inventory-aging",
  staticData: { title: "库龄分析", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsInventoryAgingReportRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsInventoryAgingReportPage /></ModuleAccessGate>;
  },
});

const analyticsStoreHealthRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/stores/health",
  staticData: { title: "店铺健康", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsStoreHealthRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsStoreHealthPage /></ModuleAccessGate>;
  },
});

const analyticsOrderStatusReportRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/sales/order-status",
  staticData: { title: "订单状态报表", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsOrderStatusReportRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsOrderStatusReportPage /></ModuleAccessGate>;
  },
});

const analyticsProductSalesReportRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/sales/product-sales",
  staticData: { title: "商品销量报表", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsProductSalesReportRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsProductSalesReportPage /></ModuleAccessGate>;
  },
});

const analyticsOrderAnalysisRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/sales/order-analysis",
  staticData: { title: "订单分析", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsOrderAnalysisRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsOrderAnalysisPage /></ModuleAccessGate>;
  },
});

const analyticsListingRealtimeSalesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/sales/listing-realtime",
  staticData: { title: "Listing实时销量", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsListingRealtimeSalesRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsListingRealtimeSalesPage /></ModuleAccessGate>;
  },
});

const analyticsInventoryRealtimeSalesRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "analytics/sales/inventory-realtime",
  staticData: { title: "库存实时销量", moduleId: analyticsModule.id } satisfies ErpRouteHandle,
  component: function AnalyticsInventoryRealtimeSalesRoute() {
    return <ModuleAccessGate module={analyticsModule}><LazyAnalyticsInventoryRealtimeSalesPage /></ModuleAccessGate>;
  },
});

const iamConsoleRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "settings/iam",
  staticData: { title: "组织与权限" } satisfies ErpRouteHandle,
  component: LazyIamConsolePage,
});

const employeeListRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "settings/employees",
  staticData: { title: "员工列表", moduleId: employeeListModule.id } satisfies ErpRouteHandle,
  component: function EmployeeListRoute() {
    return <ModuleAccessGate module={employeeListModule}><Navigate to="/settings/iam" search={{ view: "members" } as never} replace /></ModuleAccessGate>;
  },
});

function createSettingsTaskRoute(path: string, title: string, Page: ElementType) {
  return createRoute({
    getParentRoute: () => appShellRoute,
    path,
    staticData: { title, moduleId: settingsModule.id } satisfies ErpRouteHandle,
    component: function SettingsTaskRoute() { return <ModuleAccessGate module={settingsModule}><Page /></ModuleAccessGate>; },
  });
}

const settingsApprovalDocumentsRoute = createSettingsTaskRoute("settings/tasks/approvals", "审核单据", LazySettingsApprovalDocumentsPage);
const settingsTaskListRoute = createSettingsTaskRoute("settings/tasks/list", "任务列表", LazySettingsTaskListPage);
const settingsMessageCenterRoute = createSettingsTaskRoute("settings/tasks/messages", "消息中心", LazySettingsMessageCenterPage);
const settingsImportExportTasksRoute = createSettingsTaskRoute("settings/tasks/import-export", "导入/导出任务", LazySettingsImportExportTasksPage);
const settingsAttachmentDownloadsRoute = createSettingsTaskRoute("settings/tasks/attachments", "附件下载", LazySettingsAttachmentDownloadsPage);
const settingsTaskCenterRoute = createSettingsTaskRoute("settings/tasks/center", "任务中心", LazySettingsTaskCenterPage);
const settingsInternalNoticesRoute = createSettingsTaskRoute("settings/tasks/notices", "内部公告", LazySettingsInternalNoticesPage);
const settingsAliasManagementRoute = createSettingsTaskRoute("settings/parameters/aliases", "别名管理", LazySettingsAliasManagementPage);
const settingsOrderExceptionConfigRoute = createSettingsTaskRoute("settings/parameters/order-exceptions", "订单异常分类处理配置", LazySettingsOrderExceptionConfigPage);
const settingsShippingDeadlineRoute = createSettingsTaskRoute("settings/parameters/shipping-deadline", "订单发货期限设置", LazySettingsShippingDeadlinePage);
const settingsApprovalRulesRoute = createSettingsTaskRoute("settings/parameters/approval-rules", "审批规则设置", LazySettingsApprovalRulesPage);
const settingsAddressMappingRoute = createSettingsTaskRoute("settings/parameters/address-mappings", "地址映射配置", LazySettingsAddressMappingPage);
const settingsTaskManagementRoute = createSettingsTaskRoute("settings/system/task-management", "任务管理", LazySettingsTaskManagementPage);
const settingsGeneralConfigurationRoute = createSettingsTaskRoute("settings/system/general", "系统设置", LazySettingsGeneralConfigurationPage);
const settingsEnterpriseInformationRoute = createSettingsTaskRoute("settings/system/enterprise", "企业信息", LazySettingsEnterpriseInformationPage);
const erpOperatorConsoleRoute = createRoute({
  getParentRoute: () => appShellRoute,
  path: "settings/system/erp-operator",
  staticData: { title: "ERP 运维", moduleId: settingsModule.id } satisfies ErpRouteHandle,
  component: function ErpOperatorConsoleRoute() {
    const { session } = useAuth();
    return session?.platformAdmin
      ? <LazyErpOperatorConsolePage />
      : <Navigate to={"/settings/system/general" as never} replace />;
  },
});

function createModuleRoute(module: ModuleDefinition) {
  return createRoute({
    getParentRoute: () => appShellRoute,
    path: module.path.slice(1),
    staticData: {
      title: module.id === "warehouses" ? "仓库列表" : module.label,
      moduleId: module.id,
    } satisfies ErpRouteHandle,
    component: function ModuleRoute() {
      return (
        <ModuleAccessGate module={module}>
          {module.id === "shops" ? (
            <LazyShopCenterPage />
          ) : module.id === "products" ? (
            <LazyProductCenterPage />
          ) : module.id === "orders" ? (
            <LazyOrderCenterPage />
          ) : module.id === "warehouses" ? (
            <LazyWarehouseCenterPage />
          ) : module.id === "inventory" ? (
            <LazyManualMovementPage />
          ) : (
            <LazyModulePage module={module} />
          )}
        </ModuleAccessGate>
      );
    },
  });
}

const moduleRoutes = moduleDefinitions.map(createModuleRoute);

const platformControlPlaneRoutes = [
  platformLoginRoute,
  platformCredentialRoute,
  platformLogoutRoute,
  platformAuthenticatedRoute.addChildren([platformConsoleRoute]),
];

const routeTree = rootRoute.addChildren([
  loginRoute,
  createRoute({ getParentRoute: () => rootRoute, path: "/shopify/link", component: LazyShopifyNativeLinkPage }),
  ...platformControlPlaneRoutes,
  authenticatedRoute.addChildren([
    createRoute({ getParentRoute: () => authenticatedRoute, path: "/customer-service", component: CustomerServiceEntryPage }),
    appShellRoute.addChildren([
      dashboardRoute,
      memberApplicationAccessRoute,
      ...moduleRoutes,
      warehouseLocationsRoute,
      shopDetailRoute,
      orderDetailRoute,
      shopifyCustomerDirectoryRoute,
      shopifyReturnRefundRoute,
      shopifyDisputeRoute,
      inventoryQueryRoute,
      inventoryCountRoute,
      warehouseTransferRoute,
      inboundOutboundDocumentsRoute,
      logisticsAuthorizationRoute,
      logisticsAuthorizationChannelsRoute,
      logisticsMatchingRulesRoute,
      logisticsAddressManagementRoute,
      logisticsTrackingNumberRoute,
      logisticsTrackingRoute,
      logisticsFeeRoute,
      logisticsForecastRoute,
      logisticsStatisticsRoute,
      logisticsInquiryRoute,
      logisticsDeclarationEntityRoute,
      customShippingFeeRoute,
      logisticsLabelTemplateRoute,
      logisticsTrackingWorkbenchRoute,
      productMasterNewRoute,
      productMasterRoute,
      procurementPlanRoute,
      smartProcurementGenerationRoute,
      procurementOrderRoute,
      supplierManagementRoute,
      procurementReviewRoute,
      procurementReceivingRoute,
      procurementReturnRoute,
      procurementFollowUpRoute,
      purchaserPerformanceRoute,
      procurementLedgerRoute,
      analyticsInventoryReportRoute,
      analyticsInventoryAgingReportRoute,
      analyticsStoreHealthRoute,
      analyticsOrderStatusReportRoute,
      analyticsProductSalesReportRoute,
      analyticsOrderAnalysisRoute,
      analyticsListingRealtimeSalesRoute,
      analyticsInventoryRealtimeSalesRoute,
      settingsApprovalDocumentsRoute,
      settingsTaskListRoute,
      settingsMessageCenterRoute,
      settingsImportExportTasksRoute,
      settingsAttachmentDownloadsRoute,
      settingsTaskCenterRoute,
      settingsInternalNoticesRoute,
      settingsAliasManagementRoute,
      settingsOrderExceptionConfigRoute,
      settingsShippingDeadlineRoute,
      settingsApprovalRulesRoute,
      settingsAddressMappingRoute,
      settingsTaskManagementRoute,
      settingsGeneralConfigurationRoute,
      settingsEnterpriseInformationRoute,
      erpOperatorConsoleRoute,
      employeeListRoute,
      iamConsoleRoute,
    ]),
  ]),
]);

export const router = createRouter({
  routeTree,
  // Business pages read flat URLSearchParams. Keep literal keywords and avoid
  // JSON-quoting string pagination/boolean values produced by navigation links.
  parseSearch: parseSearchWith((value) => value),
  stringifySearch: stringifySearchWith(JSON.stringify),
  context: {
    auth: undefined!,
    platform: undefined!,
  },
  defaultPreload: "intent",
  defaultPendingComponent: RouteLoadingState,
  defaultErrorComponent: RouteErrorPage,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function App() {
  const auth = useAuth();
  const platform = usePlatformAdmin();

  useEffect(() => {
    void router.invalidate();
  }, [auth.session, auth.status, platform.session, platform.status]);

  return <RouterProvider router={router} context={{ auth, platform }} />;
}

function RouteLoadingState() {
  return (
    <main className="full-page-state" aria-busy="true" aria-live="polite">
      <h1>正在加载页面</h1>
      <p>正在准备模块资源，请稍候。</p>
    </main>
  );
}

function PlatformAdminLogoutPage() {
  const { logout } = usePlatformAdmin();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void logout().finally(() => {
      window.location.replace("/platform-admin/login");
    });
  }, [logout]);

  return (
    <main className="full-page-state" aria-busy="true" aria-live="polite">
      <h1>正在退出平台管理</h1>
      <p>正在安全结束平台管理员会话，请稍候。</p>
    </main>
  );
}
