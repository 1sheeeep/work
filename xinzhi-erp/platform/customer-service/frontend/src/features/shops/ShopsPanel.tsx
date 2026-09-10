import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleDot, Copy, Download, ExternalLink, FileQuestion, FormInput, HelpCircle, Languages, LoaderCircle, Mail, MessageSquareText, PackageSearch, PieChart, Plus, RefreshCw, Send, Settings, Store, Truck, UserPlus, X } from "lucide-react";
import { AISettings, cleanBaseUrl, Conversation, CuiqiuConnectInput, EmailHistoryImportJob, KnowledgeEntry, MailConfigStatus, Message, PlatformAPI, ResponseMetrics, Shop, ShopChannelCheckResult, ShopifyConnectionStatus, ShopifyOrderSummary, ShopSource, StandardMailConnectInput, User, UserRole } from "../../api";
import { Badge, Empty, Panel } from "../../components/ui";
import { hasPermission, PERMISSIONS } from "../../permissions";
import { type Language, type ShopConfigMenuKey, type T, type ToastMessage, type ToastTone } from "../shared/types";
import { errorText, connectedShopChannelLabels, conversationStatusLabel, dateOnly, defaultShopifyOrderQuery, durationLabel, firstTracking, formatMoney, isConnectedSource, normalizeShopifyDomain, roleLabel, selectedShopifyDomain, shopifyAPIStatusView, shopifyAppEmbedUrl, shopifyConnectionSummaryView, shopifyPluginRuntimeStatusView, sourceLabel, storedShopifyConnectionStatus, systemAdminUserId, timeLabel, userDisplayName, userStatusLabel } from "../shared/helpers";
import { subscribePlatformEvents } from "../shared/platformEvents";

type EmailChannelStatusKey = "ready" | "pending" | "partial_error" | "error" | "not_configured";
type StandardMailService = "netease" | "qq" | "139" | "189";
type StandardMailTutorialService = StandardMailService;

const STANDARD_MAIL_SERVICE_VIEW: Record<StandardMailService, {
  title: string;
  guidance: string;
  mailboxPlaceholder: string;
  credentialLabel: string;
  credentialPlaceholder: string;
}> = {
  netease: {
    title: "网易邮箱（163/126）",
    guidance: "支持 @163.com 和 @126.com。请先在网易邮箱开启相关服务，再填写邮箱账号和客户端授权码；请勿填写网页登录密码。",
    mailboxPlaceholder: "例如：support@163.com",
    credentialLabel: "客户端授权码",
    credentialPlaceholder: "在网易邮箱客户端授权设置中生成"
  },
  qq: {
    title: "QQ 邮箱",
    guidance: "支持 @qq.com 和 @vip.qq.com。请先在 QQ 邮箱设置中开启相关服务并生成授权码，再填写邮箱账号和客户端授权码。",
    mailboxPlaceholder: "例如：support@qq.com 或 name@vip.qq.com",
    credentialLabel: "客户端授权码",
    credentialPlaceholder: "在 QQ 邮箱账号设置中生成"
  },
  "139": {
    title: "139 邮箱",
    guidance: "支持 @139.com。请先在 139 邮箱设置中开启相关服务并生成授权码，再填写邮箱账号和客户端授权码。",
    mailboxPlaceholder: "例如：support@139.com",
    credentialLabel: "客户端授权码",
    credentialPlaceholder: "在 139 邮箱设置中生成"
  },
  "189": {
    title: "189 邮箱",
    guidance: "支持 @189.cn。请先开启邮件服务并生成客户端专用密码，再填写完整邮箱账号和客户端专用密码。",
    mailboxPlaceholder: "例如：support@189.cn",
    credentialLabel: "客户端专用密码",
    credentialPlaceholder: "在 189 邮箱设置中生成"
  }
};

const STANDARD_MAIL_TUTORIAL_VIEW: Record<StandardMailTutorialService, {
  title: string;
  subtitle: string;
  steps: string[];
  warning: string;
  image: string;
  imageAlt: string;
  imageCaption?: string;
}> = {
  netease: {
    title: "网易邮箱接入教程",
    subtitle: "适用于 @163.com 和 @126.com 邮箱",
    steps: [
      "登录 163 或 126 网页邮箱，进入“设置”。",
      "点击左侧“POP3/SMTP/IMAP”。",
      "开启“IMAP/SMTP服务”，POP3 无需开启。",
      "复制授权码，返回系统，填写邮箱账号和客户端授权码。"
    ],
    warning: "填写的是客户端授权码，不是邮箱登录密码。",
    image: "/tutorial/netease-imap-smtp-settings.png",
    imageAlt: "网易邮箱设置页面，左侧选择 POP3/SMTP/IMAP，并确认 IMAP/SMTP 服务已开启"
  },
  qq: {
    title: "QQ 邮箱接入教程",
    subtitle: "开启邮件服务并生成客户端授权码",
    steps: [
      "登录 QQ 网页邮箱，进入“安全设置”。",
      "找到“POP3/IMAP/SMTP/Exchange/CardDAV/CalDAV 服务”，确认服务已开启。",
      "点击“生成授权码”，完成身份验证后复制授权码。",
      "勾选“SMTP 发信后保存到服务器”，便于在 QQ 网页端查看已发送邮件。",
      "返回系统，填写完整邮箱账号和客户端授权码。"
    ],
    warning: "填写的是客户端授权码，不是 QQ 邮箱登录密码。",
    image: "/tutorial/qq-mail-security-settings-redacted.png",
    imageAlt: "QQ 邮箱安全设置页面，头像、昵称和邮箱账号已模糊"
  },
  "139": {
    title: "139 邮箱接入教程",
    subtitle: "开启邮箱协议并生成客户端授权码",
    steps: [
      "登录 139 网页邮箱，进入顶部“设置 → 常规设置”；也可以直接选择“设置 → 获取授权码”。",
      "进入“账号与安全 → 邮箱协议设置”，在“服务开关”中选择 POP3/IMAP 并保存。",
      "按页面提示获取短信验证码并完成身份验证。",
      "点击“获取授权码”，复制新生成的授权码。",
      "返回系统，填写完整的 @139.com 邮箱账号和客户端授权码。"
    ],
    warning: "填写的是客户端授权码，不是邮箱登录密码。139 授权码有效期为 90 天，到期后需要重新生成并接入。",
    image: "/tutorial/139-mail-protocol-settings-guide.png",
    imageAlt: "139 邮箱协议设置和获取授权码操作示意",
    imageCaption: "设置页面示意，具体入口以 139 邮箱官网当前页面为准。"
  },
  "189": {
    title: "189 邮箱接入教程",
    subtitle: "开启邮件服务并生成客户端专用密码",
    steps: [
      "登录 189 网页邮箱，进入“设置 → 账户”。",
      "开启 IMAP/POP3/SMTP 服务。",
      "进入客户端专用密码功能，完成身份验证后点击“生成客户端专用密码”并复制。",
      "返回系统，填写完整的 @189.cn 邮箱账号和客户端专用密码。"
    ],
    warning: "填写的是客户端专用密码，不是 189 邮箱登录密码。",
    image: "/tutorial/189-mail-client-password-guide.png",
    imageAlt: "189 邮箱开启邮件服务和生成客户端专用密码操作示意",
    imageCaption: "设置页面示意，具体入口以 189 邮箱官网当前页面为准。"
  }
};

function shopListDisplayName(shop: Shop, connection?: ShopifyConnectionStatus) {
  const configuredName = shop.displayName.trim();
  const configuredAddress = configuredName.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
  const shopifyDomain = selectedShopifyDomain(shop).toLowerCase();
  const shopifyHandle = shopifyDomain.replace(/\.myshopify\.com$/, "");
  const isDomainPlaceholder = Boolean(shopifyDomain) && (configuredAddress === shopifyDomain || configuredAddress === shopifyHandle);
  if (configuredName && !isDomainPlaceholder) return configuredName;
  return connection?.shopName?.trim() || "店铺名称待同步";
}

function emailSourceRuntimeState(source: ShopSource): "healthy" | "pending" | "error" {
  const provider = source.provider.trim().toLowerCase();
  const syncStatus = source.metadata?.email_sync_status;
  const healthStatus = source.metadata?.email_health_status;
  const notificationStatus = source.metadata?.email_notification_status;
  if (healthStatus === "error") return "error";
  if (syncStatus === "error") return "error";
  if (provider !== "cuiqiu" && notificationStatus === "error") return "error";
  if (healthStatus !== "ok") return "pending";
  if (provider !== "cuiqiu" && notificationStatus !== "ok") return "pending";
  return "healthy";
}

function recentEmailHighFrequencyIsolation(source: ShopSource) {
  const raw = source.metadata?.email_high_frequency_last_at;
  if (!raw) return false;
  const isolatedAt = new Date(raw);
  return !Number.isNaN(isolatedAt.getTime()) && Date.now() - isolatedAt.getTime() <= 24 * 60 * 60 * 1000;
}

function standardIMAPConnectionReason(code?: string) {
  switch (code) {
    case "imap_installation_missing": return "邮箱的本地授权信息缺失，需要重新接入";
    case "imap_authentication": return "邮箱服务器拒绝登录，请检查客户端授权码或专用密码";
    case "imap_configuration": return "邮箱接入配置不完整或与邮箱后缀不匹配";
    case "imap_tls": return "邮箱服务器的 TLS 安全连接校验失败";
    case "imap_dns": return "无法解析邮箱服务器地址";
    case "imap_connection_refused": return "邮箱服务器拒绝了 IMAP 连接";
    case "imap_connection_interrupted": return "IMAP 网络连接被中断";
    case "imap_timeout": return "连接邮箱服务器超时";
    default: return "邮箱服务器暂时无法连接";
  }
}

function standardMailServiceForSource(source: ShopSource): StandardMailService {
  const configured = source.metadata?.mail_service;
  if (configured === "netease" || configured === "qq" || configured === "139" || configured === "189") return configured;
  const mailbox = (source.address || source.metadata?.mailbox || "").toLowerCase();
  if (mailbox.endsWith("@qq.com") || mailbox.endsWith("@vip.qq.com")) return "qq";
  if (mailbox.endsWith("@139.com")) return "139";
  if (mailbox.endsWith("@189.cn")) return "189";
  return "netease";
}

function emailSourceRetryView(source: ShopSource): { label: string; detail: string; canReauthorize: boolean; canRecover?: boolean; canReconnectStandard?: boolean } | null {
  const retryState = source.metadata?.email_retry_state;
  const provider = source.provider.trim().toLowerCase();
  const canReauthorize = provider === "gmail" || provider === "outlook";
  if (source.metadata?.email_manual_paused_by === "system:flood") {
    const count = Number.parseInt(source.metadata?.email_flood_pause_count || "", 10);
    return { label: "邮件洪峰 · 已自动暂停", detail: `10 分钟内来信量超过安全阈值，系统已保存当前同步位置并暂停该邮箱，其他邮箱不受影响${Number.isFinite(count) && count > 0 ? `（检测到 ${count} 封）` : ""}。确认来信恢复正常后可手动恢复同步。`, canReauthorize: false };
  }
  if (source.metadata?.email_manual_paused_at) {
    return { label: "已手动暂停", detail: "系统保留当前同步位置，不再自动连接该邮箱；恢复后会从原位置继续。", canReauthorize: false };
  }
  if (retryState === "risk_blocked") {
    return { label: "账号风控 · 已停试", detail: "邮箱服务商已限制该账号，系统已停止自动重试。请先在邮箱服务商侧解除风控，再重新授权。", canReauthorize };
  }
  if (retryState === "manual_recovery_required") {
    return { label: "连接异常 · 已停试", detail: `${standardIMAPConnectionReason(source.metadata?.email_retry_error_code)}。系统已停止自动重连，请检查网络或邮箱服务后手动检测恢复。`, canReauthorize: false, canRecover: provider === "imap_smtp" };
  }
  if (retryState === "reauthorization_required") {
    return { label: "授权失效 · 已停试", detail: provider === "imap_smtp" ? `${standardIMAPConnectionReason(source.metadata?.email_retry_error_code)}。系统已停止自动重试，请更新客户端授权码或专用密码。` : "系统已停止自动重试。重新授权成功后，会从原同步位置继续接收。", canReauthorize, canReconnectStandard: provider === "imap_smtp" };
  }
  if (retryState === "retry_wait") {
    const parsed = source.metadata?.email_retry_next_at ? new Date(source.metadata.email_retry_next_at) : null;
    const retryAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) : "稍后";
    const count = Number.parseInt(source.metadata?.email_retry_failure_count || "", 10);
    return { label: provider === "imap_smtp" ? "连接异常 · 等待重试" : "等待自动重试", detail: `${provider === "imap_smtp" ? `${standardIMAPConnectionReason(source.metadata?.email_retry_error_code)}。` : "临时异常，"}系统将在 ${retryAt} 自动重试${Number.isFinite(count) && count > 0 ? `（连续失败 ${count} 次）` : ""}。`, canReauthorize: false };
  }
  const quarantined = Number.parseInt(source.metadata?.email_quarantine_pending_count || "", 10);
  if (Number.isFinite(quarantined) && quarantined > 0) {
    return { label: `异常邮件已隔离 ${quarantined}`, detail: `有 ${quarantined} 封格式或内容异常的邮件已单独隔离，后续正常邮件会继续接收。修复临时存储问题后可以单独重试。`, canReauthorize: false };
  }
  if (source.metadata?.email_sync_backlog_pending === "true") {
    return { label: "正在追平积压", detail: "系统正按批次接收积压邮件并逐步推进同步位置，不会反复从头读取。", canReauthorize: false };
  }
  if (recentEmailHighFrequencyIsolation(source)) {
    const count = Number.parseInt(source.metadata?.email_high_frequency_isolated_count || "", 10);
    const sender = source.metadata?.email_high_frequency_last_sender;
    return { label: "已隔离高频来信", detail: `检测到同一发件人和主题的异常高频邮件，已保留在系统记录并隔离出客服接线${sender ? `（${sender}）` : ""}${Number.isFinite(count) && count > 0 ? `，累计 ${count} 封` : ""}。`, canReauthorize: false };
  }
  return null;
}

function emailChannelStatusView(sources: ShopSource[]): { key: EmailChannelStatusKey; label: string; tone: "green" | "muted" | "warning" } {
  const connected = sources.filter((source) => isConnectedSource(source));
  if (!connected.length) return { key: "not_configured", label: "邮箱未配置", tone: "muted" };

  const pausedOrBlocked = connected.filter((source) => source.metadata?.email_manual_paused_at || ["risk_blocked", "reauthorization_required", "manual_recovery_required"].includes(source.metadata?.email_retry_state || ""));
  if (pausedOrBlocked.length) return { key: "error", label: `需处理 ${pausedOrBlocked.length}/${connected.length}`, tone: "warning" };
  const backlog = connected.filter((source) => source.metadata?.email_sync_backlog_pending === "true");
  if (backlog.length) return { key: "pending", label: `追平积压 ${backlog.length}/${connected.length}`, tone: "warning" };
  const isolated = connected.filter(recentEmailHighFrequencyIsolation);
  if (isolated.length) return { key: "partial_error", label: `高频隔离 ${isolated.length}/${connected.length}`, tone: "warning" };

  const states = connected.map((source) => emailSourceRuntimeState(source));
  const healthyCount = states.filter((state) => state === "healthy").length;
  if (healthyCount === connected.length) {
    return { key: "ready", label: connected.length === 1 ? "邮箱已接入" : `邮箱已接入 ${connected.length}`, tone: "green" };
  }
  if (states.every((state) => state === "pending")) {
    return { key: "pending", label: connected.length === 1 ? "推送检测中" : `推送检测中 ${connected.length}`, tone: "warning" };
  }
  if (!healthyCount) {
    return { key: "error", label: connected.length === 1 ? "邮箱异常" : `邮箱异常 ${connected.length}`, tone: "warning" };
  }
  return { key: "partial_error", label: `部分异常 ${healthyCount}/${connected.length}`, tone: "warning" };
}

function DrawerInlineNotice({ notice }: { notice: ToastMessage | null }) {
  if (!notice) return null;
  const icon = notice.tone === "error" ? <CircleAlert size={16} /> : notice.tone === "success" ? <CheckCircle2 size={16} /> : <CircleDot size={16} />;
  return (
    <div className={`drawer-inline-notice ${notice.tone}`} role="status" aria-live="polite">
      {icon}
      <span>{notice.text}</span>
    </div>
  );
}

export function ShopsPanel(props: {
  t: T;
  api: PlatformAPI;
  currentUser: User;
  integrationMode?: string;
  busy: boolean;
  shops: Shop[];
  users: User[];
  selectedShop: Shop | null;
  sources: ShopSource[];
  shopAgents: User[];
  sourcesByShopId: Record<string, ShopSource[]>;
  agentsByShopId: Record<string, User[]>;
  resetToken: number;
  onOpenVisitorSchemes: () => void;
  onSelectShop: (id: string) => void;
  onAgentAssignmentChanged: (shopId: string, user: User, assigned: boolean) => void;
  onAgentAssignmentsChanged: (shopId: string) => Promise<void>;
  onSourcesChanged: (sources: ShopSource[]) => void;
  onChanged: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setToast: (value: ToastMessage) => void;
}) {
  const erpManaged = props.integrationMode?.startsWith("ERP_") === true;
  const canManageChannels = hasPermission(props.currentUser, PERMISSIONS.shopChannelsManage);
  const canAssignShops = hasPermission(props.currentUser, PERMISSIONS.shopsAssign);
  const canCreateShops = hasPermission(props.currentUser, PERMISSIONS.shopsCreate);
  const canDeleteShops = hasPermission(props.currentUser, PERMISSIONS.shopsDelete);
  const canExportShops = hasPermission(props.currentUser, PERMISSIONS.shopsExport);
  const [businessAccountVisible, setBusinessAccountVisible] = useState(false);
  const [businessAccountName, setBusinessAccountName] = useState("");
  const [businessAccountNotice, setBusinessAccountNotice] = useState<ToastMessage | null>(null);
  const [configShopId, setConfigShopId] = useState("");
  const [shopifyDrawerNotice, setShopifyDrawerNotice] = useState<ToastMessage | null>(null);
  const [outlookAuthUrl, setOutlookAuthUrl] = useState("");
  const [gmailAuthUrl, setGmailAuthUrl] = useState("");
  const [emailConnectProvider, setEmailConnectProvider] = useState<"outlook" | "gmail" | "cuiqiu" | "standard" | null>(null);
  const [emailReconnectSourceID, setEmailReconnectSourceID] = useState("");
  const [standardMailService, setStandardMailService] = useState<StandardMailService>("netease");
  const [emailConnectNotice, setEmailConnectNotice] = useState<ToastMessage | null>(null);
  const [standardMailTutorial, setStandardMailTutorial] = useState<StandardMailTutorialService | null>(null);
  const [cuiqiuForm, setCuiqiuForm] = useState<CuiqiuConnectInput>({
    mailbox: "",
    smtpPassword: ""
  });
  const [standardMailForm, setStandardMailForm] = useState<StandardMailConnectInput>({
    mailbox: "",
    credential: ""
  });
  const [outlookStatus, setOutlookStatus] = useState<MailConfigStatus | null>(null);
  const [gmailStatus, setGmailStatus] = useState<MailConfigStatus | null>(null);
  const [outlookStatusError, setOutlookStatusError] = useState("");
  const [gmailStatusError, setGmailStatusError] = useState("");
  const [selectedAgentIDs, setSelectedAgentIDs] = useState<string[]>([]);
  const [configMenu, setConfigMenu] = useState<ShopConfigMenuKey>("info");
  const [shopInfoName, setShopInfoName] = useState("");
  const [shopInfoNote, setShopInfoNote] = useState("");
  const [shopAIRules, setShopAIRules] = useState("");
  const [shopSearch, setShopSearch] = useState("");
  const [shopifyAppFilter, setShopifyAppFilter] = useState("all");
  const [emailStatusFilter, setEmailStatusFilter] = useState("all");
  const [agentAssignmentFilter, setAgentAssignmentFilter] = useState("all");
  const [shopPage, setShopPage] = useState(1);
  const [shopPageSize, setShopPageSize] = useState(50);
  const [exportingShops, setExportingShops] = useState(false);
  const [quickAgentMenu, setQuickAgentMenu] = useState<{ shopID: string; top: number; left: number } | null>(null);
  const [quickAgentBusyKeys, setQuickAgentBusyKeys] = useState<Set<string>>(() => new Set());
  const [agentAssignmentsSaving, setAgentAssignmentsSaving] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState<Shop | null>(null);
  const [emailDisconnectCandidate, setEmailDisconnectCandidate] = useState<ShopSource | null>(null);
  const [emailDisconnectError, setEmailDisconnectError] = useState("");
  const [emailHistoryImports, setEmailHistoryImports] = useState<Record<string, EmailHistoryImportJob>>({});
  const [emailHistoryBusySourceIDs, setEmailHistoryBusySourceIDs] = useState<Set<string>>(() => new Set());
  const businessAccountInputRef = useRef<HTMLInputElement | null>(null);
  const deleteCancelRef = useRef<HTMLButtonElement | null>(null);
  const emailDisconnectCancelRef = useRef<HTMLButtonElement | null>(null);
  const [shopifyConnections, setShopifyConnections] = useState<Record<string, ShopifyConnectionStatus>>({});
  const [shopifyConnectionCheckingIDs, setShopifyConnectionCheckingIDs] = useState<Set<string>>(() => new Set());
  const { t } = props;
  const configShop = props.shops.find((shop) => shop.id === configShopId) || null;
  const configSources = configShop ? (props.selectedShop?.id === configShop.id ? props.sources : props.sourcesByShopId[configShop.id] || []) : [];
  const configAgents = configShop ? (props.selectedShop?.id === configShop.id ? props.shopAgents : props.agentsByShopId[configShop.id] || []) : [];
  const chatSource = configSources.find((source) => source.type === "shopify_chat");
  const shopifyAPIRecord = configSources.find((source) => source.type === "shopify_api");
  const shopifyConnection = configShop
    ? shopifyConnections[configShop.id] || storedShopifyConnectionStatus(shopifyAPIRecord)
    : undefined;
  const shopifyAPIStatus = shopifyAPIStatusView(shopifyAPIRecord, shopifyConnection);
  const shopifyPluginStatus = shopifyPluginRuntimeStatusView(chatSource);
  const emailSources = configSources.filter((source) => source.type === "email" && !source.metadata?.email_disconnected_at);
  const connectedEmailSources = emailSources.filter((source) => isConnectedSource(source));
  const emailReconnectSource = emailSources.find((source) => source.id === emailReconnectSourceID) || null;
  const assignableAgents = props.users.filter((user) => user.status === "active" || configAgents.some((agent) => agent.id === user.id));
  const shopifyDomain = configShop ? selectedShopifyDomain(configShop) : "";
  const erpPluginSettingsUrl = shopifyDomain ? shopifyAppEmbedUrl(shopifyDomain) : "";
  const configAgentIDs = configAgents.map((agent) => agent.id).sort().join(",");

  const visibleShops = useMemo(() => {
    const keyword = shopSearch.trim().toLowerCase();
    return props.shops.filter((shop) => {
      const rowSources = props.sourcesByShopId[shop.id] || (shop.id === props.selectedShop?.id ? props.sources : []);
      const rowAgents = props.agentsByShopId[shop.id] || (shop.id === props.selectedShop?.id ? props.shopAgents : []);
      const rowShopifySource = rowSources.find((source) => source.type === "shopify_api");
      const rowChatSource = rowSources.find((source) => source.type === "shopify_chat");
      const rowEmailSources = rowSources.filter((source) => source.type === "email");
      const connection = shopifyConnections[shop.id] || storedShopifyConnectionStatus(rowShopifySource);
      const searchable = [
        shop.displayName,
        connection?.shopName || "",
        selectedShopifyDomain(shop),
        shop.externalId || "",
        shop.metadata?.internalNote || "",
        ...rowEmailSources.map((source) => source.address || source.metadata?.mailbox || ""),
        ...rowAgents.map(userDisplayName)
      ].join(" ").toLowerCase();
      const appMatches = shopifyAppFilter === "all" || shopifyConnectionSummaryView(rowShopifySource, connection, rowChatSource).key === shopifyAppFilter;
      const emailMatches = emailStatusFilter === "all" || emailChannelStatusView(rowEmailSources).key === emailStatusFilter;
      const agentMatches = agentAssignmentFilter === "all" || (rowAgents.length ? "assigned" : "unassigned") === agentAssignmentFilter;
      return (!keyword || searchable.includes(keyword)) && appMatches && emailMatches && agentMatches;
    });
  }, [agentAssignmentFilter, emailStatusFilter, props.agentsByShopId, props.selectedShop?.id, props.shopAgents, props.shops, props.sources, props.sourcesByShopId, shopifyAppFilter, shopifyConnections, shopSearch]);
  const shopPageCount = Math.max(1, Math.ceil(visibleShops.length / shopPageSize));
  const pagedShops = useMemo(() => {
    const start = (shopPage - 1) * shopPageSize;
    return visibleShops.slice(start, start + shopPageSize);
  }, [shopPage, shopPageSize, visibleShops]);

  useEffect(() => {
    setShopPage(1);
  }, [agentAssignmentFilter, emailStatusFilter, shopSearch, shopifyAppFilter]);

  useEffect(() => {
    setShopPage((current) => Math.min(current, shopPageCount));
  }, [shopPageCount]);

  useEffect(() => {
    setConfigShopId("");
    setConfigMenu("info");
    setBusinessAccountVisible(false);
    setEmailDisconnectCandidate(null);
    setEmailDisconnectError("");
    setEmailHistoryImports({});
    setEmailHistoryBusySourceIDs(new Set());
  }, [props.resetToken]);

  useEffect(() => {
    if (businessAccountVisible) businessAccountInputRef.current?.focus();
  }, [businessAccountVisible]);

  useEffect(() => {
    setShopifyDrawerNotice(null);
    setOutlookAuthUrl("");
    setGmailAuthUrl("");
    setEmailConnectProvider(null);
    setEmailReconnectSourceID("");
    setEmailConnectNotice(null);
    setStandardMailTutorial(null);
    setOutlookStatus(null);
    setGmailStatus(null);
    setOutlookStatusError("");
    setGmailStatusError("");
    setSelectedAgentIDs(configAgents.map((agent) => agent.id));
  }, [configShopId, configAgentIDs]);

  useEffect(() => {
    if (!emailConnectProvider) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || props.busy) return;
      if (standardMailTutorial) {
        setStandardMailTutorial(null);
        return;
      }
      setEmailConnectProvider(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [emailConnectProvider, standardMailTutorial, props.busy]);

  useEffect(() => {
    if (!configShopId || configMenu !== "email" || !canManageChannels) return;
    let cancelled = false;
    const load = async () => {
      try {
        const jobs = await props.api.listEmailHistoryImports(configShopId);
        if (!cancelled) setEmailHistoryImports(Object.fromEntries(jobs.map((job) => [job.sourceId, job])));
      } catch (error) {
        if (!cancelled) setShopifyDrawerNotice({ tone: "error", text: `读取历史邮件任务失败：${errorText(error)}` });
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [canManageChannels, configMenu, configShopId, props.api]);

  useEffect(() => subscribePlatformEvents((event) => {
    if (event.type !== "email_history_import.updated") return;
    const job = event.payload as EmailHistoryImportJob | undefined;
    if (!job?.sourceId || (configShopId && job.shopId !== configShopId)) return;
    setEmailHistoryImports((current) => ({ ...current, [job.sourceId]: job }));
  }), [configShopId]);

  useEffect(() => {
    setShopInfoName(configShop?.displayName || "");
    setShopInfoNote(configShop?.metadata?.internalNote || "");
    setShopAIRules(configShop?.metadata?.aiReplyRules || "");
  }, [configShop?.id, configShop?.displayName, configShop?.metadata?.internalNote, configShop?.metadata?.aiReplyRules]);

  useEffect(() => {
    setShopifyDrawerNotice(null);
  }, [configMenu]);

  useEffect(() => {
    if (!deleteCandidate) return;
    deleteCancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.busy) setDeleteCandidate(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteCandidate, props.busy]);

  useEffect(() => {
    if (!emailDisconnectCandidate) return;
    emailDisconnectCancelRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !props.busy) setEmailDisconnectCandidate(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [emailDisconnectCandidate, props.busy]);

  useEffect(() => {
    if (!configShopId) return;
    let cancelled = false;
    props.api.outlookConfigStatus()
      .then((status) => {
        if (!cancelled) setOutlookStatus(status);
      })
      .catch((error) => {
        if (!cancelled) setOutlookStatusError(`读取 Outlook 配置状态失败：${errorText(error)}`);
      });
    props.api.gmailConfigStatus()
      .then((status) => {
        if (!cancelled) setGmailStatus(status);
      })
      .catch((error) => {
        if (!cancelled) setGmailStatusError(`读取 Gmail 配置状态失败：${errorText(error)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [configShopId, props.api]);

  function openShopConfig(shopId: string, menu: ShopConfigMenuKey = "info") {
    setConfigShopId(shopId);
    setConfigMenu(menu);
    props.onSelectShop(shopId);
  }

  async function exportAllShops() {
    setExportingShops(true);
    try {
      const file = await props.api.exportShops();
      const downloadURL = URL.createObjectURL(file.blob);
      const anchor = document.createElement("a");
      anchor.href = downloadURL;
      anchor.download = file.filename;
      anchor.click();
      URL.revokeObjectURL(downloadURL);
      props.setToast({ tone: "success", text: `已导出权限范围内全部 ${props.shops.length} 个账号的详细信息` });
    } catch (error) {
      props.setToast({ tone: "error", text: `导出店铺详细信息失败：${errorText(error)}` });
    } finally {
      setExportingShops(false);
    }
  }

  async function checkShopAccess(shop: Shop) {
    setShopifyConnectionCheckingIDs((current) => new Set(current).add(shop.id));
    try {
      const result = await props.api.checkShopChannels(shop.id);
      if (result.shopify) setShopifyConnections((current) => ({ ...current, [shop.id]: result.shopify! }));
      props.onSourcesChanged(result.sources);
      props.setToast({
        tone: result.healthy ? "success" : "error",
        text: channelCheckSummary(result)
      });
    } catch (error) {
      props.setToast({ tone: "error", text: `接入检测失败：${errorText(error)}` });
    } finally {
      setShopifyConnectionCheckingIDs((current) => {
        const next = new Set(current);
        next.delete(shop.id);
        return next;
      });
    }
  }

  function openBusinessAccountDialog() {
    setBusinessAccountName("");
    setBusinessAccountNotice(null);
    setBusinessAccountVisible(true);
  }

  async function createBusinessAccount(firstChannel: "email" | "info") {
    const displayName = businessAccountName.trim();
    if (!displayName) {
      setBusinessAccountNotice({ tone: "error", text: "请填写店铺名称" });
      businessAccountInputRef.current?.focus();
      return;
    }
    const existingAccount = props.shops.find((shop) => shop.displayName.trim().toLocaleLowerCase() === displayName.toLocaleLowerCase());
    if (existingAccount) {
      setBusinessAccountNotice({ tone: "error", text: `店铺名称“${existingAccount.displayName}”已存在，请直接打开原店铺配置。` });
      businessAccountInputRef.current?.focus();
      return;
    }
    props.setBusy(true);
    setBusinessAccountNotice({ tone: "info", text: "正在创建店铺…" });
    let created: Shop;
    try {
      created = await props.api.createShop({ displayName, platform: "business" });
    } catch (error) {
      setBusinessAccountNotice({ tone: "error", text: `创建店铺失败：${errorText(error)}` });
      props.setBusy(false);
      return;
    }
    try {
      await props.onChanged();
      setBusinessAccountVisible(false);
      setBusinessAccountName("");
      setBusinessAccountNotice(null);
      props.setToast({ tone: "success", text: `${displayName} 已创建，可以接入邮箱并分配客服` });
      setConfigShopId(created.id);
      setConfigMenu(firstChannel);
      props.onSelectShop(created.id);
    } catch (error) {
      setBusinessAccountVisible(false);
      props.setToast({ tone: "error", text: `${displayName} 已创建，但列表刷新失败：${errorText(error)}。请刷新页面后继续接入渠道。` });
    } finally {
      props.setBusy(false);
    }
  }

  function channelCheckSummary(result: ShopChannelCheckResult) {
    if (!result.hasChannels) return "检测完成：当前店铺尚未配置可检测渠道。";
    const parts: string[] = [];
    if (result.shopify) {
      const pluginStatus = shopifyPluginRuntimeStatusView(result.sources.find((source) => source.type === "shopify_chat"));
      parts.push(result.shopify.state === "installed"
        ? `Shopify 授权正常、${pluginStatus.label}`
        : `Shopify 异常：${result.shopify.message || "授权不可用"}`);
    } else if (result.shopifyError) {
      parts.push(`Shopify 检测失败：${result.shopifyError}`);
    }
    if (result.email.length) {
      const total = result.email.reduce((sum, item) => sum + item.sourcesChecked, 0);
      const succeeded = result.email.reduce((sum, item) => sum + item.sourcesHealthy, 0);
      const failedProviders = result.email
        .filter((item) => item.error || item.sourcesFailed > 0)
        .map((item) => item.provider === "gmail" ? "Gmail" : item.provider === "cuiqiu" ? "脆球邮箱" : item.provider === "imap_smtp" ? "其他邮箱" : "Outlook");
      parts.push(total > 0 && succeeded === total && failedProviders.length === 0
        ? `邮箱 ${succeeded}/${total} 正常`
        : `邮箱 ${succeeded}/${total} 正常${failedProviders.length ? `，${failedProviders.join("、")} 异常` : ""}`);
    }
    return `检测完成：${parts.join("；")}。`;
  }

  function emailProviderLabel(source: ShopSource) {
    if (source.provider === "gmail") return "Gmail API";
    if (source.provider === "outlook") return "Outlook / Microsoft Graph";
    if (source.provider === "cuiqiu") return "Cuiqiu API / SMTP";
    return source.provider || "邮箱 API";
  }

  function emailAuthLabel(source: ShopSource) {
    if (source.metadata?.auth === "gmail_api") return "Gmail API";
    if (source.metadata?.auth === "microsoft_graph") return "Microsoft Graph API";
    if (source.metadata?.auth === "cuiqiu_api_smtp") return "Cuiqiu API + SMTP";
    return source.metadata?.auth || emailProviderLabel(source);
  }

  async function copyShopifyEmbedAddressInDrawer() {
    if (!erpPluginSettingsUrl) {
      setShopifyDrawerNotice({ tone: "error", text: "ERP 尚未同步该店铺的 Shopify 域名，暂时无法生成插件启用链接。" });
      return;
    }
    try {
      await navigator.clipboard.writeText(erpPluginSettingsUrl);
      setShopifyDrawerNotice({ tone: "success", text: "聊天插件启用链接已复制。请在该店铺已登录的浏览器中新开标签页并手动粘贴打开；系统不会自动跳转。" });
    } catch (error) {
      setShopifyDrawerNotice({ tone: "error", text: `复制聊天插件启用链接失败：${errorText(error)}` });
    }
  }

  async function saveAgentAssignments() {
    if (!configShop) return;
    const currentIDs = new Set(configAgents.map((agent) => agent.id));
    const nextIDs = new Set(selectedAgentIDs);
    const addedAgents = props.users.filter((user) => nextIDs.has(user.id) && !currentIDs.has(user.id));
    const removedAgents = configAgents.filter((agent) => !nextIDs.has(agent.id));
    setAgentAssignmentsSaving(true);
    try {
      await Promise.all([
        ...addedAgents.map((user) => props.api.assignAgent(configShop.id, user.id)),
        ...removedAgents.map((agent) => props.api.unassignAgent(configShop.id, agent.id))
      ]);
      addedAgents.forEach((user) => props.onAgentAssignmentChanged(configShop.id, user, true));
      removedAgents.forEach((user) => props.onAgentAssignmentChanged(configShop.id, user, false));
    } catch (error) {
      props.setToast({ tone: "error", text: `分配客服失败：${errorText(error)}` });
      await props.onAgentAssignmentsChanged(configShop.id);
    } finally {
      setAgentAssignmentsSaving(false);
    }
  }

  async function toggleQuickAgent(shop: Shop, user: User, assigned: boolean) {
    const busyKey = `${shop.id}:${user.id}`;
    const nextAssigned = !assigned;
    setQuickAgentBusyKeys((current) => new Set(current).add(busyKey));
    props.onAgentAssignmentChanged(shop.id, user, nextAssigned);
    try {
      if (assigned) await props.api.unassignAgent(shop.id, user.id);
      else await props.api.assignAgent(shop.id, user.id);
    } catch (error) {
      props.onAgentAssignmentChanged(shop.id, user, assigned);
      props.setToast({ tone: "error", text: `更新客服分配失败：${errorText(error)}` });
    } finally {
      setQuickAgentBusyKeys((current) => {
        const next = new Set(current);
        next.delete(busyKey);
        return next;
      });
    }
  }

  async function saveShopInfo(event: FormEvent) {
    event.preventDefault();
    if (!configShop) return;
    const displayName = shopInfoName.trim();
    if (!displayName) {
      props.setToast({ tone: "error", text: "请填写账号名称" });
      return;
    }
    props.setBusy(true);
    try {
      const metadata = { ...(configShop.metadata || {}) };
      delete metadata.account_owner_type;
      delete metadata.account_department;
      await props.api.updateShop(configShop.id, {
        displayName,
        metadata: {
          ...metadata,
          internalNote: shopInfoNote.trim(),
          aiReplyRules: shopAIRules.trim()
        }
      });
      await props.api.saveShopAIReplyRules(configShop.id, shopAIRules);
      props.setToast({ tone: "success", text: "账号信息已保存" });
      await props.onChanged();
    } catch (error) {
      props.setToast({ tone: "error", text: `保存账号信息失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  function requestDeleteShop(shop: Shop, shopifySource?: ShopSource, emailSources: ShopSource[] = [], shopifyConnection?: ShopifyConnectionStatus) {
    const connectedChannels = connectedShopChannelLabels(shopifySource, emailSources, shopifyConnection);
    if (connectedChannels.length > 0) {
      window.alert(`请先解绑${connectedChannels.join("和")}后再删除店铺。`);
      return;
    }
    setDeleteCandidate(shop);
  }

  async function confirmDeleteShop() {
    if (!deleteCandidate) return;
    const shop = deleteCandidate;
    props.setBusy(true);
    try {
      await props.api.deleteShop(shop.id);
    } catch (error) {
      props.setToast({ tone: "error", text: `删除店铺失败：${errorText(error)}` });
      props.setBusy(false);
      return;
    }
    if (props.selectedShop?.id === shop.id) props.onSelectShop("");
    setDeleteCandidate(null);
    try {
      await props.onChanged();
      props.setToast({ tone: "success", text: "店铺已删除" });
    } catch (error) {
      props.setToast({ tone: "error", text: `店铺已删除，但刷新店铺列表失败：${errorText(error)}。请刷新页面。` });
    } finally {
      props.setBusy(false);
    }
  }

  function emailHistoryStatusText(job?: EmailHistoryImportJob) {
    if (!job) return "读取邮箱内全部历史邮件；不会改变邮箱文件夹或已读状态";
    const progress = `已扫描 ${job.messagesScanned}，新导入 ${job.messagesImported}，跳过 ${job.messagesSkipped}`;
    if (job.status === "queued") return `等待读取 · ${progress}`;
    if (job.status === "running") return `正在读取 · ${progress}`;
    if (job.status === "paused") return `已暂停 · ${progress}`;
    if (job.status === "completed") return `读取完成 · ${progress}`;
    if (job.status === "failed") return `读取失败 · ${job.lastError || "请重试"}`;
    if (job.status === "cancelled") return `已取消 · ${progress}`;
    return progress;
  }

  async function updateEmailHistoryImport(source: ShopSource, action: "start" | "pause" | "resume" | "retry" | "cancel") {
    if (!configShop) return;
    setEmailHistoryBusySourceIDs((current) => new Set(current).add(source.id));
    try {
      const job = await props.api.updateEmailHistoryImport(configShop.id, source.id, action);
      setEmailHistoryImports((current) => ({ ...current, [source.id]: job }));
      setShopifyDrawerNotice({
        tone: action === "start" || action === "resume" || action === "retry" ? "success" : "info",
        text: action === "start" ? "已开始读取该邮箱的全部历史邮件，可关闭页面，任务会在后台继续" : action === "pause" ? "历史邮件读取已暂停" : action === "cancel" ? "历史邮件读取已取消" : "历史邮件读取已继续"
      });
    } catch (error) {
      setShopifyDrawerNotice({ tone: "error", text: `历史邮件任务操作失败：${errorText(error)}` });
    } finally {
      setEmailHistoryBusySourceIDs((current) => {
        const next = new Set(current);
        next.delete(source.id);
        return next;
      });
    }
  }

  async function setEmailSourceSyncPaused(source: ShopSource, paused: boolean) {
    if (!configShop) return;
    props.setBusy(true);
    try {
      const updated = await props.api.setEmailSourceSyncPaused(configShop.id, source.id, paused);
      props.onSourcesChanged([updated]);
      const text = paused
        ? `${source.address || "该邮箱"} 已暂停自动同步；同步位置和已有邮件均已保留`
        : `${source.address || "该邮箱"} 已恢复自动同步，将从原同步位置继续`;
      setShopifyDrawerNotice({ tone: paused ? "info" : "success", text });
      props.setToast({ tone: paused ? "info" : "success", text });
    } catch (error) {
      props.setToast({ tone: "error", text: `${paused ? "暂停" : "恢复"}邮箱同步失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function recoverStandardIMAPSource(source: ShopSource) {
    if (!configShop) return;
    props.setBusy(true);
    setShopifyDrawerNotice({ tone: "info", text: `正在检测 ${source.address || "该邮箱"} 的 IMAP 连接…` });
    try {
      const updated = await props.api.recoverStandardIMAPSource(configShop.id, source.id);
      props.onSourcesChanged([updated]);
      const text = `${source.address || "该邮箱"} 连接已恢复，将从原同步位置继续收信`;
      setShopifyDrawerNotice({ tone: "success", text });
      props.setToast({ tone: "success", text });
    } catch (error) {
      const text = `连接检测未通过：${errorText(error)}`;
      setShopifyDrawerNotice({ tone: "error", text });
      props.setToast({ tone: "error", text });
      await props.onChanged();
    } finally {
      props.setBusy(false);
    }
  }

  async function retryEmailQuarantine(source: ShopSource) {
    if (!configShop) return;
    props.setBusy(true);
    try {
      const result = await props.api.retryEmailQuarantine(configShop.id, source.id);
      await props.onChanged();
      const text = result.remaining > 0
        ? `已恢复 ${result.resolved} 封异常邮件，仍有 ${result.remaining} 封需要处理`
        : `异常邮件重试完成，已恢复 ${result.resolved} 封`;
      setShopifyDrawerNotice({ tone: result.remaining > 0 ? "info" : "success", text });
      props.setToast({ tone: result.remaining > 0 ? "info" : "success", text });
    } catch (error) {
      props.setToast({ tone: "error", text: `重试异常邮件失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  async function confirmDisconnectEmail() {
    if (!configShop || !emailDisconnectCandidate) return;
    const source = emailDisconnectCandidate;
    const mailbox = source.address || source.metadata?.mailbox || "该邮箱";
    setEmailDisconnectError("");
    props.setBusy(true);
    try {
      const result = await props.api.disconnectEmailSource(configShop.id, source.id);
      props.onSourcesChanged([result.source]);
      setEmailDisconnectCandidate(null);
      setEmailDisconnectError("");
      const text = result.providerNotificationStopped
        ? `${mailbox} 已从 Xzdesk 解绑，历史邮件和会话已保留`
        : `${mailbox} 已从 Xzdesk 解绑；请确认已在邮箱端撤销 Xzdesk 授权`;
      setShopifyDrawerNotice({ tone: "success", text });
      props.setToast({ tone: "success", text });
    } catch (error) {
      const text = `解绑邮箱失败：${errorText(error)}。请重试；如仍失败，请刷新页面后检查邮箱状态。`;
      setEmailDisconnectError(text);
      props.setToast({ tone: "error", text });
    } finally {
      props.setBusy(false);
    }
  }

  async function createOutlookAuthAddressInDrawer() {
    if (!configShop) return;
    if (outlookStatus && !outlookStatus.configured) {
      setOutlookStatusError(`服务端还没有配置 Microsoft 应用：${(outlookStatus.missing || []).join("、")}`);
      setEmailConnectNotice({ tone: "error", text: `服务端还没有配置 Microsoft 应用：${(outlookStatus.missing || []).join("、")}` });
      return;
    }
    props.setBusy(true);
    try {
      const result = await props.api.createOutlookAuthURL(configShop.id);
      setOutlookAuthUrl(result.authUrl);
      setOutlookStatusError("");
      try {
        await navigator.clipboard.writeText(result.authUrl);
        setEmailConnectNotice({ tone: "success", text: "授权地址已复制，请由负责人在确认的对应账号环境中手动打开。" });
      } catch (copyError) {
        setEmailConnectNotice({ tone: "error", text: `授权地址已生成，但自动复制失败：${errorText(copyError)}` });
      }
    } catch (error) {
      const message = errorText(error);
      setOutlookStatusError(
        message.includes("OUTLOOK_CLIENT_ID") || message.includes("OUTLOOK_CLIENT_SECRET")
          ? "服务端还没有配置 Microsoft 应用 Client ID 和 Secret。请先在服务端填入 Outlook 应用参数。"
          : `生成 Outlook 授权地址失败：${message}`
      );
      setEmailConnectNotice({ tone: "error", text: message });
    } finally {
      props.setBusy(false);
    }
  }

  async function createGmailAuthAddressInDrawer() {
    if (!configShop) return;
    if (gmailStatus && !gmailStatus.configured) {
      setGmailStatusError(`服务端还没有配置 Google 应用：${(gmailStatus.missing || []).join("、")}`);
      setEmailConnectNotice({ tone: "error", text: `服务端还没有配置 Google 应用：${(gmailStatus.missing || []).join("、")}` });
      return;
    }
    props.setBusy(true);
    try {
      const result = await props.api.createGmailAuthURL(configShop.id);
      setGmailAuthUrl(result.authUrl);
      setGmailStatusError("");
      try {
        await navigator.clipboard.writeText(result.authUrl);
        setEmailConnectNotice({ tone: "success", text: "授权地址已复制，请由负责人在确认的对应账号环境中手动打开。" });
      } catch (copyError) {
        setEmailConnectNotice({ tone: "error", text: `授权地址已生成，但自动复制失败：${errorText(copyError)}` });
      }
    } catch (error) {
      const message = errorText(error);
      setGmailStatusError(
        message.includes("GMAIL_CLIENT_ID") || message.includes("GMAIL_CLIENT_SECRET")
          ? "服务端还没有配置 Google 应用 Client ID 和 Secret。请先在服务端填入 Gmail 应用参数。"
          : `生成 Gmail 授权地址失败：${message}`
      );
      setEmailConnectNotice({ tone: "error", text: message });
    } finally {
      props.setBusy(false);
    }
  }

  async function copyOutlookAuthAddressInDrawer() {
    if (!outlookAuthUrl) return;
    try {
      await navigator.clipboard.writeText(outlookAuthUrl);
      setEmailConnectNotice({ tone: "success", text: "Outlook 授权地址已复制，请由负责人在确认的对应账号环境中手动打开。" });
    } catch (error) {
      setEmailConnectNotice({ tone: "error", text: `复制 Outlook 授权地址失败：${errorText(error)}` });
    }
  }

  async function copyGmailAuthAddressInDrawer() {
    if (!gmailAuthUrl) return;
    try {
      await navigator.clipboard.writeText(gmailAuthUrl);
      setEmailConnectNotice({ tone: "success", text: "Gmail 授权地址已复制，请由负责人在确认的对应账号环境中手动打开。" });
    } catch (error) {
      setEmailConnectNotice({ tone: "error", text: `复制 Gmail 授权地址失败：${errorText(error)}` });
    }
  }

  function openEmailConnectModal(provider: "outlook" | "gmail" | "cuiqiu") {
    setEmailReconnectSourceID("");
    setEmailConnectProvider(provider);
    setEmailConnectNotice(null);
    setStandardMailTutorial(null);
    if (provider === "cuiqiu") {
      setCuiqiuForm((current) => ({ ...current, smtpPassword: "" }));
    }
  }

  function openEmailReauthorization(source: ShopSource) {
    const provider = source.provider.trim().toLowerCase();
    if (provider !== "gmail" && provider !== "outlook") return;
    setEmailReconnectSourceID(source.id);
    setEmailConnectProvider(provider);
    setEmailConnectNotice({ tone: "info", text: `请确认授权的是 ${source.address || source.metadata?.mailbox || "当前邮箱"}。授权成功后，系统会自动解除停试并从原同步位置继续。` });
    setStandardMailTutorial(null);
  }

  function openStandardMailConnectModal(service: StandardMailService) {
    setEmailReconnectSourceID("");
    setStandardMailService(service);
    setEmailConnectProvider("standard");
    setEmailConnectNotice(null);
    setStandardMailTutorial(null);
    setStandardMailForm({ mailbox: "", credential: "" });
  }

  function openStandardMailReconnect(source: ShopSource) {
    setStandardMailService(standardMailServiceForSource(source));
    setEmailReconnectSourceID(source.id);
    setEmailConnectProvider("standard");
    setEmailConnectNotice({ tone: "info", text: `请为 ${source.address || source.metadata?.mailbox || "当前邮箱"} 填写新的客户端授权码或专用密码。验证成功后会从原同步位置继续。` });
    setStandardMailTutorial(null);
    setStandardMailForm({ mailbox: source.address || source.metadata?.mailbox || "", credential: "" });
  }

  function updateCuiqiuForm<K extends keyof CuiqiuConnectInput>(key: K, value: CuiqiuConnectInput[K]) {
    setCuiqiuForm((current) => ({ ...current, [key]: value }));
    setEmailConnectNotice(null);
  }

  function updateStandardMailForm<K extends keyof StandardMailConnectInput>(key: K, value: StandardMailConnectInput[K]) {
    setStandardMailForm((current) => ({ ...current, [key]: value }));
    setEmailConnectNotice(null);
  }

  async function connectCuiqiuEmail(event: FormEvent) {
    event.preventDefault();
    if (!configShop) return;
    props.setBusy(true);
    setEmailConnectNotice({ tone: "info", text: "正在匹配域名配置并验证邮箱收发能力…" });
    try {
      const result = await props.api.connectCuiqiuEmail(configShop.id, {
        mailbox: cuiqiuForm.mailbox.trim(),
        smtpPassword: cuiqiuForm.smtpPassword
      });
      setCuiqiuForm((current) => ({ ...current, smtpPassword: "" }));
      props.onSourcesChanged([result.source]);
      setEmailConnectNotice({ tone: "success", text: "脆球邮箱已接入，收信和回复能力均已验证。" });
      await props.onChanged();
    } catch (error) {
      setEmailConnectNotice({ tone: "error", text: errorText(error) });
    } finally {
      props.setBusy(false);
    }
  }

  async function connectStandardMail(event: FormEvent) {
    event.preventDefault();
    if (!configShop) return;
    const serviceView = STANDARD_MAIL_SERVICE_VIEW[standardMailService];
    props.setBusy(true);
    setEmailConnectNotice({ tone: "info", text: `正在验证${serviceView.title}…` });
    try {
      const result = await props.api.connectStandardEmail(configShop.id, {
        mailbox: standardMailForm.mailbox.trim(),
        credential: standardMailForm.credential
      });
      setStandardMailForm((current) => ({ ...current, credential: "" }));
      props.onSourcesChanged([result.source]);
      setEmailConnectNotice({ tone: "success", text: `${serviceView.title}已接入，收信和回复均已验证。` });
      await props.onChanged();
    } catch (error) {
      setEmailConnectNotice({ tone: "error", text: errorText(error) });
    } finally {
      props.setBusy(false);
    }
  }

  return (
    <section className="shop-list-page">
      <Panel title={t.shop} icon={<Store size={18} />} className="shop-list-panel">
        <div className="install-entry-panel">
          <div>
            <strong>{erpManaged ? "客服渠道接入" : "客服业务账号"}</strong>
            <span>{erpManaged
              ? "店铺与 Shopify 授权统一来自 Xinzhi ERP；这里仅配置聊天插件、客服邮箱和接待人员。"
              : "这里可以创建客服业务账号、接入邮箱并分配接待人员；Shopify 店铺与授权统一由 Xinzhi ERP 建立。"}</span>
          </div>
          {canCreateShops && !erpManaged ? <button type="button" className="primary" onClick={openBusinessAccountDialog}><Plus size={16} /> 新增店铺</button> : null}
        </div>
        <div className="shop-list-filters">
          <input
            value={shopSearch}
            onChange={(event) => setShopSearch(event.target.value)}
            placeholder="搜索店铺名称、域名、备注或客服名称"
            aria-label="搜索店铺名称、域名、备注或客服名称"
          />
          <select value={shopifyAppFilter} onChange={(event) => setShopifyAppFilter(event.target.value)} aria-label="筛选应用状态">
            <option value="all">全部接入状态</option>
            <option value="ready">接入正常</option>
            <option value="plugin_required">待绑定插件</option>
            <option value="embed_required">待启用插件</option>
            <option value="authorization_required">待授权</option>
            <option value="unchecked">待检测</option>
            <option value="error">异常</option>
            <option value="not_configured">未配置</option>
          </select>
          <select value={emailStatusFilter} onChange={(event) => setEmailStatusFilter(event.target.value)} aria-label="筛选邮箱状态">
            <option value="all">全部邮箱</option>
            <option value="ready">接入正常</option>
            <option value="pending">检测中</option>
            <option value="partial_error">部分异常</option>
            <option value="error">异常</option>
            <option value="not_configured">未配置</option>
          </select>
          <select value={agentAssignmentFilter} onChange={(event) => setAgentAssignmentFilter(event.target.value)} aria-label="筛选客服分配状态">
            <option value="all">全部客服分配</option>
            <option value="assigned">已分配</option>
            <option value="unassigned">未分配</option>
          </select>
          <div className="shop-list-summary-actions">
            <span aria-live="polite">{visibleShops.length} / {props.shops.length} 个账号</span>
            {canExportShops ? (
              <button
                type="button"
                onClick={() => void exportAllShops()}
                disabled={exportingShops || props.shops.length === 0}
                title="导出当前账号权限范围内页面字段及绑定的 Shopify、邮箱信息"
              >
                {exportingShops ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
                {exportingShops ? "导出中" : "导出全部"}
              </button>
            ) : null}
          </div>
        </div>
        <div className="shop-table">
          <div className="shop-table-head">
            <span>账号名称</span>
            <span>店面聊天</span>
            <span>邮箱</span>
            <span>备注</span>
            <span>客服</span>
            <span>操作</span>
          </div>
          {pagedShops.map((shop) => {
            const isCurrentShop = shop.id === props.selectedShop?.id;
            const rowSources = props.sourcesByShopId[shop.id] || (isCurrentShop ? props.sources : []);
            const rowAgents = props.agentsByShopId[shop.id] || (isCurrentShop ? props.shopAgents : []);
            const rowShopifySource = rowSources.find((source) => source.type === "shopify_api");
            const rowChatSource = rowSources.find((source) => source.type === "shopify_chat");
            const rowEmailSources = rowSources.filter((source) => source.type === "email");
            const shopifyConnection = shopifyConnections[shop.id] || storedShopifyConnectionStatus(rowShopifySource);
            const rowShopName = shopListDisplayName(shop, shopifyConnection);
            const rowShopNameNeedsSetup = rowShopName === "店铺名称待同步";
            const shopifyStatus = shopifyConnectionSummaryView(rowShopifySource, shopifyConnection, rowChatSource);
            const shopifyConnectionChecking = shopifyConnectionCheckingIDs.has(shop.id);
            const emailStatus = emailChannelStatusView(rowEmailSources);
            const rowAgentNames = rowAgents.map(userDisplayName).join("、");
            const rowAgentLabel = rowAgents.length > 2
              ? `${rowAgents.slice(0, 2).map(userDisplayName).join("、")} +${rowAgents.length - 2}`
              : rowAgentNames || "未分配";
            const rowAssignableAgents = props.users.filter((user) => user.status === "active" || rowAgents.some((agent) => agent.id === user.id));
            const shopNote = shop.metadata?.internalNote || "";
            const connectedChannels = connectedShopChannelLabels(rowShopifySource, rowEmailSources, shopifyConnection);
            const deleteTitle = connectedChannels.length
              ? `请先解绑${connectedChannels.join("和")}后再删除店铺`
              : `删除店铺 ${rowShopName}`;
            return (
              <div className={`shop-table-row ${isCurrentShop ? "active" : ""}`} key={shop.id}>
                <div>
                  <strong>{rowShopName}</strong>
                  {rowShopNameNeedsSetup ? (
                    canManageChannels ? <button type="button" className="shop-name-setup" onClick={() => openShopConfig(shop.id, "info")}><Settings size={12} /> 设置名称</button> : null
                  ) : null}
                </div>
                <button
                  type="button"
                  className="status-action"
                  aria-label={`${rowShopName} 店面聊天：${shopifyStatus.label}`}
                  title={`${rowShopName} 店面聊天`}
                  onClick={() => openShopConfig(shop.id, "shopify")}
                  disabled={!canManageChannels}
                >
                  <span className="shopify-status-stack">
                    <Badge tone={shopifyStatus.tone}>{shopifyStatus.label}</Badge>
                  </span>
                </button>
                <button
                  type="button"
                  className="status-action"
                  aria-label={`${rowShopName} 邮箱渠道：${emailStatus.label}`}
                  title={`${rowShopName} 邮箱渠道`}
                  onClick={() => openShopConfig(shop.id, "email")}
                  disabled={!canManageChannels}
                >
                  <Badge tone={emailStatus.tone}>{emailStatus.label}</Badge>
                </button>
                <span className={`shop-note ${shopNote ? "" : "empty"}`} title={shopNote || "未添加备注"}>{shopNote || "--"}</span>
                <div className="quick-agent-assign">
                  <button
                    type="button"
                    className={`agent-inline-assign ${rowAgents.length ? "assigned" : ""}`}
                    title={rowAgentNames || "未分配接待人员"}
                    disabled={!canAssignShops}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setQuickAgentMenu((current) => current?.shopID === shop.id ? null : {
                        shopID: shop.id,
                        top: rect.bottom + 6,
                        left: Math.min(rect.left, window.innerWidth - 220)
                      });
                    }}
                  >
                    <UserPlus size={14} />
                    <span>{rowAgentLabel}</span>
                    <ChevronDown size={14} />
                  </button>
                  {quickAgentMenu?.shopID === shop.id ? (
                    <div className="quick-agent-picker" style={{ top: quickAgentMenu?.top ?? 0, left: quickAgentMenu?.left ?? 0 }} role="menu" aria-label={`${rowShopName} 快捷分配客服`}>
                      <strong>点击人员即可分配或取消</strong>
                      {rowAssignableAgents.map((user) => {
                        const assigned = rowAgents.some((agent) => agent.id === user.id);
                        const assignmentBusy = quickAgentBusyKeys.has(`${shop.id}:${user.id}`);
                        return <button type="button" className={assigned ? "assigned" : ""} key={user.id} disabled={props.busy || assignmentBusy} onClick={() => void toggleQuickAgent(shop, user, assigned)}><span>{userDisplayName(user)}</span>{assigned ? <CheckCircle2 size={14} /> : null}</button>;
                      })}
                      {!rowAssignableAgents.length ? <span className="quick-agent-empty">暂无可分配人员</span> : null}
                    </div>
                  ) : null}
                </div>
                <div className="shop-row-actions">
                  {canManageChannels || canAssignShops ? <>
                    <button
                      type="button"
                      aria-label={`检测 ${rowShopName} 接入状态`}
                      title={`检测 ${rowShopName} 的 Shopify 授权和全部邮箱状态；聊天插件运行状态使用客服渠道最近一次挂件心跳`}
                      onClick={() => void checkShopAccess(shop)}
                      disabled={shopifyConnectionChecking || (!selectedShopifyDomain(shop) && !rowEmailSources.some((source) => isConnectedSource(source)))}
                    ><RefreshCw size={14} className={shopifyConnectionChecking ? "spin" : ""} /> {shopifyConnectionChecking ? "检测中" : "检测"}</button>
                    <button
                      type="button"
                      aria-label={`配置 ${rowShopName}`}
                      title={`配置 ${rowShopName}`}
                      onClick={() => openShopConfig(shop.id, "info")}
                    ><Settings size={14} /> 配置</button>
                  </> : null}
                  {canDeleteShops && !erpManaged ? <button type="button" className="danger-action" onClick={() => requestDeleteShop(shop, rowShopifySource, rowEmailSources, shopifyConnection)} disabled={props.busy} title={deleteTitle}>
                    删除店铺
                  </button> : null}
                </div>
              </div>
            );
          })}
          {!props.shops.length ? <Empty text={t.selectStoreFirst} /> : null}
          {props.shops.length && !visibleShops.length ? <Empty text="没有匹配的账号" /> : null}
        </div>
        {visibleShops.length ? (
          <div className="shop-list-pagination" aria-label="账号列表分页">
            <span>共 {visibleShops.length} 条</span>
            <label>
              每页
              <select value={shopPageSize} onChange={(event) => { setShopPageSize(Number(event.target.value)); setShopPage(1); }}>
                <option value={50}>50 条</option>
                <option value={100}>100 条</option>
                <option value={200}>200 条</option>
              </select>
            </label>
            <button type="button" onClick={() => setShopPage(1)} disabled={shopPage === 1}>首页</button>
            <button type="button" onClick={() => setShopPage((current) => Math.max(1, current - 1))} disabled={shopPage === 1}>上一页</button>
            <strong>{shopPage} / {shopPageCount}</strong>
            <button type="button" onClick={() => setShopPage((current) => Math.min(shopPageCount, current + 1))} disabled={shopPage === shopPageCount}>下一页</button>
            <button type="button" onClick={() => setShopPage(shopPageCount)} disabled={shopPage === shopPageCount}>末页</button>
          </div>
        ) : null}
      </Panel>

      {deleteCandidate && !erpManaged ? (
        <div className="drawer-backdrop delete-shop-backdrop" onMouseDown={() => { if (!props.busy) setDeleteCandidate(null); }}>
          <section className="delete-shop-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-shop-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="delete-shop-dialog-icon"><CircleAlert size={22} /></div>
            <div>
              <h3 id="delete-shop-title">确认删除店铺</h3>
              <p>即将删除 <strong>{shopListDisplayName(deleteCandidate, shopifyConnections[deleteCandidate.id])}</strong>。</p>
              <span>账号配置、客服分配、渠道记录和相关会话消息都会被永久删除。</span>
            </div>
            <div className="delete-shop-dialog-actions">
              <button ref={deleteCancelRef} type="button" onClick={() => setDeleteCandidate(null)} disabled={props.busy}>取消</button>
              <button type="button" className="delete-shop-confirm" onClick={() => void confirmDeleteShop()} disabled={props.busy}>{props.busy ? "正在删除" : "确认删除"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {emailDisconnectCandidate ? (
        <div className="drawer-backdrop delete-shop-backdrop" onMouseDown={() => { if (!props.busy) { setEmailDisconnectCandidate(null); setEmailDisconnectError(""); } }}>
          <section className="delete-shop-dialog" role="dialog" aria-modal="true" aria-labelledby="disconnect-email-title" aria-describedby="disconnect-email-description" onMouseDown={(event) => event.stopPropagation()}>
            <div className="delete-shop-dialog-icon"><CircleAlert size={22} /></div>
            <div>
              <h3 id="disconnect-email-title">确认解绑邮箱</h3>
              <p>即将从 Xzdesk 解绑 <strong>{emailDisconnectCandidate.address || emailDisconnectCandidate.metadata?.mailbox || "该邮箱"}</strong>。</p>
              <span id="disconnect-email-description">系统会停止同步并删除本地授权凭证，历史邮件和会话仍会保留。若尚未在邮箱端撤销 Xzdesk 授权，解绑后还需在邮箱端完成撤销。</span>
              {emailDisconnectError ? <span className="disconnect-email-error" role="alert">{emailDisconnectError}</span> : null}
            </div>
            <div className="delete-shop-dialog-actions">
              <button ref={emailDisconnectCancelRef} type="button" onClick={() => { setEmailDisconnectCandidate(null); setEmailDisconnectError(""); }} disabled={props.busy}>取消</button>
              <button type="button" className="delete-shop-confirm" onClick={() => void confirmDisconnectEmail()} disabled={props.busy}>{props.busy ? "正在解绑" : "确认解绑"}</button>
            </div>
          </section>
        </div>
      ) : null}

      {businessAccountVisible ? (
        <div className="drawer-backdrop business-account-backdrop" onMouseDown={() => { if (!props.busy) setBusinessAccountVisible(false); }}>
          <section className="business-account-dialog" role="dialog" aria-modal="true" aria-labelledby="business-account-title" aria-describedby="business-account-description" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer-head">
              <div>
                <h3 id="business-account-title">新增店铺</h3>
                <span id="business-account-description">账号创建后可以接入客服邮箱并分配接待人员；Shopify 店铺由 Xinzhi ERP 同步。</span>
              </div>
              <button type="button" aria-label="关闭新增店铺" onClick={() => setBusinessAccountVisible(false)} disabled={props.busy}><X size={16} /></button>
            </div>
            <form className="business-account-form" onSubmit={(event) => { event.preventDefault(); void createBusinessAccount(canManageChannels ? "email" : "info"); }}>
              <label htmlFor="business-account-name">店铺名称 <span className="required-mark">*</span></label>
              <input
                ref={businessAccountInputRef}
                id="business-account-name"
                value={businessAccountName}
                onChange={(event) => { setBusinessAccountName(event.target.value); setBusinessAccountNotice(null); }}
                placeholder="例如：美国站客服"
                maxLength={80}
                autoComplete="off"
                disabled={props.busy}
                required
              />
              <small>用于客服后台识别业务，不要求现在填写邮箱地址。</small>
              <DrawerInlineNotice notice={businessAccountNotice} />
              {canManageChannels ? (
                <div className="business-account-channel-actions" aria-label="创建并接入邮箱">
                  <button type="submit" className="primary" disabled={props.busy}><Mail size={16} /> {props.busy ? "创建中" : "创建并接入邮箱"}</button>
                </div>
              ) : (
                <div className="business-account-channel-actions">
                  <button type="submit" className="primary" disabled={props.busy}><Plus size={16} /> {props.busy ? "创建中" : "创建账号"}</button>
                </div>
              )}
              <div className="drawer-actions">
                <button type="button" onClick={() => setBusinessAccountVisible(false)} disabled={props.busy}>取消</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}

      {emailConnectProvider && configShop ? (
        <div className="drawer-backdrop email-connect-backdrop" onMouseDown={() => { if (!props.busy) setEmailConnectProvider(null); }}>
          <section className="email-connect-dialog" role="dialog" aria-modal="true" aria-labelledby="email-connect-title" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong id="email-connect-title">{emailConnectProvider === "standard" ? `${emailReconnectSource ? "重新接入" : "接入"} ${STANDARD_MAIL_SERVICE_VIEW[standardMailService].title}` : emailReconnectSource ? `重新授权 ${emailConnectProvider === "outlook" ? "Outlook" : "Gmail"} 邮箱` : emailConnectProvider === "outlook" ? "接入 Outlook 邮箱" : emailConnectProvider === "gmail" ? "接入 Gmail 邮箱" : "接入脆球邮箱"}</strong>
                <span>当前店铺：{shopListDisplayName(configShop, shopifyConnections[configShop.id])}</span>
              </div>
              <button type="button" aria-label="关闭邮箱接入" onClick={() => setEmailConnectProvider(null)} disabled={props.busy}><X size={16} /></button>
            </header>

            {emailConnectProvider === "outlook" || emailConnectProvider === "gmail" ? (
              <div className="email-oauth-dialog-body">
                <p>{emailConnectProvider === "outlook" ? "系统生成 Microsoft 授权地址。" : "系统生成 Google 授权地址。"}复制后请在确认的邮箱账号环境中手动打开，Xzdesk 不会启动或控制浏览器。{emailReconnectSource ? ` 本次必须登录 ${emailReconnectSource.address || emailReconnectSource.metadata?.mailbox || "待恢复邮箱"}。` : ""}</p>
                <button
                  type="button"
                  className="primary email-connect-main-action"
                  onClick={() => void (emailConnectProvider === "outlook" ? createOutlookAuthAddressInDrawer() : createGmailAuthAddressInDrawer())}
                  disabled={props.busy}
                ><ExternalLink size={16} /> {props.busy ? "正在生成" : "生成并复制授权地址"}</button>
                {emailConnectProvider === "outlook" && outlookAuthUrl ? (
                  <div className="auth-link-row">
                    <input value={outlookAuthUrl} readOnly aria-label="Outlook API 授权地址" />
                    <button type="button" onClick={() => void copyOutlookAuthAddressInDrawer()}><Copy size={14} /> 复制</button>
                  </div>
                ) : null}
                {emailConnectProvider === "gmail" && gmailAuthUrl ? (
                  <div className="auth-link-row">
                    <input value={gmailAuthUrl} readOnly aria-label="Gmail API 授权地址" />
                    <button type="button" onClick={() => void copyGmailAuthAddressInDrawer()}><Copy size={14} /> 复制</button>
                  </div>
                ) : null}
                <DrawerInlineNotice notice={emailConnectNotice} />
              </div>
            ) : emailConnectProvider === "standard" ? (
              <form className="cuiqiu-connect-form" onSubmit={(event) => void connectStandardMail(event)}>
                <div className="cuiqiu-connect-guidance">
                  <div className="cuiqiu-connect-guidance-head">
                    <strong>按邮箱后缀自动匹配</strong>
                    <button type="button" className="netease-tutorial-entry" onClick={() => setStandardMailTutorial(standardMailService)}>
                      <BookOpen size={14} /> 查看接入教程
                    </button>
                  </div>
                  <span>{STANDARD_MAIL_SERVICE_VIEW[standardMailService].guidance}</span>
                </div>
                <div className="email-connect-field-grid">
                  <label className="wide"><span>邮箱账号 <b>*</b></span><input type="email" value={standardMailForm.mailbox} onChange={(event) => updateStandardMailForm("mailbox", event.target.value)} placeholder={STANDARD_MAIL_SERVICE_VIEW[standardMailService].mailboxPlaceholder} autoComplete="off" required disabled={props.busy} /></label>
                  <label className="wide"><span>{STANDARD_MAIL_SERVICE_VIEW[standardMailService].credentialLabel} <b>*</b></span><input type="password" value={standardMailForm.credential} onChange={(event) => updateStandardMailForm("credential", event.target.value)} placeholder={STANDARD_MAIL_SERVICE_VIEW[standardMailService].credentialPlaceholder} autoComplete="new-password" required disabled={props.busy} /></label>
                </div>
                <DrawerInlineNotice notice={emailConnectNotice} />
                <footer>
                  <button type="button" onClick={() => setEmailConnectProvider(null)} disabled={props.busy}>取消</button>
                  <button type="submit" className="primary" disabled={props.busy}>{props.busy ? "正在验证" : "验证并接入"}</button>
                </footer>
              </form>
            ) : (
              <form className="cuiqiu-connect-form" onSubmit={(event) => void connectCuiqiuEmail(event)}>
                <div className="cuiqiu-connect-guidance">
                  <strong>按邮箱域名自动匹配</strong>
                  <span>管理员已统一配置收信 API 和 SMTP 服务器。这里只需填写子邮箱账号和该子邮箱自己的密码；不是脆球后台账号密码。</span>
                </div>
                <div className="email-connect-field-grid">
                  <label className="wide"><span>邮箱账号 <b>*</b></span><input type="email" value={cuiqiuForm.mailbox} onChange={(event) => updateCuiqiuForm("mailbox", event.target.value)} placeholder="例如：support@fastmo.cn" autoComplete="off" required disabled={props.busy} /></label>
                  <label className="wide"><span>邮箱密码 <b>*</b></span><input type="password" value={cuiqiuForm.smtpPassword} onChange={(event) => updateCuiqiuForm("smtpPassword", event.target.value)} placeholder="在脆球“邮箱列表 → 修改密码”中设置" autoComplete="new-password" required disabled={props.busy} /></label>
                </div>
                <DrawerInlineNotice notice={emailConnectNotice} />
                <footer>
                  <button type="button" onClick={() => setEmailConnectProvider(null)} disabled={props.busy}>取消</button>
                  <button type="submit" className="primary" disabled={props.busy}>{props.busy ? "正在验证" : "验证并接入"}</button>
                </footer>
              </form>
            )}
          </section>
        </div>
      ) : null}

      {standardMailTutorial && emailConnectProvider === "standard" && standardMailService === standardMailTutorial ? (
        <div className="drawer-backdrop netease-tutorial-backdrop" role="presentation" onMouseDown={() => setStandardMailTutorial(null)}>
          <section className="netease-tutorial-dialog" role="dialog" aria-modal="true" aria-labelledby="standard-mail-tutorial-title" aria-describedby="standard-mail-tutorial-description" onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <strong id="standard-mail-tutorial-title">{STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].title}</strong>
                <span>{STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].subtitle}</span>
              </div>
              <button type="button" aria-label={`关闭${STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].title}`} onClick={() => setStandardMailTutorial(null)} autoFocus><X size={16} /></button>
            </header>
            <div className="netease-tutorial-body">
              <ol id="standard-mail-tutorial-description">
                {STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].steps.map((step) => <li key={step}>{step}</li>)}
              </ol>
              <div className="netease-tutorial-warning" role="note">
                <CircleAlert size={17} />
                <strong>{STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].warning}</strong>
              </div>
              <figure className="netease-tutorial-image-frame">
                <img src={STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].image} alt={STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].imageAlt} />
                {STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].imageCaption ? <figcaption>{STANDARD_MAIL_TUTORIAL_VIEW[standardMailTutorial].imageCaption}</figcaption> : null}
              </figure>
            </div>
            <footer>
              <button type="button" className="primary" onClick={() => setStandardMailTutorial(null)}>关闭</button>
            </footer>
          </section>
        </div>
      ) : null}

      {configShop ? (
        <div className="drawer-backdrop shop-config-backdrop">
          <aside className="shop-config-drawer">
            <div className="drawer-head">
              <div>
                <h3>{configShop.displayName}</h3>
                <span>配置这个账号的 Shopify、邮箱和接待客服</span>
              </div>
              <button type="button" aria-label="关闭店铺配置" onClick={() => setConfigShopId("")}><X size={16} /></button>
            </div>
            <div className="shop-config-body menu-shop-config">
              <nav className="shop-config-menu" aria-label="店铺配置菜单">
                <button type="button" className={configMenu === "info" ? "active" : ""} onClick={() => setConfigMenu("info")}><Store size={15} /> 账号信息</button>
                {canManageChannels ? <button type="button" className={configMenu === "shopify" ? "active" : ""} onClick={() => setConfigMenu("shopify")}><PackageSearch size={15} /> 店面聊天</button> : null}
                {canManageChannels ? <button type="button" className={configMenu === "email" ? "active" : ""} onClick={() => setConfigMenu("email")}><Mail size={15} /> 邮箱渠道</button> : null}
              </nav>
              <div className="shop-config-content">
                {configMenu === "info" ? (
                  <section className="simple-config-section">
                    <div className="simple-config-head">
                      <div>
                        <h3>账号信息</h3>
                      <span>店铺名称用于客服后台识别；Shopify 域名在接入该渠道后自动确认。</span>
                      </div>
                    </div>
                    {erpManaged ? (
                      <div className="erp-managed-shop-summary">
                        <div><span>店铺名称</span><strong>{configShop.displayName}</strong></div>
                        <div><span>Shopify 域名</span><strong>{shopifyDomain || "等待 ERP 同步"}</strong></div>
                        <small>店铺名称、状态和授权由 Xinzhi ERP 统一维护；客服侧不重复保存这些资料。</small>
                      </div>
                    ) : canManageChannels ? <form className="form-grid compact-form shop-info-form" onSubmit={saveShopInfo}>
                      <label>店铺名称 <span className="required-mark">*</span>
                        <input value={shopInfoName} onChange={(event) => setShopInfoName(event.target.value)} required />
                      </label>
                      <label>Shopify myshopify 域名
                        <div className="shop-domain-field">
                          <input value={shopifyDomain || "待 Shopify API 授权后自动确认"} readOnly />
                        </div>
                      </label>
                      <label className="wide-field">内部备注
                        <input
                          value={shopInfoNote}
                          onChange={(event) => setShopInfoNote(event.target.value)}
                          maxLength={160}
                          placeholder="例如：店铺负责人、产品线或测试用途"
                        />
                      </label>
                      <label className="wide-field">AI 回复规则（每行一条）
                        <textarea value={shopAIRules} onChange={(event) => setShopAIRules(event.target.value)} rows={6} maxLength={4000} placeholder={"回复保持简洁，不超过 80 个单词\n不得承诺具体到货日期\n退款或拒付必须交由人工确认"} />
                      </label>
                      <div className="simple-actions wide-field">
                        <button type="submit" className="primary" disabled={props.busy}><Settings size={16} /> 保存账号信息</button>
                      </div>
                    </form> : null}
                    {canAssignShops ? <div className="simple-config-section inner-section">
                      <div className="simple-config-head">
                        <div>
                          <h3>接待人员分配</h3>
                          <span>勾选多位客服后一次保存；每位已分配人员都能接入这个店铺的会话。</span>
                        </div>
                        <Badge tone={configAgents.length ? "green" : "muted"}>{configAgents.length ? `${configAgents.length} 人` : "未分配"}</Badge>
                      </div>
                      <div className="agent-assignment-picker" role="group" aria-label="选择接待人员">
                        {assignableAgents.map((user) => {
                          const selected = selectedAgentIDs.includes(user.id);
                          return (
                            <label className={selected ? "selected" : ""} key={user.id}>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={() => setSelectedAgentIDs((current) => selected ? current.filter((id) => id !== user.id) : [...current, user.id])}
                                disabled={props.busy || agentAssignmentsSaving}
                              />
                              <span><strong>{userDisplayName(user)}</strong><small>{user.email} · {roleLabel(user.role, t)}</small></span>
                            </label>
                          );
                        })}
                        {!assignableAgents.length ? <Empty text="暂无可分配人员" /> : null}
                      </div>
                      <div className="simple-actions"><button type="button" className="primary" onClick={() => void saveAgentAssignments()} disabled={props.busy || agentAssignmentsSaving || !assignableAgents.length}><UserPlus size={16} /> {agentAssignmentsSaving ? "保存中" : `保存 ${selectedAgentIDs.length} 位客服`}</button></div>
                    </div> : null}
                  </section>
                ) : null}

                {configMenu === "shopify" ? (
                  <section className="simple-config-section">
                    <div className="simple-config-head">
                      <div>
                        <h3>店面聊天</h3>
                        <span>客服侧负责聊天渠道绑定、Support Chat 挂件配置与运行状态；邮箱渠道在旁边单独维护。</span>
                      </div>
                    </div>
                    <div className="shopify-status-overview erp-managed">
                      <div><span>公开应用前提</span><Badge tone={shopifyAPIStatus.tone}>{shopifyAPIStatus.label}</Badge></div>
                      <div><span>客服渠道</span><Badge tone={chatSource && isConnectedSource(chatSource) ? "green" : "warning"}>{chatSource && isConnectedSource(chatSource) ? "已绑定" : "待绑定"}</Badge></div>
                      <div><span>前台挂件</span><Badge tone={shopifyPluginStatus.tone}>{shopifyPluginStatus.label}</Badge></div>
                    </div>
                    <section className="shopify-compact-section erp-channel-owner">
                      <div className="shopify-compact-head">
                        <div><strong>ERP 授权状态（只读）</strong><span>{shopifyDomain || "当前店铺域名尚未同步"}</span></div>
                        <Badge tone={shopifyAPIStatus.tone}>{shopifyAPIStatus.label}</Badge>
                      </div>
                      <span className="channel-hint">重新安装、权限范围和解除绑定请到 Xinzhi ERP 店铺详情处理；访问令牌仅由统一 Connector 持有，客服侧不会读取或保存。</span>
                    </section>
                    <section className="shopify-compact-section plugin-guide-required">
                      <div className="shopify-compact-head">
                        <div>
                          <strong>启用 Support Chat</strong>
                          <span>{chatSource?.metadata?.widgetLastSeenAt ? `最近一次前台加载：${timeLabel(chatSource.metadata.widgetLastSeenAt, t)}` : "尚未检测到前台加载记录"}</span>
                        </div>
                        <div className="simple-actions">
                          <button type="button" onClick={() => void copyShopifyEmbedAddressInDrawer()} disabled={!erpPluginSettingsUrl}><Copy size={14} /> 复制插件启用链接</button>
                        </div>
                      </div>
                      <DrawerInlineNotice notice={shopifyDrawerNotice} />
                      <ol className="compact-plugin-guide">
                        <li>点击上方按钮只复制链接，不会打开、切换或控制任何浏览器。</li>
                        <li>切换到该店铺已登录的浏览器，新开标签页并手动粘贴打开。</li>
                        <li>在<strong>应用嵌入</strong>中关闭<strong>在线商店聊天（Inbox）</strong>。</li>
                        <li>在 <code>Xinzhi ERP</code> 下开启 <code>Support Chat</code>，再点击右上角<strong>保存</strong>。</li>
                      </ol>
                      <span className="channel-hint">启用后，有访客页面加载挂件时，客服侧会记录最近加载时间；这里不会定时刷新或触发店铺操作。</span>
                    </section>
                    <div className="visitor-scheme-summary">
                      <div><strong>访客方案</strong><span>{chatSource?.metadata?.visitorSchemeName || "尚未关联访客方案"}</span></div>
                      <button type="button" onClick={props.onOpenVisitorSchemes}>管理访客方案</button>
                    </div>
                  </section>
                ) : null}

                {configMenu === "email" ? (
                  <section className="simple-config-section email-config-section">
                    <div className="simple-config-head">
                      <div>
                        <h3>邮箱渠道</h3>
                        <span>新邮件自动接收并定期补漏，支持已读同步和回复。</span>
                      </div>
                      <Badge tone={emailChannelStatusView(emailSources).tone}>{emailChannelStatusView(emailSources).label}</Badge>
                    </div>
                    <DrawerInlineNotice notice={shopifyDrawerNotice} />

                    {emailSources.length ? (
                      <div className="email-account-list" aria-label="已接入邮箱列表">
                        {emailSources.map((source) => {
                          const connected = isConnectedSource(source);
                          const runtimeState = emailSourceRuntimeState(source);
                          const retryView = emailSourceRetryView(source);
                          const accountStatus = retryView
                            ? { label: retryView.label, tone: "warning" as const }
                            : runtimeState === "error"
                            ? { label: "异常", tone: "warning" as const }
                            : runtimeState === "pending"
                              ? { label: "推送检测中", tone: "warning" as const }
                            : connected
                              ? { label: "已接入", tone: "green" as const }
                              : { label: "需要重新授权", tone: "warning" as const };
                          const historyJob = emailHistoryImports[source.id];
                          const historyBusy = emailHistoryBusySourceIDs.has(source.id);
                          const showHistoryStatus = historyJob && !["completed", "cancelled"].includes(historyJob.status);
                          return (
                            <div className="email-account-item" key={source.id}>
                              <div className="email-account-identity">
                                <strong>{source.address || source.metadata?.mailbox || "邮箱未识别"}</strong>
                                {retryView ? <span>{retryView.detail}</span> : null}
                              </div>
                              <div className="email-account-item-actions">
                                {showHistoryStatus ? <span className={`email-history-state ${historyJob.status}`}>{emailHistoryStatusText(historyJob)}</span> : null}
                                <Badge tone={accountStatus.tone}>{accountStatus.label}</Badge>
                                {canManageChannels && connected ? (
                                  <div className="email-history-actions">
                                    {!historyJob || ["completed", "cancelled"].includes(historyJob.status) ? <button type="button" onClick={() => void updateEmailHistoryImport(source, "start")} disabled={props.busy || historyBusy}>读取全部历史邮件</button> : null}
                                    {["queued", "running"].includes(historyJob?.status || "") ? <button type="button" onClick={() => void updateEmailHistoryImport(source, "pause")} disabled={props.busy || historyBusy}>暂停</button> : null}
                                    {historyJob?.status === "paused" ? <button type="button" onClick={() => void updateEmailHistoryImport(source, "resume")} disabled={props.busy || historyBusy}>继续</button> : null}
                                    {historyJob?.status === "failed" ? <button type="button" onClick={() => void updateEmailHistoryImport(source, "retry")} disabled={props.busy || historyBusy}>重试</button> : null}
                                    {["queued", "running", "paused", "failed"].includes(historyJob?.status || "") ? <button type="button" onClick={() => void updateEmailHistoryImport(source, "cancel")} disabled={props.busy || historyBusy}>取消</button> : null}
                                  </div>
                                ) : null}
                                {canManageChannels && retryView?.canReauthorize ? <button type="button" onClick={() => openEmailReauthorization(source)} disabled={props.busy}>重新授权</button> : null}
                                {canManageChannels && retryView?.canReconnectStandard ? <button type="button" onClick={() => openStandardMailReconnect(source)} disabled={props.busy}>更新授权码</button> : null}
                                {canManageChannels && retryView?.canRecover ? <button type="button" onClick={() => void recoverStandardIMAPSource(source)} disabled={props.busy}>检测并恢复</button> : null}
                                {canManageChannels && Number.parseInt(source.metadata?.email_quarantine_pending_count || "", 10) > 0 ? <button type="button" onClick={() => void retryEmailQuarantine(source)} disabled={props.busy}>重试异常邮件</button> : null}
                                {canManageChannels && connected ? <button type="button" onClick={() => void setEmailSourceSyncPaused(source, !source.metadata?.email_manual_paused_at)} disabled={props.busy}>{source.metadata?.email_manual_paused_at ? "恢复同步" : "暂停同步"}</button> : null}
                                {canManageChannels ? <button type="button" className="email-account-unlink danger-action" onClick={() => { setEmailDisconnectError(""); setEmailDisconnectCandidate(source); }} disabled={props.busy} aria-label={`解绑邮箱 ${source.address || source.metadata?.mailbox || ""}`}>解绑</button> : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <Empty text="还没有接入邮箱" />}

                    <div className="mail-connect-grid">
                      <section className="mail-connect-card">
                        <div>
                          <strong>Hotmail / Outlook / Live / Microsoft 365</strong>
                          <span>账号授权接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openEmailConnectModal("outlook")} disabled={props.busy || outlookStatus?.configured === false}><Mail size={16} /> {outlookStatus?.configured === false ? "先配置 Microsoft 应用" : "接入 Outlook 邮箱"}</button>
                      </section>
                      <section className="mail-connect-card">
                        <div>
                          <strong>Gmail</strong>
                          <span>账号授权接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openEmailConnectModal("gmail")} disabled={props.busy || gmailStatus?.configured === false}><Mail size={16} /> {gmailStatus?.configured === false ? "先配置 Google 应用" : "接入 Gmail 邮箱"}</button>
                      </section>
                      <section className="mail-connect-card">
                        <div>
                          <strong>脆球域名邮箱</strong>
                          <span>邮箱账号和密码接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openEmailConnectModal("cuiqiu")} disabled={props.busy}><Mail size={16} /> 接入脆球邮箱</button>
                      </section>
                      <section className="mail-connect-card">
                        <div>
                          <strong>网易邮箱（163 / 126）</strong>
                          <span>客户端授权码接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openStandardMailConnectModal("netease")} disabled={props.busy}><Mail size={16} /> 接入网易邮箱</button>
                      </section>
                      <section className="mail-connect-card">
                        <div>
                          <strong>QQ 邮箱</strong>
                          <span>客户端授权码接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openStandardMailConnectModal("qq")} disabled={props.busy}><Mail size={16} /> 接入 QQ 邮箱</button>
                      </section>
                      <section className="mail-connect-card">
                        <div>
                          <strong>139 邮箱</strong>
                          <span>客户端授权码接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openStandardMailConnectModal("139")} disabled={props.busy}><Mail size={16} /> 接入 139 邮箱</button>
                      </section>
                      <section className="mail-connect-card">
                        <div>
                          <strong>189 邮箱</strong>
                          <span>客户端专用密码接入，同步收信和已读状态，支持原线程回复。</span>
                        </div>
                        <button type="button" className="primary" onClick={() => openStandardMailConnectModal("189")} disabled={props.busy}><Mail size={16} /> 接入 189 邮箱</button>
                      </section>
                    </div>

                    {outlookStatus?.configured === false ? (
                      <div className="channel-warning">
                        <strong>Outlook API 还差服务端配置</strong>
                        <span>缺少：{(outlookStatus.missing || []).join("、")}</span>
                        {outlookStatus.redirectUri ? <code>回调地址：{outlookStatus.redirectUri}</code> : null}
                        <span>在 Microsoft Entra 应用里添加上面的 Web 重定向 URI，并创建 Client Secret 后，再把参数写入服务端环境变量。</span>
                      </div>
                    ) : null}
                    {gmailStatus?.configured === false ? (
                      <div className="channel-warning">
                        <strong>Gmail API 还差服务端配置</strong>
                        <span>缺少：{(gmailStatus.missing || []).join("、")}</span>
                        {gmailStatus.redirectUri ? <code>回调地址：{gmailStatus.redirectUri}</code> : null}
                        <span>在 Google Cloud OAuth Client 中添加上面的 Authorized redirect URI，并把 Client ID 和 Secret 写入服务端环境变量。</span>
                      </div>
                    ) : null}
                    {outlookStatusError ? <div className="channel-warning">{outlookStatusError}</div> : null}
                    {gmailStatusError ? <div className="channel-warning">{gmailStatusError}</div> : null}
                  </section>
                ) : null}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
