import type { User, UserRole } from "./api";

export const PERMISSIONS = {
  workbenchAccess: "workbench.access",
  autoReception: "routing.auto_receive",
  conversationClaim: "conversations.claim",
  conversationReply: "conversations.reply",
  conversationTransfer: "conversations.transfer",
  conversationClose: "conversations.close",
  ticketsView: "tickets.view",
  ticketsManage: "tickets.manage",
  emailProcessingManage: "email_processing.manage",
  emailStatisticsView: "email_statistics.view",
  knowledgeCreate: "knowledge.create",
  knowledgeEdit: "knowledge.edit",
  knowledgeDelete: "knowledge.delete",
  knowledgeReview: "knowledge.review",
  shopsView: "shops.view",
  shopsExport: "shops.export",
  shopChannelsManage: "shops.channels.manage",
  shopsAssign: "shops.assign",
  shopsCreate: "shops.create",
  shopsDelete: "shops.delete",
  usersView: "users.view",
  usersManage: "users.manage",
  permissionsManage: "permissions.manage",
  monitorView: "monitor.view",
  monitorSettingsManage: "monitor.settings.manage",
  recordsView: "records.view",
  recordsExport: "records.export",
  ordersView: "orders.view",
  ordersRefund: "orders.refund",
  ordersDisputes: "orders.disputes",
  recordCategoriesManage: "record_categories.manage",
  visitorSchemesManage: "visitor_schemes.manage",
  customerLoginManage: "customer_login.manage",
  logisticsManage: "logistics.manage",
  aiManage: "ai.manage",
  emailProvidersManage: "email_providers.manage"
} as const;

export type PermissionKey = typeof PERMISSIONS[keyof typeof PERMISSIONS];

export const permissionGroups: Array<{ label: string; items: Array<{ key: PermissionKey; label: string }> }> = [
  { label: "客服工作台", items: [
    { key: PERMISSIONS.workbenchAccess, label: "进入客服工作台" },
    { key: PERMISSIONS.autoReception, label: "参与自动进线（需开启客服工作台）" },
    { key: PERMISSIONS.conversationClaim, label: "接入会话" },
    { key: PERMISSIONS.conversationReply, label: "回复客户" },
    { key: PERMISSIONS.conversationTransfer, label: "转接会话" },
    { key: PERMISSIONS.conversationClose, label: "结束和重新打开会话" }
  ] },
  { label: "工单", items: [
    { key: PERMISSIONS.ticketsView, label: "查看工单" },
    { key: PERMISSIONS.ticketsManage, label: "创建、接收、转派和解决工单" }
  ] },
  { label: "知识库", items: [
    { key: PERMISSIONS.knowledgeCreate, label: "新增和导入知识" },
    { key: PERMISSIONS.knowledgeEdit, label: "修改知识" },
    { key: PERMISSIONS.knowledgeDelete, label: "删除知识" },
    { key: PERMISSIONS.knowledgeReview, label: "审核知识" }
  ] },
  { label: "店铺和账号", items: [
    { key: PERMISSIONS.shopsView, label: "查看店铺和渠道" },
    { key: PERMISSIONS.shopsExport, label: "导出店铺详细信息" },
    { key: PERMISSIONS.shopChannelsManage, label: "配置渠道、授权和发布插件" },
    { key: PERMISSIONS.shopsAssign, label: "分配客服到店铺" },
    { key: PERMISSIONS.shopsCreate, label: "新增店铺" },
    { key: PERMISSIONS.shopsDelete, label: "删除店铺" },
    { key: PERMISSIONS.usersView, label: "查看坐席账号" },
    { key: PERMISSIONS.usersManage, label: "新增和编辑坐席账号" },
    { key: PERMISSIONS.permissionsManage, label: "设置账号权限和工作台范围" }
  ] },
  { label: "管理后台", items: [
    { key: PERMISSIONS.emailProcessingManage, label: "处理系统通知、验证码和其他通知邮件" },
    { key: PERMISSIONS.emailStatisticsView, label: "查看、标记处理、添加标签并导出非客户邮件" },
    { key: PERMISSIONS.monitorView, label: "实时监控和统计" },
    { key: PERMISSIONS.monitorSettingsManage, label: "设置监控统计工作时间" },
    { key: PERMISSIONS.recordsView, label: "查看处理记录" },
    { key: PERMISSIONS.recordsExport, label: "导出处理记录" },
    { key: PERMISSIONS.ordersView, label: "查看订单" },
    { key: PERMISSIONS.ordersRefund, label: "处理退款" },
    { key: PERMISSIONS.ordersDisputes, label: "处理拒付" },
    { key: PERMISSIONS.recordCategoriesManage, label: "管理处理分类" },
    { key: PERMISSIONS.visitorSchemesManage, label: "管理访客方案" },
    { key: PERMISSIONS.customerLoginManage, label: "管理客户登录要求" },
    { key: PERMISSIONS.logisticsManage, label: "管理物流设置" },
    { key: PERMISSIONS.aiManage, label: "AI 接入设置" },
    { key: PERMISSIONS.emailProvidersManage, label: "管理邮箱服务配置" }
  ] }
];

export const allPermissionKeys = permissionGroups.flatMap((group) => group.items.map((item) => item.key));

export function defaultPermissionsForRole(role: UserRole, department?: User["department"]): PermissionKey[] {
  if (role === "admin") {
    const workbenchPermissions: PermissionKey[] = [
      PERMISSIONS.workbenchAccess,
      PERMISSIONS.autoReception,
      PERMISSIONS.conversationClaim,
      PERMISSIONS.conversationReply,
      PERMISSIONS.conversationTransfer,
      PERMISSIONS.conversationClose
    ];
    const defaultOffPermissions: PermissionKey[] = [
      ...workbenchPermissions,
      PERMISSIONS.knowledgeCreate,
      PERMISSIONS.knowledgeEdit,
      PERMISSIONS.knowledgeDelete,
      PERMISSIONS.knowledgeReview
    ];
    return allPermissionKeys.filter((permission) => !defaultOffPermissions.includes(permission));
  }
  if (department === "财务部" || department === "综合部") {
    return [PERMISSIONS.emailStatisticsView];
  }
  return [
    PERMISSIONS.workbenchAccess,
    PERMISSIONS.autoReception,
    PERMISSIONS.conversationClaim,
    PERMISSIONS.conversationReply,
    PERMISSIONS.conversationTransfer,
    PERMISSIONS.conversationClose,
    PERMISSIONS.ticketsView,
    PERMISSIONS.ticketsManage,
    PERMISSIONS.shopsView,
    PERMISSIONS.shopChannelsManage
  ];
}

export function hasPermission(user: User | null | undefined, permission: PermissionKey): boolean {
  if (user?.role === "agent" && user.department && user.department !== "客服部" && permission !== PERMISSIONS.emailStatisticsView) {
    return false;
  }
  return Boolean(user?.permissions?.includes(permission));
}

export const systemAdminCorePermissions: PermissionKey[] = [
  PERMISSIONS.usersView,
  PERMISSIONS.usersManage,
  PERMISSIONS.permissionsManage,
  PERMISSIONS.shopsExport,
  PERMISSIONS.monitorSettingsManage,
  PERMISSIONS.emailProcessingManage,
  PERMISSIONS.emailStatisticsView,
  PERMISSIONS.emailProvidersManage
];
