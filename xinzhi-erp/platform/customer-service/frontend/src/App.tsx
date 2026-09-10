import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, CircleAlert, CircleDot, ClipboardList, LogOut, MessageSquareText, RefreshCw, Settings, X } from "lucide-react";
import { AuthResult, cleanBaseUrl, Conversation, DataScopeModule, Message, PlatformAPI, PlatformAPIError, PlatformEvent, Shop, ShopSource, Ticket, User } from "./api";
import {
  adminMenuGroupsForSection,
  adminMenuItem,
  adminSectionForView,
  adminSectionMeta,
  adminViewLabel,
  viewSubtitle,
  viewTitle,
  type AdminMenuItem,
  type AdminSectionKey,
  type AdminViewKey,
  type ImplementedAdminViewKey,
  type ViewKey
} from "./features/navigation/adminNavigation";
import { NavButton } from "./components/ui";
import { LanguageSelect } from "./components/LanguageSelect";
import { AuthPanel } from "./features/auth/AuthPanel";
import { KnowledgePanel } from "./features/knowledge/KnowledgePanel";
import { MonitorPanel } from "./features/monitor/MonitorPanel";
import { DisputeManagementPanel } from "./features/orders/DisputeManagementPanel";
import { OrderOperationsPanel } from "./features/orders/OrderOperationsPanel";
import { ProcessingRecordsPanel } from "./features/records/ProcessingRecordsPanel";
import { RecordCategoriesPanel } from "./features/records/RecordCategoriesPanel";
import { AgentsPanel } from "./features/settings/AgentsPanel";
import { AISettingsPanel } from "./features/settings/AISettingsPanel";
import { LogisticsSettingsPanel } from "./features/settings/LogisticsSettingsPanel";
import { EmailProviderSettingsPanel } from "./features/settings/EmailProviderSettingsPanel";
import { ShopsPanel } from "./features/shops/ShopsPanel";
import { type Language, type ToastMessage, type ToastTone } from "./features/shared/types";
import { errorText, isAuthExpiredError, readStoredAuth, readStoredLanguage, storeAuth } from "./features/shared/helpers";
import { emitPlatformEvent } from "./features/shared/platformEvents";
import { VisitorSchemesPanel } from "./features/visitor-schemes/VisitorSchemesPanel";
import { CustomerLoginPanel } from "./features/customer-login/CustomerLoginPanel";
import { ERPLoginPanel } from "./features/auth/ERPLoginPanel";
import { WorkbenchPanel } from "./features/workbench/WorkbenchPanel";
import { TicketPanel } from "./features/tickets/TicketPanel";
import { EmailProcessingPanel } from "./features/email-processing/EmailProcessingPanel";
import { EmailStatisticsPanel } from "./features/email-statistics/EmailStatisticsPanel";
import { PlannedAdminPanel } from "./features/navigation/PlannedAdminPanel";
import { HistoricalStatisticsPanel } from "./features/statistics/HistoricalStatisticsPanel";
import { hasPermission, PERMISSIONS, type PermissionKey } from "./permissions";

const baseUrlKey = "support-platform.base-url";
const languageKey = "support-platform.language";
const navigationStateKey = "support-platform.navigation-state";
const defaultBaseUrl = resolveDefaultBaseUrl();
const conversationPageSize = 50;
const messagePageSize = 50;
const eventHeartbeatTimeoutMs = 50_000;
const viewDataCacheMs = 2 * 60_000;
const eventReconnectDelaysMs = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000] as const;
type EventConnectionStatus = "disconnected" | "connecting" | "connected" | "reconnecting";
type WorkbenchConversationWindow = { items: Conversation[]; hasMore: boolean };

function latestValidConversationTime(...values: Array<string | undefined>) {
  let latestValue = "";
  let latestTime = 0;
  values.forEach((value) => {
    const parsed = Date.parse(value || "");
    if (Number.isFinite(parsed) && parsed > latestTime) {
      latestTime = parsed;
      latestValue = value || "";
    }
  });
  return latestValue;
}

function mergeRealtimeConversation(existing: Conversation | undefined, incoming: Conversation, message?: Message) {
  const customerMessageAt = message?.direction === "customer" ? message.createdAt : "";
  const customerLastMessageAt = latestValidConversationTime(
    existing?.customerLastMessageAt,
    incoming.customerLastMessageAt,
    customerMessageAt
  ) || latestValidConversationTime(incoming.lastMessageAt, existing?.lastMessageAt);
  return { ...existing, ...incoming, customerLastMessageAt };
}

async function listWorkbenchConversationWindow(api: PlatformAPI, scope: "assigned" | "all", page: number, pageSize: number): Promise<WorkbenchConversationWindow> {
  const [assigned, open] = await Promise.all([
    api.listConversations({ scope, status: "assigned", activeOnly: true, page, pageSize }),
    api.listConversations({ scope, status: "open", activeOnly: true, page, pageSize })
  ]);
  const byID = new Map<string, Conversation>();
  [...assigned, ...open].forEach((conversation) => byID.set(conversation.id, conversation));
  return { items: Array.from(byID.values()), hasMore: assigned.length === pageSize || open.length === pageSize };
}

const historicalStatisticsViews: AdminViewKey[] = [
  "conversationStats",
  "customerStats",
  "agentStats",
  "skillStats",
  "serviceSummaryStats",
  "slaStats"
];

const i18n = {
  zh: {
    language: "显示语言",
    chinese: "中文",
    english: "English",
    connecting: "正在连接平台服务",
    serverChecking: "检测服务器中",
    normal: "正常",
    abnormal: "异常",
    initFirstAdmin: "请初始化第一个管理员账号",
    loginRequired: "请登录客服平台",
    dataRefreshed: "平台数据已刷新",
    serverSaved: "服务器地址已保存",
    loggedIn: "已登录",
    loggedOut: "已退出登录",
    refresh: "刷新",
    logout: "退出",
    connect: "连接",
    onlineService: "在线客服",
    shopManagement: "店铺管理",
    agentAccounts: "子账号",
    serviceList: "客服列表",
    managementCenter: "管理中心",
    customerService: "客服管理",
    seatList: "子账号",
    shopsAndSources: "店铺与渠道",
    rolePermissions: "角色权限管理",
    authInitTitle: "初始化 Xzdesk Admin",
    authLoginTitle: "登录 Xzdesk",
    authInitDesc: "当前服务器还没有账号，先创建第一个管理员。",
    authLoginDesc: "使用管理员或子账号进入 Xzdesk。",
    nativeTenantLabel: "企业标识",
    nativeTenantHelp: "使用管理员提供的客服企业标识；不会自动创建或加入企业。",
    email: "邮箱",
    name: "名称",
    password: "密码",
    createAdmin: "创建管理员",
    login: "登录",
    authSideTitle: "Xzdesk server + agent client",
    authSideDesc: "账号、店铺、会话和消息由服务器统一保存。Xzdesk Agent 负责客服接待，后续扩展 Xzdesk Admin、Insights、SLA、Xzdesk Chat 和 Xzdesk Mail。",
    shopAssignment: "店铺分配",
    servicePermission: "客服权限",
    realtimeChat: "实时会话",
    multiSourceMessages: "多来源消息",
    createAccount: "创建账号",
    accountList: "账号列表",
    role: "角色",
    agent: "客服",
    admin: "管理员",
    create: "创建",
    accountCreated: "账号已创建",
    shop: "店铺",
    shopName: "店铺域名或后台链接",
    add: "添加",
    addShopHint: "留空时使用当前选中的店铺；也可输入 myshopify 域名或 Shopify 后台链接。点击添加后生成安装链接，安装完成后自动创建店铺。",
    invalidShopDomain: "请输入有效的 Shopify 店铺域名或后台链接",
    installLinkCopied: "安装链接已生成并复制",
    installLinkReady: "安装链接已生成",
    copyInstallLink: "复制链接",
    openInstallLink: "打开安装",
    selectShop: "选择店铺",
    sources: "消息来源",
    active: "个已启用",
    notConfigured: "未配置",
    readyToTest: "可测试",
    notEnabled: "未启用",
    connected: "已接入",
    installApp: "安装应用",
    agents: "客服分配",
    assigned: "人",
    unassigned: "未分配",
    setupTitle: "Xzdesk Shopify 设置",
    openAppEmbeds: "打开应用嵌入",
    previewStore: "预览店铺",
    setupNote: "绑定 Shopify 店铺，配置 Xzdesk Chat 和客服路由，然后在 Shopify 主题编辑器里启用聊天应用嵌入。",
    stepBindTitle: "1. 绑定 Shopify 店铺",
    stepBindDone: "应用已安装，订单/客户 API 已接入。",
    stepBindTodo: "先安装并授权 Shopify 应用。",
    stepVisitorTitle: "2. 配置访客方案",
    stepVisitorDone: "Xzdesk Chat 已启用。",
    stepVisitorTodo: "启用 Xzdesk Chat 作为客户入口。",
    stepWidgetTitle: "3. 启用聊天组件",
    stepWidgetDetail: "打开 Shopify 在线商店 -> 模板 -> 自定义 -> 应用嵌入，关闭在线商店聊天（Inbox），开启并保持 Xzdesk Chat，然后保存。",
    stepRoutingTitle: "4. 配置路由",
    stepRoutingTodo: "至少分配一个客服，后续可扩展路由和排队规则。",
    stepRoutingDone: "已分配客服。",
    stepOrdersTitle: "5. 工作台核查订单",
    stepOrdersDone: "客服可在右侧面板查询 Shopify 订单。",
    stepOrdersTodo: "需要先启用 Shopify API 来源。",
    visitorScheme: "访客方案",
    editable: "可编辑",
    enableChatFirst: "先启用 Xzdesk Chat",
    visitorLanguage: "访客语言",
    visitorLanguageAuto: "自动识别，当前不支持时回退英文",
    visitorLanguageEnglish: "English",
    saveVisitorScheme: "保存访客方案",
    visitorSchemeSaved: "访客方案已保存",
    messageSources: "消息来源",
    addressOptional: "地址或账号，可选",
    addSource: "添加来源",
    sourceAdded: "来源已添加",
    sourceExists: "该来源已存在并启用",
    enabled: "启用",
    disabled: "停用",
    enable: "启用",
    disable: "停用",
    noAddress: "无地址",
    noSources: "暂无来源。可添加 Xzdesk Chat、Shopify Inbox、Shopify Connector 或 Xzdesk Mail。",
    storefrontWidget: "店铺聊天组件",
    agentAssignment: "客服分配",
    selectAgent: "选择客服",
    assign: "分配",
    remove: "移除",
    agentAssigned: "客服已分配",
    agentUnassigned: "已取消分配",
    noAgentAssigned: "这个店铺还没有分配客服。",
    selectStoreFirst: "先从左侧选择一个店铺。",
    myConversations: "我的会话",
    allStores: "全部店铺",
    chatChannel: "Chat",
    emailChannel: "邮箱",
    assignedStoresEmpty: "暂无已分配店铺，请先在店铺与渠道中分配接待人员。",
    conversationList: "会话列表",
    expandShop: "展开店铺",
    collapseShop: "收起店铺",
    unselectedShop: "未选择店铺",
    selectStoreAria: "选择店铺",
    inConversation: "会话中",
    queue: "排队",
    visitors: "访客",
    receptionLimit: "接待上限 50",
    customerName: "客户名",
    issueSummary: "问题摘要",
    newConversation: "新建",
    offlineConversations: "离线会话",
    visitor: "访客",
    noSubject: "无主题",
    noConversations: "暂无会话",
    unknownSource: "未知来源",
    conversationCreated: "会话已创建",
    messageRecorded: "消息已记录",
    conversationUpdated: "会话状态已更新",
    claimSucceeded: "会话已由你接入",
    closeSucceeded: "会话已结束",
    reopenSucceeded: "会话已重新接入",
    conversationClaimedByOther: "该会话已被其他客服接入，列表已刷新。",
    assignedToYou: "由你接待",
    assignedToOther: "其他客服接待中",
    claimBeforeReply: "请先接入会话后再回复",
    closedReadOnly: "会话已结束，重新打开后才能回复",
    replyFailed: "回复失败",
    actionFailed: "失败",
    noMatchingOrder: "没有匹配订单",
    claim: "接入",
    closeConversation: "结束会话",
    reopen: "重新打开",
    orderPending: "订单待核查",
    logisticsPending: "物流待同步",
    originalPage: "原始页面",
    serviceAgent: "客服",
    customer: "客户",
    noMessages: "暂无消息记录",
    aiDraft: "AI 草稿",
    replyPlaceholder: "输入回复内容...",
    sendRecord: "发送/记录",
    noConversationContent: "没有会话内容",
    noConversationHint: "当客户接入后，从左侧客户列表中选择客户开始会话",
    customerAndOrders: "客户与订单",
    shopifyCheck: "Shopify API 核查",
    noCustomerSelected: "未选择客户",
    waitingConversation: "等待会话",
    orderSearchPlaceholder: "邮箱、订单号或客户名",
    searching: "搜索中",
    findOrder: "查订单",
    orderResults: "订单结果",
    unknownPayment: "未知付款状态",
    unfulfilled: "未履约",
    searchOrderHelp: "可按邮箱、订单号或客户名查询 Shopify 订单。",
    tracking: "物流单号",
    statusOpen: "待接入",
    statusAssigned: "接待中",
    statusClosed: "已结束",
    unknownTime: "未知时间",
    viewShopsTitle: "Xzdesk Admin",
    viewAgentsTitle: "Xzdesk 子账号",
    viewWorkbenchAdminTitle: "Xzdesk 客服监控",
    viewWorkbenchAgentTitle: "我的会话",
    viewShopsSubtitle: "配置店铺、渠道、连接器和客服分配。",
    viewAgentsSubtitle: "创建管理员及客服部、财务部、综合部子账号。",
    viewWorkbenchAdminSubtitle: "管理员可以查看所有店铺和会话。",
    viewWorkbenchAgentSubtitle: "客服只看到已分配店铺。",
  },
  en: {
    language: "Display language",
    chinese: "Chinese",
    english: "English",
    connecting: "Connecting to platform service",
    serverChecking: "Checking server",
    normal: "normal",
    abnormal: "abnormal",
    initFirstAdmin: "Initialize the first admin account",
    loginRequired: "Sign in to the support platform",
    dataRefreshed: "Platform data refreshed",
    serverSaved: "Server address saved",
    loggedIn: "signed in",
    loggedOut: "Signed out",
    refresh: "Refresh",
    logout: "Logout",
    connect: "Connect",
    onlineService: "Online service",
    shopManagement: "Shop management",
    agentAccounts: "Agent accounts",
    serviceList: "Service list",
    managementCenter: "Management center",
    customerService: "Customer service",
    seatList: "Agent seats",
    shopsAndSources: "Stores and channels",
    rolePermissions: "Role permissions",
    authInitTitle: "Initialize Xzdesk Admin",
    authLoginTitle: "Sign in to Xzdesk",
    authInitDesc: "This server has no account yet. Create the first admin.",
    authLoginDesc: "Use an admin or agent account to enter Xzdesk Agent.",
    nativeTenantLabel: "Enterprise ID",
    nativeTenantHelp: "Use the customer-service enterprise ID supplied by your administrator. No enterprise is created or joined automatically.",
    email: "Email",
    name: "Name",
    password: "Password",
    createAdmin: "Create admin",
    login: "Sign in",
    authSideTitle: "Xzdesk server + agent client",
    authSideDesc: "Accounts, stores, conversations, and messages are saved on the server. Xzdesk Agent handles support, with Xzdesk Admin, Insights, SLA, Xzdesk Chat, and Xzdesk Mail planned next.",
    shopAssignment: "Store assignment",
    servicePermission: "Agent permissions",
    realtimeChat: "Realtime chat",
    multiSourceMessages: "Multi-source messages",
    createAccount: "Create account",
    accountList: "Account list",
    role: "Role",
    agent: "Agent",
    admin: "Admin",
    create: "Create",
    accountCreated: "Account created",
    shop: "Store",
    shopName: "Store domain or admin URL",
    add: "Add",
    addShopHint: "Leave blank to use the selected store, or enter a myshopify domain / Shopify admin URL. Add generates an install link; the store is created after authorization.",
    invalidShopDomain: "Enter a valid Shopify store domain or admin URL",
    installLinkCopied: "Install link generated and copied",
    installLinkReady: "Install link generated",
    copyInstallLink: "Copy link",
    openInstallLink: "Open install",
    selectShop: "Select store",
    sources: "Sources",
    active: "active",
    notConfigured: "Not configured",
    readyToTest: "Ready to test",
    notEnabled: "Not enabled",
    connected: "Connected",
    installApp: "Install app",
    agents: "Agents",
    assigned: "assigned",
    unassigned: "Unassigned",
    setupTitle: "Xzdesk Shopify setup",
    openAppEmbeds: "Open app embeds",
    previewStore: "Preview store",
    setupNote: "Flow aligned with Sobot: bind the Shopify store, configure Xzdesk Chat and routing, then enable the chat app embed in the Shopify theme editor.",
    stepBindTitle: "1. Bind Shopify store",
    stepBindDone: "App installed; order/customer API is connected.",
    stepBindTodo: "Install and authorize the Shopify app first.",
    stepVisitorTitle: "2. Configure visitor scheme",
    stepVisitorDone: "Xzdesk Chat is enabled.",
    stepVisitorTodo: "Enable Xzdesk Chat as the customer entry point.",
    stepWidgetTitle: "3. Enable chat widget",
    stepWidgetDetail: "Open Shopify Online Store -> Themes -> Customize -> App embeds, disable Shopify Inbox, keep Xzdesk Chat enabled, then save.",
    stepRoutingTitle: "4. Configure routing",
    stepRoutingTodo: "Assign at least one agent; routing and queue rules can be expanded next.",
    stepRoutingDone: "agent(s) assigned.",
    stepOrdersTitle: "5. Check orders in workbench",
    stepOrdersDone: "Agents can query Shopify orders from the right panel.",
    stepOrdersTodo: "Shopify API source must be enabled before order lookup works.",
    visitorScheme: "Visitor scheme",
    editable: "Editable",
    enableChatFirst: "Enable Xzdesk Chat first",
    visitorLanguage: "Visitor language",
    visitorLanguageAuto: "Auto-detect, fallback to English",
    visitorLanguageEnglish: "English",
    saveVisitorScheme: "Save visitor scheme",
    visitorSchemeSaved: "Visitor scheme saved",
    messageSources: "Message sources",
    addressOptional: "Address or account, optional",
    addSource: "Add source",
    sourceAdded: "Source added",
    sourceExists: "This source already exists and is active",
    enabled: "Enabled",
    disabled: "Disabled",
    enable: "Enable",
    disable: "Disable",
    noAddress: "No address",
    noSources: "No sources yet. Add Xzdesk Chat, Shopify Inbox, Shopify Connector, or Xzdesk Mail.",
    storefrontWidget: "Storefront chat widget",
    agentAssignment: "Agent assignment",
    selectAgent: "Select agent",
    assign: "Assign",
    remove: "Remove",
    agentAssigned: "Agent assigned",
    agentUnassigned: "Agent unassigned",
    noAgentAssigned: "No agent assigned to this store yet.",
    selectStoreFirst: "Select a store from the left first.",
    myConversations: "My conversations",
    allStores: "All stores",
    chatChannel: "Chat",
    emailChannel: "Email",
    assignedStoresEmpty: "No assigned stores. Assign a reception user in Stores and channels first.",
    conversationList: "Conversations",
    expandShop: "Expand store",
    collapseShop: "Collapse store",
    unselectedShop: "No store selected",
    selectStoreAria: "Select store",
    inConversation: "In conversation",
    queue: "Queue",
    visitors: "Visitors",
    receptionLimit: "Reception limit 50",
    customerName: "Customer name",
    issueSummary: "Issue summary",
    newConversation: "New",
    offlineConversations: "Offline conversations",
    visitor: "Visitor",
    noSubject: "No subject",
    noConversations: "No conversations",
    unknownSource: "Unknown source",
    conversationCreated: "Conversation created",
    messageRecorded: "Message recorded",
    conversationUpdated: "Conversation status updated",
    claimSucceeded: "Conversation assigned to you",
    closeSucceeded: "Conversation closed",
    reopenSucceeded: "Conversation reopened",
    conversationClaimedByOther: "Another agent claimed this conversation. The list has been refreshed.",
    assignedToYou: "Assigned to you",
    assignedToOther: "Assigned to another agent",
    claimBeforeReply: "Claim this conversation before replying",
    closedReadOnly: "This conversation is closed. Reopen it before replying.",
    replyFailed: "Reply failed",
    actionFailed: " failed",
    noMatchingOrder: "No matching order",
    claim: "Claim",
    closeConversation: "Close conversation",
    reopen: "Reopen",
    orderPending: "Order pending",
    logisticsPending: "Logistics pending",
    originalPage: "Original page",
    serviceAgent: "Agent",
    customer: "Customer",
    noMessages: "No message records",
    aiDraft: "AI draft",
    replyPlaceholder: "Type a reply...",
    sendRecord: "Send / record",
    noConversationContent: "No conversation content",
    noConversationHint: "When customers arrive, select one from the left list to start.",
    customerAndOrders: "Customer and orders",
    shopifyCheck: "Shopify API check",
    noCustomerSelected: "No customer selected",
    waitingConversation: "Waiting for conversation",
    orderSearchPlaceholder: "Email, order number, or customer name",
    searching: "Searching",
    findOrder: "Find order",
    orderResults: "Order results",
    unknownPayment: "Unknown payment",
    unfulfilled: "Unfulfilled",
    searchOrderHelp: "Search Shopify orders by email, order number, or customer name.",
    tracking: "Tracking",
    statusOpen: "Open",
    statusAssigned: "Assigned",
    statusClosed: "Closed",
    unknownTime: "Unknown time",
    viewShopsTitle: "Xzdesk Admin",
    viewAgentsTitle: "Xzdesk Agent accounts",
    viewWorkbenchAdminTitle: "Xzdesk Agent monitor",
    viewWorkbenchAgentTitle: "My conversations",
    viewShopsSubtitle: "Configure stores, channels, connectors, and agent assignment.",
    viewAgentsSubtitle: "Create Xzdesk Admin and Xzdesk Agent accounts.",
    viewWorkbenchAdminSubtitle: "Admins can monitor all stores and conversations.",
    viewWorkbenchAgentSubtitle: "Agents only see assigned stores.",
  }
} as const;

const permissionByAdminView: Record<AdminViewKey, PermissionKey> = {
  monitor: PERMISSIONS.monitorView,
  anomalyMonitor: PERMISSIONS.monitorView,
  conversationStats: PERMISSIONS.monitorView,
  customerStats: PERMISSIONS.monitorView,
  agentStats: PERMISSIONS.monitorView,
  skillStats: PERMISSIONS.monitorView,
  satisfactionStats: PERMISSIONS.monitorView,
  serviceSummaryStats: PERMISSIONS.monitorView,
  slaStats: PERMISSIONS.monitorView,
  conversationRecords: PERMISSIONS.recordsView,
  leaveMessageRecords: PERMISSIONS.recordsView,
  orderOperations: PERMISSIONS.ordersView,
  disputeManagement: PERMISSIONS.ordersDisputes,
  emailProcessing: PERMISSIONS.emailProcessingManage,
  emailStatistics: PERMISSIONS.emailStatisticsView,
  tickets: PERMISSIONS.ticketsView,
  knowledge: PERMISSIONS.knowledgeCreate,
  quickMenu: PERMISSIONS.visitorSchemesManage,
  faq: PERMISSIONS.knowledgeCreate,
  inquiryForms: PERMISSIONS.visitorSchemesManage,
  visitorSchemes: PERMISSIONS.visitorSchemesManage,
  customerLogin: PERMISSIONS.customerLoginManage,
  receptionSchemes: PERMISSIONS.visitorSchemesManage,
  recordCategories: PERMISSIONS.recordCategoriesManage,
  shops: PERMISSIONS.shopsView,
  aiSettings: PERMISSIONS.aiManage,
  logisticsSettings: PERMISSIONS.logisticsManage,
  emailProviderSettings: PERMISSIONS.emailProvidersManage,
  agents: PERMISSIONS.usersView
};

function canOpenAdminView(user: User | null | undefined, view: AdminViewKey) {
  if (view === "knowledge") return Boolean(user);
  if (view === "emailProcessing") return hasPermission(user, PERMISSIONS.emailProcessingManage);
  if (view === "orderOperations") {
    return hasPermission(user, PERMISSIONS.ordersView) || hasPermission(user, PERMISSIONS.ordersRefund);
  }
  return hasPermission(user, permissionByAdminView[view]);
}

function emptyModuleShops(): Record<DataScopeModule, Shop[]> {
  return { knowledge: [], monitor: [], records: [], tickets: [], orders: [], shops: [] };
}

function groupSourcesByShop(items: ShopSource[]) {
  const grouped: Record<string, ShopSource[]> = {};
  items.forEach((source) => {
    (grouped[source.shopId] ||= []).push(source);
  });
  return grouped;
}

function groupAgentsByShop(visibleShops: Shop[], assignments: Array<{ shopId: string; userId: string }>, visibleUsers: User[]) {
  const usersByID = new Map(visibleUsers.map((user) => [user.id, user]));
  const grouped: Record<string, User[]> = Object.fromEntries(visibleShops.map((shop) => [shop.id, []]));
  assignments.forEach((assignment) => {
    const user = usersByID.get(assignment.userId);
    if (user && grouped[assignment.shopId]) grouped[assignment.shopId].push(user);
  });
  return grouped;
}

function dataScopeForView(view: ViewKey): DataScopeModule | null {
  if (view === "knowledge" || view === "faq") return "knowledge";
  if (view === "monitor" || view === "anomalyMonitor" || historicalStatisticsViews.includes(view as AdminViewKey)) return "monitor";
  if (view === "conversationRecords" || view === "leaveMessageRecords") return "records";
  if (view === "tickets") return "tickets";
  if (view === "orderOperations" || view === "disputeManagement") return "orders";
  if (view === "shops" || view === "agents" || view === "visitorSchemes" || view === "customerLogin" || view === "receptionSchemes") return "shops";
  return null;
}

function initialViewForUser(user: User): ViewKey {
  if (user.role !== "admin" && hasPermission(user, PERMISSIONS.workbenchAccess)) return "workbench";
  const preferred: AdminViewKey[] = ["monitor", "emailProcessing", "emailStatistics", "tickets", "conversationRecords", "orderOperations", "disputeManagement", "shops", "agents", "knowledge", "emailProviderSettings", "aiSettings", "logisticsSettings", "visitorSchemes", "customerLogin", "recordCategories"];
  const adminView = preferred.find((candidate) => canOpenAdminView(user, candidate));
  if (adminView) return adminView;
  return "workbench";
}

type StoredNavigationState = {
  userId: string;
  view: ViewKey;
  adminTabs: AdminViewKey[];
};

function isAdminViewKey(value: unknown): value is AdminViewKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(permissionByAdminView, value);
}

function readStoredNavigationState(user: User | null | undefined): Pick<StoredNavigationState, "view" | "adminTabs"> {
  if (!user) return { view: "workbench", adminTabs: [] };
  const fallback = initialViewForUser(user);
  try {
    const raw = window.sessionStorage.getItem(navigationStateKey);
    if (!raw) return { view: fallback, adminTabs: fallback === "workbench" ? [] : [fallback] };
    const stored = JSON.parse(raw) as Partial<StoredNavigationState>;
    if (stored.userId !== user.id) return { view: fallback, adminTabs: fallback === "workbench" ? [] : [fallback] };

    const adminTabs = Array.isArray(stored.adminTabs)
      ? Array.from(new Set(stored.adminTabs.filter((tab): tab is AdminViewKey => isAdminViewKey(tab) && canOpenAdminView(user, tab))))
      : [];
    const view = stored.view === "workbench"
      ? hasPermission(user, PERMISSIONS.workbenchAccess) ? "workbench" : fallback
      : isAdminViewKey(stored.view) && canOpenAdminView(user, stored.view) ? stored.view : fallback;
    if (view !== "workbench" && !adminTabs.includes(view)) adminTabs.push(view);
    return { view, adminTabs };
  } catch {
    return { view: fallback, adminTabs: fallback === "workbench" ? [] : [fallback] };
  }
}

function storeNavigationState(user: User, view: ViewKey, adminTabs: AdminViewKey[]) {
  try {
    window.sessionStorage.setItem(navigationStateKey, JSON.stringify({ userId: user.id, view, adminTabs } satisfies StoredNavigationState));
  } catch {
    // Navigation persistence is best-effort; the app must still work when browser storage is unavailable.
  }
}

function clearStoredNavigationState() {
  try {
    window.sessionStorage.removeItem(navigationStateKey);
  } catch {
    // Ignore unavailable browser storage while clearing the authenticated session.
  }
}

export function App() {
  const [language, setLanguage] = useState<Language>(() => readStoredLanguage());
  const t = i18n[language];
  const [baseUrl] = useState(() => window.localStorage.getItem(baseUrlKey) || defaultBaseUrl);
  const [auth, setAuth] = useState<AuthResult | null>(() => readStoredAuth());
  const [startupNavigation] = useState(() => readStoredNavigationState(auth?.user));
  const [needsBootstrap, setNeedsBootstrap] = useState(false);
  const [identityMode, setIdentityMode] = useState<"local" | "erp_sso" | "loading">("loading");
  const [tenantRequired, setTenantRequired] = useState(true);
  const [view, setView] = useState<ViewKey>(startupNavigation.view);
  const [ticketRefreshToken, setTicketRefreshToken] = useState(0);
  const [ticketContextRefreshToken, setTicketContextRefreshToken] = useState(0);
  const [ticketOpenToken, setTicketOpenToken] = useState(0);
  const [hasPendingTicketAttention, setHasPendingTicketAttention] = useState(false);
  const [adminTabs, setAdminTabs] = useState<AdminViewKey[]>(startupNavigation.adminTabs);
  const [shopConfigResetToken, setShopConfigResetToken] = useState(0);
  const [shops, setShops] = useState<Shop[]>([]);
  const [moduleShops, setModuleShops] = useState<Record<DataScopeModule, Shop[]>>(() => emptyModuleShops());
  const [workbenchShops, setWorkbenchShops] = useState<Shop[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [sources, setSources] = useState<ShopSource[]>([]);
  const [shopAgents, setShopAgents] = useState<User[]>([]);
  const [sourcesByShopId, setSourcesByShopId] = useState<Record<string, ShopSource[]>>({});
  const [agentsByShopId, setAgentsByShopId] = useState<Record<string, User[]>>({});
  const [workbenchConversations, setWorkbenchConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
	const [conversationsHasMore, setConversationsHasMore] = useState(false);
	const [messagesHasMore, setMessagesHasMore] = useState(false);
	const conversationPageRef = useRef(1);
  const confirmedReadRef = useRef<{ conversationId: string; messageId: string }>({ conversationId: "", messageId: "" });
  const activeConversationRef = useRef("");
  const messageRequestSequenceRef = useRef(0);
  const [selectedShopId, setSelectedShopId] = useState("");
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [eventConnectionStatus, setEventConnectionStatus] = useState<EventConnectionStatus>("disconnected");
  const viewDataLoadedAtRef = useRef(new Map<ViewKey, number>());
  const viewDataRequestRef = useRef(new Map<ViewKey, Promise<void>>());
  const viewDataGenerationRef = useRef(0);
  const prefetchedShopDetailsRef = useRef(new Set<string>());
  const api = useMemo(
    () => new PlatformAPI(baseUrl, auth?.token || "", auth?.tenantId || ""),
    [baseUrl, auth?.token, auth?.tenantId]
  );
  const currentUser = auth?.user || null;
  const isAdmin = currentUser?.role === "admin";
  const canUseWorkbench = hasPermission(currentUser, PERMISSIONS.workbenchAccess);
  const canViewTickets = hasPermission(currentUser, PERMISSIONS.ticketsView);
  const canViewShops = [
    PERMISSIONS.shopsView, PERMISSIONS.shopChannelsManage, PERMISSIONS.shopsAssign,
    PERMISSIONS.shopsCreate, PERMISSIONS.shopsDelete, PERMISSIONS.customerLoginManage
  ].some((permission) => hasPermission(currentUser, permission));
  const canViewOperations = Boolean(currentUser && adminMenuGroupsForSection("operations").some((group) => group.items.some((item) => canOpenAdminView(currentUser, item.key))));
  const canViewBusiness = Boolean(currentUser && adminMenuGroupsForSection("business").some((group) => group.items.some((item) => canOpenAdminView(currentUser, item.key))));
  const canViewSettings = Boolean(currentUser && adminMenuGroupsForSection("settings").some((group) => group.items.some((item) => canOpenAdminView(currentUser, item.key))));
  const selectedShop = shops.find((shop) => shop.id === selectedShopId) || null;
  const selectedConversation = workbenchConversations.find((conversation) => conversation.id === selectedConversationId) || null;
  const applyAgentAssignment = useCallback((shopId: string, user: User, assigned: boolean) => {
    const updateAgents = (current: User[]) => assigned
      ? current.some((agent) => agent.id === user.id) ? current : [...current, user]
      : current.filter((agent) => agent.id !== user.id);
    setAgentsByShopId((current) => ({ ...current, [shopId]: updateAgents(current[shopId] || []) }));
    if (selectedShopId === shopId) setShopAgents(updateAgents);
  }, [selectedShopId]);
  const applyUserSaved = useCallback((user: User, assignedShopIds?: string[]) => {
    setUsers((current) => current.some((item) => item.id === user.id)
      ? current.map((item) => item.id === user.id ? user : item)
      : [...current, user]);
    setAuth((current) => current?.user.id === user.id ? { ...current, user } : current);
    setShopAgents((current) => current.map((item) => item.id === user.id ? user : item));
    setAgentsByShopId((current) => {
      const assigned = assignedShopIds ? new Set(assignedShopIds) : null;
      const next = { ...current };
      shops.forEach((shop) => {
        const shopAgents = next[shop.id] || [];
        const alreadyAssigned = shopAgents.some((item) => item.id === user.id);
        const shouldBeAssigned = assigned ? assigned.has(shop.id) : alreadyAssigned;
        next[shop.id] = shouldBeAssigned
          ? alreadyAssigned
            ? shopAgents.map((item) => item.id === user.id ? user : item)
            : [...shopAgents, user]
          : shopAgents.filter((item) => item.id !== user.id);
      });
      return next;
    });
  }, [shops]);
  const applyUserDeleted = useCallback((userId: string) => {
    setUsers((current) => current.filter((user) => user.id !== userId));
    setShopAgents((current) => current.filter((user) => user.id !== userId));
    setAgentsByShopId((current) => Object.fromEntries(
      Object.entries(current).map(([shopId, agents]) => [shopId, agents.filter((user) => user.id !== userId)])
    ));
  }, []);
  const applyShopSourceUpdates = useCallback((updatedSources: ShopSource[]) => {
    if (!updatedSources.length) return;
    const updatedById = new Map(updatedSources.map((source) => [source.id, source]));
    setSources((current) => current.map((source) => updatedById.get(source.id) || source));
    setSourcesByShopId((current) => {
      const next = { ...current };
      updatedSources.forEach((source) => {
        const shopSources = next[source.shopId] || [];
        next[source.shopId] = shopSources.some((item) => item.id === source.id)
          ? shopSources.map((item) => item.id === source.id ? source : item)
          : [...shopSources, source];
      });
      return next;
    });
  }, []);
  const applyShopUpdate = useCallback((updatedShop: Shop) => {
    const replace = (items: Shop[]) => items.some((shop) => shop.id === updatedShop.id)
      ? items.map((shop) => shop.id === updatedShop.id ? updatedShop : shop)
      : items;
    setShops(replace);
    setWorkbenchShops(replace);
    setModuleShops((current) => Object.fromEntries(
      Object.entries(current).map(([scope, items]) => [scope, replace(items)])
    ) as Record<DataScopeModule, Shop[]>);
  }, []);
  const applyWorkbenchConversationPage = useCallback((nextConversations: Conversation[], loadedPages = 1, hasMore = false) => {
    setWorkbenchConversations((current) => {
      const selected = current.find((conversation) => conversation.id === selectedConversationId);
      return selected && !nextConversations.some((conversation) => conversation.id === selected.id)
        ? [...nextConversations, selected]
        : nextConversations;
    });
    conversationPageRef.current = Math.max(1, loadedPages);
    setConversationsHasMore(hasMore);
  }, [selectedConversationId]);
  const applyConversationUpdate = useCallback((conversation: Conversation) => {
    setWorkbenchConversations((current) => {
      const existing = current.find((item) => item.id === conversation.id);
      const next = mergeRealtimeConversation(existing, conversation);
      const without = current.filter((item) => item.id !== next.id);
      const visible = next.kind === "customer" && (
        currentUser?.conversationScope === "all"
        || next.assignedAgentId === currentUser?.id
        || (next.status === "open" && !next.assignedAgentId)
        || selectedConversationId === next.id
      );
      if (!visible) return without;
      return [next, ...without].sort((left, right) => Date.parse(right.customerLastMessageAt || right.lastMessageAt) - Date.parse(left.customerLastMessageAt || left.lastMessageAt));
    });
  }, [currentUser?.conversationScope, currentUser?.id, selectedConversationId]);
  const applyMessageCreated = useCallback((message: Message) => {
    if (activeConversationRef.current === message.conversationId) {
      setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current, message]);
    }
    setWorkbenchConversations((current) => current.map((conversation) => conversation.id === message.conversationId
      ? {
          ...conversation,
          lastMessageAt: message.createdAt,
          lastMessageDirection: message.direction,
          customerLastMessageAt: message.direction === "customer"
            ? latestValidConversationTime(conversation.customerLastMessageAt, message.createdAt) || conversation.customerLastMessageAt
            : conversation.customerLastMessageAt,
          updatedAt: message.createdAt
        }
      : conversation));
  }, []);
  const refreshPendingTicketAttention = useCallback(async () => {
    if (!auth?.token || !sessionReady || !currentUser || !hasPermission(currentUser, PERMISSIONS.ticketsView)) {
      setHasPendingTicketAttention(false);
      return;
    }
    try {
      const summary = await api.getTicketSummary();
      setHasPendingTicketAttention(summary.mine + summary.waitingForMe + summary.reviewForMe > 0);
    } catch {
      // The ticket page still reports request errors; the rail indicator is best-effort.
    }
  }, [api, auth?.token, currentUser, sessionReady]);
  const canMarkSelectedConversationRead = Boolean(
    selectedConversation
    && selectedConversation.status === "assigned"
    && selectedConversation.assignedAgentId === currentUser?.id
  );
  const activeAdminSection = view === "workbench" ? "operations" : adminSectionForView(view);
  const visibleAdminMenuGroups = adminMenuGroupsForSection(activeAdminSection)
    .map((group) => ({ ...group, items: group.items.filter((item) => canOpenAdminView(currentUser, item.key)) }))
    .filter((group) => group.items.length > 0);

  const clearSessionState = useCallback((message: string, tone: ToastTone = "error") => {
    clearStoredNavigationState();
    setAuth(null);
    storeAuth(null);
    setUsers([]);
    setShops([]);
    setModuleShops(emptyModuleShops());
    setWorkbenchShops([]);
    setSources([]);
    setShopAgents([]);
    setSourcesByShopId({});
    setAgentsByShopId({});
    setWorkbenchConversations([]);
    setMessages([]);
	setConversationsHasMore(false);
	setMessagesHasMore(false);
	conversationPageRef.current = 1;
    activeConversationRef.current = "";
    confirmedReadRef.current = { conversationId: "", messageId: "" };
    messageRequestSequenceRef.current += 1;
    setSelectedShopId("");
    setSelectedConversationId("");
    setAdminTabs([]);
    setView("workbench");
    setHasPendingTicketAttention(false);
    setSessionReady(false);
    viewDataGenerationRef.current += 1;
    viewDataLoadedAtRef.current.clear();
    viewDataRequestRef.current.clear();
    prefetchedShopDetailsRef.current.clear();
    setToast({ tone, text: message });
  }, []);

  useEffect(() => {
    void refreshPendingTicketAttention();
  }, [refreshPendingTicketAttention]);

  useEffect(() => {
    const expired = (event: Event) => {
      // A late failure from an old API instance must not clear a newer login.
      if (event instanceof CustomEvent && event.detail === api && auth?.token) {
        clearSessionState("登录已失效，请使用 ERP 账号重新进入");
      }
    };
    window.addEventListener("xzdesk:session-expired", expired);
    return () => window.removeEventListener("xzdesk:session-expired", expired);
  }, [api, auth?.token, clearSessionState]);

  useEffect(() => {
    if (!currentUser) return;
    const allowed = view === "workbench" ? hasPermission(currentUser, PERMISSIONS.workbenchAccess) : canOpenAdminView(currentUser, view);
    if (allowed) return;
    const fallback = initialViewForUser(currentUser);
    setView(fallback);
    setAdminTabs(fallback === "workbench" ? [] : [fallback]);
  }, [currentUser, view]);

  useEffect(() => {
    if (!currentUser) return;
    storeNavigationState(currentUser, view, adminTabs);
  }, [currentUser, view, adminTabs]);

  useEffect(() => {
    document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
    window.localStorage.setItem(languageKey, language);
  }, [language]);

  const refreshSession = useCallback(async () => {
    setBusy(true);
    try {
      if (!auth?.token) {
        const status = await api.bootstrapStatus();
        setNeedsBootstrap(status.needsBootstrap);
        if (status.authMode !== "local" && status.authMode !== "erp_sso") {
          setIdentityMode("loading");
          throw new Error("登录模式缺失或无效，请联系管理员");
        }
        setIdentityMode(status.authMode!);
        setTenantRequired(status.tenantRequired === true);
        setSessionReady(false);
        setToast({ tone: "info", text: status.needsBootstrap ? t.initFirstAdmin : t.loginRequired });
        return;
      }
      const me = await api.me();
      const nextAuth = { ...auth, user: me };
      setAuth(nextAuth);
      storeAuth(nextAuth);
      setSessionReady(true);
      setToast((current) => current?.tone === "error" ? current : null);
    } catch (error) {
      if (isAuthExpiredError(error)) {
        clearSessionState("登录已失效，请重新登录");
        return;
      }
      setToast({ tone: "error", text: `读取账号状态失败：${errorText(error)}` });
    } finally {
      setBusy(false);
    }
  }, [api, auth, t, clearSessionState]);

  const refreshViewData = useCallback(async (targetView: ViewKey = view, force = false) => {
    if (!auth?.token || !sessionReady || !currentUser) return;
    const loadedAt = viewDataLoadedAtRef.current.get(targetView) || 0;
    if (!force && Date.now() - loadedAt < viewDataCacheMs) return;
    const existing = viewDataRequestRef.current.get(targetView);
    if (existing) {
      await existing;
      if (!force) return;
    }
    const requestGeneration = viewDataGenerationRef.current;

    const request = (async () => {
      try {
        if (targetView === "workbench") {
          if (!hasPermission(currentUser, PERMISSIONS.workbenchAccess)) return;
          const [nextWorkbenchShops, workbenchSources, conversationWindow] = await Promise.all([
            api.listShops("workbench"),
            api.listAssignedSources("workbench"),
            listWorkbenchConversationWindow(api, currentUser.conversationScope === "all" ? "all" : "assigned", 1, conversationPageSize)
          ]);
          if (requestGeneration !== viewDataGenerationRef.current) return;
          const groupedSources = groupSourcesByShop(workbenchSources);
          setWorkbenchShops(nextWorkbenchShops);
          setSourcesByShopId((current) => {
            const next = { ...current };
            nextWorkbenchShops.forEach((shop) => { next[shop.id] = groupedSources[shop.id] || []; });
            return next;
          });
          applyWorkbenchConversationPage(conversationWindow.items, 1, conversationWindow.hasMore);
          viewDataLoadedAtRef.current.set(targetView, Date.now());
          return;
        }

        const scope = dataScopeForView(targetView);
        if (!scope) {
          viewDataLoadedAtRef.current.set(targetView, Date.now());
          return;
        }
        const needsUsers = ["shops", "agents", "tickets", "conversationRecords", ...historicalStatisticsViews].includes(targetView as AdminViewKey)
          && hasPermission(currentUser, PERMISSIONS.usersView);
        const needsSources = ["shops", "visitorSchemes", "customerLogin"].includes(targetView)
          && (hasPermission(currentUser, PERMISSIONS.shopsView) || hasPermission(currentUser, PERMISSIONS.shopChannelsManage) || hasPermission(currentUser, PERMISSIONS.customerLoginManage));
        const needsAssignments = ["shops", "agents", "conversationRecords"].includes(targetView)
          && hasPermission(currentUser, PERMISSIONS.shopsAssign);
        const [scopeShops, nextUsers, nextSources, assignments] = await Promise.all([
          api.listShops(scope),
          needsUsers ? api.listUsers() : Promise.resolve(null),
          needsSources ? api.listAssignedSources() : Promise.resolve(null),
          needsAssignments ? api.listShopAssignments() : Promise.resolve(null)
        ]);
        if (requestGeneration !== viewDataGenerationRef.current) return;

        setModuleShops((current) => ({ ...current, [scope]: scopeShops }));
        if (scope === "shops") setShops(scopeShops);
        if (nextUsers) setUsers(nextUsers);
        const detailShopID = selectedShopId && scopeShops.some((shop) => shop.id === selectedShopId)
          ? selectedShopId
          : scopeShops[0]?.id || "";
        if (nextSources) {
          const groupedSources = groupSourcesByShop(nextSources);
          setSourcesByShopId((current) => {
            const next = { ...current };
            scopeShops.forEach((shop) => { next[shop.id] = groupedSources[shop.id] || []; });
            return next;
          });
          if (targetView === "shops") {
            if (detailShopID && detailShopID !== selectedShopId) setSelectedShopId(detailShopID);
            setSources(detailShopID ? groupedSources[detailShopID] || [] : []);
          }
        }
        if (assignments) {
          const assignmentUsers = nextUsers || users;
          const groupedAgents = groupAgentsByShop(scopeShops, assignments, assignmentUsers);
          setAgentsByShopId((current) => ({ ...current, ...groupedAgents }));
          if (targetView === "shops") setShopAgents(detailShopID ? groupedAgents[detailShopID] || [] : []);
        }
        if (targetView === "shops" && nextSources && (!hasPermission(currentUser, PERMISSIONS.usersView) || assignments)) {
          scopeShops.forEach((shop) => prefetchedShopDetailsRef.current.add(shop.id));
        }
        viewDataLoadedAtRef.current.set(targetView, Date.now());
      } catch (error) {
        if (isAuthExpiredError(error)) {
          clearSessionState("登录已失效，请重新登录");
          return;
        }
        setToast({ tone: "error", text: `加载当前页面失败：${errorText(error)}` });
      }
    })();
    viewDataRequestRef.current.set(targetView, request);
    try {
      await request;
    } finally {
      if (viewDataRequestRef.current.get(targetView) === request) viewDataRequestRef.current.delete(targetView);
    }
  }, [api, applyWorkbenchConversationPage, auth?.token, clearSessionState, currentUser, selectedShopId, sessionReady, users, view]);

  const refreshShopDetail = useCallback(async (shopId: string, force = false) => {
    if (!auth?.token) {
      setSources([]);
      setShopAgents([]);
      return;
    }
    if (!shopId) {
      setSources([]);
      setShopAgents([]);
      return;
    }
    if (!force && prefetchedShopDetailsRef.current.has(shopId)) return;
    try {
      const mayViewSources = hasPermission(currentUser, PERMISSIONS.workbenchAccess) || hasPermission(currentUser, PERMISSIONS.shopsView) || hasPermission(currentUser, PERMISSIONS.shopChannelsManage) || hasPermission(currentUser, PERMISSIONS.customerLoginManage);
      const nextSources = mayViewSources ? await api.listSources(shopId) : [];
      setSources(nextSources);
      setSourcesByShopId((current) => ({ ...current, [shopId]: nextSources }));
      if (hasPermission(currentUser, PERMISSIONS.usersView)) {
        const nextAgents = await api.listShopAgents(shopId);
        setShopAgents(nextAgents);
        setAgentsByShopId((current) => ({ ...current, [shopId]: nextAgents }));
      } else {
        setShopAgents([]);
      }
      prefetchedShopDetailsRef.current.add(shopId);
    } catch (error) {
      if (isAuthExpiredError(error)) {
        clearSessionState("登录已失效，请重新登录");
        return;
      }
      setToast({ tone: "error", text: `加载店铺详情失败：${errorText(error)}` });
    }
  }, [api, auth?.token, currentUser, clearSessionState]);

  const refreshMessages = useCallback(async (conversationId: string, markAsRead = false) => {
    if (!conversationId || !auth?.token) {
      confirmedReadRef.current = { conversationId: "", messageId: "" };
      messageRequestSequenceRef.current += 1;
      setMessages([]);
      return;
    }
    const requestSequence = ++messageRequestSequenceRef.current;
    try {
      const previousConfirmedMessageId = confirmedReadRef.current.conversationId === conversationId
        ? confirmedReadRef.current.messageId
        : "";
      const nextMessages = await api.listMessages(conversationId, "", messagePageSize);
      if (requestSequence !== messageRequestSequenceRef.current || activeConversationRef.current !== conversationId) {
        return;
      }
      setMessages(nextMessages);
		setMessagesHasMore(nextMessages.length === messagePageSize);
      if (!markAsRead) return;
      const throughMessageId = nextMessages[nextMessages.length - 1]?.id || "";
      if (!throughMessageId || throughMessageId === previousConfirmedMessageId) return;
      const [markReadResult] = await Promise.allSettled([
        api.markConversationRead(conversationId, throughMessageId, previousConfirmedMessageId)
      ]);
      const markRead = (items: Conversation[]) => items.map((conversation) => conversation.id === conversationId ? { ...conversation, unread: false } : conversation);
      if (markReadResult.status === "fulfilled") {
        if (requestSequence !== messageRequestSequenceRef.current || activeConversationRef.current !== conversationId) {
          return;
        }
        confirmedReadRef.current = { conversationId, messageId: throughMessageId };
        setWorkbenchConversations(markRead);
      } else if (isAuthExpiredError(markReadResult.reason)) {
        clearSessionState("登录已失效，请重新登录");
      } else {
        setToast({ tone: "error", text: `标记会话已读失败：${errorText(markReadResult.reason)}` });
      }
    } catch (error) {
      if (isAuthExpiredError(error)) {
        clearSessionState("登录已失效，请重新登录");
        return;
      }
      setToast({ tone: "error", text: `加载会话消息失败：${errorText(error)}` });
    }
  }, [api, auth?.token, clearSessionState]);

  const refreshWorkbenchConversations = useCallback(async () => {
    if (!auth?.token || !canUseWorkbench) return;
    try {
      const loadedPages = Math.min(Math.max(conversationPageRef.current, 1), 10);
      const windowSize = loadedPages * conversationPageSize;
      const conversationWindow = await listWorkbenchConversationWindow(api, currentUser?.conversationScope === "all" ? "all" : "assigned", 1, windowSize);
      applyWorkbenchConversationPage(conversationWindow.items, loadedPages, conversationWindow.hasMore);
    } catch (error) {
      if (isAuthExpiredError(error)) clearSessionState("登录已失效，请重新登录");
    }
  }, [api, applyWorkbenchConversationPage, auth?.token, canUseWorkbench, currentUser?.conversationScope, clearSessionState]);

	const loadMoreConversations = useCallback(async () => {
		if (!auth?.token || !canUseWorkbench || !conversationsHasMore) return;
		const nextPage = conversationPageRef.current + 1;
		const conversationWindow = await listWorkbenchConversationWindow(api, currentUser?.conversationScope === "all" ? "all" : "assigned", nextPage, conversationPageSize);
		setWorkbenchConversations((current) => {
			const byID = new Map(current.map((item) => [item.id, item]));
			conversationWindow.items.forEach((item) => byID.set(item.id, item));
			return Array.from(byID.values());
		});
		conversationPageRef.current = nextPage;
		setConversationsHasMore(conversationWindow.hasMore);
	}, [api, auth?.token, canUseWorkbench, conversationsHasMore, currentUser?.conversationScope]);

	const loadOlderMessages = useCallback(async () => {
		if (!selectedConversationId || !messagesHasMore || !messages.length) return;
		const older = await api.listMessages(selectedConversationId, messages[0].id, messagePageSize);
		setMessages((current) => {
			const existing = new Set(current.map((item) => item.id));
			return [...older.filter((item) => !existing.has(item.id)), ...current];
		});
		setMessagesHasMore(older.length === messagePageSize);
	}, [api, messages, messagesHasMore, selectedConversationId]);

  useEffect(() => {
    void refreshSession();
  }, []);

  useEffect(() => {
    viewDataGenerationRef.current += 1;
    viewDataLoadedAtRef.current.clear();
    viewDataRequestRef.current.clear();
    prefetchedShopDetailsRef.current.clear();
  }, [auth?.token]);

  useEffect(() => {
    if (!sessionReady || !currentUser) return;
    void refreshViewData(view);
  }, [sessionReady, currentUser?.id, view, refreshViewData]);

  useEffect(() => {
    if (view !== "shops") return;
    void refreshShopDetail(selectedShopId);
  }, [selectedShopId, auth?.token, view]);

  useEffect(() => {
    void refreshMessages(selectedConversationId, canMarkSelectedConversationRead);
  }, [selectedConversationId, auth?.token, canMarkSelectedConversationRead]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), toast.tone === "success" ? 2200 : toast.tone === "error" ? 5000 : 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const eventRefreshCurrentViewRef = useRef<() => Promise<void>>(async () => undefined);
  const eventRefreshWorkbenchRef = useRef(refreshWorkbenchConversations);
  const eventRefreshMessagesRef = useRef(refreshMessages);
  const eventRefreshPendingTicketAttentionRef = useRef(refreshPendingTicketAttention);
  const eventApplyAgentAssignmentRef = useRef(applyAgentAssignment);
  const eventApplyShopSourceUpdatesRef = useRef(applyShopSourceUpdates);
  const eventApplyShopUpdateRef = useRef(applyShopUpdate);
  const eventConversationIDRef = useRef(selectedConversationId);
  const eventCurrentUserRef = useRef(currentUser);
  const eventCurrentViewRef = useRef(view);
  const eventUsersRef = useRef(users);
  eventRefreshCurrentViewRef.current = () => refreshViewData(view, true);
  eventRefreshWorkbenchRef.current = refreshWorkbenchConversations;
  eventRefreshMessagesRef.current = refreshMessages;
  eventRefreshPendingTicketAttentionRef.current = refreshPendingTicketAttention;
  eventApplyAgentAssignmentRef.current = applyAgentAssignment;
  eventApplyShopSourceUpdatesRef.current = applyShopSourceUpdates;
  eventApplyShopUpdateRef.current = applyShopUpdate;
  eventConversationIDRef.current = selectedConversationId;
  eventCurrentUserRef.current = currentUser;
  eventCurrentViewRef.current = view;
  eventUsersRef.current = users;

  useEffect(() => {
    if (!auth?.token || !sessionReady || (!canUseWorkbench && !canViewOperations && !canViewTickets && !canViewShops)) {
      setEventConnectionStatus("disconnected");
      return;
    }
    let stopped = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatDeadline: number | null = null;
    let reconnectAttempt = 0;
    let ticketRequestInFlight = false;
    let refreshAfterReconnect = false;

    const clearHeartbeatDeadline = () => {
      if (heartbeatDeadline !== null) window.clearTimeout(heartbeatDeadline);
      heartbeatDeadline = null;
    };
    const armHeartbeatDeadline = () => {
      clearHeartbeatDeadline();
      heartbeatDeadline = window.setTimeout(() => {
        if (socket?.readyState === WebSocket.OPEN) socket.close(4000, "heartbeat timeout");
      }, eventHeartbeatTimeoutMs);
    };
    const scheduleReconnect = () => {
      if (stopped || reconnectTimer !== null) return;
      setEventConnectionStatus("reconnecting");
      refreshAfterReconnect = true;
      if (document.visibilityState !== "visible" || navigator.onLine === false) return;
      const baseDelay = eventReconnectDelaysMs[Math.min(reconnectAttempt, eventReconnectDelaysMs.length - 1)];
      reconnectAttempt += 1;
      const delay = Math.max(250, Math.round(baseDelay * (0.8 + Math.random() * 0.4)));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void connect();
      }, delay);
    };

    const connect = async () => {
      if (stopped || ticketRequestInFlight || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      if (document.visibilityState !== "visible" || navigator.onLine === false) {
        setEventConnectionStatus("reconnecting");
        return;
      }
      setEventConnectionStatus(refreshAfterReconnect ? "reconnecting" : "connecting");
      ticketRequestInFlight = true;
      try {
        const { ticket } = await api.createWSTicket();
        if (stopped) return;
        socket = new WebSocket(api.eventsUrl(ticket));
      } catch {
        scheduleReconnect();
        return;
      } finally {
        ticketRequestInFlight = false;
      }
      socket.onopen = () => {
        const shouldReconcile = refreshAfterReconnect;
        reconnectAttempt = 0;
        setEventConnectionStatus("connected");
        armHeartbeatDeadline();
        if (shouldReconcile) {
          void api.me().then((user) => {
            setAuth((current) => {
              if (!current || current.user.id !== user.id) return current;
              const next = { ...current, user };
              storeAuth(next);
              return next;
            });
          }).catch(() => undefined);
          if (eventCurrentViewRef.current === "workbench" && canUseWorkbench) void eventRefreshWorkbenchRef.current();
          else void eventRefreshCurrentViewRef.current();
          void eventRefreshPendingTicketAttentionRef.current();
          if (eventCurrentViewRef.current === "workbench" && eventConversationIDRef.current) {
            void eventRefreshMessagesRef.current(eventConversationIDRef.current, true);
          }
        }
        refreshAfterReconnect = false;
      };
      socket.onmessage = (messageEvent) => {
        let event: PlatformEvent | null = null;
        try {
          event = JSON.parse(String(messageEvent.data)) as PlatformEvent;
        } catch {
          event = null;
        }
        if (!event) return;
        if (event.type === "connection.heartbeat") {
          armHeartbeatDeadline();
          try {
            if (socket?.readyState === WebSocket.OPEN) socket.send("heartbeat");
          } catch {
            socket?.close();
          }
          return;
        }
        emitPlatformEvent(event);
        const eventCurrentUser = eventCurrentUserRef.current;
        if (event.type === "user.updated") {
          const updatedUser = event.payload as User | undefined;
          if (updatedUser?.id) {
            setUsers((current) => current.map((item) => item.id === updatedUser.id ? updatedUser : item));
            if (updatedUser.id === eventCurrentUser?.id) {
              viewDataGenerationRef.current += 1;
              viewDataLoadedAtRef.current.clear();
              viewDataRequestRef.current.clear();
              prefetchedShopDetailsRef.current.clear();
              setAuth((current) => {
                if (!current || current.user.id !== updatedUser.id) return current;
                const next = { ...current, user: updatedUser };
                storeAuth(next);
                return next;
              });
            }
          }
        }
        if (event.type === "shop_source.created" || event.type === "shop_source.updated" || event.type === "source.updated") {
          const source = event.payload as ShopSource | undefined;
          if (source?.id) eventApplyShopSourceUpdatesRef.current([source]);
        } else if (event.type === "email.gmail.installed" || event.type === "email.outlook.installed") {
          const source = (event.payload as { source?: ShopSource } | undefined)?.source;
          if (source?.id) eventApplyShopSourceUpdatesRef.current([source]);
        } else if (event.type === "shopify_app.installed") {
          const source = (event.payload as { source?: ShopSource } | undefined)?.source;
          if (source?.id) eventApplyShopSourceUpdatesRef.current([source]);
        } else if (event.type === "shopify_app.deployed") {
          if (eventCurrentViewRef.current === "shops") void eventRefreshCurrentViewRef.current();
        }
        if (event.type === "ticket.created" || event.type === "ticket.updated" || event.type === "ticket.assigned") {
          const ticket = event.payload as Ticket | undefined;
          setTicketRefreshToken((current) => current + 1);
          void eventRefreshPendingTicketAttentionRef.current();
          if ((event.type === "ticket.created" || event.type === "ticket.assigned") && ticket && eventCurrentUser && (ticket.assignedAgentId === eventCurrentUser.id || ticket.collaboratorIds?.includes(eventCurrentUser.id)) && ticket.createdBy !== eventCurrentUser.id) {
            setToast({ tone: "info", text: `${event.type === "ticket.assigned" ? "收到转交工单" : "收到新工单"}：${ticket.title}，请到工单中心处理` });
          }
        }
        if (event.type === "message.created") {
          setTicketContextRefreshToken((current) => current + 1);
        }
        const conversation = event.conversation;
        if (conversation && canUseWorkbench) {
          const customerConversation = conversation.kind === "customer";
          const visible = customerConversation && (eventCurrentUser?.conversationScope === "all" || conversation.assignedAgentId === eventCurrentUser?.id
            || (conversation.status === "open" && !conversation.assignedAgentId)
            || event.type.startsWith("transfer."));
          setWorkbenchConversations((current) => {
            const without = current.filter((item) => item.id !== conversation.id);
            if (!visible) return without;
            const existing = current.find((item) => item.id === conversation.id);
            const incomingMessage = event.type === "message.created" ? (event.payload as Message | undefined) : undefined;
            const next = {
              ...mergeRealtimeConversation(existing, conversation, incomingMessage),
              lastMessageDirection: incomingMessage?.direction === "customer" || incomingMessage?.direction === "agent"
                ? incomingMessage.direction
                : conversation.lastMessageDirection || existing?.lastMessageDirection,
              unread: event.type === "message.created"
                && incomingMessage?.direction === "customer"
                && eventConversationIDRef.current !== conversation.id
                ? true
                : existing?.unread || conversation.unread
            };
            return [...without, next].sort((left, right) => Date.parse(right.customerLastMessageAt || right.lastMessageAt) - Date.parse(left.customerLastMessageAt || left.lastMessageAt));
          });
          if (!visible && eventConversationIDRef.current === conversation.id) {
            activeConversationRef.current = "";
            confirmedReadRef.current = { conversationId: "", messageId: "" };
            messageRequestSequenceRef.current += 1;
            setSelectedConversationId("");
            setMessages([]);
          }
        }
        if (event.type === "message.updated") {
          const updatedMessage = event.payload as Message | undefined;
          if (updatedMessage?.metadata?.email_send_status === "failed" && updatedMessage.metadata?.agentId === eventCurrentUser?.id) {
            setToast({ tone: "error", text: `邮件发送失败：${updatedMessage.metadata.email_send_error || "请回到该会话重新发送"}` });
          }
        }
        if (event.type.startsWith("message.") && eventConversationIDRef.current && conversation?.id === eventConversationIDRef.current) {
          const incoming = event.payload as Message;
          if (incoming?.id) {
            setMessages((current) => event.type === "message.created"
              ? current.some((item) => item.id === incoming.id) ? current : [...current, incoming]
              : current.some((item) => item.id === incoming.id)
                ? current.map((item) => item.id === incoming.id ? incoming : item)
                : [...current, incoming]);
            if (event.type === "message.created" && incoming.direction === "customer") {
              const previousMessageID = confirmedReadRef.current.conversationId === conversation.id
                ? confirmedReadRef.current.messageId
                : "";
              void api.markConversationRead(conversation.id, incoming.id, previousMessageID)
                .then(() => {
                  confirmedReadRef.current = { conversationId: conversation.id, messageId: incoming.id };
                  setWorkbenchConversations((current) => current.map((item) => item.id === conversation.id ? { ...item, unread: false } : item));
                })
                .catch(() => undefined);
            }
          }
        }
        if (event.type === "shop_agent.assigned" || event.type === "shop_agent.unassigned") {
          const assignment = (event.payload || {}) as { shopId?: string; userId?: string };
          const shopId = event.shopId || assignment.shopId || "";
          const userId = event.entityId || assignment.userId || "";
          const user = eventUsersRef.current.find((item) => item.id === userId);
          if (shopId && user) eventApplyAgentAssignmentRef.current(shopId, user, event.type === "shop_agent.assigned");
          else if (eventCurrentViewRef.current !== "workbench") void eventRefreshCurrentViewRef.current();
          if (userId === eventCurrentUser?.id && canUseWorkbench) {
            viewDataLoadedAtRef.current.delete("workbench");
            if (eventCurrentViewRef.current === "workbench") void eventRefreshCurrentViewRef.current();
          }
        } else if (event.type === "shop.updated") {
          const updatedShop = event.payload as Shop | undefined;
          if (updatedShop?.id) eventApplyShopUpdateRef.current(updatedShop);
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        clearHeartbeatDeadline();
        socket = null;
        scheduleReconnect();
      };
    };

    const resumeConnection = () => {
      if (stopped || document.visibilityState !== "visible" || navigator.onLine === false) return;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      void connect();
    };

    window.addEventListener("online", resumeConnection);
    document.addEventListener("visibilitychange", resumeConnection);
    void connect();
    return () => {
      stopped = true;
      window.removeEventListener("online", resumeConnection);
      document.removeEventListener("visibilitychange", resumeConnection);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      clearHeartbeatDeadline();
      setEventConnectionStatus("disconnected");
      if (socket?.readyState === WebSocket.OPEN) socket.close(1000, "client cleanup");
      else socket?.close();
    };
  }, [api, auth?.token, canUseWorkbench, canViewOperations, canViewShops, canViewTickets, sessionReady]);

  async function handleAuth(result: Promise<AuthResult>, showSuccess = true) {
    setBusy(true);
    try {
      const next = await result;
      storeAuth(next);
      setAuth(next);
      setNeedsBootstrap(false);
      setSessionReady(true);
      viewDataLoadedAtRef.current.clear();
      viewDataRequestRef.current.clear();
      const me = next.user;
      const nextView = initialViewForUser(me);
      setView(nextView);
      setAdminTabs(nextView === "workbench" ? [] : [nextView]);
      if (showSuccess) setToast({ tone: "success", text: `${next.user.displayName || next.user.email} ${t.loggedIn}` });
      return true;
    } catch (error) {
      setToast({ tone: "error", text: errorText(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      if (auth?.token) await api.logout();
    } catch {
      // Clear local state even if the server session is already gone.
    }
    clearSessionState(t.loggedOut, "info");
  }

  function openAdminView(nextView: AdminViewKey) {
    if (!canOpenAdminView(currentUser, nextView)) return;
    if (nextView === "tickets") setTicketOpenToken((current) => current + 1);
    setView(nextView);
    setAdminTabs((current) => current.includes(nextView) ? current : [...current, nextView]);
  }

  function openTicketConversation(conversation: Conversation) {
    setWorkbenchConversations((current) => {
      const next = current.filter((item) => item.id !== conversation.id);
      return [conversation, ...next];
    });
    setView("workbench");
    activeConversationRef.current = conversation.id;
    confirmedReadRef.current = { conversationId: "", messageId: "" };
    messageRequestSequenceRef.current += 1;
    setSelectedConversationId(conversation.id);
    setMessages([]);
    setMessagesHasMore(false);
  }

  function openAdminSection(section: AdminSectionKey) {
    if (section === "settings") setShopConfigResetToken((current) => current + 1);
    const nextView = adminMenuGroupsForSection(section).flatMap((group) => group.items).find((item) => canOpenAdminView(currentUser, item.key))?.key;
    if (nextView) openAdminView(nextView);
  }

  function closeAdminTab(tab: AdminViewKey) {
    setAdminTabs((current) => {
      const nextTabs = current.filter((item) => item !== tab);
      if (view === tab) {
        const fallback = nextTabs[nextTabs.length - 1];
        setView(fallback || "workbench");
      }
      return nextTabs;
    });
  }

  return (
    <main className={`platform-shell ${currentUser && view === "workbench" ? "agent-shell" : "admin-shell"} ${currentUser ? "authenticated-shell" : "native-auth-shell"}`}>
      <aside className="platform-sidebar">
        <div className="brand-block">
          <div className="brand-mark"><img src="/xinzhi-logo.png" alt="新知客服" /></div>
          <div><strong>新知客服</strong><span>Customer Service</span></div>
        </div>
        <nav className="nav-stack">
          {canUseWorkbench ? <NavButton active={view === "workbench"} icon={<MessageSquareText size={18} />} label={t.onlineService} onClick={() => setView("workbench")} /> : null}
          {canViewOperations ? <NavButton active={view !== "workbench" && activeAdminSection === "operations"} icon={<Activity size={18} />} label={adminSectionMeta.operations.label} onClick={() => openAdminSection("operations")} /> : null}
          {canViewBusiness ? <NavButton active={view !== "workbench" && activeAdminSection === "business"} icon={<ClipboardList size={18} />} label={adminSectionMeta.business.label} attention={canViewTickets && hasPendingTicketAttention} onClick={() => openAdminSection("business")} /> : null}
          {canViewSettings ? <NavButton active={view !== "workbench" && activeAdminSection === "settings"} icon={<Settings size={18} />} label={adminSectionMeta.settings.label} onClick={() => openAdminSection("settings")} /> : null}
        </nav>
        <div className="sidebar-footer">
          {currentUser ? (
            <>
              <div className="rail-account" title={currentUser.displayName || currentUser.email}>
                <span className="rail-account-avatar" aria-hidden="true">
                  {(currentUser.displayName || currentUser.email).trim().charAt(0).toUpperCase()}
                </span>
                <span className="rail-account-name">{currentUser.displayName || currentUser.email}</span>
              </div>
              <LanguageSelect value={language} onChange={setLanguage} t={t} />
              <button type="button" className="rail-logout" onClick={() => void handleLogout()} title={t.logout} aria-label={t.logout}>
                <LogOut size={18} />
              </button>
            </>
          ) : null}
        </div>
      </aside>

      <section className="platform-main">
        {!currentUser ? <header className="platform-topbar">
          <div>
            <h1>{viewTitle(view, isAdmin, t)}</h1>
            <p>{viewSubtitle(view, isAdmin, t)}</p>
          </div>
          <div className="topbar-actions">
            <LanguageSelect value={language} onChange={setLanguage} t={t} />
          </div>
        </header> : null}

        {toast ? (
          <div className={`toast ${toast.tone}`}>
            {toast.tone === "error" ? <CircleAlert size={16} /> : toast.tone === "success" ? <CheckCircle2 size={16} /> : <CircleDot size={16} />}
            <span>{toast.text}</span>
          </div>
        ) : null}

        {!currentUser ? (
          <>{identityMode === "loading" ? <section className="auth-layout"><div className="auth-card" role="status"><p>{busy ? "正在读取安全登录配置…" : "未能读取登录配置，请重试。"}</p><button type="button" disabled={busy} onClick={() => void refreshSession()}>重试</button></div></section> : identityMode === "erp_sso" ? <ERPLoginPanel language={language} onLogin={async (input) => { const result = await api.loginWithERP(input); if (!await handleAuth(Promise.resolve(result), false)) throw new Error("Sign-in could not be saved"); }} /> : <AuthPanel t={t} busy={busy} needsBootstrap={needsBootstrap} tenantRequired={tenantRequired} onBootstrap={(input) => void handleAuth(api.bootstrapAdmin(input))} onLogin={(email, password, tenantId) => void handleAuth(new PlatformAPI(baseUrl, "", tenantId).login(email, password))} />}</>
        ) : !sessionReady ? (
          <section className="session-loading-screen" aria-busy="true">
            <RefreshCw size={18} aria-hidden="true" />
            <span>{t.connecting}</span>
          </section>
        ) : view === "workbench" && canUseWorkbench ? (
          <WorkbenchPanel t={t} api={api} isAdmin={isAdmin} shops={workbenchShops} conversations={workbenchConversations} conversationsHasMore={conversationsHasMore} messagesHasMore={messagesHasMore} selectedConversation={selectedConversation} messages={messages} sourcesByShopId={sourcesByShopId} currentUser={currentUser} eventConnectionStatus={eventConnectionStatus} ticketRefreshToken={ticketRefreshToken} onCurrentUserChanged={(user) => setAuth((current) => {
            if (!current) return current;
            const next = { ...current, user };
            storeAuth(next);
            return next;
          })} onLoadMoreConversations={loadMoreConversations} onLoadOlderMessages={loadOlderMessages} onSelectConversation={(id, archivedConversation) => {
            if (archivedConversation) {
              setWorkbenchConversations((current) => current.some((conversation) => conversation.id === archivedConversation.id)
                ? current.map((conversation) => conversation.id === archivedConversation.id ? archivedConversation : conversation)
                : [...current, archivedConversation]);
            }
            activeConversationRef.current = id;
            if (id === selectedConversationId) {
              void refreshMessages(id, canMarkSelectedConversationRead);
              return;
            }
            confirmedReadRef.current = { conversationId: "", messageId: "" };
            messageRequestSequenceRef.current += 1;
            setSelectedConversationId(id);
            setMessages([]);
			setMessagesHasMore(false);
          }} onConversationUnavailable={(id) => {
            setWorkbenchConversations((current) => current.filter((conversation) => conversation.id !== id));
            if (activeConversationRef.current !== id) return;
            activeConversationRef.current = "";
            confirmedReadRef.current = { conversationId: "", messageId: "" };
            messageRequestSequenceRef.current += 1;
            setSelectedConversationId("");
            setMessages([]);
          }} onMessageCreated={applyMessageCreated} onConversationUpdated={applyConversationUpdate} onChanged={async () => { await refreshWorkbenchConversations(); }} setBusy={setBusy} setToast={setToast} />
        ) : (
          <section className="admin-stage">
            <aside className="admin-menu">
              <div className="admin-tab">{adminSectionMeta[activeAdminSection].label}</div>
              <nav>
                {visibleAdminMenuGroups.map((group) => (
                  <div className="admin-menu-group" key={group.title}>
                    <strong>{group.icon}{group.title}</strong>
                    {group.items.map((item) => (
                      <button
                        type="button"
                        key={item.key}
                        className={view === item.key ? "active" : ""}
                        onClick={() => openAdminView(item.key)}
                        aria-label={`${item.label}${item.key === "tickets" && hasPendingTicketAttention ? "，有待处理工单" : ""}`}
                      >
                        <span>{item.label}</span>
                        {item.key === "tickets" && hasPendingTicketAttention ? <i className="ticket-attention-dot" aria-hidden="true" /> : null}
                        {item.status === "planned" ? <em>规划中</em> : null}
                      </button>
                    ))}
                  </div>
                ))}
              </nav>
            </aside>
            <div className="admin-page">
              <div className="admin-open-tabs">
                {adminTabs.map((tab) => (
                  <button type="button" key={tab} className={view === tab ? "active" : ""} onClick={() => openAdminView(tab)} aria-label={`${adminViewLabel(tab)}${tab === "tickets" && hasPendingTicketAttention ? "，有待处理工单" : ""}`}>
                    {adminViewLabel(tab)}
                    {tab === "tickets" && hasPendingTicketAttention ? <i className="ticket-attention-dot" aria-hidden="true" /> : null}
                    <span onClick={(event) => { event.stopPropagation(); closeAdminTab(tab); }}><X size={12} /></span>
                  </button>
                ))}
              </div>
              {view === "agents" && canOpenAdminView(currentUser, "agents") ? (
                <AgentsPanel t={t} api={api} busy={busy} users={users} shops={shops} agentsByShopId={agentsByShopId} currentUser={currentUser} sharedIdentity={auth?.integrationMode === "ERP_PASSWORDLESS"} onUserSaved={applyUserSaved} onUserDeleted={applyUserDeleted} setBusy={setBusy} setToast={setToast} />
              ) : view === "shops" && canOpenAdminView(currentUser, "shops") ? (
                <ShopsPanel t={t} api={api} currentUser={currentUser} integrationMode={auth?.integrationMode} busy={busy} shops={shops} users={users} selectedShop={selectedShop} sources={sources} shopAgents={shopAgents} sourcesByShopId={sourcesByShopId} agentsByShopId={agentsByShopId} resetToken={shopConfigResetToken} onOpenVisitorSchemes={() => openAdminView("visitorSchemes")} onSelectShop={setSelectedShopId} onAgentAssignmentChanged={applyAgentAssignment} onAgentAssignmentsChanged={refreshShopDetail} onSourcesChanged={applyShopSourceUpdates} onChanged={async () => { await refreshViewData("shops", true); if (selectedShopId) await refreshShopDetail(selectedShopId, true); }} setBusy={setBusy} setToast={setToast} />
              ) : view === "monitor" && canOpenAdminView(currentUser, "monitor") ? (
                <MonitorPanel
                  api={api}
                  shops={moduleShops.monitor}
                  canManageSchedule={hasPermission(currentUser, PERMISSIONS.monitorSettingsManage)}
                  setToast={setToast}
                />
              ) : view !== "workbench" && historicalStatisticsViews.includes(view) && canOpenAdminView(currentUser, view) ? (
                <HistoricalStatisticsPanel
                  view={view}
                  api={api}
                  shops={moduleShops.monitor}
                  users={users}
                  canManageSLA={hasPermission(currentUser, PERMISSIONS.monitorSettingsManage)}
                  setToast={setToast}
                />
              ) : view === "knowledge" && canOpenAdminView(currentUser, "knowledge") ? (
                <KnowledgePanel api={api} shops={moduleShops.knowledge} currentUser={currentUser} busy={busy} setBusy={setBusy} setToast={setToast} />
              ) : view === "aiSettings" && canOpenAdminView(currentUser, "aiSettings") ? (
                <AISettingsPanel api={api} busy={busy} setBusy={setBusy} setToast={setToast} />
              ) : view === "logisticsSettings" && canOpenAdminView(currentUser, "logisticsSettings") ? (
                <LogisticsSettingsPanel api={api} busy={busy} setBusy={setBusy} setToast={setToast} />
              ) : view === "emailProviderSettings" && canOpenAdminView(currentUser, "emailProviderSettings") ? (
                <EmailProviderSettingsPanel api={api} busy={busy} setBusy={setBusy} setToast={setToast} />
              ) : view === "visitorSchemes" && canOpenAdminView(currentUser, "visitorSchemes") ? (
                <VisitorSchemesPanel api={api} shops={shops} sourcesByShopId={sourcesByShopId} busy={busy} onChanged={() => void refreshViewData("visitorSchemes", true)} setBusy={setBusy} setToast={setToast} />
              ) : view === "customerLogin" && canOpenAdminView(currentUser, "customerLogin") ? (
                <CustomerLoginPanel api={api} shops={shops} sourcesByShopId={sourcesByShopId} onSourcesChanged={applyShopSourceUpdates} setToast={setToast} />
              ) : view === "orderOperations" && canOpenAdminView(currentUser, "orderOperations") ? (
                <OrderOperationsPanel
                  api={api}
                  shops={moduleShops.orders}
                  canRefund={hasPermission(currentUser, PERMISSIONS.ordersRefund)}
                  busy={busy}
                  setBusy={setBusy}
                  setToast={setToast}
                />
              ) : view === "disputeManagement" && canOpenAdminView(currentUser, "disputeManagement") ? (
                <DisputeManagementPanel
                  api={api}
                  shops={moduleShops.orders}
                  setToast={setToast}
                />
              ) : view === "conversationRecords" && canOpenAdminView(currentUser, "conversationRecords") ? (
                <ProcessingRecordsPanel api={api} shops={moduleShops.records} users={users} agentsByShopId={agentsByShopId} setToast={setToast} />
              ) : view === "recordCategories" && canOpenAdminView(currentUser, "recordCategories") ? (
                <RecordCategoriesPanel api={api} setToast={setToast} />
              ) : view === "emailProcessing" && canOpenAdminView(currentUser, "emailProcessing") ? (
                <EmailProcessingPanel api={api} setToast={setToast} />
              ) : view === "emailStatistics" && canOpenAdminView(currentUser, "emailStatistics") ? (
                <EmailStatisticsPanel api={api} setToast={setToast} />
              ) : view === "tickets" && canOpenAdminView(currentUser, "tickets") ? (
                <TicketPanel key={`tickets-${ticketOpenToken}`} api={api} shops={moduleShops.tickets} users={users} currentUser={currentUser} refreshToken={ticketRefreshToken} contextRefreshToken={ticketContextRefreshToken} t={t} onOpenConversation={openTicketConversation} setToast={setToast} />
              ) : view !== "workbench" && canOpenAdminView(currentUser, view) ? (
                <PlannedAdminPanel item={adminMenuItem(view)} onOpenRelated={(nextView) => openAdminView(nextView)} />
              ) : null}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function resolveDefaultBaseUrl() {
  if (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost") {
    if (window.location.port === "5173") return "http://127.0.0.1:8787";
  }
  return window.location.origin;
}
