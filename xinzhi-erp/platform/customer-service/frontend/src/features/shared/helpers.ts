import { AuthResult, cleanBaseUrl, Conversation, PlatformAPIError, ResponseMetrics, Shop, ShopifyConnectionStatus, ShopifyOrderSummary, ShopSource, User } from "../../api";
import { DEFAULT_INSTANT_ANSWER, type InstantAnswerConfig, type Language, type T } from "./types";

const authKey = "support-platform.erp-auth";
const languageKey = "support-platform.language";

export function parseInstantAnswers(raw?: string): InstantAnswerConfig[] {
  if (!raw) return [DEFAULT_INSTANT_ANSWER];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [DEFAULT_INSTANT_ANSWER];
    const answers = parsed
      .map((item, index): InstantAnswerConfig => ({
        id: typeof item?.id === "string" && item.id.trim() ? item.id.trim() : `answer_${index}`,
        title: typeof item?.title === "string" ? item.title : "",
        answer: typeof item?.answer === "string" ? item.answer : "",
        mode: item?.mode === "order_tracking" ? "order_tracking" : "text",
        enabled: item?.enabled !== false,
        sort: Number.isFinite(Number(item?.sort)) ? Number(item.sort) : index
      }))
      .filter((item) => item.title.trim() || item.answer.trim());
    return answers.length ? normalizeInstantAnswerOrder(answers) : [DEFAULT_INSTANT_ANSWER];
  } catch {
    return [DEFAULT_INSTANT_ANSWER];
  }
}

export function normalizeInstantAnswerOrder(answers: InstantAnswerConfig[]) {
  return [...answers]
    .sort((a, b) => a.sort - b.sort)
    .map((answer, index) => ({ ...answer, sort: index }));
}

export function defaultShopifyOrderQuery(conversation: Conversation | null) {
  const email = conversation?.customerEmail?.trim();
  if (email) return `email:"${email.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return "";
}

export function formatMoney(value?: { amount?: string; currencyCode?: string }) {
  if (!value?.amount) return "-";
  return `${value.currencyCode || ""} ${value.amount}`.trim();
}

export function dateOnly(value?: string) {
  return value ? value.slice(0, 10) : "";
}

export function durationLabel(seconds?: number) {
  if (!seconds || seconds < 0) return "--";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  return [hours, minutes, remaining].map((value) => String(value).padStart(2, "0")).join(":");
}

export function firstTracking(order?: ShopifyOrderSummary) {
  if (!order) return "";
  for (const fulfillment of order.fulfillments || []) {
    for (const tracking of fulfillment.trackingInfo || []) {
      if (tracking.number) return [tracking.company, tracking.number].filter(Boolean).join(" ");
    }
  }
  return "";
}

export function readStoredAuth(): AuthResult | null {
  try {
    const raw = window.sessionStorage.getItem(authKey);
    return raw ? JSON.parse(raw) as AuthResult : null;
  } catch {
    return null;
  }
}

export function storeAuth(value: AuthResult | null) {
  if (!value) window.sessionStorage.removeItem(authKey);
  else window.sessionStorage.setItem(authKey, JSON.stringify(value));
}

export function readStoredLanguage(): Language {
  const stored = window.localStorage.getItem(languageKey);
  if (stored === "zh" || stored === "en") return stored;
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isAuthExpiredError(error: unknown) {
  if (error instanceof PlatformAPIError && error.status === 401) return true;
  const message = errorText(error).toLowerCase();
  return message.includes("invalid session") || message.includes("unauthorized");
}

export function roleLabel(role: string, t: T) {
  if (role === "admin") return t.admin;
  if (role === "agent") return t.agent;
  return role;
}

export function userDisplayName(user: User) {
  return user.displayName || user.email;
}

export function systemAdminUserId(users: User[]) {
  return users
    .filter((user) => user.role === "admin")
    .sort((left, right) => {
      const created = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      if (created !== 0) return created;
      return left.id.localeCompare(right.id);
    })[0]?.id || "";
}

export function sourceLabel(type: string) {
  if (type === "shopify_chat") return "Xzdesk Chat";
  if (type === "shopify_inbox") return "Shopify Inbox";
  if (type === "shopify_api") return "Xzdesk Shopify Connector";
  if (type === "email") return "Xzdesk Mail";
  return type;
}

export function sourceStatusView(source: ShopSource | undefined, labels: { empty: string; active: string; disabled: string }): { label: string; tone: "green" | "muted" } {
  if (!source) return { label: labels.empty, tone: "muted" };
  if (source.status === "active" && isConnectedSource(source)) return { label: labels.active, tone: "green" };
  if (source.status === "active" && source.type === "email") return { label: labels.empty, tone: "muted" };
  if (source.status === "disabled") return { label: labels.disabled, tone: "muted" };
  return { label: source.status || labels.empty, tone: "muted" };
}

export function ticketStatusTone(status: string): "blue" | "green" | "muted" | "warning" {
  if (status === "resolved") return "green";
  if (status === "closed" || status === "cancelled") return "muted";
  if (status === "open" || status === "pending" || status === "pending_review") return "warning";
  return "blue";
}

export function orderFinancialStatusTone(status?: string): "green" | "muted" | "warning" | "danger" {
  const normalized = (status || "").toUpperCase();
  if (normalized === "PAID") return "green";
  if (["PENDING", "AUTHORIZED", "PARTIALLY_PAID", "PARTIALLY_REFUNDED"].includes(normalized)) return "warning";
  if (["FAILED", "DECLINED"].includes(normalized)) return "danger";
  return "muted";
}

export function orderFulfillmentStatusTone(status?: string): "green" | "muted" | "warning" {
  const normalized = (status || "").toUpperCase();
  if (normalized === "FULFILLED") return "green";
  if (["UNFULFILLED", "PARTIALLY_FULFILLED", "IN_PROGRESS", "ON_HOLD", "SCHEDULED", "OPEN"].includes(normalized)) return "warning";
  return "muted";
}

export function shopifyAppStatusView(connection?: ShopifyConnectionStatus): { label: string; tone: "green" | "muted" | "warning" | "danger" } {
  if (!connection) return { label: "正在校验", tone: "warning" };
  if (connection.state === "installed") return { label: "应用已安装", tone: "green" };
  if (connection.state === "not_installed") return { label: "应用未安装", tone: "warning" };
  if (connection.state === "not_configured") return { label: "未配置 API", tone: "muted" };
  return { label: "校验失败", tone: "danger" };
}

export function shopifyEmbedStatusView(connection?: ShopifyConnectionStatus): { label: string; tone: "green" | "muted" | "warning" | "danger" } {
  if (!connection) return { label: "待检测", tone: "muted" };
  if (connection.state === "not_installed") return { label: "插件不可用", tone: "muted" };
  if (connection.state === "not_configured") return { label: "插件未配置", tone: "muted" };
  if (connection.state !== "installed") return { label: "插件校验失败", tone: "danger" };
  if (connection.themeEmbedState === "enabled") return { label: "插件已启用", tone: "green" };
  if (connection.themeEmbedState === "disabled") return { label: "插件未启用", tone: "warning" };
  if (connection.themeEmbedState === "not_added") return { label: "插件未启用", tone: "warning" };
  if (connection.themeEmbedState === "permission_required") return { label: "需重新授权", tone: "warning" };
  if (connection.themeEmbedState === "unavailable") return { label: "待检测", tone: "muted" };
  return { label: "待检测", tone: "muted" };
}

export function shopifyPluginRuntimeStatusView(source?: ShopSource, now = Date.now()): { key: string; label: string; tone: "green" | "muted" | "warning" } {
  if (!source) return { key: "unbound", label: "待绑定客服渠道", tone: "warning" };
  if (source.status === "disabled") return { key: "disabled", label: "客服渠道已停用", tone: "muted" };
  const lastSeenAt = Date.parse(source.metadata?.widgetLastSeenAt || "");
  if (!Number.isFinite(lastSeenAt)) return { key: "not_seen", label: "待启用插件", tone: "warning" };
  if (now - lastSeenAt <= 30 * 60 * 1000) return { key: "active", label: "插件最近已加载", tone: "green" };
  return { key: "stale", label: "插件最近未加载", tone: "warning" };
}

export function shopifyConnectionSummaryView(source?: ShopSource, connection?: ShopifyConnectionStatus, chatSource?: ShopSource): { key: string; label: string; tone: "green" | "muted" | "warning" | "danger" } {
  if (source?.status === "disabled") return { key: "disabled", label: "接入已停用", tone: "muted" };
  if (!source || connection?.state === "not_configured") return { key: "not_configured", label: "未配置", tone: "muted" };
  if (connection?.state === "not_installed" || source.metadata?.apiStatus === "invalid_token") {
    return { key: "authorization_required", label: "待授权", tone: "warning" };
  }
  if (connection?.state === "unknown") return { key: "error", label: "检测失败", tone: "danger" };
  if (!connection && !isConnectedSource(source)) return { key: "unchecked", label: "待检测", tone: "muted" };
  const pluginStatus = shopifyPluginRuntimeStatusView(chatSource);
  if (pluginStatus.key === "active") return { key: "ready", label: "接入正常", tone: "green" };
  if (pluginStatus.key === "unbound" || pluginStatus.key === "disabled") {
    return { key: "plugin_required", label: pluginStatus.label, tone: pluginStatus.tone };
  }
  return { key: "embed_required", label: pluginStatus.label, tone: pluginStatus.tone };
}

// Kept for legacy imports; the shop configuration no longer presents runtime recency as a status.
export function shopifyRuntimeStatusView(connection?: ShopifyConnectionStatus): { label: string; tone: "green" | "muted" | "warning" } {
  if (connection?.widgetRuntimeState === "active") return { label: "前台运行中", tone: "green" };
  if (connection?.widgetRuntimeState === "stale") return { label: "前台最近未加载", tone: "warning" };
  return { label: "前台尚未检测", tone: "muted" };
}

export function shopifyAPIStatusView(source: ShopSource | undefined, connection?: ShopifyConnectionStatus): { label: string; tone: "green" | "muted" | "warning" | "danger" } {
  if (source?.status === "disabled") return { label: "Shopify API 已停用", tone: "muted" };
  if (source?.metadata?.apiStatus === "invalid_token") return { label: "API 已失效", tone: "danger" };
  if (connection?.state === "installed") return { label: "Shopify 已接入", tone: "green" };
  if (!source) return { label: "待安装", tone: "warning" };
  if (connection?.state === "not_installed") return { label: "待安装", tone: "warning" };
  if (connection?.state === "not_configured") return { label: "待安装", tone: "warning" };
  if (isConnectedSource(source) && !connection) return { label: "Shopify 已接入", tone: "green" };
  return { label: "暂时无法校验", tone: "muted" };
}

export function storedShopifyConnectionStatus(apiSource?: ShopSource): ShopifyConnectionStatus | undefined {
  if (!apiSource) return undefined;
  const storedState = apiSource.metadata?.connectionState;
  const state: ShopifyConnectionStatus["state"] = storedState === "installed"
    || storedState === "not_installed"
    || storedState === "not_configured"
    || storedState === "unknown"
    ? storedState
    : apiSource.metadata?.apiStatus === "invalid_token"
      ? "not_installed"
    : isConnectedSource(apiSource)
      ? "installed"
      : "not_configured";
  return {
    state,
    shopDomain: apiSource.metadata?.shopifyDomain || apiSource.address,
    shopName: apiSource.metadata?.connectionShopName,
    message: apiSource.metadata?.connectionMessage,
    checkedAt: apiSource.metadata?.connectionCheckedAt,
    themeEmbedState: apiSource.metadata?.themeEmbedState as ShopifyConnectionStatus["themeEmbedState"],
    themeEmbedMessage: apiSource.metadata?.themeEmbedMessage,
    appDeployStatus: apiSource.metadata?.appDeployStatus as ShopifyConnectionStatus["appDeployStatus"],
    appDeployVersion: apiSource.metadata?.appDeployVersion
  };
}

export function connectedShopChannelLabels(shopifySource?: ShopSource, emailSource?: ShopSource | ShopSource[], shopifyConnection?: ShopifyConnectionStatus) {
  const labels: string[] = [];
  const shopifyConnected = isConnectedSource(shopifySource)
    && shopifyConnection?.state !== "not_installed"
    && shopifyConnection?.state !== "not_configured";
  if (shopifyConnected) labels.push("Shopify");
  const emailConnected = Array.isArray(emailSource)
    ? emailSource.some((source) => isConnectedSource(source))
    : isConnectedSource(emailSource);
  if (emailConnected) labels.push("邮箱");
  return labels;
}

export function isConnectedSource(source?: ShopSource) {
  if (!source || source.status !== "active") return false;
  if (source.type === "email") {
    return Boolean(source.address?.trim() || source.metadata?.mailbox?.trim());
  }
  if (source.type === "shopify_api") {
    return Boolean(source.address?.trim() || source.metadata?.shopifyDomain?.trim());
  }
  return true;
}

export function userStatusLabel(status: string) {
  if (status === "active") return "启用中";
  if (status === "disabled") return "已停用";
  return status || "未知状态";
}

export function defaultShopifyInstallUrl(baseUrl: string) {
  return `${cleanBaseUrl(baseUrl)}/auth?shop=你的店铺ID.myshopify.com`;
}

export function shopifyInstallUrl(baseUrl: string, shopDomain: string) {
  const normalized = normalizeShopifyDomain(shopDomain);
  return `${cleanBaseUrl(baseUrl)}/auth?shop=${normalized || "你的店铺ID.myshopify.com"}`;
}

export function selectedShopifyDomain(shop: Shop) {
  const candidates = [shop.metadata?.shopifyDomain, shop.metadata?.domain, shop.externalId, shop.displayName];
  const raw = candidates.find((value) => isLikelyShopifyDomain(value || "")) || "";
  return normalizeShopifyDomain(raw);
}

export function isLikelyShopifyDomain(value: string) {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return false;
  return trimmed.includes(".myshopify.com") || trimmed.includes("admin.shopify.com/store/");
}

export function normalizeShopifyDomain(value: string) {
  const withoutProtocol = value.trim().replace(/^https?:\/\//i, "").toLowerCase();
  const adminMatch = withoutProtocol.match(/^admin\.shopify\.com\/store\/([^/?#]+)/i);
  if (adminMatch?.[1]) return `${adminMatch[1]}.myshopify.com`;
  const trimmed = withoutProtocol.replace(/\/.*$/, "");
  if (!trimmed) return "";
  return trimmed.includes(".") ? trimmed : `${trimmed}.myshopify.com`;
}

export function normalizeShopifyOAuthTarget(value: string) {
  const normalized = normalizeShopifyDomain(value);
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.myshopify\.com$/.test(normalized) ? normalized : "";
}

export function shopifyAppEmbedUrl(shopDomain: string) {
	const domain = normalizeShopifyDomain(shopDomain);
	return `https://${domain}/admin/themes/current/editor?context=apps`;
}

export function conversationStatusLabel(status: string, t: T) {
  if (status === "open") return t.statusOpen;
  if (status === "assigned") return t.statusAssigned;
  if (status === "closed") return t.statusClosed;
  return status;
}

export function timeLabel(value: string, t: T) {
  if (!value) return t.unknownTime;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
