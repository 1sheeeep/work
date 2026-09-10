import { ClipboardEvent as ReactClipboardEvent, CSSProperties, FormEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, UIEvent as ReactUIEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, BookOpen, Bot, Check, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, CircleHelp, ClipboardPlus, Clock3, Copy, CreditCard, ExternalLink, FileText, ImagePlus, Languages, ListChecks, Mail, MapPin, MessageSquareText, Pencil, Phone, RefreshCw, Search, Send, ShoppingBag, Store, Tag, Trash2, Truck, UserRound, X } from "lucide-react";
import { AIReplyRulesResult, Conversation, ConversationShopifyContext, ConversationSummary, LogisticsTrackingEvent, LogisticsTrackingResult, LogisticsTrackingStatus, Message, PlatformAPI, PlatformAPIError, RecordCategoryOption, Shop, ShopifyCustomerProfile, ShopifyFulfillment, ShopifyMailingAddress, ShopifyOrderSummary, ShopifyProductSummary, ShopifyProductVariant, ShopifyShippingAddressInput, ShopSource, Ticket, TransferRequest, User } from "../../api";
import { Badge, Empty, Panel } from "../../components/ui";
import { DEFAULT_INSTANT_ANSWER, DEFAULT_WIDGET_LANGUAGE, SHOPIFY_STORE_ID_EXAMPLE, type InstantAnswerConfig, type Language, type ShopConfigMenuKey, type T, type ToastMessage, type ToastTone } from "../shared/types";
import { errorText, connectedShopChannelLabels, conversationStatusLabel, defaultShopifyInstallUrl, defaultShopifyOrderQuery, durationLabel, formatMoney, isConnectedSource, normalizeInstantAnswerOrder, normalizeShopifyDomain, parseInstantAnswers, roleLabel, selectedShopifyDomain, shopifyAPIStatusView, shopifyAppEmbedUrl, shopifyAppStatusView, shopifyEmbedStatusView, shopifyInstallUrl, shopifyRuntimeStatusView, sourceLabel, sourceStatusView, systemAdminUserId, ticketStatusTone, timeLabel, userDisplayName, userStatusLabel } from "../shared/helpers";
import { CreateTicketDialog, TransferDialog } from "./WorkflowDialogs";
import { hasPermission, PERMISSIONS } from "../../permissions";

type ConversationRecordDraft = {
  primary: string;
  secondary: string;
  tertiary: string;
  remark: string;
};

const emptyConversationRecord: ConversationRecordDraft = { primary: "", secondary: "", tertiary: "", remark: "" };
const closedConversationPageSize = 100;

type WorkbenchLayout = {
  sessionListWidth: number;
  customerPanelWidth: number;
  composerHeight: number;
};

type WorkbenchResizeTarget = "session-list" | "customer-panel" | "composer";
type AIBusyAction = "" | "draft" | "rewrite" | "translate";

const CURRENT_AI_REPLY_POLICY_VERSION = "carrierless-v1";

type PendingProductDraft = {
  product: ShopifyProductSummary;
  variant: ShopifyProductVariant;
};

type TrackingEditorDraft = {
  fulfillmentId: string;
  company: string;
  number: string;
  url: string;
};

const WORKBENCH_LAYOUT_STORAGE_KEY = "xzdesk.workbench.layout.v1";
const MINIMUM_CHAT_PANE_WIDTH = 520;
const MINIMUM_COMPOSER_HEIGHT = 150;
const COMPOSER_NOTICE_HEIGHT = 32;
const MESSAGE_BOTTOM_THRESHOLD = 48;
const DEFAULT_WORKBENCH_LAYOUT: WorkbenchLayout = {
  sessionListWidth: 318,
  customerPanelWidth: 300,
  composerHeight: 210
};

function createClientRequestID() {
  const random = window.crypto.getRandomValues(new Uint32Array(2));
  return `req_${Date.now().toString(36)}_${random[0].toString(36)}_${random[1].toString(36)}`;
}

function formatAttachmentSize(value?: string) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function visibleMessageTranslation(body: string, translation?: string) {
  const translated = translation?.trim() || "";
  if (!translated) return "";
  const comparable = (value: string) => value.toLocaleLowerCase().replace(/\s+/g, "");
  return comparable(body) === comparable(translated) ? "" : translated;
}

function orderTrackings(order?: ShopifyOrderSummary) {
  const trackings = (order?.fulfillments || []).flatMap((fulfillment) =>
    (fulfillment.trackingInfo || []).map((tracking) => ({
      ...tracking,
      fulfillmentId: fulfillment.id || "",
      fulfillmentStatus: fulfillment.status,
      updatedAt: fulfillment.updatedAt || fulfillment.createdAt || ""
    }))
  ).sort((left, right) => Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""));
  const seen = new Set<string>();
  return trackings.filter((tracking) => {
    const number = tracking.number?.trim();
    if (!number || seen.has(number)) return false;
    seen.add(number);
    return true;
  });
}

function logisticsStatusLabel(status?: string) {
  const normalized = (status || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!normalized) return "";
  if (normalized.includes("notfound")) return "暂无物流信息";
  if (normalized.includes("undelivered") || normalized.includes("deliveryfailure")) return "投递失败";
  if (normalized.includes("outfordelivery")) return "派送中";
  if (normalized.includes("availableforpickup")) return "待取件";
  if (normalized.includes("delivered")) return "已签收";
  if (normalized.includes("exception")) return "运输异常";
  if (normalized.includes("expired")) return "查询超时";
  if (normalized.includes("clearance") || normalized.includes("customs")) return "清关中";
  if (normalized.includes("pickedup") || normalized === "pickup") return "已揽收";
  if (normalized.includes("inforeceived") || normalized.includes("datareceived")) return "已收到物流信息";
  if (normalized.includes("arrival") || normalized.includes("arrived")) return "已到达";
  if (normalized.includes("departure") || normalized.includes("departed")) return "已发出";
  if (normalized.includes("transit")) return "运输中";
  if (normalized.includes("pending")) return "查询中";
  return "";
}

function shippingAddressDraft(address?: ShopifyMailingAddress): ShopifyShippingAddressInput {
  return {
    firstName: address?.firstName || "",
    lastName: address?.lastName || "",
    company: address?.company || "",
    address1: address?.address1 || "",
    address2: address?.address2 || "",
    city: address?.city || "",
    provinceCode: address?.provinceCode || "",
    countryCode: address?.countryCode || "",
    zip: address?.zip || "",
    phone: address?.phone || ""
  };
}

function shippingAddressDisplay(address?: ShopifyMailingAddress) {
  const formatted = address?.formatted?.filter(Boolean).join(", ") || "";
  if (formatted) return formatted;
  return [
    [address?.firstName, address?.lastName].filter(Boolean).join(" "),
    address?.company,
    address?.address1,
    address?.address2,
    [address?.city, address?.provinceCode, address?.zip].filter(Boolean).join(" "),
    address?.countryCode,
    address?.phone
  ].filter(Boolean).join(", ");
}

function orderWithShippingAddress(order: ShopifyOrderSummary, orderId: string, address: ShopifyMailingAddress) {
  return order.id === orderId ? { ...order, shippingAddress: address } : order;
}

function orderWithFulfillment(order: ShopifyOrderSummary, fulfillment: ShopifyFulfillment) {
  if (!fulfillment.id) return order;
  return {
    ...order,
    fulfillments: (order.fulfillments || []).map((item) => item.id === fulfillment.id ? fulfillment : item)
  };
}

function logisticsStatusTone(status?: string): "blue" | "green" | "warning" | "muted" {
  const normalized = (status || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("delivered") && !normalized.includes("undelivered")) return "green";
  if (normalized.includes("exception") || normalized.includes("undelivered") || normalized.includes("expired")) return "warning";
  if (normalized.includes("notfound") || normalized.includes("pending")) return "muted";
  return "blue";
}

function logisticsEventText(event: LogisticsTrackingEvent) {
  return event.description?.trim() || logisticsStatusLabel(event.status) || "物流更新";
}

function formatLogisticsEventTime(value?: string) {
  const raw = value?.trim() || "";
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return match ? `${match[1]} ${match[2]}` : raw || "-";
}

function explicitConversationOrderNumber(conversation: Conversation | null) {
  const stored = conversation?.recordOrderNumber?.trim();
  if (stored) return stored.replace(/\s+/g, "");
  const text = conversation?.subject || "";
  return text.match(/#\s*[a-z0-9][a-z0-9._-]{1,39}|\b\d{5,20}\b/i)?.[0]?.replace(/\s+/g, "") || "";
}

function conversationOrderQueries(conversation: Conversation | null) {
  const emailQuery = defaultShopifyOrderQuery(conversation);
  if (!emailQuery) return [];
  const queries = [emailQuery];
  const orderNumber = explicitConversationOrderNumber(conversation);
  if (orderNumber) queries.push(`name:${orderNumber}`);
  return Array.from(new Set(queries.map((query) => query.trim()).filter(Boolean)));
}

function normalizeOrderReference(value?: string) {
  return (value || "").replace(/\s+/g, "").toLowerCase();
}

function verifiedConversationOrders(orders: ShopifyOrderSummary[], conversation: Conversation | null) {
  const email = conversation?.customerEmail?.trim().toLowerCase() || "";
  if (!email) return [];
  const verified = orders.filter((order) => {
    const orderEmail = order.email?.trim().toLowerCase() || order.customer?.email?.trim().toLowerCase() || "";
    return orderEmail === email;
  });
  const explicitOrder = normalizeOrderReference(explicitConversationOrderNumber(conversation));
  if (!explicitOrder) return verified;
  const exact = verified.find((order) => normalizeOrderReference(order.name) === explicitOrder);
  return exact ? [exact] : [];
}

function customerLastOrderSummary(customer?: ShopifyCustomerProfile | null): ShopifyOrderSummary | undefined {
  const order = customer?.lastOrder;
  if (!order?.name) return undefined;
  return {
    id: order.id || order.legacyResourceId || order.name,
    legacyResourceId: order.legacyResourceId,
    name: order.name,
    email: order.email || customer?.email,
    sourceName: order.sourceName,
    createdAt: order.createdAt || "",
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    paymentGatewayNames: order.paymentGatewayNames,
    total: order.total || { amount: "", currencyCode: "" },
    subtotal: order.subtotal,
    productSubtotal: order.productSubtotal,
    shipping: order.shipping,
    additionalServiceFees: order.additionalServiceFees,
    shippingAddress: order.shippingAddress,
    customer: {
      id: customer?.id,
      displayName: customer?.displayName,
      email: customer?.email,
      phone: customer?.phone,
      createdAt: customer?.createdAt,
      totalSpent: customer?.totalSpent,
      defaultAddress: customer?.defaultAddress
    },
    lineItems: order.lineItems || [],
    fulfillments: order.fulfillments || []
  };
}

function orderDateTime(value?: string) {
  if (!value) return "-";
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}` : value;
}

function orderProductTitles(order?: ShopifyOrderSummary) {
  return (order?.lineItems || [])
    .map((item) => item.name?.trim() || "")
    .filter(Boolean);
}

function orderSourceLabel(sourceName?: string) {
  const labels: Record<string, string> = {
    web: "Online store",
    pos: "Point of Sale",
    mobile_app: "Shop app",
    shopify_draft_order: "Draft order"
  };
  const normalized = (sourceName || "").trim();
  return labels[normalized.toLowerCase()] || normalized || "来源未知";
}

function orderMoney(value?: { amount?: string; currencyCode?: string }) {
  const amount = Number(value?.amount);
  const currency = value?.currencyCode?.trim();
  if (!Number.isFinite(amount) || !currency) return formatMoney(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return formatMoney(value);
  }
}

function validOrderMoney(value?: { amount?: string; currencyCode?: string }) {
  return Boolean(value?.amount?.trim())
    && Number.isFinite(Number(value?.amount))
    && Boolean(value?.currencyCode?.trim());
}

function orderAmountBreakdown(order: ShopifyOrderSummary) {
  const productSubtotal = [order.productSubtotal, order.subtotal, order.total].find(validOrderMoney)
    || undefined;
  const shipping = validOrderMoney(order.shipping) ? order.shipping : undefined;
  const additionalServiceFees = validOrderMoney(order.additionalServiceFees)
    ? order.additionalServiceFees
    : undefined;
  return [
    { label: "商品金额", value: productSubtotal },
    { label: "运费", value: shipping },
    { label: "附加服务费", value: additionalServiceFees },
    { label: "订单总额", value: validOrderMoney(order.total) ? order.total : undefined }
  ];
}

function usableCustomerName(value?: string, email?: string) {
  const candidate = value?.trim() || "";
  if (!candidate || candidate.includes("@")) return "";
  const emailLocalPart = (email || "").trim().split("@")[0] || "";
  const comparable = (text: string) => text.toLocaleLowerCase().replace(/[\s._-]+/g, "");
  if (emailLocalPart && comparable(candidate) === comparable(emailLocalPart)) return "";
  return candidate;
}

function firstUsableCustomerName(values: Array<string | undefined>, email?: string) {
  for (const value of values) {
    const candidate = usableCustomerName(value, email);
    if (candidate) return candidate;
  }
  return "";
}

function financialStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    PAID: "已付款",
    PENDING: "待付款",
    AUTHORIZED: "已授权",
    PARTIALLY_PAID: "部分付款",
    PARTIALLY_REFUNDED: "部分退款",
    REFUNDED: "已退款",
    VOIDED: "已作废",
    EXPIRED: "已过期"
  };
  return labels[(status || "").toUpperCase()] || status || "付款状态未知";
}

function fulfillmentStatusLabel(status?: string) {
  const labels: Record<string, string> = {
    FULFILLED: "已发货",
    UNFULFILLED: "未发货",
    PARTIALLY_FULFILLED: "部分发货",
    IN_PROGRESS: "处理中",
    ON_HOLD: "已暂停",
    SCHEDULED: "已安排",
    OPEN: "待处理"
  };
  return labels[(status || "").toUpperCase()] || status || "发货状态未知";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum);
}
function customerMessageTimestamp(conversation: Conversation) {
  const customerTime = Date.parse(conversation.customerLastMessageAt);
  return Number.isFinite(customerTime) && customerTime > 0
    ? conversation.customerLastMessageAt
    : conversation.lastMessageAt;
}

function customerMessageTime(conversation: Conversation) {
  return Date.parse(customerMessageTimestamp(conversation)) || 0;
}

type ConversationAttention = "unread" | "pending-reply" | "waiting-customer" | "neutral";

function conversationAttention(conversation: Conversation): ConversationAttention {
  if (conversation.unread) return "unread";
  if (conversation.lastMessageDirection === "customer") return "pending-reply";
  if (conversation.lastMessageDirection === "agent") return "waiting-customer";
  return conversation.status === "open" ? "pending-reply" : "waiting-customer";
}

function conversationNeedsReply(conversation: Conversation) {
  const attention = conversationAttention(conversation);
  return attention === "unread" || attention === "pending-reply";
}

function conversationCountTitle(total: number, pending: number) {
  return `共 ${total} 个会话，${pending} 个待回复`;
}

function conversationAttentionTitle(conversation: Conversation) {
  if (conversation.unread) return "客户有新消息";
  return conversationNeedsReply(conversation) ? "待回复" : "等待客户回复";
}

type WritingSystem = "han" | "japanese" | "korean" | "cyrillic" | "arabic" | "latin";

function dominantWritingSystem(value: string): WritingSystem | "" {
  const counts: Record<WritingSystem, number> = { han: 0, japanese: 0, korean: 0, cyrillic: 0, arabic: 0, latin: 0 };
  for (const character of value.replace(/https?:\/\/\S+|\b\S+@\S+\b/g, " ")) {
    if (/\p{Script=Hiragana}|\p{Script=Katakana}/u.test(character)) counts.japanese += 1;
    else if (/\p{Script=Hangul}/u.test(character)) counts.korean += 1;
    else if (/\p{Script=Han}/u.test(character)) counts.han += 1;
    else if (/\p{Script=Cyrillic}/u.test(character)) counts.cyrillic += 1;
    else if (/\p{Script=Arabic}/u.test(character)) counts.arabic += 1;
    else if (/[A-Za-z]/.test(character)) counts.latin += 1;
  }
  const scores = { ...counts };
  if (scores.japanese >= 2) {
    scores.japanese += scores.han;
    scores.han = 0;
  }
  const ranked = (Object.entries(scores) as Array<[WritingSystem, number]>).sort((left, right) => right[1] - left[1]);
  const total = ranked.reduce((sum, [, count]) => sum + count, 0);
  const [system, count] = ranked[0];
  return count >= 3 && total > 0 && count / total >= 0.6 ? system : "";
}

function routingReasonLabel(reason?: string) {
  switch (reason) {
    case "not_routable": return "非接待会话";
    case "no_assigned_agents": return "店铺未分配客服";
    case "no_eligible_agents": return "暂无符合条件的客服";
    case "agents_disconnected": return "客服连接已断开";
    case "agents_at_capacity": return "客服均已达到上限";
    case "awaiting_assignment": return "等待系统分配";
    default: return "等待接入";
  }
}

function readWorkbenchLayout(): WorkbenchLayout {
  if (typeof window === "undefined") return DEFAULT_WORKBENCH_LAYOUT;
  try {
    const stored = JSON.parse(window.localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY) || "{}") as Partial<WorkbenchLayout>;
    const maximumComposerHeight = Math.max(150, Math.floor(window.innerHeight * 0.4));
    return {
      sessionListWidth: clamp(Number(stored.sessionListWidth) || DEFAULT_WORKBENCH_LAYOUT.sessionListWidth, 260, 420),
      customerPanelWidth: clamp(Number(stored.customerPanelWidth) || DEFAULT_WORKBENCH_LAYOUT.customerPanelWidth, 280, 420),
      composerHeight: clamp(Number(stored.composerHeight) || DEFAULT_WORKBENCH_LAYOUT.composerHeight, 150, maximumComposerHeight)
    };
  } catch {
    return DEFAULT_WORKBENCH_LAYOUT;
  }
}

export function WorkbenchPanel(props: {
  t: T;
  api: PlatformAPI;
  isAdmin: boolean;
  shops: Shop[];
  conversations: Conversation[];
  conversationsHasMore: boolean;
  selectedConversation: Conversation | null;
  messages: Message[];
  messagesHasMore: boolean;
  sourcesByShopId: Record<string, ShopSource[]>;
  currentUser: User;
  eventConnectionStatus: "disconnected" | "connecting" | "connected" | "reconnecting";
  ticketRefreshToken: number;
  onCurrentUserChanged: (user: User) => void;
  onLoadMoreConversations: () => Promise<void>;
  onLoadOlderMessages: () => Promise<void>;
  onSelectConversation: (id: string, conversation?: Conversation) => void;
  onConversationUnavailable: (id: string) => void;
  onMessageCreated: (message: Message) => void;
  onConversationUpdated: (conversation: Conversation) => void;
  onChanged: () => Promise<void>;
  setBusy: (value: boolean) => void;
  setToast: (value: { tone: ToastTone; text: string }) => void;
}) {
  const [reply, setReply] = useState("");
  const [workbenchLayout, setWorkbenchLayout] = useState<WorkbenchLayout>(readWorkbenchLayout);
  const [conversationStatus, setConversationStatus] = useState<"assigned" | "open" | "closed">("assigned");
  const [routingBusy, setRoutingBusy] = useState(false);
  const [presenceBusy, setPresenceBusy] = useState(false);
  const [editingReceptionLimit, setEditingReceptionLimit] = useState(false);
  const [receptionLimitDraft, setReceptionLimitDraft] = useState(String(props.currentUser.receptionLimit || 50));
  const [expandedShopIds, setExpandedShopIds] = useState<Set<string>>(() => new Set());
  const [expandedChannelKeys, setExpandedChannelKeys] = useState<Set<string>>(() => new Set());
  const [conversationSearch, setConversationSearch] = useState("");
  const [conversationShopID, setConversationShopID] = useState("");
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [conversationSummary, setConversationSummary] = useState<ConversationSummary | null>(null);
  const [closedConversationPage, setClosedConversationPage] = useState(1);
  const [closedConversationHasMore, setClosedConversationHasMore] = useState(false);
  const [closedConversationLoading, setClosedConversationLoading] = useState(false);
  const [closedConversationError, setClosedConversationError] = useState("");
  const closedConversationRequestRef = useRef(0);
  const [conversationAction, setConversationAction] = useState<"" | "claim" | "close" | "reopen">("");
  const treeInitialized = useRef(false);
  const [shopifyOrders, setShopifyOrders] = useState<ShopifyOrderSummary[]>([]);
  const [orderLookupBusy, setOrderLookupBusy] = useState(false);
  const [orderLookupError, setOrderLookupError] = useState("");
  const [customerProfile, setCustomerProfile] = useState<ShopifyCustomerProfile | null>(null);
  const [customerLookupBusy, setCustomerLookupBusy] = useState(false);
  const [customerLookupError, setCustomerLookupError] = useState("");
  const [customerLookupSettled, setCustomerLookupSettled] = useState(false);
  const [conversationShopifyContext, setConversationShopifyContext] = useState<ConversationShopifyContext | null>(null);
  const [conversationContextSettled, setConversationContextSettled] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productQuery, setProductQuery] = useState("");
  const [entryProduct, setEntryProduct] = useState<ShopifyProductSummary | null>(null);
  const [products, setProducts] = useState<ShopifyProductSummary[]>([]);
  const [productResultShopID, setProductResultShopID] = useState("");
  const [productSearchBusy, setProductSearchBusy] = useState(false);
  const [productSearchError, setProductSearchError] = useState("");
  const [selectedVariants, setSelectedVariants] = useState<Record<string, string>>({});
  const [pendingProduct, setPendingProduct] = useState<PendingProductDraft | null>(null);
  const [knowledgeSubmitOpen, setKnowledgeSubmitOpen] = useState(false);
  const [knowledgeTitleDraft, setKnowledgeTitleDraft] = useState("");
  const [knowledgeAnswerDraft, setKnowledgeAnswerDraft] = useState("");
  const [knowledgeTagsDraft, setKnowledgeTagsDraft] = useState("");
  const [knowledgeSubmitError, setKnowledgeSubmitError] = useState("");
  const [aiRulesOpen, setAIRulesOpen] = useState(false);
  const [aiRulesDraft, setAIRulesDraft] = useState("");
  const [aiRulesResult, setAIRulesResult] = useState<AIReplyRulesResult | null>(null);
  const [aiRulesLoading, setAIRulesLoading] = useState(false);
  const [aiRulesSaving, setAIRulesSaving] = useState(false);
  const [aiRulesError, setAIRulesError] = useState("");
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  const [pendingImageURL, setPendingImageURL] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [retryingEmailMessageIDs, setRetryingEmailMessageIDs] = useState<Set<string>>(() => new Set());
  const messageSendingRef = useRef(false);
  const messageRequestRef = useRef<{ signature: string; id: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const consoleRef = useRef<HTMLElement>(null);
  const customerPanelRef = useRef<HTMLElement>(null);
  const messageStreamRef = useRef<HTMLDivElement>(null);
  const messageConversationIDRef = useRef("");
  const lastRenderedMessageIDRef = useRef("");
  const followLatestMessageRef = useRef(true);
  const olderMessagesScrollRef = useRef<{ conversationID: string; scrollHeight: number; scrollTop: number } | null>(null);
  const resizeRef = useRef<{ target: WorkbenchResizeTarget; startX: number; startY: number; initialValue: number } | null>(null);
  const composerMinimumHeightRef = useRef(MINIMUM_COMPOSER_HEIGHT);
  const productSearchRef = useRef<HTMLInputElement>(null);
  const activeShopIDRef = useRef("");
  const [aiBusyByConversation, setAIBusyByConversation] = useState<Record<string, AIBusyAction>>({});
  const aiBusyByConversationRef = useRef<Record<string, AIBusyAction>>({});
  const [knowledgeSubmitting, setKnowledgeSubmitting] = useState(false);
  const [recordCategories, setRecordCategories] = useState<RecordCategoryOption[]>([]);
  const recordCategoriesLoadedRef = useRef(false);
  const [recordCategoryError, setRecordCategoryError] = useState("");
  const [recordDraft, setRecordDraft] = useState<ConversationRecordDraft>(emptyConversationRecord);
  const [recordSaveState, setRecordSaveState] = useState<"idle" | "classifying" | "unsaved" | "saving" | "saved" | "error">("idle");
  const [recordSaveError, setRecordSaveError] = useState("");
  const [rightPanelTab, setRightPanelTab] = useState<"customer" | "logistics" | "tickets">("customer");
  const [logisticsStatus, setLogisticsStatus] = useState<LogisticsTrackingStatus | null>(null);
  const logisticsStatusLoadedRef = useRef(false);
  const [logisticsCarrier, setLogisticsCarrier] = useState("");
  const [logisticsTrackingNumber, setLogisticsTrackingNumber] = useState("");
  const [logisticsResult, setLogisticsResult] = useState<LogisticsTrackingResult | null>(null);
  const [logisticsBusy, setLogisticsBusy] = useState(false);
  const [logisticsError, setLogisticsError] = useState("");
  const [logisticsSending, setLogisticsSending] = useState(false);
  const [shippingAddressEditor, setShippingAddressEditor] = useState<{ orderId: string; orderName: string; address: ShopifyShippingAddressInput } | null>(null);
  const [shippingAddressSaving, setShippingAddressSaving] = useState(false);
  const [shippingAddressError, setShippingAddressError] = useState("");
  const [trackingEditor, setTrackingEditor] = useState<TrackingEditorDraft | null>(null);
  const [trackingSaving, setTrackingSaving] = useState(false);
  const [trackingEditError, setTrackingEditError] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [ticketCreateOpen, setTicketCreateOpen] = useState(false);
  const [resolvingTicketID, setResolvingTicketID] = useState("");
  const [pendingTransfers, setPendingTransfers] = useState<TransferRequest[]>([]);
  const [conversationTickets, setConversationTickets] = useState<Ticket[]>([]);
  const recordDraftRef = useRef<ConversationRecordDraft>(emptyConversationRecord);
  const recordRemarkTimerRef = useRef<number | null>(null);
  const recordSaveVersionRef = useRef(0);
  const recordSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const replyTranslationCacheRef = useRef<Map<string, string>>(new Map());
  const replyDraftByConversationRef = useRef<Map<string, string>>(new Map());
  const selectedConversationIDRef = useRef("");
  const logisticsQueryVersionRef = useRef(0);
  const { t } = props;
  const selectedConversationID = props.selectedConversation?.id || "";
  const aiBusy = selectedConversationID ? aiBusyByConversation[selectedConversationID] || "" : "";
  selectedConversationIDRef.current = selectedConversationID;

  function setConversationAIBusy(conversationID: string, action: AIBusyAction) {
    const current = aiBusyByConversationRef.current;
    if ((current[conversationID] || "") === action) return;
    const next = { ...current };
    if (action) next[conversationID] = action;
    else delete next[conversationID];
    aiBusyByConversationRef.current = next;
    setAIBusyByConversation(next);
  }

  function setConversationReply(conversationID: string, value: string | ((current: string) => string)) {
    const current = replyDraftByConversationRef.current.get(conversationID) || "";
    const next = typeof value === "function" ? value(current) : value;
    if (next) replyDraftByConversationRef.current.set(conversationID, next);
    else replyDraftByConversationRef.current.delete(conversationID);
    if (selectedConversationIDRef.current === conversationID) setReply(next);
  }

  useEffect(() => {
    setReceptionLimitDraft(String(props.currentUser.receptionLimit || 50));
  }, [props.currentUser.receptionLimit]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, JSON.stringify(workbenchLayout));
    } catch {
      // Layout persistence is optional; resizing still works when storage is unavailable.
    }
  }, [workbenchLayout]);

  useLayoutEffect(() => {
    const conversationID = props.selectedConversation?.id || "";
    const stream = messageStreamRef.current;
    if (messageConversationIDRef.current !== conversationID) {
      messageConversationIDRef.current = conversationID;
      lastRenderedMessageIDRef.current = "";
      followLatestMessageRef.current = true;
      olderMessagesScrollRef.current = null;
    }
    if (!conversationID || !stream || !props.messages.length) return;

    const olderScroll = olderMessagesScrollRef.current;
    if (olderScroll?.conversationID === conversationID) {
      stream.scrollTop = olderScroll.scrollTop + stream.scrollHeight - olderScroll.scrollHeight;
      olderMessagesScrollRef.current = null;
    } else {
      const latestMessageID = props.messages[props.messages.length - 1]?.id || "";
      if (!lastRenderedMessageIDRef.current || (latestMessageID !== lastRenderedMessageIDRef.current && followLatestMessageRef.current)) {
        stream.scrollTop = stream.scrollHeight;
      }
    }
    lastRenderedMessageIDRef.current = props.messages[props.messages.length - 1]?.id || "";
  }, [props.messages, props.selectedConversation?.id]);

  useEffect(() => {
    const stream = messageStreamRef.current;
    if (!stream || !props.selectedConversation?.id) return;
    const observer = new ResizeObserver(() => {
      if (followLatestMessageRef.current) stream.scrollTop = stream.scrollHeight;
    });
    observer.observe(stream);
    return () => observer.disconnect();
  }, [props.selectedConversation?.id]);

  useEffect(() => {
    const clampLayoutToWorkbench = () => {
      const bounds = consoleRef.current?.getBoundingClientRect();
      const minimumComposerHeight = composerMinimumHeightRef.current;
      const maximumComposerHeight = Math.max(minimumComposerHeight, Math.floor((bounds?.height || window.innerHeight) * 0.4));
      const horizontalBudget = Math.max(540, Math.floor(bounds?.width || window.innerWidth) - MINIMUM_CHAT_PANE_WIDTH);
      setWorkbenchLayout((current) => {
        let sessionListWidth = clamp(current.sessionListWidth, 260, 420);
        let customerPanelWidth = clamp(current.customerPanelWidth, 280, 420);
        let excess = Math.max(0, sessionListWidth + customerPanelWidth - horizontalBudget);
        const customerReduction = Math.min(excess, customerPanelWidth - 280);
        customerPanelWidth -= customerReduction;
        excess -= customerReduction;
        sessionListWidth -= Math.min(excess, sessionListWidth - 260);
        const composerHeight = clamp(current.composerHeight, minimumComposerHeight, maximumComposerHeight);
        return { sessionListWidth, customerPanelWidth, composerHeight };
      });
    };
    clampLayoutToWorkbench();
    const observer = new ResizeObserver(clampLayoutToWorkbench);
    if (consoleRef.current) observer.observe(consoleRef.current);
    return () => observer.disconnect();
  }, []);

  const sourceById = useMemo(() => new Map(Object.values(props.sourcesByShopId).flat().map((source) => [source.id, source])), [props.sourcesByShopId]);
  const sourceChannel = useCallback((sourceId: string): "chat" | "email" => sourceById.get(sourceId)?.type === "email" ? "email" : "chat", [sourceById]);
  const normalizedConversationSearch = conversationSearch.trim().toLowerCase();
  const conversationMatchesFilters = (conversation: Conversation) => {
    if (conversationShopID && conversation.shopId !== conversationShopID) return false;
    if (!normalizedConversationSearch) return true;
    return [conversation.customerName, conversation.customerEmail, conversation.subject]
      .filter(Boolean)
      .some((value) => (value || "").toLowerCase().includes(normalizedConversationSearch));
  };
  const visibleConversations = props.conversations
    .filter((conversation) => conversation.status !== "closed" && conversation.status === conversationStatus)
    .filter(conversationMatchesFilters)
    .sort((left, right) => customerMessageTime(right) - customerMessageTime(left));
  const loadedOpenCount = props.conversations.filter((conversation) => conversation.status === "open" && conversationMatchesFilters(conversation)).length;
  const loadedAssignedCount = props.conversations.filter((conversation) => conversation.status === "assigned" && conversationMatchesFilters(conversation)).length;
  const loadedClosedCount = props.conversations.filter((conversation) => conversation.status === "closed").length;
  const openCount = conversationSummary?.open ?? loadedOpenCount;
  const assignedCount = conversationSummary?.assigned ?? loadedAssignedCount;
  const closedCount = conversationSummary?.closed ?? loadedClosedCount;
  const activeLoad = conversationSummary?.activeLoad ?? props.conversations.filter((conversation) => conversation.status === "assigned").length;
  const receptionCapacity = conversationSummary?.capacity || props.currentUser.receptionLimit || 50;
  const conversationRefreshSignature = useMemo(() => {
    let latest = 0;
    let assigned = 0;
    let open = 0;
    let closed = 0;
    props.conversations.forEach((conversation) => {
      if (conversation.status === "assigned") assigned += 1;
      else if (conversation.status === "open") open += 1;
      else if (conversation.status === "closed") closed += 1;
      latest = Math.max(latest, Date.parse(conversation.updatedAt || conversation.closedAt || conversation.lastMessageAt) || 0);
    });
    return `${props.conversations.length}:${assigned}:${open}:${closed}:${latest}`;
  }, [props.conversations]);
  const conversationScope = props.currentUser.conversationScope === "all" ? "all" : "assigned";

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void props.api.getConversationSummary({
        scope: conversationScope,
        shopId: conversationShopID || undefined,
        search: conversationSearch.trim() || undefined
      }).then((result) => {
        if (!cancelled) setConversationSummary(result);
      }).catch(() => {
        if (!cancelled) setConversationSummary(null);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [props.api, conversationScope, conversationShopID, conversationSearch, conversationRefreshSignature]);

  useEffect(() => {
    if (conversationStatus !== "closed") return;
    const requestID = ++closedConversationRequestRef.current;
    const timer = window.setTimeout(() => {
      setClosedConversationLoading(true);
      setClosedConversationError("");
      void props.api.listConversationPage({
        status: "closed",
        scope: conversationScope,
        shopId: conversationShopID || undefined,
        search: conversationSearch.trim() || undefined,
        page: 1,
        pageSize: closedConversationPageSize
      }).then((result) => {
        if (closedConversationRequestRef.current !== requestID) return;
        setArchivedConversations(result.items);
        setClosedConversationPage(1);
        setClosedConversationHasMore(result.page < result.totalPages);
      }).catch((error) => {
        if (closedConversationRequestRef.current !== requestID) return;
        setArchivedConversations([]);
        setClosedConversationHasMore(false);
        setClosedConversationError(errorText(error));
      }).finally(() => {
        if (closedConversationRequestRef.current === requestID) setClosedConversationLoading(false);
      });
    }, 240);
    return () => window.clearTimeout(timer);
  }, [props.api, conversationStatus, conversationScope, conversationShopID, conversationSearch, conversationRefreshSignature]);

  async function loadMoreClosedConversations() {
    if (closedConversationLoading || !closedConversationHasMore) return;
    const requestID = ++closedConversationRequestRef.current;
    const nextPage = closedConversationPage + 1;
    setClosedConversationLoading(true);
    setClosedConversationError("");
    try {
      const result = await props.api.listConversationPage({
        status: "closed",
        scope: conversationScope,
        shopId: conversationShopID || undefined,
        search: conversationSearch.trim() || undefined,
        page: nextPage,
        pageSize: closedConversationPageSize
      });
      if (closedConversationRequestRef.current !== requestID) return;
      setArchivedConversations((current) => {
        const byID = new Map(current.map((conversation) => [conversation.id, conversation]));
        result.items.forEach((conversation) => byID.set(conversation.id, conversation));
        return Array.from(byID.values());
      });
      setClosedConversationPage(nextPage);
      setClosedConversationHasMore(result.page < result.totalPages);
    } catch (error) {
      if (closedConversationRequestRef.current === requestID) setClosedConversationError(errorText(error));
    } finally {
      if (closedConversationRequestRef.current === requestID) setClosedConversationLoading(false);
    }
  }
  const selectedSource = props.selectedConversation ? sourceById.get(props.selectedConversation.sourceId) || null : null;
  const conversationSourceLabel = selectedSource ? sourceLabel(selectedSource.type) : t.unknownSource;
  const latestCustomerReplyDraft = props.selectedConversation
    ? [...props.messages].reverse().find((message) => message.conversationId === props.selectedConversation?.id && message.direction === "customer" && message.type === "text")
    : undefined;
  const logisticsAutoDraftReady = latestCustomerReplyDraft?.metadata?.aiReplyKind === "logistics"
    && latestCustomerReplyDraft.metadata.aiReplyStatus === "completed"
    && latestCustomerReplyDraft.metadata.aiReplyPolicyVersion === CURRENT_AI_REPLY_POLICY_VERSION
    && Boolean(latestCustomerReplyDraft.metadata.aiReplyText?.trim());
  const latestEmailNoReplyWarning = latestCustomerReplyDraft?.metadata?.email_no_reply_warning === "true";
  const composerNoticeCount = Number(latestEmailNoReplyWarning) + Number(logisticsAutoDraftReady);
  const composerMinimumHeight = MINIMUM_COMPOSER_HEIGHT + composerNoticeCount * COMPOSER_NOTICE_HEIGHT;
  composerMinimumHeightRef.current = composerMinimumHeight;
  useEffect(() => {
    const workbenchHeight = consoleRef.current?.getBoundingClientRect().height || window.innerHeight;
    const maximumComposerHeight = Math.max(composerMinimumHeight, Math.floor(workbenchHeight * 0.4));
    setWorkbenchLayout((current) => {
      const composerHeight = clamp(current.composerHeight, composerMinimumHeight, maximumComposerHeight);
      return composerHeight === current.composerHeight ? current : { ...current, composerHeight };
    });
  }, [composerMinimumHeight]);
  const selectedConversationShop = props.shops.find((shop) => shop.id === props.selectedConversation?.shopId) || null;
  const activeShop = selectedConversationShop;
  const selectedConversationShopID = props.selectedConversation?.shopId || "";
  const conversationShopName = selectedConversationShop?.displayName || conversationShopifyContext?.shopName || "";
  useEffect(() => {
    setAIRulesOpen(false);
    setAIRulesError("");
  }, [activeShop?.id]);
  activeShopIDRef.current = activeShop?.id || "";
  const totalActive = visibleConversations.length;
  const totalPending = visibleConversations.filter(conversationNeedsReply).length;
  const conversationFilterActive = Boolean(conversationShopID || normalizedConversationSearch);
  const storeRows = props.shops.filter((shop) => !conversationShopID || shop.id === conversationShopID).map((shop) => {
    const rows = visibleConversations.filter((conversation) => conversation.shopId === shop.id);
    const active = rows.length;
    const pending = rows.filter(conversationNeedsReply).length;
    const chatRows = rows.filter((conversation) => sourceChannel(conversation.sourceId) === "chat");
    const emailRows = rows.filter((conversation) => sourceChannel(conversation.sourceId) === "email");
    const chatActive = chatRows.length;
    const emailActive = emailRows.length;
    const chatPending = chatRows.filter(conversationNeedsReply).length;
    const emailPending = emailRows.filter(conversationNeedsReply).length;
    const lastMessageAt = rows.reduce((latest, conversation) => Math.max(latest, customerMessageTime(conversation)), 0);
    return { shop, rows, active, pending, chatActive, emailActive, chatPending, emailPending, lastMessageAt };
  }).filter(({ rows }) => !normalizedConversationSearch || rows.length > 0)
    .sort((left, right) => right.pending - left.pending || right.lastMessageAt - left.lastMessageAt || left.shop.displayName.localeCompare(right.shop.displayName));
  const expandableShopIds = storeRows.filter(({ rows }) => rows.length > 0).map(({ shop }) => shop.id);
  const expandableChannelKeys = storeRows.flatMap(({ shop, rows }) => (["chat", "email"] as const)
    .filter((channel) => rows.some((conversation) => sourceChannel(conversation.sourceId) === channel))
    .map((channel) => `${shop.id}:${channel}`));
  const allStoresExpanded = expandableShopIds.length > 0
    && expandableShopIds.every((shopId) => expandedShopIds.has(shopId))
    && expandableChannelKeys.every((key) => expandedChannelKeys.has(key));
  const ownedByCurrentUser = props.selectedConversation?.assignedAgentId === props.currentUser.id;
  const assignedToOther = props.selectedConversation?.status === "assigned" && !ownedByCurrentUser;
  const canClaim = hasPermission(props.currentUser, PERMISSIONS.conversationClaim);
  const canTransfer = hasPermission(props.currentUser, PERMISSIONS.conversationTransfer);
  const canManageTickets = hasPermission(props.currentUser, PERMISSIONS.ticketsManage);
  const canSubmitKnowledge = true;
  const canReviewKnowledge = hasPermission(props.currentUser, PERMISSIONS.knowledgeReview);
  const canClose = hasPermission(props.currentUser, PERMISSIONS.conversationClose) && props.selectedConversation?.status === "assigned" && ownedByCurrentUser;
  const canReply = hasPermission(props.currentUser, PERMISSIONS.conversationReply) && props.selectedConversation?.status === "assigned" && ownedByCurrentUser && props.selectedConversation.replyAllowed !== false;
  const canReopen = props.selectedConversation?.status === "closed"
    && hasPermission(props.currentUser, PERMISSIONS.conversationClose)
    && (!props.selectedConversation.assignedAgentId || ownedByCurrentUser);
  const customerWritingSystem = useMemo(() => {
    const latestCustomerMessage = [...props.messages].reverse().find((message) =>
      message.direction === "customer"
      && (message.type || "text") === "text"
      && message.metadata?.displayQuotedHistory !== "true"
      && message.body.trim() !== ""
    );
    return latestCustomerMessage ? dominantWritingSystem(latestCustomerMessage.body) : "";
  }, [props.messages]);
  const replyWritingSystem = useMemo(() => dominantWritingSystem(reply), [reply]);
  const replyLanguageMismatch = Boolean(
    reply.trim()
    && customerWritingSystem
    && replyWritingSystem
    && customerWritingSystem !== replyWritingSystem
  );
  const entryContext = useMemo(() => {
    const message = props.messages.find((item) => item.direction === "customer" && (item.metadata?.entryProductHandle || item.metadata?.entryPageUrl || item.metadata?.entryPageTitle));
    return {
      messageId: message?.id || "",
      handle: message?.metadata?.entryProductHandle || "",
      pageUrl: message?.metadata?.entryPageUrl || "",
      pageTitle: message?.metadata?.entryPageTitle || "",
      productTitle: message?.metadata?.entryProductTitle || "",
      productImageUrl: message?.metadata?.entryProductImageUrl || "",
      productPrice: message?.metadata?.entryProductPrice || "",
      productCurrencyCode: message?.metadata?.entryProductCurrencyCode || ""
    };
  }, [props.messages]);
  const selectedPendingTransfer = pendingTransfers.find((item) => item.conversationId === props.selectedConversation?.id) || null;
  const recordPrimaryOptions = Array.from(new Set([...recordCategories.map((item) => item.primary), recordDraft.primary].filter(Boolean)));
  const recordSecondaryOptions = Array.from(new Set([...recordCategories.map((item) => item.secondary), recordDraft.secondary].filter(Boolean)));
  const recordTertiaryOptions = Array.from(new Set([...recordCategories.flatMap((item) => item.tertiary), recordDraft.tertiary].filter(Boolean)));
  const workbenchStyle = {
    "--session-list-width": `${workbenchLayout.sessionListWidth}px`,
    "--customer-panel-width": `${workbenchLayout.customerPanelWidth}px`,
    "--composer-height": `${workbenchLayout.composerHeight}px`
  } as CSSProperties;

  function composerMaximumHeight() {
    const workbenchHeight = consoleRef.current?.getBoundingClientRect().height || (typeof window === "undefined" ? 900 : window.innerHeight);
    return Math.max(composerMinimumHeightRef.current, Math.floor(workbenchHeight * 0.4));
  }

  function maximumPanelWidth(target: "session-list" | "customer-panel", current = workbenchLayout) {
    const workbenchWidth = consoleRef.current?.getBoundingClientRect().width || (typeof window === "undefined" ? 1376 : window.innerWidth - 64);
    const oppositeWidth = target === "session-list" ? current.customerPanelWidth : current.sessionListWidth;
    const minimum = target === "session-list" ? 260 : 280;
    return clamp(Math.floor(workbenchWidth - oppositeWidth - MINIMUM_CHAT_PANE_WIDTH), minimum, 420);
  }

  function setResizeValue(target: WorkbenchResizeTarget, value: number) {
    setWorkbenchLayout((current) => {
      if (target === "session-list") return { ...current, sessionListWidth: clamp(value, 260, maximumPanelWidth("session-list", current)) };
      if (target === "customer-panel") return { ...current, customerPanelWidth: clamp(value, 280, maximumPanelWidth("customer-panel", current)) };
      return { ...current, composerHeight: clamp(value, composerMinimumHeightRef.current, composerMaximumHeight()) };
    });
  }

  function startResize(target: WorkbenchResizeTarget, event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const initialValue = target === "session-list"
      ? workbenchLayout.sessionListWidth
      : target === "customer-panel"
        ? workbenchLayout.customerPanelWidth
        : workbenchLayout.composerHeight;
    resizeRef.current = { target, startX: event.clientX, startY: event.clientY, initialValue };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function continueResize(event: ReactPointerEvent<HTMLDivElement>) {
    const resize = resizeRef.current;
    if (!resize) return;
    const nextValue = resize.target === "session-list"
      ? resize.initialValue + event.clientX - resize.startX
      : resize.target === "customer-panel"
        ? resize.initialValue - (event.clientX - resize.startX)
        : resize.initialValue - (event.clientY - resize.startY);
    setResizeValue(resize.target, nextValue);
  }

  function stopResize() {
    resizeRef.current = null;
  }

  function resetResize(target: WorkbenchResizeTarget) {
    setResizeValue(target, target === "session-list"
      ? DEFAULT_WORKBENCH_LAYOUT.sessionListWidth
      : target === "customer-panel"
        ? DEFAULT_WORKBENCH_LAYOUT.customerPanelWidth
        : DEFAULT_WORKBENCH_LAYOUT.composerHeight);
  }

  function handleMessageStreamScroll(event: ReactUIEvent<HTMLDivElement>) {
    const stream = event.currentTarget;
    const distanceFromBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight;
    followLatestMessageRef.current = distanceFromBottom <= MESSAGE_BOTTOM_THRESHOLD;
  }

  function keepMessageStreamAtBottom() {
    const stream = messageStreamRef.current;
    if (!stream || !followLatestMessageRef.current) return;
    window.requestAnimationFrame(() => {
      if (messageStreamRef.current === stream && followLatestMessageRef.current) {
        stream.scrollTop = stream.scrollHeight;
      }
    });
  }

  async function loadOlderMessages() {
    const stream = messageStreamRef.current;
    const conversationID = props.selectedConversation?.id || "";
    if (stream && conversationID) {
      olderMessagesScrollRef.current = {
        conversationID,
        scrollHeight: stream.scrollHeight,
        scrollTop: stream.scrollTop
      };
      followLatestMessageRef.current = false;
    }
    const snapshot = olderMessagesScrollRef.current;
    try {
      await props.onLoadOlderMessages();
    } finally {
      window.requestAnimationFrame(() => {
        if (olderMessagesScrollRef.current === snapshot) olderMessagesScrollRef.current = null;
      });
    }
  }

  function resizeWithKeyboard(target: WorkbenchResizeTarget, event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 24 : 8;
    let delta = 0;
    if (target === "session-list") delta = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
    if (target === "customer-panel") delta = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
    if (target === "composer") delta = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
    if (!delta) return;
    event.preventDefault();
    setResizeValue(target, target === "session-list"
      ? workbenchLayout.sessionListWidth + delta
      : target === "customer-panel"
        ? workbenchLayout.customerPanelWidth + delta
        : workbenchLayout.composerHeight + delta);
  }

  function toggleAllStores() {
    if (allStoresExpanded) {
      setExpandedShopIds(new Set());
      setExpandedChannelKeys(new Set());
      return;
    }
    setExpandedShopIds(new Set(expandableShopIds));
    setExpandedChannelKeys(new Set(expandableChannelKeys));
  }

  function toggleShop(shopId: string) {
    const isExpanded = expandedShopIds.has(shopId);
    const shopChannelKeys = expandableChannelKeys.filter((key) => key.startsWith(`${shopId}:`));
    setExpandedShopIds((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(shopId);
      else next.add(shopId);
      return next;
    });
    setExpandedChannelKeys((current) => {
      const next = new Set(current);
      shopChannelKeys.forEach((key) => isExpanded ? next.delete(key) : next.add(key));
      return next;
    });
  }

  function toggleChannel(shopId: string, channel: "chat" | "email") {
    const key = `${shopId}:${channel}`;
    setExpandedShopIds((current) => new Set(current).add(shopId));
    setExpandedChannelKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  useEffect(() => {
    if (treeInitialized.current || !props.conversations.length) return;
    treeInitialized.current = true;
    setExpandedShopIds(new Set(expandableShopIds));
    setExpandedChannelKeys(new Set(expandableChannelKeys));
  }, [expandableChannelKeys, expandableShopIds, props.conversations.length]);

  useEffect(() => {
    if (!props.selectedConversation) return;
    const shopId = props.selectedConversation.shopId;
    const key = `${shopId}:${sourceChannel(props.selectedConversation.sourceId)}`;
    setExpandedShopIds((current) => new Set(current).add(shopId));
    setExpandedChannelKeys((current) => new Set(current).add(key));
  }, [props.selectedConversation?.id, props.selectedConversation?.shopId, props.selectedConversation?.sourceId, sourceChannel]);

  useEffect(() => {
    setReply(replyDraftByConversationRef.current.get(props.selectedConversation?.id || "") || "");
    replyTranslationCacheRef.current.clear();
    setShopifyOrders([]);
    setOrderLookupBusy(false);
    setOrderLookupError("");
    setCustomerProfile(null);
    setCustomerLookupBusy(false);
    setCustomerLookupError("");
    setCustomerLookupSettled(false);
    setConversationShopifyContext(null);
    setConversationContextSettled(false);
    setPendingImage(null);
    setProductPickerOpen(false);
    setProductQuery("");
    setEntryProduct(null);
    setProducts([]);
    setSelectedVariants({});
    setProductResultShopID("");
    setProductSearchBusy(false);
    setProductSearchError("");
    setPendingProduct(null);
    setLogisticsCarrier("");
    setLogisticsTrackingNumber("");
    setLogisticsResult(null);
    setLogisticsError("");
    setLogisticsSending(false);
    logisticsQueryVersionRef.current += 1;
  }, [props.selectedConversation?.id]);

  useEffect(() => {
    if (!props.selectedConversation?.id || recordCategoriesLoadedRef.current) return;
    let cancelled = false;
    recordCategoriesLoadedRef.current = true;
    setRecordCategoryError("");
    void props.api.listRecordCategories()
      .then((categories) => {
        if (!cancelled) setRecordCategories(categories);
      })
      .catch((error) => {
        if (!cancelled) {
          recordCategoriesLoadedRef.current = false;
          setRecordCategoryError(`加载消息分类失败：${errorText(error)}`);
        }
      });
    return () => { cancelled = true; };
  }, [props.api, Boolean(props.selectedConversation?.id)]);

  useEffect(() => {
    if (recordRemarkTimerRef.current !== null) {
      window.clearTimeout(recordRemarkTimerRef.current);
      recordRemarkTimerRef.current = null;
    }
    recordSaveVersionRef.current += 1;
    setRecordSaveError("");
    const conversation = props.selectedConversation;
    if (!conversation) {
      recordDraftRef.current = emptyConversationRecord;
      setRecordDraft(emptyConversationRecord);
      setRecordSaveState("idle");
      return;
    }
    const initial = conversationRecordFromConversation(conversation);
    recordDraftRef.current = initial;
    setRecordDraft(initial);
    const needsAutomaticRecord = !conversation.recordClassified;
    if (!needsAutomaticRecord) {
      setRecordSaveState("saved");
      return;
    }
    let cancelled = false;
    const automaticVersion = recordSaveVersionRef.current;
    setRecordSaveState("classifying");
    void props.api.autoClassifyConversation(conversation.id)
      .then(async (updated) => {
        if (cancelled || props.selectedConversation?.id !== updated.id || automaticVersion !== recordSaveVersionRef.current) return;
        const next = conversationRecordFromConversation(updated);
        recordDraftRef.current = next;
        setRecordDraft(next);
        if (updated.recordRemarkError) {
          setRecordSaveError(updated.recordRemarkError);
          setRecordSaveState("error");
        } else if (updated.recordAutoFilled && !next.remark) {
          setRecordSaveError("AI 备注暂未生成，重新进入会话时会自动重试");
          setRecordSaveState("error");
        } else {
          setRecordSaveState("saved");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setRecordSaveError(`自动分类失败：${errorText(error)}`);
        setRecordSaveState("error");
      });
    return () => { cancelled = true; };
  }, [
    props.selectedConversation?.id,
    props.selectedConversation?.recordClassified,
    props.selectedConversation?.recordAutoFilled,
    props.selectedConversation?.recordRemark,
  ]);

  useEffect(() => () => {
    if (recordRemarkTimerRef.current !== null) window.clearTimeout(recordRemarkTimerRef.current);
  }, []);

  useEffect(() => {
    replyTranslationCacheRef.current.clear();
  }, [props.selectedConversation?.id]);

  useEffect(() => {
    const conversationID = props.selectedConversation?.id;
    if (!conversationID || !canReply) return;
    const latestCustomer = [...props.messages].reverse().find((message) => message.conversationId === conversationID && message.direction === "customer" && message.type === "text");
    const text = latestCustomer?.metadata?.aiReplyText?.trim() || "";
    const textZh = latestCustomer?.metadata?.aiReplyTextZh?.trim() || "";
    const currentPolicyDraft = latestCustomer?.metadata?.aiReplyStatus === "completed"
      && latestCustomer.metadata.aiReplyPolicyVersion === CURRENT_AI_REPLY_POLICY_VERSION;
    if (!currentPolicyDraft) {
      if (text) setConversationReply(conversationID, (current) => current.trim() === text ? "" : current);
      return;
    }
    if (!text) return;
    if (textZh) {
      replyTranslationCacheRef.current.set(`${conversationID}\u0000translate_zh\u0000${text}`, textZh);
      replyTranslationCacheRef.current.set(`${conversationID}\u0000translate\u0000${textZh}`, text);
    }
    setConversationReply(conversationID, (current) => current.trim() ? current : text);
  }, [canReply, props.messages, props.selectedConversation?.id]);

  useEffect(() => {
    if (!pendingImage) {
      setPendingImageURL("");
      return;
    }
    const url = URL.createObjectURL(pendingImage);
    setPendingImageURL(url);
    return () => URL.revokeObjectURL(url);
  }, [pendingImage]);

  useEffect(() => {
    if (!productPickerOpen) return;
    const timer = window.setTimeout(() => productSearchRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProductPickerOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [productPickerOpen]);

  const refreshTransfers = useCallback(async () => {
    setPendingTransfers(await props.api.listTransfers("pending"));
  }, [props.api]);

  const refreshConversationTickets = useCallback(async () => {
    setConversationTickets(props.selectedConversation
      ? await props.api.listTickets({ conversationId: props.selectedConversation.id })
      : []);
  }, [props.api, props.selectedConversation?.id]);

  const refreshWorkflowData = useCallback(async () => {
    await Promise.all([refreshTransfers(), refreshConversationTickets()]);
  }, [refreshConversationTickets, refreshTransfers]);

  async function resolveConversationTicket(ticket: Ticket) {
    if (ticket.assignedAgentId !== props.currentUser.id || (ticket.status !== "in_progress" && ticket.status !== "pending")) return;
    setResolvingTicketID(ticket.id);
    try {
      const updated = await props.api.runTicketAction(ticket.id, "complete");
      setConversationTickets((current) => current.map((item) => item.id === updated.id ? updated : item));
      props.setToast({ tone: "success", text: updated.status === "pending_review" ? "工单已提交，等待创建人验收" : "工单已完成，会话仍可继续处理" });
    } catch (error) {
      props.setToast({ tone: "error", text: `解决工单失败：${errorText(error)}` });
    } finally {
      setResolvingTicketID("");
    }
  }

  useEffect(() => {
    if (!props.selectedConversation?.id) return;
    let cancelled = false;
    void refreshTransfers().catch((error) => {
      if (!cancelled) props.setToast({ tone: "error", text: `读取转接状态失败：${errorText(error)}` });
    });
    return () => { cancelled = true; };
  }, [refreshTransfers, Boolean(props.selectedConversation?.id)]);

  useEffect(() => {
    let cancelled = false;
    void refreshConversationTickets().catch((error) => {
      if (!cancelled) props.setToast({ tone: "error", text: `读取工单状态失败：${errorText(error)}` });
    });
    return () => { cancelled = true; };
  }, [refreshConversationTickets, props.ticketRefreshToken]);

  useEffect(() => {
    setRightPanelTab("customer");
    setTransferOpen(false);
    setTicketCreateOpen(false);
    setShippingAddressEditor(null);
    setTrackingEditor(null);
    setShippingAddressError("");
    setTrackingEditError("");
  }, [props.selectedConversation?.id]);

  useEffect(() => {
    customerPanelRef.current?.scrollTo({ top: 0 });
  }, [rightPanelTab]);

  useEffect(() => {
    if (!props.selectedConversation?.id || rightPanelTab !== "logistics" || logisticsStatusLoadedRef.current) return;
    let cancelled = false;
    logisticsStatusLoadedRef.current = true;
    void props.api.getLogisticsStatus()
      .then((status) => {
        if (!cancelled) setLogisticsStatus(status);
      })
      .catch((error) => {
        if (!cancelled) {
          logisticsStatusLoadedRef.current = false;
          setLogisticsStatus({ configured: false, message: `物流查询状态读取失败：${errorText(error)}` });
        }
      });
    return () => { cancelled = true; };
  }, [props.api, Boolean(props.selectedConversation?.id), rightPanelTab]);

  useEffect(() => {
    const conversationID = props.selectedConversation?.id || "";
    if (!conversationID) {
      setConversationContextSettled(true);
      return;
    }
    let cancelled = false;
    setConversationContextSettled(false);
    void props.api.getConversationShopifyContext(conversationID)
      .then((context) => {
        if (!cancelled) setConversationShopifyContext(context);
      })
      .catch(() => {
        if (!cancelled) setConversationShopifyContext(null);
      })
      .finally(() => {
        if (!cancelled) setConversationContextSettled(true);
      });
    return () => { cancelled = true; };
  }, [props.api, props.selectedConversation?.id]);

  useEffect(() => {
    if (!customerLookupSettled) return;
    const explicitOrder = explicitConversationOrderNumber(props.selectedConversation);
    const profileOrderCandidate = customerLastOrderSummary(customerProfile);
    const profileOrder = verifiedConversationOrders(profileOrderCandidate ? [profileOrderCandidate] : [], props.selectedConversation)[0];
    const profileOrderName = profileOrder?.name?.replace(/\s+/g, "") || "";
    if (profileOrder && (!explicitOrder || explicitOrder.toLowerCase() === profileOrderName.toLowerCase())) {
      setShopifyOrders([]);
      setOrderLookupError("");
      setOrderLookupBusy(false);
      return;
    }
    const queries = conversationOrderQueries(props.selectedConversation);
    if (!selectedConversationShopID || !props.selectedConversation || !queries.length) return;
    let cancelled = false;
    setOrderLookupBusy(true);
    setOrderLookupError("");
    void (async () => {
      let firstError = "";
      for (const query of queries) {
        try {
          const result = await props.api.searchShopifyOrders(selectedConversationShopID, query);
          if (cancelled) return;
          const verifiedOrders = verifiedConversationOrders(result.orders || [], props.selectedConversation);
          if (verifiedOrders.length) {
            setShopifyOrders(verifiedOrders);
            return;
          }
        } catch (error) {
          if (!firstError) firstError = errorText(error);
        }
      }
      if (!cancelled) {
        setShopifyOrders([]);
        if (firstError) setOrderLookupError(`Shopify 当前状态更新失败，已保留会话订单信息：${firstError}`);
      }
    })().finally(() => {
      if (!cancelled) setOrderLookupBusy(false);
    });
    return () => { cancelled = true; };
  }, [selectedConversationShopID, customerLookupSettled, customerProfile?.lastOrder, props.api, props.selectedConversation?.id, props.selectedConversation?.customerEmail, props.selectedConversation?.customerName, props.selectedConversation?.subject, props.selectedConversation?.recordOrderNumber]);

  useEffect(() => {
    if (!conversationContextSettled) return;
    const email = props.selectedConversation?.customerEmail?.trim();
    if (!selectedConversationShopID || !email) {
      setCustomerLookupSettled(true);
      return;
    }
    let cancelled = false;
    setCustomerLookupSettled(false);
    setCustomerLookupBusy(true);
    setCustomerLookupError("");
    void props.api.searchShopifyCustomer(selectedConversationShopID, email)
      .then((result) => {
        if (cancelled) return;
        setCustomerProfile(result.customer || null);
        if (!result.customer) setCustomerLookupError("Shopify 中未找到匹配客户");
      })
      .catch((error) => {
        if (!cancelled) setCustomerLookupError(`Shopify 当前客户状态更新失败：${errorText(error)}`);
      })
      .finally(() => {
        if (!cancelled) {
          setCustomerLookupBusy(false);
          setCustomerLookupSettled(true);
        }
      });
    return () => { cancelled = true; };
  }, [conversationContextSettled, selectedConversationShopID, props.api, props.selectedConversation?.id, props.selectedConversation?.customerEmail, props.selectedConversation?.customerName]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (messageSendingRef.current || !props.selectedConversation || (!reply.trim() && !pendingImage && !pendingProduct) || !canReply) return;
    if (replyLanguageMismatch) {
      props.setToast({ tone: "error", text: "回复语言与客户语言不一致，请先翻译" });
      return;
    }
    const conversationID = props.selectedConversation.id;
    const replyBody = reply.trim();
    const imageDraft = pendingImage;
    const productDraft = pendingProduct;
    const requestSignature = JSON.stringify([
      conversationID,
      replyBody,
      imageDraft ? [imageDraft.name, imageDraft.size, imageDraft.lastModified, imageDraft.type] : null,
      productDraft ? [productDraft.product.id, productDraft.variant.id] : null
    ]);
    if (messageRequestRef.current?.signature !== requestSignature) {
      messageRequestRef.current = { signature: requestSignature, id: createClientRequestID() };
    }
    const clientRequestID = messageRequestRef.current.id;
    messageSendingRef.current = true;
    setMessageSending(true);
    let backgroundQueued = false;
    try {
      if (imageDraft) {
        const message = await props.api.addImageMessage(conversationID, imageDraft, productDraft ? "" : replyBody, `${clientRequestID}_image`);
        props.onMessageCreated(message);
        backgroundQueued ||= message.metadata?.email_send_status === "queued";
        setPendingImage(null);
      }
      if (productDraft) {
        const productFallbackBody = [productDraft.product.title, productDraft.variant.title !== "Default Title" ? productDraft.variant.title : ""].filter(Boolean).join(" - ");
        const message = await props.api.addMessage(conversationID, {
          direction: "agent",
          type: "product",
          body: replyBody || productFallbackBody,
          metadata: { ...productMessageMetadata(productDraft.product, productDraft.variant), client_request_id: `${clientRequestID}_product` }
        });
        props.onMessageCreated(message);
        backgroundQueued ||= message.metadata?.email_send_status === "queued";
        setPendingProduct(null);
      }
      if (replyBody && !imageDraft && !productDraft) {
        const message = await props.api.addMessage(conversationID, { direction: "agent", type: "text", body: replyBody, metadata: { client_request_id: `${clientRequestID}_text` } });
        props.onMessageCreated(message);
        backgroundQueued ||= message.metadata?.email_send_status === "queued";
      }
      if (messageRequestRef.current?.id === clientRequestID) messageRequestRef.current = null;
      setConversationReply(conversationID, "");
      replyTranslationCacheRef.current.clear();
      props.setToast({ tone: "success", text: backgroundQueued ? "已加入后台发送队列，可继续处理其他消息" : t.messageRecorded });
    } catch (error) {
      props.setToast({ tone: "error", text: `发送失败：${errorText(error)}` });
    } finally {
      messageSendingRef.current = false;
      setMessageSending(false);
    }
  }

  function chooseImage(file?: File) {
    if (!file) return;
    if (!/^image\/(jpeg|png|gif|webp)$/i.test(file.type)) {
      props.setToast({ tone: "error", text: "添加图片失败：仅支持 JPEG、PNG、GIF 和 WebP" });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      props.setToast({ tone: "error", text: "添加图片失败：图片不能超过 8 MB" });
      return;
    }
    setPendingImage(file);
  }

  async function searchProducts(event: FormEvent) {
    event.preventDefault();
    await runProductSearch(productQuery.trim());
  }

  async function runProductSearch(query: string) {
    if (!activeShop) return;
    const shopID = activeShop.id;
    setProductSearchBusy(true);
    setProductSearchError("");
    try {
      const result = await props.api.searchShopifyProducts(shopID, query);
      if (activeShopIDRef.current !== shopID) return;
      const nextProducts = (result.products || []).filter((product) => product.id !== entryProduct?.id && product.handle !== entryContext.handle);
      setProducts(nextProducts);
      setProductResultShopID(shopID);
      setSelectedVariants((current) => ({
        ...Object.fromEntries(nextProducts.map((product) => [product.id, product.variants[0]?.id || ""])),
        ...current
      }));
      if (!result.products?.length) setProductSearchError("未找到匹配商品，请更换关键词");
    } catch (error) {
      if (activeShopIDRef.current !== shopID) return;
      setProductSearchError(`商品搜索失败：${errorText(error)}`);
    } finally {
      if (activeShopIDRef.current === shopID) setProductSearchBusy(false);
    }
  }

  async function loadProductPicker() {
    if (!activeShop) return;
    const shopID = activeShop.id;
    setProductSearchBusy(true);
    setProductSearchError("");
    try {
      const recommendationResult = await props.api.getShopifyProductRecommendations(shopID, entryContext.handle || undefined);
      if (activeShopIDRef.current !== shopID) return;
      const matchedEntryProduct = entryContext.handle && recommendationResult.seedProduct?.handle === entryContext.handle
        ? recommendationResult.seedProduct
        : null;
      const recommendedProducts = (recommendationResult.products || []).filter((product) =>
        product.id !== matchedEntryProduct?.id && product.handle !== matchedEntryProduct?.handle
      );
      setEntryProduct(matchedEntryProduct);
      setProducts(recommendedProducts);
      setProductResultShopID(shopID);
      setSelectedVariants((current) => ({
        ...Object.fromEntries([...recommendedProducts, ...(matchedEntryProduct ? [matchedEntryProduct] : [])].map((product) => [product.id, product.variants[0]?.id || ""])),
        ...current,
        ...(pendingProduct ? { [pendingProduct.product.id]: pendingProduct.variant.id } : {})
      }));
    } catch (error) {
      if (activeShopIDRef.current !== shopID) return;
      setProductSearchError(`加载 Shopify 推荐商品失败：${errorText(error)}`);
    } finally {
      if (activeShopIDRef.current === shopID) setProductSearchBusy(false);
    }
  }

  function stageProduct(product: ShopifyProductSummary) {
    if (!activeShop || productResultShopID !== activeShop.id) {
      setProductSearchError("添加商品失败：商品结果不属于当前店铺，请重新打开商品推荐");
      return;
    }
    const variant = product.variants.find((item) => item.id === selectedVariants[product.id]) || product.variants[0];
    if (!variant) {
      setProductSearchError("添加商品失败：该商品没有可用变体");
      return;
    }
    setPendingProduct({ product, variant });
    setWorkbenchLayout((current) => ({
      ...current,
      composerHeight: clamp(Math.max(current.composerHeight, 260), composerMinimumHeightRef.current, composerMaximumHeight())
    }));
    setProductPickerOpen(false);
    props.setToast({ tone: "success", text: "商品已加入回复框，可继续添加文案后发送" });
  }

  function renderProductPickerItem(product: ShopifyProductSummary, isEntryProduct = false) {
    const selectedVariantID = selectedVariants[product.id] || product.variants[0]?.id || "";
    const selectedVariant = product.variants.find((variant) => variant.id === selectedVariantID) || product.variants[0];
    return (
      <article
        className={`product-picker-item product-picker-selectable ${isEntryProduct ? "entry-product" : ""}`}
        key={product.id}
        role="button"
        tabIndex={0}
        onClick={() => stageProduct(product)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          stageProduct(product);
        }}
      >
        {product.imageUrl ? <img src={product.imageUrl} alt={product.imageAlt || product.title} /> : <div className="product-picker-image-empty"><ShoppingBag size={24} /></div>}
        <div className="product-picker-main">
          <strong>{product.title}{isEntryProduct ? <em>进线商品</em> : null}</strong>
          <select
            value={selectedVariantID}
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => setSelectedVariants((current) => ({ ...current, [product.id]: event.target.value }))}
            aria-label={`选择 ${product.title} 变体`}
          >
            {product.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.title} · {formatMoney(variant.price)}{variant.availableForSale ? "" : " · 已售罄"}</option>)}
          </select>
          <span>{selectedVariant?.sku ? `SKU ${selectedVariant.sku}` : "无 SKU"}</span>
        </div>
        <span className="product-picker-add-hint"><span>加入回复</span><ChevronRight size={17} /></span>
      </article>
    );
  }

  async function runConversationAction(action: "claim" | "close" | "reopen") {
    if (!props.selectedConversation) return;
    setConversationAction(action);
    try {
      const updated = action === "claim"
        ? await props.api.claimConversation(props.selectedConversation.id)
        : action === "close"
          ? await props.api.closeConversation(props.selectedConversation.id)
          : await props.api.reopenConversation(props.selectedConversation.id);
      props.onConversationUpdated(updated);
      props.setToast({ tone: "success", text: action === "claim" ? t.claimSucceeded : action === "close" ? t.closeSucceeded : t.reopenSucceeded });
    } catch (error) {
      if (error instanceof PlatformAPIError && error.status === 409) {
        const operation = action === "claim" ? t.claim : action === "close" ? t.closeConversation : t.reopen;
        props.setToast({ tone: "error", text: action === "claim" ? t.conversationClaimedByOther : `${operation}${t.actionFailed}：${errorText(error)}` });
        if (action === "claim") props.onConversationUnavailable(props.selectedConversation.id);
        await props.onChanged();
      } else {
        const operation = action === "claim" ? t.claim : action === "close" ? t.closeConversation : t.reopen;
        props.setToast({ tone: "error", text: `${operation}${t.actionFailed}：${errorText(error)}` });
      }
    } finally {
      setConversationAction("");
    }
  }

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      props.setToast({ tone: "success", text: `${label}已复制` });
    } catch (error) {
      props.setToast({ tone: "error", text: `复制${label}失败：${errorText(error)}` });
    }
  }

  function handleReplyKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (replyLanguageMismatch) {
      props.setToast({ tone: "error", text: "回复语言与客户语言不一致，请先翻译" });
      return;
    }
    event.currentTarget.form?.requestSubmit();
  }

  function handleReplyPaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/"));
    const image = imageItem?.getAsFile() || Array.from(event.clipboardData.files).find((file) => file.type.toLowerCase().startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    chooseImage(image);
  }

  function openLogisticsTracking(carrier: string, trackingNumber: string) {
    setLogisticsCarrier(carrier);
    setLogisticsTrackingNumber(trackingNumber);
    setRightPanelTab("logistics");
    void queryLogistics(carrier, trackingNumber);
  }

  async function queryLogistics(carrier: string, trackingNumber: string) {
    if (!activeShop || !trackingNumber.trim()) return;
    const queryVersion = logisticsQueryVersionRef.current + 1;
    logisticsQueryVersionRef.current = queryVersion;
    setLogisticsBusy(true);
    setLogisticsError("");
    setLogisticsResult(null);
    try {
      const result = await props.api.trackLogistics({
        shopId: activeShop.id,
        carrier: carrier.trim(),
        trackingNumber: trackingNumber.trim()
      });
      if (logisticsQueryVersionRef.current !== queryVersion) return;
      setLogisticsResult(result);
      setLogisticsStatus({
        configured: result.configured,
        provider: result.provider,
        message: result.message
      });
    } catch (error) {
      if (logisticsQueryVersionRef.current !== queryVersion) return;
      setLogisticsError(`物流查询失败：${errorText(error)}`);
    } finally {
      if (logisticsQueryVersionRef.current === queryVersion) setLogisticsBusy(false);
    }
  }

  async function sendLatestLogisticsEvent() {
    const conversation = props.selectedConversation;
    const event = logisticsResult?.events[0];
    if (messageSendingRef.current || !conversation || !logisticsResult || !event || !canReply || logisticsSending) return;
    const sourceText = JSON.stringify({
      orderNumber: latestOrder?.name || "",
      trackingNumber: logisticsResult.trackingNumber,
      providerStatus: logisticsResult.status,
      latestEvent: {
        time: event.time,
        status: event.status,
        description: event.description,
        location: event.location,
      },
    });
    const requestSignature = JSON.stringify([conversation.id, "logistics", sourceText]);
    if (messageRequestRef.current?.signature !== requestSignature) {
      messageRequestRef.current = { signature: requestSignature, id: createClientRequestID() };
    }
    const clientRequestID = messageRequestRef.current.id;
    messageSendingRef.current = true;
    setLogisticsSending(true);
    setMessageSending(true);
    try {
      const body = (await props.api.transformAIReply(conversation.id, "logistics_reply", sourceText)).text.trim();
      if (!body) throw new Error("翻译结果为空");
      const message = await props.api.addMessage(conversation.id, { direction: "agent", type: "text", body, metadata: { client_request_id: `${clientRequestID}_logistics` } });
      props.onMessageCreated(message);
      if (messageRequestRef.current?.id === clientRequestID) messageRequestRef.current = null;
      props.setToast({ tone: "success", text: "最新物流轨迹已发送给客户" });
    } catch (error) {
      props.setToast({ tone: "error", text: `发送物流轨迹失败：${errorText(error)}` });
    } finally {
      messageSendingRef.current = false;
      setLogisticsSending(false);
      setMessageSending(false);
    }
  }

  async function resolvePendingTransfer(action: "accept" | "reject") {
    if (!selectedPendingTransfer) return;
    props.setBusy(true);
    try {
      await props.api.resolveTransfer(selectedPendingTransfer.id, action);
      props.setToast({ tone: "success", text: action === "accept" ? "转接请求已接收" : "转接请求已拒绝" });
      await refreshWorkflowData();
      await props.onChanged();
    } catch (error) {
      props.setToast({ tone: "error", text: `${action === "accept" ? "接收" : "拒绝"}转接请求失败：${errorText(error)}` });
    } finally {
      props.setBusy(false);
    }
  }

  function applyRecordDraft(next: ConversationRecordDraft) {
    recordDraftRef.current = next;
    setRecordDraft(next);
  }

  function scheduleRemarkSave(next: ConversationRecordDraft) {
    applyRecordDraft(next);
    recordSaveVersionRef.current += 1;
    setRecordSaveState("unsaved");
    setRecordSaveError("");
    if (recordRemarkTimerRef.current !== null) window.clearTimeout(recordRemarkTimerRef.current);
    recordRemarkTimerRef.current = window.setTimeout(() => {
      recordRemarkTimerRef.current = null;
      void saveConversationRecord(recordDraftRef.current);
    }, 2000);
  }

  function flushRemarkSave() {
    const hadPendingSave = recordRemarkTimerRef.current !== null;
    if (recordRemarkTimerRef.current !== null) {
      window.clearTimeout(recordRemarkTimerRef.current);
      recordRemarkTimerRef.current = null;
    }
    if (hadPendingSave || recordSaveState === "unsaved") void saveConversationRecord(recordDraftRef.current);
  }

  function changeRecordPrimary(primary: string) {
    const next = { ...recordDraftRef.current, primary };
    applyRecordDraft(next);
    void saveConversationRecord(next);
  }

  function changeRecordSecondary(secondary: string) {
    const next = { ...recordDraftRef.current, secondary };
    applyRecordDraft(next);
    void saveConversationRecord(next);
  }

  function changeRecordTertiary(tertiary: string) {
    const next = { ...recordDraftRef.current, tertiary };
    applyRecordDraft(next);
    void saveConversationRecord(next);
  }

  async function saveConversationRecord(next: ConversationRecordDraft) {
    const conversationID = props.selectedConversation?.id;
    if (!conversationID) return;
    if (recordRemarkTimerRef.current !== null) {
      window.clearTimeout(recordRemarkTimerRef.current);
      recordRemarkTimerRef.current = null;
    }
    const version = ++recordSaveVersionRef.current;
    setRecordSaveState("saving");
    setRecordSaveError("");
    const request = recordSaveQueueRef.current.then(() => props.api.updateConversationRecord(conversationID, next));
    recordSaveQueueRef.current = request.then(() => undefined, () => undefined);
    try {
      const updated = await request;
      if (props.selectedConversation?.id !== conversationID || version !== recordSaveVersionRef.current) return;
      const saved = conversationRecordFromConversation(updated);
      applyRecordDraft(saved);
      setRecordSaveState("saved");
    } catch (error) {
      if (props.selectedConversation?.id !== conversationID || version !== recordSaveVersionRef.current) return;
      setRecordSaveError(`保存消息分类和备注失败：${errorText(error)}`);
      setRecordSaveState("error");
    }
  }

  function openProductPicker() {
    setProductPickerOpen(true);
    setProductQuery("");
    void loadProductPicker();
  }

  function openKnowledgeSubmission() {
    if (!props.selectedConversation || !activeShop) return;
    const latestCustomerMessage = [...props.messages].reverse().find((message) =>
      message.direction === "customer"
      && (message.type || "text") === "text"
      && message.metadata?.displayQuotedHistory !== "true"
      && message.body.trim() !== ""
    );
    const latestAgentMessage = [...props.messages].reverse().find((message) =>
      message.direction === "agent"
      && (message.type || "text") === "text"
      && message.body.trim() !== ""
    );
    setKnowledgeTitleDraft(latestCustomerMessage?.body.trim() || props.selectedConversation.subject?.trim() || "");
    setKnowledgeAnswerDraft(reply.trim() || latestAgentMessage?.body.trim() || "");
    setKnowledgeTagsDraft("");
    setKnowledgeSubmitError("");
    setKnowledgeSubmitOpen(true);
  }

  async function openAIReplyRules() {
    if (!activeShop) return;
    const shopID = activeShop.id;
    setAIRulesOpen(true);
    setAIRulesLoading(true);
    setAIRulesError("");
    setAIRulesResult(null);
    setAIRulesDraft(activeShop.metadata?.aiReplyRules || "");
    try {
      const result = await props.api.getShopAIReplyRules(shopID);
      if (activeShopIDRef.current !== shopID) return;
      setAIRulesResult(result);
      setAIRulesDraft(result.rules);
    } catch (error) {
      if (activeShopIDRef.current !== shopID) return;
      setAIRulesError(`加载店铺规则失败：${errorText(error)}`);
    } finally {
      if (activeShopIDRef.current === shopID) setAIRulesLoading(false);
    }
  }

  async function saveAIReplyRules() {
    if (!activeShop) return;
    const shopID = activeShop.id;
    setAIRulesSaving(true);
    setAIRulesError("");
    try {
      const result = await props.api.saveShopAIReplyRules(shopID, aiRulesDraft);
      if (activeShopIDRef.current !== shopID) return;
      setAIRulesResult(result);
      setAIRulesDraft(result.rules);
      props.setToast({ tone: "success", text: `${activeShop.displayName} 的 AI 回复规则已保存` });
      await props.onChanged();
    } catch (error) {
      if (activeShopIDRef.current !== shopID) return;
      setAIRulesError(`保存店铺规则失败：${errorText(error)}`);
    } finally {
      if (activeShopIDRef.current === shopID) setAIRulesSaving(false);
    }
  }

  async function generateAIDraft() {
    if (!props.selectedConversation || !canReply) return;
    const conversationID = props.selectedConversation.id;
    if (aiBusyByConversationRef.current[conversationID]) return;
    setConversationAIBusy(conversationID, "draft");
    try {
      const result = await props.api.generateAIReply(conversationID);
      replyTranslationCacheRef.current.clear();
      setConversationReply(conversationID, result.text);
      if (selectedConversationIDRef.current === conversationID) {
        props.setToast({ tone: "success", text: result.knowledgeUsed.length ? `AI 草稿已生成，引用 ${result.knowledgeUsed.length} 条知识` : "AI 草稿已生成" });
      }
    } catch (error) {
      if (selectedConversationIDRef.current === conversationID) {
        props.setToast({ tone: "error", text: `AI 草稿生成失败：${errorText(error)}` });
      }
    } finally {
      setConversationAIBusy(conversationID, "");
    }
  }

  async function retryEmailMessage(message: Message) {
    const conversationID = message.conversationId;
    const clientRequestID = message.metadata?.client_request_id?.trim();
    if (!conversationID || !clientRequestID || retryingEmailMessageIDs.has(message.id)) return;
    setRetryingEmailMessageIDs((current) => new Set(current).add(message.id));
    try {
      await props.api.addMessage(conversationID, {
        direction: "agent",
        type: message.type === "image" || message.type === "product" ? message.type : "text",
        body: message.body,
        metadata: { ...message.metadata, client_request_id: clientRequestID }
      });
      props.setToast({ tone: "success", text: "已重新加入后台发送队列" });
    } catch (error) {
      props.setToast({ tone: "error", text: `重新发送失败：${errorText(error)}` });
    } finally {
      setRetryingEmailMessageIDs((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  }

  function openShippingAddressEditor() {
    if (!latestOrder?.id) return;
    setShippingAddressError("");
    setShippingAddressEditor({
      orderId: latestOrder.id,
      orderName: latestOrder.name,
      address: shippingAddressDraft(latestOrder.shippingAddress)
    });
  }

  async function saveShippingAddress(event: FormEvent) {
    event.preventDefault();
    if (!activeShop || !shippingAddressEditor || shippingAddressSaving) return;
    const address = {
      ...shippingAddressEditor.address,
      countryCode: shippingAddressEditor.address.countryCode.trim().toUpperCase(),
      provinceCode: shippingAddressEditor.address.provinceCode.trim().toUpperCase()
    };
    if (!address.address1.trim() || !address.city.trim() || !/^[A-Z]{2}$/.test(address.countryCode)) {
      setShippingAddressError("请填写地址第一行、城市和两个字母的国家/地区代码");
      return;
    }
    setShippingAddressSaving(true);
    setShippingAddressError("");
    try {
      const result = await props.api.updateShopifyOrderShippingAddress(activeShop.id, shippingAddressEditor.orderId, address);
      setShopifyOrders((current) => current.map((order) => orderWithShippingAddress(order, shippingAddressEditor.orderId, result.shippingAddress)));
      setCustomerProfile((current) => current?.lastOrder?.id === shippingAddressEditor.orderId
        ? { ...current, lastOrder: { ...current.lastOrder, shippingAddress: result.shippingAddress } }
        : current);
      setShippingAddressEditor(null);
      props.setToast({ tone: "success", text: `${shippingAddressEditor.orderName} 收货地址已同步到 Shopify` });
    } catch (error) {
      setShippingAddressError(errorText(error));
    } finally {
      setShippingAddressSaving(false);
    }
  }

  function openTrackingEditor(fulfillment: ShopifyFulfillment, tracking?: { company?: string; number?: string; url?: string }) {
    if (!fulfillment.id) return;
    setTrackingEditError("");
    setTrackingEditor({
      fulfillmentId: fulfillment.id,
      company: tracking?.company || "",
      number: tracking?.number || "",
      url: tracking?.url || ""
    });
  }

  async function saveTrackingUpdate(event: FormEvent) {
    event.preventDefault();
    if (!activeShop || !trackingEditor || trackingSaving) return;
    if (!trackingEditor.number.trim()) {
      setTrackingEditError("物流单号不能为空");
      return;
    }
    setTrackingSaving(true);
    setTrackingEditError("");
    try {
      const result = await props.api.updateShopifyFulfillmentTracking(activeShop.id, {
        ...trackingEditor,
        notifyCustomer: false
      });
      setShopifyOrders((current) => current.map((order) => orderWithFulfillment(order, result.fulfillment)));
      setCustomerProfile((current) => current?.lastOrder
        ? {
            ...current,
            lastOrder: {
              ...current.lastOrder,
              fulfillments: (current.lastOrder.fulfillments || []).map((item) =>
                item.id === result.fulfillment.id ? result.fulfillment : item
              )
            }
          }
        : current);
      setTrackingEditor(null);
      props.setToast({ tone: "success", text: "物流单号已同步到 Shopify，未向客户发送通知" });
    } catch (error) {
      setTrackingEditError(errorText(error));
    } finally {
      setTrackingSaving(false);
    }
  }

  async function rewriteReply() {
    if (!props.selectedConversation || !canReply || !reply.trim()) return;
    const conversationID = props.selectedConversation.id;
    const sourceText = reply;
    if (aiBusyByConversationRef.current[conversationID]) return;
    setConversationAIBusy(conversationID, "rewrite");
    try {
      const result = await props.api.transformAIReply(conversationID, "rewrite", sourceText);
      replyTranslationCacheRef.current.clear();
      setConversationReply(conversationID, result.text);
      if (selectedConversationIDRef.current === conversationID) {
        props.setToast({ tone: "success", text: "已优化回复措辞" });
      }
    } catch (error) {
      if (selectedConversationIDRef.current === conversationID) {
        props.setToast({ tone: "error", text: `AI 处理失败：${errorText(error)}` });
      }
    } finally {
      setConversationAIBusy(conversationID, "");
    }
  }

  async function toggleReplyTranslation() {
    if (!props.selectedConversation || !canReply || !reply.trim()) return;
    const conversationID = props.selectedConversation.id;
    if (aiBusyByConversationRef.current[conversationID]) return;
    const sourceText = reply.trim();
    const containsJapaneseKana = /\p{Script=Hiragana}|\p{Script=Katakana}/u.test(sourceText);
    const containsKorean = /\p{Script=Hangul}/u.test(sourceText);
    const inputLooksChinese = /\p{Script=Han}/u.test(sourceText) && !containsJapaneseKana && !containsKorean;
    const action: "translate" | "translate_zh" = inputLooksChinese && customerWritingSystem !== "han" ? "translate" : "translate_zh";
    const cacheKey = `${conversationID}\u0000${action}\u0000${sourceText}`;
    const cached = replyTranslationCacheRef.current.get(cacheKey);
    if (cached !== undefined) {
      setConversationReply(conversationID, cached);
      props.setToast({ tone: "success", text: action === "translate" ? "已切换为客户语言（使用缓存）" : "已切换为中文（使用缓存）" });
      return;
    }

    setConversationAIBusy(conversationID, "translate");
    try {
      const result = await props.api.transformAIReply(conversationID, action, sourceText);
      const translatedText = result.text.trim();
      const compactSource = sourceText.toLocaleLowerCase().replace(/\s+/g, "");
      const compactTranslation = translatedText.toLocaleLowerCase().replace(/\s+/g, "");
      if (!translatedText || compactTranslation === compactSource) {
        throw new Error("AI 未正确转换目标语言，请重试");
      }
      const reverseAction: "translate" | "translate_zh" = action === "translate" ? "translate_zh" : "translate";
      replyTranslationCacheRef.current.set(cacheKey, translatedText);
      replyTranslationCacheRef.current.set(`${conversationID}\u0000${reverseAction}\u0000${translatedText}`, sourceText);
      setConversationReply(conversationID, translatedText);
      if (selectedConversationIDRef.current === conversationID) {
        props.setToast({ tone: "success", text: action === "translate" ? "已翻译为客户语言" : "已翻译为中文" });
      }
    } catch (error) {
      if (selectedConversationIDRef.current === conversationID) {
        props.setToast({ tone: "error", text: `AI 翻译失败：${errorText(error)}` });
      }
    } finally {
      setConversationAIBusy(conversationID, "");
    }
  }

  async function submitConversationKnowledge(event?: FormEvent) {
    event?.preventDefault();
    if (!props.selectedConversation || !knowledgeTitleDraft.trim() || !knowledgeAnswerDraft.trim()) return;
    setKnowledgeSubmitting(true);
    setKnowledgeSubmitError("");
    try {
      const entry = await props.api.submitConversationKnowledge(props.selectedConversation.id, {
        title: knowledgeTitleDraft.trim(),
        answer: knowledgeAnswerDraft.trim(),
        tags: knowledgeTagsDraft.split(/[,，;；\n]/).map((value) => value.trim()).filter(Boolean)
      });
      setKnowledgeSubmitOpen(false);
      props.setToast({ tone: "success", text: entry.status === "published" ? "知识已直接发布，可供 AI 使用" : "已提交知识审核，审核发布后才会供 AI 使用" });
    } catch (error) {
      const message = error instanceof PlatformAPIError && error.status === 409
        ? "当前会话已经提交过知识申请"
        : `提交知识审核失败：${errorText(error)}`;
      setKnowledgeSubmitError(message);
    } finally {
      setKnowledgeSubmitting(false);
    }
  }

  async function saveReceptionLimit() {
    const value = Number.parseInt(receptionLimitDraft, 10);
    if (!Number.isInteger(value) || value < 1 || value > 50) {
      props.setToast({ tone: "error", text: "接待上限请输入 1 到 50 的整数" });
      return;
    }
    setRoutingBusy(true);
    try {
      const user = await props.api.updateMyRouting({ receptionLimit: value });
      props.onCurrentUserChanged(user);
      setReceptionLimitDraft(String(user.receptionLimit || value));
      setEditingReceptionLimit(false);
      props.setToast({ tone: "success", text: "接待上限已保存" });
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      setRoutingBusy(false);
    }
  }

  async function toggleReceptionPresence() {
    const nextOnline = !props.currentUser.receptionOnline;
    setPresenceBusy(true);
    try {
      const user = await props.api.updateMyPresence(nextOnline);
      props.onCurrentUserChanged(user);
      props.setToast({
        tone: "success",
        text: nextOnline ? "已上线，开始接收新会话" : "已离线，不再分配新会话；当前会话保持不变"
      });
    } catch (error) {
      props.setToast({ tone: "error", text: errorText(error) });
    } finally {
      setPresenceBusy(false);
    }
  }

  const profileLastOrderCandidate = customerLastOrderSummary(customerProfile);
  const profileLastOrder = verifiedConversationOrders(profileLastOrderCandidate ? [profileLastOrderCandidate] : [], props.selectedConversation)[0];
  const latestOrder = shopifyOrders[0] || profileLastOrder || conversationShopifyContext?.order;
  const latestOrderTrackings = orderTrackings(latestOrder);
  const latestOrderProductTitles = orderProductTitles(latestOrder);
  const editableFulfillments = [...(latestOrder?.fulfillments || [])]
    .filter((fulfillment) => Boolean(fulfillment.id))
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || "") - Date.parse(left.updatedAt || left.createdAt || ""));
  const primaryEditableFulfillment = editableFulfillments[0];
  const orderCustomer = latestOrder?.customer;
  const customerEmail = customerProfile?.email || orderCustomer?.email || props.selectedConversation?.customerEmail || "-";
  const customerDisplayName = firstUsableCustomerName([
    customerProfile?.displayName,
    orderCustomer?.displayName,
    props.selectedConversation?.customerName,
    latestOrder?.shippingAddress?.name
  ], customerEmail) || customerEmail;
  const customerPhone = latestOrder?.shippingAddress?.phone || customerProfile?.phone || orderCustomer?.phone || "";
  const customerTotalSpent = customerProfile?.totalSpent || orderCustomer?.totalSpent;
  const participatesInAutoReception = props.currentUser.role === "agent" && hasPermission(props.currentUser, PERMISSIONS.autoReception);
  const receptionConnected = props.eventConnectionStatus === "connected";
  const receptionFull = props.currentUser.receptionOnline && receptionConnected && activeLoad >= receptionCapacity;
  const receptionPresence = !props.currentUser.receptionOnline ? "offline" : !receptionConnected ? "reconnecting" : receptionFull ? "full" : "online";
  const receptionPresenceLabel = receptionPresence === "full" ? "接待已满" : receptionPresence === "online" ? "在线接待" : receptionPresence === "reconnecting" ? "重连中" : "离线";
  const receptionPresenceTitle = receptionPresence === "reconnecting"
    ? "实时连接暂时中断，恢复后将继续自动接待；点击可切换离线"
    : props.currentUser.receptionOnline
      ? "切换离线后不再接收新会话，当前会话保持不变"
      : "切换在线并开始接收新会话";
  return (
    <section ref={consoleRef} className="sobot-console" style={workbenchStyle}>
      <aside className="sobot-session-list">
        <header className="session-list-head">
          <div><strong>{t.myConversations}</strong><span>{conversationShopName || t.allStores}</span></div>
          {participatesInAutoReception ? (
            <button
              type="button"
              className={`agent-presence-toggle ${receptionPresence}`}
              onClick={() => void toggleReceptionPresence()}
              disabled={presenceBusy}
              aria-pressed={props.currentUser.receptionOnline}
              aria-label={`当前${receptionPresenceLabel}，点击切换接待状态`}
              title={receptionPresenceTitle}
            >
              <span className="agent-presence-dot" aria-hidden="true" />
              <span>{presenceBusy ? "切换中" : receptionPresenceLabel}</span>
            </button>
          ) : null}
        </header>

        <div className="session-fixed-controls">
          <div className="session-tabs">
            <button type="button" className={conversationStatus === "assigned" ? "active" : ""} onClick={() => setConversationStatus("assigned")}>{t.inConversation}({assignedCount})</button>
            <button type="button" className={conversationStatus === "open" ? "active" : ""} onClick={() => setConversationStatus("open")}>{t.queue}({openCount})</button>
            <button type="button" className={conversationStatus === "closed" ? "active" : ""} onClick={() => setConversationStatus("closed")}>{t.statusClosed}({closedCount})</button>
          </div>
          {participatesInAutoReception ? <div className="session-sort">
            <div className="routing-limit-control">
              <span>接待负载</span>
              {editingReceptionLimit ? (
                <>
                  <input type="number" min={1} max={50} value={receptionLimitDraft} onChange={(event) => setReceptionLimitDraft(event.target.value)} disabled={routingBusy} />
                  <button type="button" onClick={() => void saveReceptionLimit()} disabled={routingBusy}>完成</button>
                </>
              ) : (
                <button type="button" onClick={() => setEditingReceptionLimit(true)} disabled={routingBusy} title="当前有效接待量 / 接待上限；点击修改上限">{activeLoad}/{receptionCapacity}</button>
              )}
            </div>
          </div> : null}
        </div>

        <div className="conversation-list-filters">
          <select value={conversationShopID} onChange={(event) => setConversationShopID(event.target.value)} aria-label="筛选店铺">
            <option value="">全部店铺</option>
            {props.shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.displayName}</option>)}
          </select>
          <input
            type="search"
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.target.value)}
            placeholder="搜索客户姓名或邮箱"
            aria-label="搜索客户姓名或邮箱"
          />
        </div>

        {conversationStatus === "closed" ? (
          <section className="closed-conversation-archive" aria-label="已结束会话">
            <div className="closed-conversation-list">
              {archivedConversations.map((conversation) => {
                const shop = props.shops.find((item) => item.id === conversation.shopId);
                return (
                  <button type="button" className={`sobot-session-item ${conversation.id === props.selectedConversation?.id ? "active" : ""}`} key={conversation.id} onClick={() => props.onSelectConversation(conversation.id, conversation)}>
                    <span className="status-dot closed" />
                    <span className="session-main"><strong>{conversation.customerName || conversation.customerEmail || t.visitor}</strong><small>{shop?.displayName || conversation.shopId} · {sourceChannel(conversation.sourceId) === "email" ? t.emailChannel : t.chatChannel}</small></span>
                    <span className="session-side"><small>{timeLabel(customerMessageTimestamp(conversation), t)}</small><em>{t.statusClosed}</em></span>
                  </button>
                );
              })}
              {closedConversationError ? <div className="channel-empty">加载失败：{closedConversationError}</div> : null}
              {!closedConversationLoading && !closedConversationError && !archivedConversations.length ? <div className="channel-empty">{conversationFilterActive ? "暂无匹配会话" : "暂无已结束会话"}</div> : null}
              {closedConversationHasMore ? <button type="button" className="load-more-conversations" disabled={closedConversationLoading} onClick={() => void loadMoreClosedConversations()}>{closedConversationLoading ? "加载中..." : "加载更多已结束会话"}</button> : null}
              {closedConversationLoading && !archivedConversations.length ? <div className="channel-empty">正在加载已结束会话...</div> : null}
            </div>
          </section>
        ) : (
        <nav className="conversation-store-tree" aria-label={t.selectStoreAria}>
          <button type="button" className={`store-scope-all ${allStoresExpanded ? "active" : ""}`} onClick={toggleAllStores} aria-expanded={allStoresExpanded}>
            <span className="scope-label">{allStoresExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}<Store size={15} /><strong>{t.allStores}</strong></span>
            <span className={`conversation-count ${totalPending ? "has-pending" : ""}`} title={conversationCountTitle(totalActive, totalPending)}>{totalActive}</span>
          </button>
          {storeRows.map(({ shop, active, pending, chatActive, emailActive, chatPending, emailPending }) => {
            const expanded = conversationFilterActive || expandedShopIds.has(shop.id);
            const channelRows = {
              chat: visibleConversations.filter((conversation) => conversation.shopId === shop.id && sourceChannel(conversation.sourceId) === "chat"),
              email: visibleConversations.filter((conversation) => conversation.shopId === shop.id && sourceChannel(conversation.sourceId) === "email")
            };
            return (
              <div className="store-scope-group" key={shop.id}>
                <div className="store-scope-row">
                  <button type="button" className="store-scope-toggle" onClick={() => toggleShop(shop.id)} aria-expanded={expanded} aria-label={`${expanded ? t.collapseShop : t.expandShop} ${shop.displayName}`}>
                    {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button type="button" className="store-scope-select" onClick={() => toggleShop(shop.id)} aria-expanded={expanded} title={shop.displayName}>
                    <span>{shop.displayName}</span>
                    <span className={`conversation-count ${pending ? "has-pending" : ""}`} title={conversationCountTitle(active, pending)}>{active}</span>
                  </button>
                </div>
                {expanded ? (
                  <div className="store-channel-list">
                    {(["chat", "email"] as const).map((channel) => {
                      const key = `${shop.id}:${channel}`;
                      const channelExpanded = conversationFilterActive || expandedChannelKeys.has(key);
                      const rows = channelRows[channel];
                      const channelActive = channel === "chat" ? chatActive : emailActive;
                      const channelPending = channel === "chat" ? chatPending : emailPending;
                      return (
                        <div className="store-channel-group" key={key}>
                          <button type="button" className="store-channel-row" onClick={() => toggleChannel(shop.id, channel)} aria-expanded={channelExpanded}>
                            <span>
                              {channelExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              {channel === "chat" ? <MessageSquareText size={14} /> : <Mail size={14} />}
                              {channel === "chat" ? t.chatChannel : t.emailChannel}
                            </span>
                            <span className={`conversation-count ${channelPending ? "has-pending" : ""}`} title={conversationCountTitle(channelActive, channelPending)}>{channelActive}</span>
                          </button>
                          {channelExpanded ? (
                            <div className="channel-conversation-list">
                              {rows.map((conversation) => (
                                <button type="button" className={`sobot-session-item ${conversation.id === props.selectedConversation?.id ? "active" : ""} ${conversation.unread ? "unread" : ""}`} key={conversation.id} onClick={() => props.onSelectConversation(conversation.id)}>
                                  <span className={`status-dot ${conversationAttention(conversation)}`} title={conversationAttentionTitle(conversation)} />
                                  <span className="session-main"><strong>{conversation.customerName || conversation.customerEmail || t.visitor}</strong><small>{conversation.subject || t.noSubject}</small></span>
                                  <span className="session-side"><small>{timeLabel(customerMessageTimestamp(conversation), t)}</small><em title={conversation.status === "open" ? routingReasonLabel(conversationSummary?.routingReasons?.[conversation.id] || conversation.routingReason) : undefined}>{conversation.status === "open" ? routingReasonLabel(conversationSummary?.routingReasons?.[conversation.id] || conversation.routingReason) : conversationStatusLabel(conversation.status, t)}</em></span>
                                </button>
                              ))}
                              {!rows.length ? <div className="channel-empty">{t.noConversations}</div> : null}
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
          {!storeRows.length ? <div className="store-scope-empty">{conversationFilterActive ? "暂无匹配会话" : t.assignedStoresEmpty}</div> : null}
          {props.conversationsHasMore ? <button type="button" className="load-more-conversations" onClick={() => void props.onLoadMoreConversations()}>加载更多会话</button> : null}
        </nav>
        )}
      </aside>

      <section className="sobot-chat-pane">
        {props.selectedConversation ? (
          <>
            <header className="chat-header">
              <div><strong>{props.selectedConversation.customerName || props.selectedConversation.customerEmail || t.visitor}</strong><span>{props.selectedConversation.subject || t.noSubject} · {conversationSourceLabel}</span></div>
              <div className="conversation-actions">
                <Badge tone={props.selectedConversation.status === "closed" ? "muted" : props.selectedConversation.status === "assigned" ? "green" : "warning"}>{conversationStatusLabel(props.selectedConversation.status, t)}</Badge>
                {ownedByCurrentUser && props.selectedConversation.status === "assigned" ? <span className="conversation-owner-state mine">{t.assignedToYou}</span> : null}
                {!ownedByCurrentUser && conversationShopifyContext?.assignedAgentName ? <span className="conversation-owner-state">接待客服：{conversationShopifyContext.assignedAgentName}</span> : assignedToOther ? <span className="conversation-owner-state">{t.assignedToOther}</span> : null}
                {props.selectedConversation.status === "closed" && ownedByCurrentUser && conversationShopifyContext?.assignedAgentName ? <span className="conversation-owner-state">接待客服：{conversationShopifyContext.assignedAgentName}</span> : null}
                {props.selectedConversation.status === "open" ? <span className="conversation-owner-state">{routingReasonLabel(conversationSummary?.routingReasons?.[props.selectedConversation.id] || props.selectedConversation.routingReason)}</span> : null}
                {props.selectedConversation.status === "open" && canClaim ? <button type="button" onClick={() => void runConversationAction("claim")} disabled={conversationAction !== ""}>{conversationAction === "claim" ? "..." : t.claim}</button> : null}
                {canClose && canTransfer ? <button type="button" title="转接会话" onClick={() => setTransferOpen(true)}><ArrowRightLeft size={15} /> 转接</button> : null}
                {canManageTickets ? <button type="button" title="创建工单" onClick={() => setTicketCreateOpen(true)}><ClipboardPlus size={15} /> 工单</button> : null}
                {canClose ? <button type="button" className="danger-action" onClick={() => void runConversationAction("close")} disabled={conversationAction !== ""}>{conversationAction === "close" ? "..." : t.closeConversation}</button> : null}
                {canReopen ? <button type="button" onClick={() => void runConversationAction("reopen")} disabled={conversationAction !== ""}>{conversationAction === "reopen" ? "..." : t.reopen}</button> : null}
                {props.selectedConversation.status === "closed" && canSubmitKnowledge ? <button type="button" onClick={openKnowledgeSubmission} disabled={knowledgeSubmitting}>{knowledgeSubmitting ? "..." : "申请知识"}</button> : null}
              </div>
            </header>

            {selectedPendingTransfer ? <div className="pending-transfer-banner"><div><ArrowRightLeft size={16} /><span><strong>收到转接请求</strong>{selectedPendingTransfer.note || "请确认是否接收该会话"}</span></div><div><button type="button" onClick={() => void resolvePendingTransfer("reject")}>拒绝</button><button className="primary" type="button" onClick={() => void resolvePendingTransfer("accept")}><Check size={14} /> 接收</button></div></div> : null}

            <div ref={messageStreamRef} className="message-stream sobot-message-stream" onScroll={handleMessageStreamScroll}>
              {props.messagesHasMore ? <button type="button" className="load-older-messages" onClick={() => void loadOlderMessages()}>加载更早消息</button> : null}
              {props.messages.map((message) => {
                const messageType = message.type || "text";
                const imageURL = props.api.resolveAssetURL(message.metadata?.url);
                const attachmentDownloadURL = imageURL && message.metadata?.fileName
                  ? `${imageURL}${imageURL.includes("?") ? "&" : "?"}name=${encodeURIComponent(message.metadata.fileName)}`
                  : imageURL;
                const productURL = safeExternalURL(message.metadata?.onlineStoreUrl);
                const productImageURL = safeExternalURL(message.metadata?.imageUrl);
                const productFallbackBody = [message.metadata?.productTitle, message.metadata?.variantTitle && message.metadata.variantTitle !== "Default Title" ? message.metadata.variantTitle : ""].filter(Boolean).join(" - ");
                const productCaption = messageType === "product" && message.body && message.body !== message.metadata?.productTitle && message.body !== productFallbackBody ? message.body : "";
                const isEntryProductMessage = message.id === entryContext.messageId && Boolean(entryContext.handle);
                const entryProductImageURL = isEntryProductMessage ? safeExternalURL(entryContext.productImageUrl) : "";
                const entryProductURL = isEntryProductMessage ? safeExternalURL(entryContext.pageUrl) : "";
                const entryProductTitle = entryContext.productTitle || entryContext.pageTitle || entryContext.handle;
                const storedTranslation = message.metadata?.translationZh?.trim();
                const translatedText = visibleMessageTranslation(message.body || "", storedTranslation);
                const translationState = storedTranslation ? "completed" : message.metadata?.translationZhStatus;
                const translationPending = translationState === "queued" || translationState === "processing";
                const emailSendStatus = message.direction === "agent" ? message.metadata?.email_send_status?.trim() : "";
                const emailSendFailed = emailSendStatus === "failed";
                const emailSendStatusLabel = emailSendStatus === "queued"
                  ? "等待后台发送，可继续处理其他消息"
                  : emailSendStatus === "sending"
                    ? "后台发送中"
                    : emailSendStatus === "reconciling"
                      ? "发送结果核对中，此消息请勿重复发送"
                      : emailSendFailed
                        ? message.metadata?.email_send_error || "发送失败"
                        : emailSendStatus === "sent" ? "已发送" : "";
                return (
                  <div className={`message-bubble ${message.direction === "customer" ? "customer" : message.direction === "system" ? "system" : "agent"} ${messageType !== "text" ? `message-${messageType}` : ""}`} key={message.id}>
                    <span>{message.direction === "agent" ? t.serviceAgent : message.direction === "system" ? "系统通知" : t.customer} · {timeLabel(message.createdAt, t)}{message.metadata?.email_ingress_label ? ` · ${message.metadata.email_ingress_label}` : ""}</span>
                    {isEntryProductMessage ? (
                      <article className="entry-product-message">
                        <a
                          className="entry-product-message-link"
                          href={entryProductURL || undefined}
                          target={entryProductURL ? "_blank" : undefined}
                          rel={entryProductURL ? "noreferrer" : undefined}
                          aria-label={entryProductURL ? `打开商品页面：${entryProductTitle}` : undefined}
                          title={entryProductURL ? "打开商品页面" : undefined}
                        >
                          {entryProductImageURL ? <img src={entryProductImageURL} alt={entryProductTitle || "进线商品"} onLoad={keepMessageStreamAtBottom} /> : <div className="entry-product-message-placeholder"><ShoppingBag size={20} /></div>}
                          <div>
                            <small>客户从此商品页发起咨询</small>
                            <strong>{entryProductTitle}</strong>
                            {entryContext.productPrice ? <b>{[entryContext.productCurrencyCode, entryContext.productPrice].filter(Boolean).join(" ")}</b> : null}
                          </div>
                          {entryProductURL ? <ExternalLink size={15} /> : null}
                        </a>
                      </article>
                    ) : null}
                    {messageType === "image" && imageURL ? (
                      <a className="message-image-link" href={imageURL} target="_blank" rel="noreferrer" aria-label="查看原图">
                        <img className="message-image" src={imageURL} alt={message.metadata?.fileName || "聊天图片"} onLoad={keepMessageStreamAtBottom} />
                      </a>
                    ) : null}
                    {messageType === "file" && attachmentDownloadURL ? (
                      <a className="message-file-card" href={attachmentDownloadURL} target="_blank" rel="noreferrer" download={message.metadata?.fileName || undefined}>
                        <FileText size={24} />
                        <span>
                          <strong>{message.metadata?.fileName || message.body || "附件"}</strong>
                          <small>{[message.metadata?.mimeType, formatAttachmentSize(message.metadata?.fileSize)].filter(Boolean).join(" · ")}</small>
                        </span>
                        <ExternalLink size={15} />
                      </a>
                    ) : null}
                    {messageType === "product" ? (
                      <article className="message-product-card">
                        {productImageURL ? <img src={productImageURL} alt={message.metadata?.productTitle || "商品图片"} onLoad={keepMessageStreamAtBottom} /> : <div className="product-image-empty"><ShoppingBag size={20} /></div>}
                        <div>
                          <strong>{message.metadata?.productTitle || message.body}</strong>
                          {message.metadata?.variantTitle && message.metadata.variantTitle !== "Default Title" ? <span>{message.metadata.variantTitle}</span> : null}
                          <b>{[message.metadata?.currencyCode, message.metadata?.price].filter(Boolean).join(" ")}</b>
                        </div>
                        {productURL ? <a href={productURL} target="_blank" rel="noreferrer" aria-label="打开商品页面"><ExternalLink size={15} /></a> : null}
                      </article>
                    ) : null}
                    {productCaption ? <p>{productCaption}</p> : null}
                    {messageType !== "product" && messageType !== "file" && message.body ? <p>{message.body}</p> : null}
                    {messageType === "file" && message.body && message.body !== message.metadata?.fileName ? <p>{message.body}</p> : null}
                    {translatedText ? <div className="message-translation-block"><p className="message-translation">{translatedText}</p><span className="message-translation-status done"><Check size={12} /> 翻译完成</span></div> : null}
                    {!translatedText && translationPending && messageType === "text" && message.direction !== "system" ? <span className="message-translation-status loading"><RefreshCw size={12} /> 翻译中</span> : null}
                    {emailSendStatusLabel ? (
                      <div className={`email-send-status ${emailSendStatus}`} role={emailSendFailed ? "alert" : "status"} aria-live={emailSendFailed ? "assertive" : "polite"}>
                        <span>
                          {emailSendFailed ? <CircleAlert size={13} /> : emailSendStatus === "sent" ? <CheckCircle2 size={13} /> : emailSendStatus === "queued" ? <Clock3 size={13} /> : <RefreshCw size={13} />}
                          {emailSendStatusLabel}
                        </span>
                        {emailSendFailed && canReply && message.metadata?.client_request_id ? (
                          <button type="button" onClick={() => void retryEmailMessage(message)} disabled={retryingEmailMessageIDs.has(message.id)}>
                            {retryingEmailMessageIDs.has(message.id) ? "重试中" : "重新发送"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {props.selectedConversation.replyAllowed === false ? (
              <div className="system-notification-readonly"><Mail size={17} /><span>该邮件地址不支持直接回复，可继续分配、转接或结束会话。</span></div>
            ) : <>
              <div
                className="composer-resizer"
                role="separator"
                aria-label="调整回复区高度"
                aria-orientation="horizontal"
                aria-valuemin={composerMinimumHeight}
                aria-valuemax={composerMaximumHeight()}
                aria-valuenow={workbenchLayout.composerHeight}
                tabIndex={0}
                onDoubleClick={() => resetResize("composer")}
                onKeyDown={(event) => resizeWithKeyboard("composer", event)}
                onPointerDown={(event) => startResize("composer", event)}
                onPointerMove={continueResize}
                onPointerUp={stopResize}
                onLostPointerCapture={stopResize}
              />
              <form className="sobot-composer" onSubmit={sendMessage}>
              <div className="composer-tools">
                <button type="button" disabled={!canReply || aiBusy !== ""} onClick={() => void generateAIDraft()}><Bot size={15} /> {aiBusy === "draft" ? "生成中" : t.aiDraft}</button>
                <button type="button" disabled={!activeShop || aiRulesLoading} onClick={() => void openAIReplyRules()}><ListChecks size={15} /> AI 回复规则</button>
                <button type="button" disabled={!canReply} onClick={openProductPicker}><ShoppingBag size={15} /> 商品推荐</button>
                <button type="button" disabled={!canReply} onClick={() => imageInputRef.current?.click()}><ImagePlus size={15} /> 添加图片</button>
                <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => { chooseImage(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                {canSubmitKnowledge ? <button type="button" disabled={!canReply || !activeShop || knowledgeSubmitting} onClick={openKnowledgeSubmission}><BookOpen size={15} /> 申请知识</button> : null}
                <button type="button" disabled={!canReply || !reply.trim() || aiBusy !== ""} onClick={() => void rewriteReply()}><RefreshCw size={15} /> {aiBusy === "rewrite" ? "处理中" : "优化措辞"}</button>
                <button type="button" disabled={!canReply || !reply.trim() || aiBusy !== ""} onClick={() => void toggleReplyTranslation()}><Languages size={15} /> {aiBusy === "translate" ? "翻译中" : "翻译"}</button>
              </div>
              <div className="composer-notices">
                {latestEmailNoReplyWarning ? <div className="composer-auto-draft-banner"><Mail size={15} /><span>发件地址包含 no-reply，回复时将优先使用邮件提供的 Reply-To 地址</span></div> : null}
                {logisticsAutoDraftReady ? <div className="composer-auto-draft-banner"><Truck size={15} /><span>{latestCustomerReplyDraft?.metadata?.logisticsDraftLatestEvent ? "最新物流轨迹草稿已生成" : "无物流信息草稿已生成"}</span></div> : null}
              </div>
              <div className="composer-editor">
                {pendingImage && pendingImageURL ? (
                  <div className="composer-image-preview">
                    <img src={pendingImageURL} alt="待发送图片预览" />
                    <div><strong>{pendingImage.name}</strong><span>{(pendingImage.size / 1024 / 1024).toFixed(1)} MB</span></div>
                    <button type="button" onClick={() => setPendingImage(null)} aria-label="移除待发送图片"><Trash2 size={16} /></button>
                  </div>
                ) : null}
                {pendingProduct ? (
                  <div className="composer-product-preview">
                    {pendingProduct.product.imageUrl ? <img src={pendingProduct.product.imageUrl} alt={pendingProduct.product.imageAlt || pendingProduct.product.title} /> : <div className="product-image-empty"><ShoppingBag size={20} /></div>}
                    <div>
                      <strong>{pendingProduct.product.title}</strong>
                      {pendingProduct.variant.title !== "Default Title" ? <span>{pendingProduct.variant.title}</span> : null}
                      <b>{formatMoney(pendingProduct.variant.price)}</b>
                    </div>
                    <button type="button" onClick={() => setPendingProduct(null)} aria-label="移除待发送商品"><Trash2 size={16} /></button>
                  </div>
                ) : null}
                <textarea disabled={!canReply || messageSending} value={reply} onChange={(event) => { replyTranslationCacheRef.current.clear(); setConversationReply(selectedConversationID, event.target.value); }} onKeyDown={handleReplyKeyDown} onPaste={handleReplyPaste} placeholder={canReply ? pendingProduct ? "可添加商品推荐文案" : pendingImage ? "可添加图片说明" : t.replyPlaceholder : props.selectedConversation.status === "closed" ? t.closedReadOnly : assignedToOther ? t.assignedToOther : t.claimBeforeReply} />
              </div>
              <div className="composer-actions">
                <span>{conversationSourceLabel} · {conversationShopName || t.unselectedShop}</span>
                {replyLanguageMismatch ? <span className="composer-language-warning">回复语言与客户语言不一致，请先翻译</span> : <span className="composer-shortcut">Enter 发送，Shift + Enter 换行</span>}
                <button className="primary" type="submit" disabled={!canReply || (!reply.trim() && !pendingImage && !pendingProduct) || replyLanguageMismatch || messageSending}><Send size={16} /> {messageSending ? "发送中" : t.sendRecord}</button>
              </div>
              </form>
            </>}
          </>
        ) : (
          <div className="sobot-chat-empty"><MessageSquareText size={42} /><strong>{t.noConversationContent}</strong><span>{t.noConversationHint}</span></div>
        )}
      </section>

      <aside ref={customerPanelRef} className="sobot-customer-panel">
        <nav className="customer-panel-tabs" aria-label="会话辅助信息">
          <button type="button" className={rightPanelTab === "customer" ? "active" : ""} onClick={() => setRightPanelTab("customer")}>客户</button>
          <button
            type="button"
            className={rightPanelTab === "logistics" ? "active" : ""}
            onClick={() => {
              const tracking = latestOrderTrackings[0];
              if (tracking?.number) openLogisticsTracking(tracking.company || "", tracking.number);
              else {
                setRightPanelTab("logistics");
                setLogisticsResult(null);
                setLogisticsError("");
              }
            }}
          >物流查询</button>
          <button type="button" className={rightPanelTab === "tickets" ? "active" : ""} onClick={() => setRightPanelTab("tickets")}>工单{conversationTickets.length ? ` ${conversationTickets.length}` : ""}</button>
        </nav>
        {rightPanelTab === "customer" ? <>
          <section className="customer-detail-section" aria-label="Shopify 客户资料">
            <div className="side-section-title"><strong>客户资料</strong>{customerLookupBusy ? <span>查询中</span> : null}</div>
            {customerLookupError ? <span className="lookup-error">{customerLookupError}</span> : null}
            <div className="customer-detail-list">
              <div className="customer-name-row"><UserRound size={14} /><strong>{customerDisplayName}</strong></div>
              <div><Mail size={14} /><span>{customerEmail}</span></div>
              <div className={customerPhone ? "" : "customer-detail-empty"}><Phone size={14} /><span>{customerPhone || "未填写电话"}</span></div>
              <div className="customer-spend-row"><ShoppingBag size={14} /><span>累计消费</span><strong>{formatMoney(customerTotalSpent)}</strong></div>
            </div>
            {customerProfile?.tags?.length ? <div className="customer-tags" title="来自 Shopify 客户标签"><Tag size={13} /><small>Shopify 标签</small>{customerProfile.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
          </section>
          <section className="side-section latest-order-section" aria-label="客户最新订单">
            <div className="side-section-title latest-order-heading">
              <strong title={latestOrder ? `最新订单 · ${latestOrder.name}` : "最新订单"}>{latestOrder ? `最新订单 · ${latestOrder.name}` : "最新订单"}</strong>
              {latestOrder ? (
                <button type="button" title="复制订单号" aria-label="复制订单号" onClick={() => void copyText(latestOrder.name, "订单号")}><Copy size={14} /></button>
              ) : orderLookupBusy ? <span>查询中</span> : null}
            </div>
            {orderLookupError ? <span className="lookup-error">{orderLookupError}</span> : null}
            {latestOrder ? (
              <article className="latest-order-card">
                <div className="latest-order-summary-row">
                  <span className="latest-order-status-text">{financialStatusLabel(latestOrder.financialStatus)} · {fulfillmentStatusLabel(latestOrder.fulfillmentStatus)}</span>
                  <time className="latest-order-meta" dateTime={latestOrder.createdAt} title={orderDateTime(latestOrder.createdAt)}>{orderDateTime(latestOrder.createdAt)}</time>
                </div>
                <div className="latest-order-origin-row">
                  <span className="latest-order-source" title={`来自 ${orderSourceLabel(latestOrder.sourceName)}`}>来自 {orderSourceLabel(latestOrder.sourceName)}</span>
                  <div className="latest-order-payment" title={`支付渠道：${latestOrder.paymentGatewayNames?.filter(Boolean).join("、") || "Shopify 未返回"}`}>
                    <CreditCard size={13} />
                    <span className="visually-hidden">支付渠道：</span>
                    <strong>{latestOrder.paymentGatewayNames?.filter(Boolean).join("、") || "Shopify 未返回"}</strong>
                  </div>
                </div>
                <div className="latest-order-products">
                  <span>商品标题</span>
                  <div className="latest-order-product-list">
                    {latestOrderProductTitles.length ? latestOrderProductTitles.map((title, index) => (
                      <span key={`${title}-${index}`} title={title}>{title}</span>
                    )) : <span className="latest-order-product-empty">暂无商品标题</span>}
                  </div>
                </div>
                <div className="latest-order-amounts">
                  {orderAmountBreakdown(latestOrder).map((item) => (
                    <div className={item.label === "订单总额" ? "latest-order-total" : ""} key={item.label}>
                      <span>{item.label}</span>
                      <strong>{orderMoney(item.value)}</strong>
                    </div>
                  ))}
                </div>
                <div className="latest-order-address">
                  <div>
                    <strong>订单收货地址</strong>
                    <button
                      type="button"
                      disabled={!latestOrder.id}
                      title="修改当前订单的收货地址"
                      onClick={openShippingAddressEditor}
                    ><Pencil size={13} /> 修改</button>
                  </div>
                  <span>{shippingAddressDisplay(latestOrder.shippingAddress) || "该订单没有收货地址"}</span>
                </div>
                <div className="latest-order-trackings">
                  <div className="latest-order-subsection-heading">
                    <strong>物流信息</strong>
                    {!latestOrderTrackings.length && primaryEditableFulfillment ? (
                      <button
                        type="button"
                        title="为现有履约记录添加物流单号"
                        onClick={() => openTrackingEditor(primaryEditableFulfillment)}
                      ><Pencil size={13} /> 添加单号</button>
                    ) : null}
                  </div>
                  {latestOrderTrackings.map((tracking) => (
                    <div className="latest-order-tracking-row" key={tracking.number}>
                      <div><span>{tracking.company || "承运商未知"}</span><code>{tracking.number}</code></div>
                      <div>
                        <button type="button" title="复制物流单号" aria-label="复制物流单号" onClick={() => void copyText(tracking.number!, "物流单号")}><Copy size={14} /></button>
                        <button
                          type="button"
                          title="修改物流单号"
                          aria-label="修改物流单号"
                          disabled={!tracking.fulfillmentId}
                          onClick={() => {
                            const fulfillment = latestOrder.fulfillments.find((item) => item.id === tracking.fulfillmentId);
                            if (fulfillment) openTrackingEditor(fulfillment, tracking);
                          }}
                        ><Pencil size={14} /></button>
                        <button type="button" onClick={() => openLogisticsTracking(tracking.company || "", tracking.number!)}><Truck size={14} /> 查询轨迹</button>
                      </div>
                    </div>
                  ))}
                  {!latestOrderTrackings.length ? <span className="latest-order-no-tracking">{primaryEditableFulfillment ? "该履约记录尚未填写物流单号" : "订单尚未创建履约，暂不能添加物流单号"}</span> : null}
                </div>
              </article>
            ) : !orderLookupBusy && !orderLookupError ? <div className="mini-empty">暂未关联 Shopify 订单</div> : null}
          </section>
          {props.selectedConversation ? (
            <section className="side-section conversation-record-section" aria-label="消息分类和客服备注">
              <div className="conversation-record-heading">
                <strong>消息分类 / 客服备注</strong>
                <span className={`record-save-state ${recordSaveState}`}>
                  {recordSaveState === "classifying"
                    ? "AI 生成备注中"
                    : recordSaveState === "saving"
                      ? "保存中"
                      : recordSaveState === "unsaved"
                        ? "2 秒后保存"
                        : recordSaveState === "error"
                          ? recordSaveError.startsWith("AI ") ? "AI 生成失败" : "保存失败"
                          : props.selectedConversation.recordAutoFilled && recordDraft.remark
                            ? "AI 已生成"
                            : "已保存"}
                </span>
              </div>
              {recordCategoryError ? <span className="lookup-error">{recordCategoryError}</span> : null}
              <div className="record-category-grid">
                <label>
                  <span>一级分类</span>
                  <select value={recordDraft.primary} disabled={!recordCategories.length} onChange={(event) => changeRecordPrimary(event.target.value)}>
                    {recordPrimaryOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label>
                  <span>二级分类</span>
                  <select value={recordDraft.secondary} disabled={!recordSecondaryOptions.length} onChange={(event) => changeRecordSecondary(event.target.value)}>
                    {recordSecondaryOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="record-category-wide">
                  <span>三级分类</span>
                  <select value={recordDraft.tertiary} disabled={!recordTertiaryOptions.length} onChange={(event) => changeRecordTertiary(event.target.value)}>
                    {recordTertiaryOptions.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <label className="record-category-wide">
                  <span>客服备注</span>
                  <textarea
                    rows={3}
                    value={recordDraft.remark}
                    placeholder="记录客户问题、处理结果和后续事项"
                    onChange={(event) => scheduleRemarkSave({ ...recordDraftRef.current, remark: event.target.value })}
                    onBlur={flushRemarkSave}
                  />
                </label>
              </div>
              {recordSaveError ? <span className="lookup-error">{recordSaveError}</span> : null}
            </section>
          ) : null}
        </> : null}
        {rightPanelTab === "logistics" ? <section className="logistics-tab">
          <div className="logistics-tab-heading">
            <Truck size={18} />
            <div><strong>物流轨迹查询</strong><span>从客户最新订单选择包裹并查看完整轨迹。</span></div>
          </div>
          <div className={`logistics-service-state ${logisticsStatus?.configured ? "configured" : "unconfigured"}`}>
            <strong>{logisticsStatus?.configured ? `已接入 ${logisticsStatus.provider || "物流查询服务"}` : "物流查询服务尚未配置"}</strong>
            <span>{logisticsStatus?.configured ? "查询结果由已配置的第三方物流服务返回。" : logisticsStatus?.message || "接入第三方物流 API 后即可返回真实物流轨迹。"}</span>
          </div>
          {latestOrderTrackings.length ? <div className="logistics-package-picker">
            <label>
              <span>订单包裹</span>
              <select
                value={logisticsTrackingNumber || latestOrderTrackings[0].number || ""}
                disabled={logisticsBusy}
                onChange={(event) => {
                  const tracking = latestOrderTrackings.find((item) => item.number === event.target.value);
                  if (tracking?.number) openLogisticsTracking(tracking.company || "", tracking.number);
                }}
              >
                {latestOrderTrackings.map((tracking) => <option key={tracking.number} value={tracking.number}>{tracking.company || "承运商未知"} · {tracking.number}</option>)}
              </select>
            </label>
            <small>{latestOrder?.name || "最新订单"} · {latestOrderTrackings.length} 个包裹</small>
          </div> : <div className="mini-empty">当前订单暂无物流单号</div>}
          {logisticsError ? <span className="lookup-error">{logisticsError}</span> : null}
          {logisticsBusy ? <div className="logistics-loading"><RefreshCw size={16} /> 正在查询物流轨迹</div> : null}
          {logisticsResult ? <div className="logistics-result">
            <div className="logistics-result-header"><div><span>{logisticsResult.carrier || "承运商未知"}</span><strong>{logisticsResult.trackingNumber}</strong></div><Badge tone={logisticsStatusTone(logisticsResult.status)}>{logisticsStatusLabel(logisticsResult.status) || "已查询"}</Badge></div>
            {logisticsResult.configured ? <>
              <div className="logistics-event-list">
                {logisticsResult.events.map((event, index) => <article key={`${event.time}-${index}`}><time>{formatLogisticsEventTime(event.time)}</time><span>{logisticsEventText(event)}</span>{event.location ? <small><MapPin size={11} />{event.location}</small> : null}</article>)}
                {!logisticsResult.events.length ? <div className="mini-empty">{logisticsResult.message || "服务未返回物流轨迹"}</div> : null}
              </div>
              <button
                className="primary logistics-send-latest"
                type="button"
                disabled={!canReply || logisticsBusy || logisticsSending || !logisticsResult.events.length}
                onClick={() => void sendLatestLogisticsEvent()}
              >
                <Send size={15} />
                {!canReply
                  ? props.selectedConversation?.status === "closed" ? "重新打开会话后发送" : "接入会话后发送"
                  : logisticsSending
                    ? "发送中"
                    : !logisticsResult.events.length ? "暂无轨迹可发送" : "发送最新轨迹"}
              </button>
            </> : <div className="mini-empty">{logisticsResult.message || "物流查询服务尚未配置"}</div>}
          </div> : null}
        </section> : null}
        {rightPanelTab === "tickets" ? <section className="conversation-ticket-tab">
          <div className="conversation-ticket-head"><div><strong>关联工单</strong><span>跟进需要跨会话或跨班次处理的问题</span></div><button type="button" onClick={() => setTicketCreateOpen(true)}><ClipboardPlus size={14} /> 新建</button></div>
          <div className="conversation-ticket-list">
            {conversationTickets.map((ticket) => <article key={ticket.id}>
              <header><div><span>{ticket.id}</span><strong>{ticket.title}</strong></div><Badge tone={ticketStatusTone(ticket.status)}>{ticketStatusText(ticket.status)}</Badge></header>
              <p>{ticket.description || "暂无问题说明"}</p>
              <footer><span>{ticket.category} · {ticketPriorityText(ticket.priority)}</span><span>{ticketStatusHint(ticket.status)}</span></footer>
              {ticket.assignedAgentId === props.currentUser.id && (ticket.status === "in_progress" || ticket.status === "pending")
                ? <div className="conversation-ticket-actions"><button type="button" disabled={resolvingTicketID === ticket.id} onClick={() => void resolveConversationTicket(ticket)}><CheckCircle2 size={14} />{resolvingTicketID === ticket.id ? "处理中" : "完成工单"}</button></div>
                : null}
            </article>)}
            {!conversationTickets.length ? <Empty text="当前会话尚未创建工单" /> : null}
          </div>
        </section> : null}
      </aside>

      <div
        className="pane-resizer pane-resizer-session"
        role="separator"
        aria-label="调整会话列表宽度"
        aria-orientation="vertical"
        aria-valuemin={260}
        aria-valuemax={maximumPanelWidth("session-list")}
        aria-valuenow={workbenchLayout.sessionListWidth}
        tabIndex={0}
        onDoubleClick={() => resetResize("session-list")}
        onKeyDown={(event) => resizeWithKeyboard("session-list", event)}
        onPointerDown={(event) => startResize("session-list", event)}
        onPointerMove={continueResize}
        onPointerUp={stopResize}
        onLostPointerCapture={stopResize}
      />
      <div
        className="pane-resizer pane-resizer-customer"
        role="separator"
        aria-label="调整客户与订单区宽度"
        aria-orientation="vertical"
        aria-valuemin={280}
        aria-valuemax={maximumPanelWidth("customer-panel")}
        aria-valuenow={workbenchLayout.customerPanelWidth}
        tabIndex={0}
        onDoubleClick={() => resetResize("customer-panel")}
        onKeyDown={(event) => resizeWithKeyboard("customer-panel", event)}
        onPointerDown={(event) => startResize("customer-panel", event)}
        onPointerMove={continueResize}
        onPointerUp={stopResize}
        onLostPointerCapture={stopResize}
      />

      {shippingAddressEditor ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !shippingAddressSaving) setShippingAddressEditor(null); }}>
          <section className="order-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="shipping-address-edit-title">
            <header>
              <div><strong id="shipping-address-edit-title">修改订单收货地址</strong><span>{shippingAddressEditor.orderName} · 仅修改当前订单，不改客户默认地址</span></div>
              <button type="button" disabled={shippingAddressSaving} onClick={() => setShippingAddressEditor(null)} aria-label="关闭收货地址编辑"><X size={18} /></button>
            </header>
            <form onSubmit={saveShippingAddress}>
              <div className="order-address-fields">
                <label><span>名字</span><input autoFocus value={shippingAddressEditor.address.firstName} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, firstName: event.target.value } } : current)} /></label>
                <label><span>姓氏</span><input value={shippingAddressEditor.address.lastName} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, lastName: event.target.value } } : current)} /></label>
                <label className="order-edit-wide"><span>公司（可选）</span><input value={shippingAddressEditor.address.company} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, company: event.target.value } } : current)} /></label>
                <label className="order-edit-wide"><span>地址第一行</span><input required value={shippingAddressEditor.address.address1} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, address1: event.target.value } } : current)} /></label>
                <label className="order-edit-wide"><span>地址第二行（公寓、房间号等）</span><input value={shippingAddressEditor.address.address2} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, address2: event.target.value } } : current)} /></label>
                <label><span>城市</span><input required value={shippingAddressEditor.address.city} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, city: event.target.value } } : current)} /></label>
                <label><span>州/省代码</span><input value={shippingAddressEditor.address.provinceCode} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, provinceCode: event.target.value.toUpperCase() } } : current)} placeholder="例如 CA" /></label>
                <label><span>国家/地区代码</span><input required maxLength={2} pattern="[A-Za-z]{2}" value={shippingAddressEditor.address.countryCode} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, countryCode: event.target.value.toUpperCase() } } : current)} placeholder="例如 US" /></label>
                <label><span>邮编</span><input value={shippingAddressEditor.address.zip} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, zip: event.target.value } } : current)} /></label>
                <label className="order-edit-wide"><span>联系电话（可选）</span><input type="tel" value={shippingAddressEditor.address.phone} onChange={(event) => setShippingAddressEditor((current) => current ? { ...current, address: { ...current.address, phone: event.target.value } } : current)} placeholder="建议使用含国家代码的号码" /></label>
              </div>
              {shippingAddressError ? <div className="order-edit-error" role="alert">{shippingAddressError}</div> : null}
              <footer>
                <span>保存后会立即写入 Shopify 订单。</span>
                <div>
                  <button type="button" disabled={shippingAddressSaving} onClick={() => setShippingAddressEditor(null)}>取消</button>
                  <button className="primary" type="submit" disabled={shippingAddressSaving}><Check size={15} /> {shippingAddressSaving ? "保存中" : "保存地址"}</button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
      {trackingEditor ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !trackingSaving) setTrackingEditor(null); }}>
          <section className="order-edit-dialog tracking-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="tracking-edit-title">
            <header>
              <div><strong id="tracking-edit-title">修改物流单号</strong><span>更新当前 Shopify 履约记录，不会新建发货</span></div>
              <button type="button" disabled={trackingSaving} onClick={() => setTrackingEditor(null)} aria-label="关闭物流单号编辑"><X size={18} /></button>
            </header>
            <form onSubmit={saveTrackingUpdate}>
              <div className="order-address-fields">
                <label className="order-edit-wide"><span>物流公司</span><input autoFocus value={trackingEditor.company} onChange={(event) => setTrackingEditor((current) => current ? { ...current, company: event.target.value } : current)} placeholder="例如 UPS、China Post" /></label>
                <label className="order-edit-wide"><span>物流单号</span><input required value={trackingEditor.number} onChange={(event) => setTrackingEditor((current) => current ? { ...current, number: event.target.value } : current)} /></label>
                <label className="order-edit-wide"><span>查询链接（可选）</span><input type="url" value={trackingEditor.url} onChange={(event) => setTrackingEditor((current) => current ? { ...current, url: event.target.value } : current)} placeholder="https://www.17track.net/en" /></label>
              </div>
              <div className="order-edit-notice"><CircleHelp size={14} /><span>本次保存默认不向客户发送 Shopify 物流更新邮件。</span></div>
              {trackingEditError ? <div className="order-edit-error" role="alert">{trackingEditError}</div> : null}
              <footer>
                <span>缺少履约写入授权时，请在店铺配置中重新发布 App 并重新授权。</span>
                <div>
                  <button type="button" disabled={trackingSaving} onClick={() => setTrackingEditor(null)}>取消</button>
                  <button className="primary" type="submit" disabled={trackingSaving || !trackingEditor.number.trim()}><Check size={15} /> {trackingSaving ? "保存中" : "保存物流"}</button>
                </div>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
      {productPickerOpen ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setProductPickerOpen(false); }}>
          <section className="product-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="product-picker-title">
            <header>
              <div><strong id="product-picker-title">推荐 Shopify 商品</strong><span>点击商品卡加入回复框，客服补充文案后统一发送</span></div>
              <button type="button" onClick={() => setProductPickerOpen(false)} aria-label="关闭商品选择器"><X size={18} /></button>
            </header>
            <form className="product-search-form" onSubmit={searchProducts}>
              <Search size={17} />
              <input ref={productSearchRef} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} placeholder="搜索商品名称、SKU 或标签" aria-label="搜索 Shopify 商品" />
              <button className="primary" type="submit" disabled={!productQuery.trim() || productSearchBusy}>{productSearchBusy ? "搜索中" : "搜索"}</button>
            </form>
            {productSearchError ? <div className="product-picker-error" role="alert">{productSearchError}</div> : null}
            <div className="product-picker-results">
              {entryProduct ? <div className="product-picker-section-title"><Store size={15} /><strong>客户进线商品</strong></div> : entryContext.pageTitle ? <div className="entry-product-context"><Store size={15} /><div><strong>客户从非商品页进线</strong><span>{entryContext.pageTitle}</span></div><Badge tone="muted">无进线商品</Badge></div> : null}
              {entryProduct ? renderProductPickerItem(entryProduct, true) : null}
              <div className="product-picker-section-title"><ShoppingBag size={15} /><strong>{productQuery.trim() ? "商品搜索结果" : "Shopify 推荐商品"}</strong></div>
              {products.map((product) => renderProductPickerItem(product))}
              {!products.length && !productSearchError && !productSearchBusy ? <div className="product-picker-empty"><ShoppingBag size={28} /><span>{productQuery.trim() ? "未找到匹配商品" : "Shopify 暂未返回推荐商品，可使用上方搜索"}</span></div> : null}
            </div>
          </section>
        </div>
      ) : null}
      {knowledgeSubmitOpen && activeShop ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !knowledgeSubmitting) setKnowledgeSubmitOpen(false); }}>
          <section className="knowledge-submit-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledge-submit-title">
            <header>
              <div><strong id="knowledge-submit-title">申请加入知识库</strong><span>{activeShop.displayName} · {canReviewKnowledge ? "提交后直接发布" : "提交后进入待审核"}</span></div>
              <button type="button" disabled={knowledgeSubmitting} onClick={() => setKnowledgeSubmitOpen(false)} aria-label="关闭知识申请"><X size={18} /></button>
            </header>
            <form onSubmit={submitConversationKnowledge}>
              <label><span>客户问题或场景</span><textarea value={knowledgeTitleDraft} onChange={(event) => setKnowledgeTitleDraft(event.target.value)} maxLength={500} placeholder="当前客户提出的问题或业务场景" autoFocus /></label>
              <label><span>建议收录的客服回复</span><textarea value={knowledgeAnswerDraft} onChange={(event) => setKnowledgeAnswerDraft(event.target.value)} maxLength={8000} placeholder="可复用、已核对的客服回复" /></label>
              <label><span>标签</span><input value={knowledgeTagsDraft} onChange={(event) => setKnowledgeTagsDraft(event.target.value)} placeholder="例如：物流, 延迟, 售后" /></label>
              {knowledgeSubmitError ? <div className="product-picker-error" role="alert">{knowledgeSubmitError}</div> : null}
              <footer>
                <button type="button" disabled={knowledgeSubmitting} onClick={() => setKnowledgeSubmitOpen(false)}>取消</button>
                <button className="primary" type="submit" disabled={knowledgeSubmitting || !knowledgeTitleDraft.trim() || !knowledgeAnswerDraft.trim()}><BookOpen size={15} /> {knowledgeSubmitting ? "提交中" : canReviewKnowledge ? "提交并发布" : "提交审核"}</button>
              </footer>
            </form>
          </section>
        </div>
      ) : null}
      {aiRulesOpen && activeShop ? (
        <div className="product-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !aiRulesSaving) setAIRulesOpen(false); }}>
          <section className="ai-rules-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-rules-title">
            <header>
              <div>
                <strong id="ai-rules-title">店铺 AI 回复规则</strong>
                <span>{activeShop.displayName}</span>
              </div>
              <button type="button" disabled={aiRulesSaving} onClick={() => setAIRulesOpen(false)} aria-label="关闭 AI 回复规则"><X size={18} /></button>
            </header>
            <label className="ai-rules-field">
              <span>规则内容（每行一条）</span>
              <textarea
                value={aiRulesDraft}
                onChange={(event) => setAIRulesDraft(event.target.value)}
                disabled={aiRulesLoading || aiRulesSaving}
                maxLength={4000}
                placeholder={"回复保持简洁，不超过 80 个单词\n不得承诺具体到货日期\n退款或拒付必须交由人工确认"}
                autoFocus
              />
            </label>
            {aiRulesError ? <div className="ai-rules-error" role="alert">{aiRulesError}</div> : null}
            <footer>
              <span>
                {aiRulesLoading
                  ? "正在加载..."
                  : aiRulesResult?.updatedAt
                    ? `最后修改：${aiRulesResult.updatedByName || "未知客服"} · ${timeLabel(aiRulesResult.updatedAt, t)}`
                    : "尚未设置"}
              </span>
              <div>
                <button type="button" disabled={aiRulesSaving} onClick={() => setAIRulesOpen(false)}>取消</button>
                <button className="primary" type="button" disabled={aiRulesLoading || aiRulesSaving} onClick={() => void saveAIReplyRules()}><Check size={16} /> {aiRulesSaving ? "保存中" : "保存规则"}</button>
              </div>
            </footer>
          </section>
        </div>
      ) : null}
      {transferOpen && props.selectedConversation ? <TransferDialog api={props.api} conversation={props.selectedConversation} onClose={() => setTransferOpen(false)} onDone={async () => { await refreshWorkflowData(); await props.onChanged(); }} setToast={props.setToast} /> : null}
      {ticketCreateOpen && props.selectedConversation ? <CreateTicketDialog api={props.api} conversation={props.selectedConversation} shop={activeShop} onClose={() => setTicketCreateOpen(false)} onDone={async () => { await refreshWorkflowData(); setRightPanelTab("tickets"); }} setToast={props.setToast} /> : null}
    </section>
  );
}

function conversationRecordFromConversation(conversation: Conversation): ConversationRecordDraft {
  return {
    primary: conversation.recordPrimary || "",
    secondary: conversation.recordSecondary || "",
    tertiary: conversation.recordTertiary || "",
    remark: conversation.recordRemark || ""
  };
}

function ticketStatusText(status: string) {
  return ({ open: "待接收", in_progress: "处理中", pending: "等待中", pending_review: "待验收", resolved: "已完成", closed: "已关闭", cancelled: "已取消" } as Record<string, string>)[status] || status;
}

function ticketStatusHint(status: string) {
  if (status === "open") return "等待接收客服确认";
  if (status === "pending_review") return "已提交，等待创建人验收";
  if (status === "resolved") return "工单已完成";
  if (status === "closed") return "工单已关闭";
  return "请继续处理并记录结果";
}

function ticketPriorityText(priority: string) {
  return ({ low: "低", normal: "普通", high: "高", urgent: "紧急" } as Record<string, string>)[priority] || priority;
}

function productMessageMetadata(product: ShopifyProductSummary, variant: ShopifyProductVariant): Record<string, string> {
  return {
    productId: product.id,
    productTitle: product.title,
    variantId: variant.id,
    variantTitle: variant.title,
    sku: variant.sku || "",
    price: variant.price.amount,
    currencyCode: variant.price.currencyCode,
    imageUrl: product.imageUrl || "",
    onlineStoreUrl: product.onlineStoreUrl || ""
  };
}

function safeExternalURL(value?: string): string {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}
