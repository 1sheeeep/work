import { ReactNode } from "react";
import { BarChart3, ClipboardList, ListChecks, MessageSquareText, Settings } from "lucide-react";

export type ImplementedAdminViewKey =
  | "agents"
  | "shops"
  | "aiSettings"
  | "logisticsSettings"
  | "emailProviderSettings"
  | "monitor"
  | "conversationStats"
  | "customerStats"
  | "agentStats"
  | "skillStats"
  | "serviceSummaryStats"
  | "slaStats"
  | "knowledge"
  | "visitorSchemes"
  | "customerLogin"
  | "orderOperations"
  | "disputeManagement"
  | "conversationRecords"
  | "recordCategories"
  | "emailProcessing"
  | "emailStatistics"
  | "tickets";
export type PlannedAdminViewKey =
  | "anomalyMonitor"
  | "satisfactionStats"
  | "leaveMessageRecords"
  | "quickMenu"
  | "faq"
  | "inquiryForms"
  | "receptionSchemes";
export type AdminViewKey = ImplementedAdminViewKey | PlannedAdminViewKey;
export type ViewKey = "workbench" | AdminViewKey;
export type AdminSectionKey = "operations" | "business" | "settings";
export type AdminMenuItem = {
  key: AdminViewKey;
  label: string;
  status: "live" | "planned";
  summary?: string;
  dependsOn?: string;
  nextStep?: string;
  relatedView?: ImplementedAdminViewKey;
};
type AdminMenuGroup = {
  title: string;
  sectionTitles?: Partial<Record<AdminSectionKey, string>>;
  icon: ReactNode;
  items: AdminMenuItem[];
};
type ViewCopy = {
  viewShopsTitle: string;
  viewAgentsTitle: string;
  viewWorkbenchAdminTitle: string;
  viewWorkbenchAgentTitle: string;
  viewShopsSubtitle: string;
  viewAgentsSubtitle: string;
  viewWorkbenchAdminSubtitle: string;
  viewWorkbenchAgentSubtitle: string;
};

export const adminSectionMeta: Record<AdminSectionKey, { label: string; defaultView: AdminViewKey }> = {
  operations: { label: "客服监控", defaultView: "monitor" },
  business: { label: "业务处理", defaultView: "orderOperations" },
  settings: { label: "软件配置", defaultView: "shops" }
};

const adminSectionByView: Record<AdminViewKey, AdminSectionKey> = {
  monitor: "operations",
  anomalyMonitor: "operations",
  conversationStats: "operations",
  customerStats: "operations",
  agentStats: "operations",
  skillStats: "operations",
  satisfactionStats: "operations",
  serviceSummaryStats: "operations",
  slaStats: "operations",
  conversationRecords: "operations",
  leaveMessageRecords: "operations",
  orderOperations: "business",
  disputeManagement: "business",
  emailProcessing: "business",
  emailStatistics: "business",
  tickets: "business",
  shops: "settings",
  aiSettings: "settings",
  logisticsSettings: "settings",
  emailProviderSettings: "settings",
  agents: "settings",
  knowledge: "settings",
  quickMenu: "settings",
  faq: "settings",
  inquiryForms: "settings",
  visitorSchemes: "settings",
  customerLogin: "settings",
  receptionSchemes: "settings",
  recordCategories: "settings"
};

const adminMenuGroups: AdminMenuGroup[] = [
  {
    title: "订单售后",
    sectionTitles: { business: "订单售后" },
    icon: <ClipboardList size={15} />,
    items: [
      {
        key: "orderOperations",
        label: "订单与退款",
        status: "live",
        summary: "按店铺检索订单、处理退货退款，并在内部查看订单统计规划。"
      },
      {
        key: "disputeManagement",
        label: "拒付管理",
        status: "live",
        summary: "集中查看 Shopify Payments 拒付状态、原因和处理截止时间。"
      }
    ]
  },
  {
    title: "在线客服",
    icon: <MessageSquareText size={15} />,
    items: [
      {
        key: "emailProcessing",
        label: "邮件处理",
        status: "live",
        summary: "集中处理系统通知、验证码和其他通知邮件，不进入客服会话和客服统计。"
      },
      {
        key: "emailStatistics",
        label: "邮件统计",
        status: "live",
        summary: "按单封邮件查询并导出非广告、非客户咨询的完整邮件数据。"
      },
      {
        key: "tickets",
        label: "工单",
        status: "live",
        summary: "跟进需要跨会话、跨班次或多客服协作处理的问题。"
      },
      {
        key: "monitor",
        label: "实时监控",
        status: "live",
        summary: "按店铺、客服、渠道和会话状态查看当前接待压力。",
        nextStep: "继续补齐接待方案后，实时监控会接入更准确的队列、在线和忙碌状态。"
      },
      {
        key: "anomalyMonitor",
        label: "异常监控",
        status: "planned",
        summary: "用于集中查看超时未回复、长时间排队、渠道断开和插件异常。",
        dependsOn: "需要 SLA 规则、客服在线状态和渠道健康事件。",
        nextStep: "先保留入口；当前可在实时监控的“异常监控”页签查看 30 分钟未更新会话。",
        relatedView: "monitor"
      }
    ]
  },
  {
    title: "数据统计",
    icon: <BarChart3 size={15} />,
    items: [
      {
        key: "conversationStats",
        label: "会话统计",
        status: "live",
        summary: "统计排队、接通、有效会话、首响和平均响应时长。",
      },
      {
        key: "customerStats",
        label: "客户统计",
        status: "live",
        summary: "区分新访客、回访访客、机器人/人工接待和转人工路径。",
      },
      {
        key: "agentStats",
        label: "客服统计",
        status: "live",
        summary: "统计客服接待量、完成量、首响、平均响应和 SLA 达标率。"
      },
      {
        key: "skillStats",
        label: "技能组统计",
        status: "live",
        summary: "按技能组统计接待量、完成量、响应时长和 SLA 达标率。"
      },
      {
        key: "satisfactionStats",
        label: "满意度评价统计",
        status: "planned",
        summary: "统计主动评价、邀请评价、解决/未解决和星级评分。",
        dependsOn: "需要满意度邀请、评价组件和评价数据表。"
      },
      {
        key: "serviceSummaryStats",
        label: "服务总结统计",
        status: "live",
        summary: "按服务分类统计结束会话、分类覆盖率和分类结构。"
      },
      {
        key: "slaStats",
        label: "SLA统计",
        status: "live",
        summary: "统计首响、回复、解决等 SLA 达标率和超时率。"
      }
    ]
  },
  {
    title: "记录",
    icon: <ClipboardList size={15} />,
    items: [
      {
        key: "conversationRecords",
        label: "处理记录",
        status: "live",
        summary: "按店铺、客户、分类和时间查询客服处理记录，并导出 Excel。"
      },
      {
        key: "leaveMessageRecords",
        label: "留言记录",
        status: "planned",
        summary: "管理离线留言、询前表单和未接待客户提交的内容。",
        dependsOn: "需要离线留言流程、询前表单和留言状态。"
      }
    ]
  },
  {
    title: "服务应用",
    sectionTitles: { settings: "接待配置" },
    icon: <ListChecks size={15} />,
    items: [
      {
        key: "quickMenu",
        label: "快捷菜单",
        status: "planned",
        summary: "配置访客端常用入口，例如查订单、物流、退换货。",
        dependsOn: "需要访客方案和 Shopify 订单查询入口。"
      },
      {
        key: "faq",
        label: "常见问题",
        status: "planned",
        summary: "配置客服和访客都能调用的 FAQ/知识库内容。",
        dependsOn: "需要知识库结构和客服插入回答流程。"
      },
      {
        key: "knowledge",
        label: "知识库",
        status: "live",
        summary: "管理员维护全局和店铺专属知识；客服结束会话后可提交审核。"
      },
      {
        key: "inquiryForms",
        label: "询前表单",
        status: "planned",
        summary: "配置可选的访客联系方式、订单号和问题类型采集。",
        dependsOn: "需要访客方案支持表单开关和字段定义。"
      },
      {
        key: "visitorSchemes",
        label: "访客方案",
        status: "live",
        summary: "配置可复用的访客语言和即时回答，并一次应用到多个店铺。"
      },
      {
        key: "customerLogin",
        label: "客户登录",
        status: "live",
        summary: "按店铺或统一控制前台聊天是否仅允许已登录的 Shopify 客户使用。"
      },
      {
        key: "receptionSchemes",
        label: "接待方案",
        status: "planned",
        summary: "配置人工优先、分配客服、离线提示、欢迎语和队列策略。",
        dependsOn: "需要接待模式、自动分配规则和客服在线状态。",
        nextStep: "当前先使用店铺分配客服作为默认接待规则。",
        relatedView: "shops"
      }
    ]
  },
  {
    title: "基础管理",
    icon: <Settings size={15} />,
    items: [
      {
        key: "recordCategories",
        label: "处理分类",
        status: "live",
        summary: "维护客服处理记录使用的全局三级分类。"
      },
      {
        key: "shops",
        label: "店铺与渠道",
        status: "live",
        summary: "管理 Shopify 插件安装、邮箱渠道、客服分配和前台聊天入口。"
      },
      {
        key: "emailProviderSettings",
        label: "邮箱服务",
        status: "live",
        summary: "集中配置脆球域名邮箱服务；店铺接入时按邮箱后缀自动匹配。"
      },
      {
        key: "aiSettings",
        label: "AI 接入",
        status: "live",
        summary: "配置全局 DeepSeek 接口，供翻译和 AI 回复建议使用。"
      },
      {
        key: "logisticsSettings",
        label: "物流 API",
        status: "live",
        summary: "配置 17TRACK Standard、Webhook 和共享物流轨迹缓存。"
      },
      {
        key: "agents",
        label: "坐席列表",
        status: "live",
        summary: "创建管理员以及客服部、财务部和综合部子账号。"
      },
    ]
  }
];

const adminMenuItems = adminMenuGroups.flatMap((group) => group.items);

export function adminViewLabel(view: AdminViewKey) {
  return adminMenuItem(view).label;
}

export function adminSectionForView(view: AdminViewKey): AdminSectionKey {
  return adminSectionByView[view] || "operations";
}

export function adminMenuGroupsForSection(section: AdminSectionKey) {
  return adminMenuGroups
    .map((group) => ({
      ...group,
      title: group.sectionTitles?.[section] || group.title,
      items: group.items.filter((item) => adminSectionForView(item.key) === section)
    }))
    .filter((group) => group.items.length > 0);
}

export function viewTitle(view: ViewKey, isAdmin: boolean, t: ViewCopy) {
  if (view === "shops") return t.viewShopsTitle;
  if (view === "agents") return t.viewAgentsTitle;
  if (view === "monitor") return "实时监控";
  if (view === "aiSettings") return "AI 接入";
  if (view === "logisticsSettings") return "物流 API";
  if (view === "emailProviderSettings") return "邮箱服务";
  if (view !== "workbench") return adminMenuItem(view).label;
  return isAdmin ? t.viewWorkbenchAdminTitle : t.viewWorkbenchAgentTitle;
}

export function viewSubtitle(view: ViewKey, isAdmin: boolean, t: ViewCopy) {
  if (view === "shops") return t.viewShopsSubtitle;
  if (view === "agents") return t.viewAgentsSubtitle;
  if (view === "monitor") return "管理员查看店铺会话、客服接待和渠道状态。";
  if (view === "aiSettings") return "配置全局 DeepSeek 服务，统一支持翻译和 AI 回复建议。";
  if (view === "logisticsSettings") return "配置 17TRACK Standard，为客户和客服提供物流轨迹查询。";
  if (view === "emailProviderSettings") return "集中维护第三方域名邮箱参数，普通接入只需填写邮箱账号和邮箱密码。";
  if (view !== "workbench") return adminMenuItem(view).summary || "按完整服务台菜单保留入口，后续随接待闭环逐步实现。";
  return isAdmin ? t.viewWorkbenchAdminSubtitle : t.viewWorkbenchAgentSubtitle;
}

export function adminMenuItem(view: AdminViewKey): AdminMenuItem {
  return adminMenuItems.find((item) => item.key === view) || {
    key: view,
    label: "未命名模块",
    status: "planned",
    summary: "该模块尚未接入菜单配置。"
  };
}
