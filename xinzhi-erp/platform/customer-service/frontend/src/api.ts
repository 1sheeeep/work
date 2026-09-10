export type UserRole = "admin" | "agent";
export type UserDepartment = "客服部" | "财务部" | "综合部";

export type User = {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: string;
  department?: UserDepartment | string;
  skillGroup?: "咨询接待" | "售后" | string;
  receptionLimit: number;
  receptionOnline: boolean;
  permissions: string[];
  permissionsCustomized: boolean;
  shopScope?: "assigned" | "selected" | "all" | string;
  shopScopeIds?: string[];
  workbenchShopScope: "assigned" | "all" | string;
  conversationScope: "assigned" | "all" | string;
  systemAdmin: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthResult = {
  token: string;
  expiresAt: string;
  user: User;
  tenantId?: string;
  integrationMode?: "ERP_LOCAL_DEMO" | string;
};

export type Shop = {
  id: string;
  displayName: string;
  platform: string;
  externalId?: string;
  status: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type ShopSource = {
  id: string;
  shopId: string;
  type: string;
  provider: string;
  address?: string;
  status: string;
  metadata?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  shopId: string;
  sourceId: string;
  customerName?: string;
  customerEmail?: string;
  subject?: string;
  status: string;
  assignedAgentId?: string;
  lastMessageAt: string;
  customerLastMessageAt: string;
  lastMessageDirection?: "customer" | "agent" | string;
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
  unread: boolean;
  kind: "customer" | "system" | string;
  replyAllowed: boolean;
  classificationReason?: string;
  recordPrimary?: string;
  recordSecondary?: string;
  recordTertiary?: string;
  recordRemark?: string;
  recordOrderNumber?: string;
  recordClassified: boolean;
  recordAutoFilled: boolean;
  recordUpdatedAt?: string;
  recordUpdatedBy?: string;
  recordRemarkError?: string;
  routingReason?: "not_routable" | "no_assigned_agents" | "no_eligible_agents" | "agents_disconnected" | "agents_at_capacity" | "awaiting_assignment" | string;
};

export type AccountAuditLog = {
  id: string;
  actorUserId: string;
  targetUserId: string;
  action: string;
  changes?: Record<string, unknown>;
  createdAt: string;
};

export type ShopAgentAssignment = { shopId: string; userId: string; createdAt: string };

export type RecordCategoryOption = {
  primary: string;
  secondary: string;
  tertiary: string[];
};

export type ConversationRecordInput = {
  primary: string;
  secondary: string;
  tertiary: string;
  remark: string;
};

export type ProcessingRecord = {
  conversationId: string;
  handledAt: string;
  shopId: string;
  shopName: string;
  agentId?: string;
  agentName?: string;
  customerName: string;
  customerEmail: string;
  subject: string;
  orderNumber: string;
  primary: string;
  secondary: string;
  tertiary: string;
  inboundChannel: string;
  remark: string;
  status: string;
  updatedBy: string;
};

export type ProcessingRecordFilters = {
  shopId?: string;
  agentId?: string;
  status?: string;
  channel?: string;
  primary?: string;
  secondary?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  page?: string;
  pageSize?: string;
};

export type ProcessingRecordsResponse = {
  items: ProcessingRecord[];
  summary: {
    total: number;
    byPrimary: Record<string, number>;
    bySecondary: Record<string, number>;
  };
  page: number;
  pageSize: number;
  totalPages: number;
};

export type Message = {
  id: string;
  conversationId: string;
  direction: "customer" | "agent" | "system" | string;
  type: "text" | "image" | "file" | "product" | string;
  body: string;
  metadata?: Record<string, string>;
  senderName?: string;
  senderEmail?: string;
  sourceMessageId?: string;
  createdAt: string;
};

export type KnowledgeScope = "global" | "shop";
export type KnowledgeStatus = "pending" | "published" | "rejected";

export type KnowledgeEntry = {
  id: string;
  supersedesId?: string;
  scope: KnowledgeScope;
  shopId?: string;
  title: string;
  answer: string;
  tags: string[];
  status: KnowledgeStatus;
  conversationId?: string;
  submittedBy?: string;
  reviewedBy?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
};

export type EmailHistoryImportJob = {
  id: string;
  shopId: string;
  sourceId: string;
  provider: string;
  mailbox: string;
  status: "queued" | "running" | "paused" | "completed" | "failed" | "cancelled" | string;
  pagesProcessed: number;
  messagesScanned: number;
  messagesImported: number;
  messagesSkipped: number;
  filteredMessages: number;
  conversationsCreated: number;
  lastError?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ConversationPage = {
  items: Conversation[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type ConversationSummary = {
  assigned: number;
  open: number;
  closed: number;
  activeLoad: number;
  capacity: number;
  routingReasons: Record<string, string>;
};

export type DataScopeModule = "knowledge" | "monitor" | "records" | "tickets" | "orders" | "shops";

export type KnowledgePage = {
  items: KnowledgeEntry[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
};

export type CreateKnowledgeInput = {
  scope: KnowledgeScope;
  shopId?: string;
  title: string;
  answer: string;
  tags?: string[];
};

export type UpdateKnowledgeInput = Partial<CreateKnowledgeInput> & {
  status?: KnowledgeStatus;
  reviewNote?: string;
};

export type KnowledgeImportResult = {
  created: number;
  skipped: number;
  failed: number;
  issues: Array<{ sheet?: string; row: number; message: string }>;
};

export type AIReplyResult = {
  text: string;
  knowledgeUsed: KnowledgeEntry[];
  orderContext: ShopifyOrderSummary[];
};

export type AIPreparationResult = {
  status: "queued" | "processing" | "completed" | "failed" | "not_available" | string;
  text?: string;
  textZh?: string;
};

export type PlatformEvent = {
  type: string;
  shopId?: string;
  entityId?: string;
  payload?: unknown;
  conversation?: Conversation;
  createdAt: string;
};

export type AIReplyRulesResult = {
  shopId: string;
  rules: string;
  updatedBy?: string;
  updatedByName?: string;
  updatedAt?: string;
};

export type AISettings = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  models: string[];
  thinking: boolean;
  hasApiKey: boolean;
  keySource: "saved" | "environment" | "none";
  encryptionConfigured: boolean;
  updatedAt?: string;
};

export type AISettingsInput = {
  enabled: boolean;
  baseUrl: string;
  model: string;
  models: string[];
  thinking: boolean;
  apiKey?: string;
};

export type ShopifyOrderSearchResult = {
  orders: ShopifyOrderSummary[];
};

export type ConversationShopifyContext = {
  shopId: string;
  shopName: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
  orderNumber?: string;
  order?: ShopifyOrderSummary;
  snapshotAt?: string;
};

export type ShopifyOrderSyncState = {
  shopId: string;
  shopName: string;
  state: "idle" | "queued" | "syncing" | "ok" | "error" | string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  error?: string;
  syncedCount: number;
  orderCount: number;
  historyWindowDays?: number;
};

export type ShopifySyncedOrderResult = {
  orders: ShopifyOrderSummary[];
  total: number;
  page: number;
  pageSize: number;
  sync: ShopifyOrderSyncState[];
};

export type ShopifyAuthorizationStatus = {
  shopId: string;
  shopName: string;
  installed: boolean;
  needsReauthorization: boolean;
  missingScopes: string[];
};

export type ShopifyAuthorizationStatusResult = {
  feature: "refund" | "dispute";
  shops: ShopifyAuthorizationStatus[];
};

export type ShopifyProductSearchResult = {
  products: ShopifyProductSummary[];
  seedProduct?: ShopifyProductSummary;
};

export type ShopifyProductSummary = {
  id: string;
  title: string;
  handle: string;
  onlineStoreUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  variants: ShopifyProductVariant[];
};

export type ShopifyProductVariant = {
  id: string;
  title: string;
  sku?: string;
  availableForSale: boolean;
  price: { amount: string; currencyCode: string };
};

export type ShopifyCustomerProfile = {
  id: string;
  displayName?: string;
  email?: string;
  phone?: string;
  createdAt?: string;
  verifiedEmail: boolean;
  tags: string[];
  totalSpent?: { amount: string; currencyCode: string };
  defaultAddress?: string;
  lastOrder?: {
    id?: string;
    legacyResourceId?: string;
    name?: string;
    adminUrl?: string;
    email?: string;
    sourceName?: string;
    createdAt?: string;
    financialStatus?: string;
    fulfillmentStatus?: string;
    paymentGatewayNames?: string[];
    total?: { amount: string; currencyCode: string };
    subtotal?: { amount: string; currencyCode: string };
    productSubtotal?: { amount: string; currencyCode: string };
    shipping?: { amount: string; currencyCode: string };
    additionalServiceFees?: { amount: string; currencyCode: string };
    shippingAddress?: ShopifyMailingAddress;
    lineItems?: Array<{
      name: string;
      quantity: number;
      sku?: string;
      variantTitle?: string;
      requiresShipping: boolean;
      discountedTotal?: { amount: string; currencyCode: string };
    }>;
    fulfillments?: Array<{
      id?: string;
      status?: string;
      createdAt?: string;
      updatedAt?: string;
      trackingInfo?: Array<{
        company?: string;
        number?: string;
        url?: string;
      }>;
    }>;
  };
};

export type LogisticsSettings = {
  enabled: boolean;
  baseUrl: string;
  hasApiKey: boolean;
  encryptionConfigured: boolean;
  webhookUrl?: string;
  autoDraftEnabled: boolean;
  autoSendEnabled: boolean;
  chatEnabled: boolean;
  gmailEnabled: boolean;
  outlookEnabled: boolean;
  replyCooldownHours: number;
  lastTestedAt?: string;
  lastTestOk: boolean;
  lastTestError?: string;
  updatedAt?: string;
};

export type LogisticsSettingsInput = {
  enabled: boolean;
  apiKey?: string;
  autoDraftEnabled: boolean;
  autoSendEnabled: boolean;
  chatEnabled: boolean;
  gmailEnabled: boolean;
  outlookEnabled: boolean;
  replyCooldownHours: number;
};

export type ShopifyConnectionStatus = {
  state: "installed" | "not_installed" | "not_configured" | "unknown";
  shopDomain?: string;
  shopName?: string;
  message?: string;
  checkedAt?: string;
  themeEmbedState?: "enabled" | "disabled" | "not_added" | "permission_required" | "unavailable" | "unknown";
  themeEmbedMessage?: string;
  appDeployStatus?: "pending" | "running" | "ready" | "failed";
  appDeployVersion?: string;
  widgetRuntimeState?: "active" | "stale" | "not_seen";
  widgetLastSeenAt?: string;
};

export type EmailChannelCheckResult = {
  provider: string;
  sourcesChecked: number;
  sourcesHealthy: number;
  sourcesFailed: number;
  error?: string;
};

export type ShopChannelCheckResult = {
  checkedAt: string;
  healthy: boolean;
  hasChannels: boolean;
  shopify?: ShopifyConnectionStatus;
  shopifyError?: string;
  email: EmailChannelCheckResult[];
  sources: ShopSource[];
};

export type ResponseMetrics = { averageResponseSec: number; firstResponseSec: number; metrics: Array<{ userId: string; conversationCount: number; responseCount: number; averageResponseSec: number; firstResponseSec: number }> };

export type MonitorWorkSchedule = {
  configured: boolean;
  enabled: boolean;
  timezone: "Asia/Shanghai" | string;
  startMinute: number;
  endMinute: number;
  weekdays: number[];
  effectiveFrom?: string;
  updatedAt?: string;
};

export type MonitorWorkScheduleInput = {
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  weekdays: number[];
};

export type SLASettings = {
  firstResponseMinutes: number;
  responseMinutes: number;
  resolutionMinutes: number;
  updatedAt?: string;
};

export type HistoricalStatisticsView = "conversation" | "customer" | "agent" | "skill" | "service" | "sla";

export type HistoricalStatisticsFilters = {
  view: HistoricalStatisticsView;
  startDate: string;
  endDate: string;
  shopId?: string;
  agentId?: string;
  skillGroup?: string;
  channel?: string;
};

export type HistoricalStatisticsResponse = {
  view: HistoricalStatisticsView;
  startDate: string;
  endDate: string;
  dateBasis: string;
  summary: Array<{
    key: string;
    label: string;
    value: number;
    unit: "count" | "seconds" | "percent" | string;
    note?: string;
  }>;
  trendSeries: Array<{
    key: string;
    label: string;
    unit: "count" | "seconds" | "percent" | string;
  }>;
  trend: Array<{
    date: string;
    values: Record<string, number>;
  }>;
  columns: Array<{
    key: string;
    label: string;
    unit: "count" | "seconds" | "percent" | string;
  }>;
  breakdown: Array<{
    id: string;
    name: string;
    secondary?: string;
    values: Record<string, number>;
  }>;
  slaSettings?: SLASettings;
};

export type MonitorConversationItem = Conversation & {
  shopName: string;
  agentName?: string;
  sourceType: "chat" | "email" | string;
};

export type MonitorConversationPage = {
  items: MonitorConversationItem[];
  total: number;
  page: number;
  pageSize: number;
  summary: {
    open: number;
    assigned: number;
    closed: number;
    anomaly: number;
  };
};

export type MonitorOverview = {
  totals: {
    agents: number;
    shops: number;
    activeChannels: number;
    queued: number;
    assigned: number;
    emailPending: number;
    closedToday: number;
    anomaly: number;
  };
  agentOptions: Array<{
    id: string;
    name: string;
    role: UserRole;
    skillGroup?: string;
  }>;
  agents: Array<{
    id: string;
    name: string;
    role: UserRole;
    skillGroup?: string;
    online: boolean;
    shopNames: string[];
    assigned: number;
    queued: number;
    closedToday: number;
    anomaly: number;
    receptionLimit: number;
    receptionPercent: number;
  }>;
  skillGroups: Array<{
    name: string;
    agents: number;
    online: number;
    assigned: number;
    queued: number;
    closedToday: number;
    anomaly: number;
  }>;
  shops: Array<{
    id: string;
    name: string;
    shopifyReady: boolean;
    emailReady: boolean;
    agentNames: string[];
    queued: number;
    assigned: number;
    closedToday: number;
    anomaly: number;
    lastMessageAt?: string;
  }>;
};

export type ShopifyOrderSummary = {
  shopId?: string;
  shopName?: string;
  id: string;
  legacyResourceId?: string;
  name: string;
  adminUrl?: string;
  email?: string;
  sourceName?: string;
  createdAt: string;
  financialStatus?: string;
  fulfillmentStatus?: string;
  paymentGatewayNames?: string[];
  total: {
    amount: string;
    currencyCode: string;
  };
  subtotal?: {
    amount: string;
    currencyCode: string;
  };
  productSubtotal?: {
    amount: string;
    currencyCode: string;
  };
  shipping?: {
    amount: string;
    currencyCode: string;
  };
  additionalServiceFees?: {
    amount: string;
    currencyCode: string;
  };
  shippingAddress?: ShopifyMailingAddress;
  customer?: {
    id?: string;
    displayName?: string;
    email?: string;
    phone?: string;
    createdAt?: string;
    totalSpent?: {
      amount: string;
      currencyCode: string;
    };
    defaultAddress?: string;
    lastOrder?: {
      id?: string;
      legacyResourceId?: string;
      name?: string;
      adminUrl?: string;
      sourceName?: string;
      createdAt?: string;
      financialStatus?: string;
      fulfillmentStatus?: string;
      paymentGatewayNames?: string[];
      total?: {
        amount: string;
        currencyCode: string;
      };
    };
  };
  lineItems: Array<{
    name: string;
    quantity: number;
    sku?: string;
    variantTitle?: string;
    requiresShipping: boolean;
    discountedTotal?: {
      amount: string;
      currencyCode: string;
    };
  }>;
  fulfillments: Array<{
    id?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    trackingInfo?: Array<{
      company?: string;
      number?: string;
      url?: string;
    }>;
  }>;
};

export type ShopifyReturnLine = {
  id: string;
  name: string;
  sku?: string;
  reason?: string;
  quantity: number;
  processableQuantity: number;
  processedQuantity: number;
  refundableQuantity: number;
  refundedQuantity: number;
};

export type ShopifyReturn = {
  id: string;
  name: string;
  orderId: string;
  orderName: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  closedAt?: string;
  requestApprovedAt?: string;
  totalQuantity: number;
  lineItems: ShopifyReturnLine[];
};

export type ShopifyMoneyBag = {
  shopMoney: { amount: string; currencyCode: string };
  presentmentMoney: { amount: string; currencyCode: string };
};

export type ShopifyRefundLineSelection = { returnLineId: string; quantity: number };

export type ShopifyReturnRefundPreview = {
  returnId: string;
  state: "REFUNDABLE" | "NOT_REFUNDABLE" | string;
  lineItems: ShopifyRefundLineSelection[];
  refundShipping: boolean;
  refundAmount: ShopifyMoneyBag;
  maximumRefundable: ShopifyMoneyBag;
  shippingAmount?: ShopifyMoneyBag;
  transactions: Array<{
    parentTransactionId: string;
    gateway?: string;
    formattedGateway?: string;
    accountNumber?: string;
    amount: ShopifyMoneyBag;
  }>;
  previewToken?: string;
  expiresAt?: string;
};

export type ShopifyReturnRefundResult = {
  returnId: string;
  returnStatus: string;
  outcome: "APPLIED" | "PENDING" | "REVIEW_REQUIRED" | string;
  refundAmount: ShopifyMoneyBag;
  recoveredFromShopify: boolean;
  reviewTicketId?: string;
  updatedAt: string;
};

export type ShopifyDispute = {
  id: string;
  status: string;
  type: string;
  reason?: string;
  networkReasonCode?: string;
  amount: { amount: string; currencyCode: string };
  orderId?: string;
  orderName?: string;
  initiatedAt: string;
  evidenceDueBy?: string;
  evidenceSentOn?: string;
  finalizedOn?: string;
};

export type ShopifyMailingAddress = {
  name?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  provinceCode?: string;
  country?: string;
  countryCode?: string;
  zip?: string;
  phone?: string;
  formatted?: string[];
};

export type ShopifyShippingAddressInput = {
  firstName: string;
  lastName: string;
  company: string;
  address1: string;
  address2: string;
  city: string;
  provinceCode: string;
  countryCode: string;
  zip: string;
  phone: string;
};

export type ShopifyFulfillment = ShopifyOrderSummary["fulfillments"][number];

export type LogisticsTrackingStatus = {
  configured: boolean;
  provider?: string;
  message?: string;
};

export type LogisticsTrackingEvent = {
  time?: string;
  status?: string;
  description?: string;
  location?: string;
};

export type LogisticsTrackingResult = {
  configured: boolean;
  provider?: string;
  carrier?: string;
  trackingNumber: string;
  status?: string;
  message?: string;
  updatedAt?: string;
  events: LogisticsTrackingEvent[];
};

export type ShopAgent = {
  shopId: string;
  userId: string;
  createdAt: string;
};

export type BootstrapStatus = {
  needsBootstrap: boolean;
  authMode?: "local" | "erp_sso";
  erpLoginUrl?: string;
  tenantRequired?: boolean;
};

export type CreateUserInput = {
  email: string;
  displayName: string;
  password: string;
  role: UserRole;
  department?: UserDepartment | "";
  skillGroup?: "咨询接待" | "售后" | "";
  receptionLimit?: number;
  permissions?: string[];
  permissionsCustomized?: boolean;
  shopScope?: "assigned" | "selected" | "all";
  shopScopeIds?: string[];
  workbenchShopScope?: "assigned" | "all";
  conversationScope?: "assigned" | "all";
};

export type UpdateUserInput = {
  email?: string;
  displayName?: string;
  password?: string;
  role?: UserRole;
  department?: UserDepartment | "";
  skillGroup?: "咨询接待" | "售后" | "";
  status?: string;
  receptionLimit?: number;
  permissions?: string[];
  permissionsCustomized?: boolean;
  shopScope?: "assigned" | "selected" | "all";
  shopScopeIds?: string[];
  workbenchShopScope?: "assigned" | "all";
  conversationScope?: "assigned" | "all";
};

export type CreateShopInput = {
  displayName: string;
  platform?: string;
  externalId?: string;
  metadata?: Record<string, string>;
};

export type UpdateShopInput = {
  displayName?: string;
  platform?: string;
  externalId?: string;
  status?: string;
  metadata?: Record<string, string>;
};

export type CreateSourceInput = {
  type: string;
  provider?: string;
  address?: string;
  metadata?: Record<string, string>;
};

export type UpdateSourceInput = {
  status?: string;
  provider?: string;
  address?: string;
  metadata?: Record<string, string>;
};

export type OutlookAuthURLResult = {
  authUrl: string;
};

export type CuiqiuConnectInput = {
  mailbox: string;
  smtpPassword: string;
};

export type CuiqiuConnectResult = {
  source: ShopSource;
  webhookUrl: string;
};

export type StandardMailConnectInput = {
  mailbox: string;
  credential: string;
};

export type StandardMailConnectResult = {
  source: ShopSource;
};

export type CuiqiuDomainSettings = {
  domain: string;
  apiBase: string;
  hasToken: boolean;
  encryptionConfigured: boolean;
  domainId?: string;
  smtpHost: string;
  smtpPort: number;
  smtpMode: "tls" | "starttls";
  webhookUrl?: string;
  webhookVerifiedAt?: string;
  lastTestedAt?: string;
  lastTestOk: boolean;
  lastTestError?: string;
  updatedAt?: string;
};

export type CuiqiuDomainSettingsInput = {
  domain: string;
  apiBase: string;
  token: string;
  domainId?: string;
  smtpHost: string;
  smtpPort: number;
  smtpMode: "tls" | "starttls";
};

export type EmailDisconnectResult = {
  source: ShopSource;
  providerNotificationStopped: boolean;
};

export type OutlookConfigStatus = {
  configured: boolean;
  missing?: string[];
  redirectUri?: string;
};

export type MailConfigStatus = OutlookConfigStatus;

export type CreateConversationInput = {
  shopId: string;
  sourceId: string;
  customerName?: string;
  customerEmail?: string;
  subject?: string;
};

export type CreateMessageInput = {
  direction: string;
  type?: "text" | "image" | "product";
  body: string;
  metadata?: Record<string, string>;
  senderName?: string;
  senderEmail?: string;
};

export type UpdateConversationInput = {
  status?: string;
  assignedAgentId?: string;
};

export type TransferCandidate = {
  agent: User;
  skillGroup: string;
  activeConversations: number;
  capacity: number;
  presence: "available" | "offline" | "full" | string;
  requiresAcceptance: boolean;
};

export type TransferRequest = {
  id: string;
  conversationId: string;
  shopId: string;
  fromAgentId: string;
  targetAgentId?: string;
  targetSkillGroup?: string;
  note?: string;
  status: "pending" | "accepted" | "rejected" | "cancelled" | "completed" | string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type TicketAttachment = { name: string; url: string; type?: string };

export type Ticket = {
  id: string;
  type: "customer" | "internal" | string;
  parentTicketId?: string;
  conversationId?: string;
  shopId?: string;
  customerRef?: string;
  customerName?: string;
  customerEmail?: string;
  orderNumber?: string;
  title: string;
  category: string;
  priority: "low" | "normal" | "high" | "urgent" | string;
  status: "open" | "in_progress" | "pending" | "resolved" | "closed" | string;
  assignedGroup?: string;
  assignedAgentId?: string;
  handoffFromAgentId?: string;
  collaboratorIds: string[];
  description?: string;
  attachments?: TicketAttachment[];
  dueAt?: string;
  waitingReason?: string;
  requiresAcceptance: boolean;
  acceptedAt?: string;
  completedBy?: string;
  completedAt?: string;
  cancelledAt?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TicketCustomer = {
  customerRef: string;
  shopId: string;
  customerName?: string;
  customerEmail?: string;
  conversationId: string;
  lastMessageAt: string;
};

export type TicketComment = {
  id: string;
  ticketId: string;
  authorId: string;
  kind: "comment" | "system" | string;
  body: string;
  createdAt: string;
};

export type EmailProcessingCategory = "verification" | "security" | "payment" | "logistics" | "platform" | "other";
export type EmailProcessingTagColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

export type EmailProcessingTag = {
  label: string;
  color: EmailProcessingTagColor;
};

export type EmailProcessingItem = {
  conversation: Conversation;
  shopName: string;
  sourceAddress: string;
  provider: string;
  category: EmailProcessingCategory;
  preview?: string;
  shopifyOfficial: boolean;
  tags: EmailProcessingTag[];
};

export type EmailProcessingOption = {
  id: string;
  label: string;
  shopId?: string;
  provider?: string;
  connected?: boolean;
  syncable?: boolean;
};

export type EmailProcessingPage = {
  items: EmailProcessingItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  openCount: number;
  shops: EmailProcessingOption[];
  mailboxes: EmailProcessingOption[];
  tagOptions: EmailProcessingTag[];
};

export type EmailProcessingDetail = {
  item: EmailProcessingItem;
  messages: Message[];
};

export type EmailProcessingActionResponse = {
  item: EmailProcessingItem;
  emailReadSynced?: boolean;
  emailReadPending?: boolean;
};

export type EmailStatisticsRecord = {
  conversationId: string;
  messageId: string;
  uniqueId: string;
  mailbox: string;
  senderName?: string;
  senderEmail?: string;
  recipient: string;
  receivedAt: string;
  receivedAtDisplay: string;
  originalReceivedAt?: string;
  subject: string;
  preview?: string;
  provider: string;
  shopId: string;
  shopName: string;
  shopNote?: string;
  hasAttachments: boolean;
  attachmentNames?: string[];
  category: EmailProcessingCategory;
  status: string;
  tags: EmailProcessingTag[];
  messageHeaderId?: string;
  replyTo?: string;
};

export type EmailStatisticsPage = {
  items: EmailStatisticsRecord[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  shops: EmailProcessingOption[];
  mailboxes: EmailProcessingOption[];
  providers: string[];
};

export type EmailStatisticsDetail = {
  record: EmailStatisticsRecord;
  body: string;
};

export type EmailStatisticsFilters = {
  shopId?: string;
  sourceId?: string;
  provider?: string;
  category?: string;
  status?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
};

export type EmailStatisticsExportJob = {
  id: string;
  status: "queued" | "running" | "completed" | "failed";
  filename?: string;
  rowCount: number;
  progressStage?: string;
  attachmentTotal: number;
  attachmentProcessed: number;
  attachmentSucceeded: number;
  attachmentFailed: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  expiresAt: string;
};

export type TicketSummary = {
  total: number;
  customer: number;
  internal: number;
  open: number;
  inProgress: number;
  pendingReview: number;
  overdue: number;
  mine: number;
  waitingForMe: number;
  reviewForMe: number;
  createdByMe: number;
  active: number;
  completed: number;
};

export type VisitorSchemeInstantAnswer = {
  id: string;
  title: string;
  answer: string;
  mode: "text" | "order_tracking";
  enabled: boolean;
  sort: number;
};

export type VisitorScheme = {
  id: string;
  name: string;
  language: "auto" | "en" | string;
  instantAnswersEnabled: boolean;
  instantAnswers: VisitorSchemeInstantAnswer[];
  isDefault: boolean;
  shopIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type VisitorSchemeInput = Pick<VisitorScheme, "name" | "language" | "instantAnswersEnabled" | "instantAnswers">;

export type TicketAcceptance = {
  ticket: Ticket;
  conversation?: Conversation;
};

export type TicketContext = {
  conversation: Conversation;
  messages: Message[];
  hasMore?: boolean;
};

export type CreateTicketInput = Omit<Ticket, "id" | "type" | "handoffFromAgentId" | "waitingReason" | "acceptedAt" | "completedBy" | "completedAt" | "cancelledAt" | "collaboratorIds" | "requiresAcceptance" | "createdBy" | "createdAt" | "updatedAt"> & {
  type?: Ticket["type"];
  collaboratorIds?: string[];
  requiresAcceptance?: boolean;
};
export type UpdateTicketInput = Partial<Pick<Ticket, "title" | "category" | "priority" | "assignedGroup" | "assignedAgentId" | "collaboratorIds" | "description" | "dueAt" | "requiresAcceptance">> & {
  handoverNote?: string;
};

export class PlatformAPI {
  baseUrl: string;
  token: string;
  tenantId: string;

  constructor(baseUrl: string, token = "", tenantId = "") {
    this.baseUrl = cleanBaseUrl(baseUrl);
    this.token = token;
    this.tenantId = tenantId;
  }

  withToken(token: string, tenantId = this.tenantId) {
    return new PlatformAPI(this.baseUrl, token, tenantId);
  }

  async createWSTicket() {
    return this.request<{ ticket: string; expiresAt: string }>("/api/v1/auth/ws-ticket", {
      method: "POST"
    });
  }

  eventsUrl(ticket: string) {
    const url = new URL("/ws/events", this.baseUrl);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("ticket", ticket);
    return url.toString();
  }

  async health() {
    return this.request<{ ok: boolean; service: string; storage: { name: string; ok: boolean; error?: string } }>("/healthz");
  }

  async bootstrapStatus() {
    return this.request<BootstrapStatus>("/api/v1/bootstrap/status");
  }

  async bootstrapAdmin(input: Omit<CreateUserInput, "role">) {
    return this.request<AuthResult>("/api/v1/bootstrap/admin", {
      method: "POST",
      body: input
    });
  }

  async login(email: string, password: string) {
    return this.request<AuthResult>("/api/v1/auth/login", {
      method: "POST",
      body: { email, password }
    });
  }

  async loginWithERP(input: { tenantCode: string; loginIdentifier: string; password: string }) {
    const endpoint = new URL(`${this.baseUrl}/api/v1/auth/erp/login`, window.location.href);
    if (endpoint.origin !== window.location.origin || endpoint.username || endpoint.password) {
      throw new PlatformAPIError("Sign-in must use the workbench origin", 503, null);
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(20000)
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new PlatformAPIError("Sign-in could not be completed", response.status, null);
    const result = payload as AuthResult;
    if (!result || typeof result.token !== "string" || !result.token || typeof result.tenantId !== "string" || !result.tenantId || !result.user?.id || result.integrationMode !== "ERP_PASSWORDLESS") {
      throw new PlatformAPIError("Invalid sign-in response", 503, null);
    }
    return result;
  }

  async me() {
    return this.request<User>("/api/v1/auth/me");
  }

  async updateMyRouting(input: Pick<UpdateUserInput, "receptionLimit">) {
    return this.request<User>("/api/v1/auth/me/routing", {
      method: "PATCH",
      body: input
    });
  }

  async logout() {
    return this.request<{ ok: boolean }>("/api/v1/auth/logout", { method: "POST" });
  }

  async listUsers() {
    return (await this.request<User[] | null>("/api/v1/users")) ?? [];
  }

  async createUser(input: CreateUserInput) {
    return this.request<User>("/api/v1/users", { method: "POST", body: input });
  }

  async updateUser(userId: string, input: UpdateUserInput) {
    return this.request<User>(`/api/v1/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: input
    });
  }

  async deleteUser(userId: string) {
    return this.request<{ ok: boolean }>(`/api/v1/users/${encodeURIComponent(userId)}`, {
      method: "DELETE"
    });
  }

  async listShops(scope?: "assigned" | "workbench" | DataScopeModule) {
    const suffix = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return (await this.request<Shop[] | null>(`/api/v1/shops${suffix}`)) ?? [];
  }

  async exportShops() {
    const response = await this.requestBlob("/api/v1/shops/export");
    return {
      blob: response.blob,
      filename: decodeAttachmentFilename(response.contentDisposition) || "Xzdesk_店铺账号明细.xlsx"
    };
  }

  async createShop(input: CreateShopInput) {
    return this.request<Shop>("/api/v1/shops", { method: "POST", body: input });
  }

  async updateShop(shopId: string, input: UpdateShopInput) {
    return this.request<Shop>(`/api/v1/shops/${encodeURIComponent(shopId)}`, {
      method: "PATCH",
      body: input
    });
  }

  async listUserAuditLogs(userId: string) {
    return (await this.request<AccountAuditLog[] | null>(`/api/v1/users/${encodeURIComponent(userId)}/audit-logs`)) ?? [];
  }

  async getShopAIReplyRules(shopId: string) {
    return this.request<AIReplyRulesResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/ai-reply-rules`);
  }

  async saveShopAIReplyRules(shopId: string, rules: string) {
    return this.request<AIReplyRulesResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/ai-reply-rules`, {
      method: "PATCH",
      body: { rules }
    });
  }

  async deleteShop(shopId: string) {
    return this.request<{ ok: boolean }>(`/api/v1/shops/${encodeURIComponent(shopId)}`, {
      method: "DELETE"
    });
  }

  async listSources(shopId: string) {
    return (await this.request<ShopSource[] | null>(`/api/v1/shops/${encodeURIComponent(shopId)}/sources`)) ?? [];
  }

  async createSource(shopId: string, input: CreateSourceInput) {
    return this.request<ShopSource>(`/api/v1/shops/${encodeURIComponent(shopId)}/sources`, {
      method: "POST",
      body: input
    });
  }

  async updateSourceStatus(shopId: string, sourceId: string, status: string) {
    return this.request<ShopSource>(`/api/v1/shops/${encodeURIComponent(shopId)}/sources/${encodeURIComponent(sourceId)}`, {
      method: "PATCH",
      body: { status }
    });
  }

  async updateSource(shopId: string, sourceId: string, input: UpdateSourceInput) {
    return this.request<ShopSource>(`/api/v1/shops/${encodeURIComponent(shopId)}/sources/${encodeURIComponent(sourceId)}`, {
      method: "PATCH",
      body: input
    });
  }

  async createOutlookAuthURL(shopId: string) {
    return this.request<OutlookAuthURLResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/outlook/auth-url`, {
      method: "POST",
      body: {}
    });
  }

  async updateMyPresence(online: boolean) {
    return this.request<User>("/api/v1/auth/me/presence", {
      method: "PATCH",
      body: { online }
    });
  }

  async createGmailAuthURL(shopId: string) {
    return this.request<OutlookAuthURLResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/gmail/auth-url`, {
      method: "POST",
      body: {}
    });
  }

  async connectCuiqiuEmail(shopId: string, input: CuiqiuConnectInput) {
    return this.request<CuiqiuConnectResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/cuiqiu/connect`, {
      method: "POST",
      body: input
    });
  }

  async connectStandardEmail(shopId: string, input: StandardMailConnectInput) {
    return this.request<StandardMailConnectResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/standard/connect`, {
      method: "POST",
      body: input
    });
  }

  async disconnectEmailSource(shopId: string, sourceId: string) {
    return this.request<EmailDisconnectResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/sources/${encodeURIComponent(sourceId)}`, {
      method: "DELETE"
    });
  }

  async setEmailSourceSyncPaused(shopId: string, sourceId: string, paused: boolean) {
    return this.request<ShopSource>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/sources/${encodeURIComponent(sourceId)}/sync-control`, {
      method: "POST",
      body: { action: paused ? "pause" : "resume" }
    });
  }

  async recoverStandardIMAPSource(shopId: string, sourceId: string) {
    return this.request<ShopSource>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/sources/${encodeURIComponent(sourceId)}/sync-control`, {
      method: "POST",
      body: { action: "recover" }
    });
  }

  async retryEmailQuarantine(shopId: string, sourceId: string) {
    return this.request<{ examined: number; resolved: number; remaining: number; errors?: string[] }>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/sources/${encodeURIComponent(sourceId)}/quarantine-retry`, {
      method: "POST"
    });
  }

  async listEmailHistoryImports(shopId: string) {
    return (await this.request<EmailHistoryImportJob[] | null>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/history-imports`)) ?? [];
  }

  async updateEmailHistoryImport(shopId: string, sourceId: string, action: "start" | "pause" | "resume" | "retry" | "cancel") {
    return this.request<EmailHistoryImportJob>(`/api/v1/shops/${encodeURIComponent(shopId)}/email/sources/${encodeURIComponent(sourceId)}/history-import`, {
      method: "POST",
      body: { action }
    });
  }

  async outlookConfigStatus() {
    return this.request<OutlookConfigStatus>("/api/v1/email/outlook/status");
  }

  async gmailConfigStatus() {
    return this.request<MailConfigStatus>("/api/v1/email/gmail/status");
  }

  async listShopAgents(shopId: string) {
    return (await this.request<User[] | null>(`/api/v1/shops/${encodeURIComponent(shopId)}/agents`)) ?? [];
  }

  async assignAgent(shopId: string, userId: string) {
    return this.request<ShopAgent>(`/api/v1/shops/${encodeURIComponent(shopId)}/agents`, {
      method: "POST",
      body: { userId }
    });
  }

  async unassignAgent(shopId: string, userId: string) {
    return this.request<{ ok: boolean }>(`/api/v1/shops/${encodeURIComponent(shopId)}/agents/${encodeURIComponent(userId)}`, {
      method: "DELETE"
    });
  }

  async searchShopifyOrders(shopId: string, query: string) {
    const params = new URLSearchParams({ query });
    return this.request<ShopifyOrderSearchResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/orders?${params}`);
  }

  async searchShopifyProducts(shopId: string, query: string) {
    const params = new URLSearchParams({ query });
    return this.request<ShopifyProductSearchResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/products?${params}`);
  }

  async searchShopifyCustomer(shopId: string, email: string) {
    const params = new URLSearchParams({ email });
    return this.request<{ customer?: ShopifyCustomerProfile }>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/customer?${params}`);
  }

  async listVisitorSchemes() {
    return (await this.request<VisitorScheme[] | null>("/api/v1/visitor-schemes")) ?? [];
  }

  async createVisitorScheme(input: VisitorSchemeInput) {
    return this.request<VisitorScheme>("/api/v1/visitor-schemes", { method: "POST", body: input });
  }

  async updateVisitorScheme(id: string, input: VisitorSchemeInput) {
    return this.request<VisitorScheme>(`/api/v1/visitor-schemes/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  }

  async applyVisitorScheme(id: string, shopIds: string[]) {
    return this.request<VisitorScheme>(`/api/v1/visitor-schemes/${encodeURIComponent(id)}/apply`, {
      method: "POST",
      body: { shopIds }
    });
  }

  async deleteVisitorScheme(id: string) {
    return this.request<{ ok: boolean }>(`/api/v1/visitor-schemes/${encodeURIComponent(id)}`, { method: "DELETE" });
  }

  async listAssignedSources(scope?: "workbench") {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return (await this.request<ShopSource[] | null>(`/api/v1/sources${query}`)) ?? [];
  }

  async listSyncedShopifyOrders(filters: { shopId?: string; query?: string; financialStatus?: string; fulfillmentStatus?: string; refundStatus?: string; days?: number; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.shopId) params.set("shopId", filters.shopId);
    if (filters.query) params.set("query", filters.query);
    if (filters.financialStatus) params.set("financialStatus", filters.financialStatus);
    if (filters.fulfillmentStatus) params.set("fulfillmentStatus", filters.fulfillmentStatus);
    if (filters.refundStatus) params.set("refundStatus", filters.refundStatus);
    if (filters.days) params.set("days", String(filters.days));
    if (filters.page) params.set("page", String(filters.page));
    if (filters.pageSize) params.set("pageSize", String(filters.pageSize));
    const query = params.toString();
    return this.request<ShopifySyncedOrderResult>(`/api/v1/shopify/orders${query ? `?${query}` : ""}`);
  }

  async syncShopifyOrders(shopId?: string) {
    return this.request<{ sync: ShopifyOrderSyncState[] }>("/api/v1/shopify/orders/sync", {
      method: "POST",
      body: { shopId: shopId || "" }
    });
  }

  async getShopifyAuthorizationStatus(feature: "refund" | "dispute", shopId?: string) {
    const params = new URLSearchParams({ feature });
    if (shopId) params.set("shopId", shopId);
    return this.request<ShopifyAuthorizationStatusResult>(`/api/v1/shopify/authorization-status?${params}`);
  }

  async listShopifyReturns(shopId: string, orderId: string) {
    const params = new URLSearchParams({ orderId });
    return this.request<{ returns: ShopifyReturn[] }>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/returns?${params}`);
  }

  async decideShopifyReturn(shopId: string, input: { returnId: string; decision: "APPROVE" | "DECLINE"; notifyCustomer: boolean; declineReason?: string; declineNote?: string }) {
    return this.request<{ returnId: string; status: string; recoveredFromShopify: boolean; updatedAt: string }>(
      `/api/v1/shops/${encodeURIComponent(shopId)}/shopify/returns/decision`,
      { method: "POST", body: input }
    );
  }

  async previewShopifyReturnRefund(shopId: string, input: { returnId: string; lineItems: ShopifyRefundLineSelection[]; refundShipping: boolean }) {
    return this.request<ShopifyReturnRefundPreview>(
      `/api/v1/shops/${encodeURIComponent(shopId)}/shopify/returns/refund-preview`,
      { method: "POST", body: input }
    );
  }

  async processShopifyReturnRefund(shopId: string, input: { returnId: string; lineItems: ShopifyRefundLineSelection[]; refundShipping: boolean; notifyCustomer: boolean; previewToken: string }) {
    return this.request<ShopifyReturnRefundResult>(
      `/api/v1/shops/${encodeURIComponent(shopId)}/shopify/returns/refund-process`,
      { method: "POST", body: input }
    );
  }

  async listShopifyDisputes(shopId: string) {
    return this.request<{ disputes: ShopifyDispute[] }>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/disputes`);
  }

  async updateShopifyOrderShippingAddress(shopId: string, orderId: string, address: ShopifyShippingAddressInput) {
    return this.request<{ shippingAddress: ShopifyMailingAddress }>(
      `/api/v1/shops/${encodeURIComponent(shopId)}/shopify/orders/shipping-address`,
      { method: "PATCH", body: { orderId, address } }
    );
  }

  async updateShopifyFulfillmentTracking(shopId: string, input: {
    fulfillmentId: string;
    company: string;
    number: string;
    url: string;
    notifyCustomer?: boolean;
  }) {
    return this.request<{ fulfillment: ShopifyFulfillment }>(
      `/api/v1/shops/${encodeURIComponent(shopId)}/shopify/fulfillments/tracking`,
      { method: "PATCH", body: { ...input, notifyCustomer: Boolean(input.notifyCustomer) } }
    );
  }

  async updateCustomerLoginRequirement(shopId: string, required: boolean) {
    return this.request<ShopSource>(`/api/v1/shops/${encodeURIComponent(shopId)}/customer-login`, {
      method: "PATCH",
      body: { required }
    });
  }

  async updateAllCustomerLoginRequirements(required: boolean) {
    return this.request<{ updated: number; sources: ShopSource[] }>("/api/v1/customer-login", {
      method: "PATCH",
      body: { required }
    });
  }

  async listShopAssignments() {
    return (await this.request<ShopAgentAssignment[] | null>("/api/v1/shop-assignments")) ?? [];
  }

  async getShopifyProductRecommendations(shopId: string, seedHandle?: string) {
    const params = new URLSearchParams();
    if (seedHandle) params.set("recommendForHandle", seedHandle);
    return this.request<ShopifyProductSearchResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/products?${params}`);
  }

  async getLogisticsStatus() {
    return this.request<LogisticsTrackingStatus>("/api/v1/logistics/status");
  }

  async trackLogistics(input: { shopId: string; carrier?: string; trackingNumber: string }) {
    return this.request<LogisticsTrackingResult>("/api/v1/logistics/track", {
      method: "POST",
      body: input
    });
  }

  async getShopifyConnectionStatus(shopId: string) {
    return this.request<ShopifyConnectionStatus>(`/api/v1/shops/${encodeURIComponent(shopId)}/shopify/connection`);
  }

  async checkShopChannels(shopId: string) {
    return this.request<ShopChannelCheckResult>(`/api/v1/shops/${encodeURIComponent(shopId)}/channels/check`, {
      method: "POST"
    });
  }

  async getResponseMetrics(filters: { shopId?: string; agentId?: string; status?: string; channel?: string; skillGroup?: string } = {}) {
    return this.request<ResponseMetrics>(`/api/v1/monitor/response-metrics${querySuffix(filters)}`);
  }

  async getMonitorOverview(filters: { shopId?: string; agentId?: string; status?: string; channel?: string; skillGroup?: string } = {}) {
    return this.request<MonitorOverview>(`/api/v1/monitor/overview${querySuffix(filters)}`);
  }

  async getMonitorWorkSchedule() {
    return this.request<MonitorWorkSchedule>("/api/v1/settings/monitor-work-schedule");
  }

  async saveMonitorWorkSchedule(input: MonitorWorkScheduleInput) {
    return this.request<MonitorWorkSchedule>("/api/v1/settings/monitor-work-schedule", { method: "PUT", body: input });
  }

  async getSLASettings() {
    return this.request<SLASettings>("/api/v1/settings/sla");
  }

  async saveSLASettings(input: SLASettings) {
    return this.request<SLASettings>("/api/v1/settings/sla", { method: "PUT", body: input });
  }

  async getHistoricalStatistics(filters: HistoricalStatisticsFilters) {
    return this.request<HistoricalStatisticsResponse>(`/api/v1/statistics${querySuffix(filters)}`);
  }

  async exportHistoricalStatistics(filters: HistoricalStatisticsFilters) {
    const response = await this.requestBlob(`/api/v1/statistics/export${querySuffix(filters)}`);
    return {
      blob: response.blob,
      filename: decodeAttachmentFilename(response.contentDisposition) || "Xzdesk_历史统计.xlsx"
    };
  }

  async listMonitorConversations(filters: {
    shopId?: string;
    agentId?: string;
    status?: string;
    channel?: string;
    search?: string;
    anomaly?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && value !== false) params.set(key, String(value));
    });
    return this.request<MonitorConversationPage>(`/api/v1/monitor/conversations?${params}`);
  }

  async listMonitorMessages(conversationId: string) {
    return (await this.request<Message[] | null>(`/api/v1/monitor/conversations/${encodeURIComponent(conversationId)}/messages`)) ?? [];
  }

  async getAISettings() {
    return this.request<AISettings>("/api/v1/settings/ai");
  }

  async saveAISettings(input: AISettingsInput) {
    return this.request<AISettings>("/api/v1/settings/ai", { method: "PUT", body: input });
  }

  async testAISettings(input: AISettingsInput) {
    return this.request<{ ok: boolean; message: string }>("/api/v1/settings/ai/test", { method: "POST", body: input });
  }

  async syncAIModels(input: AISettingsInput) {
    return this.request<{ models: string[] }>("/api/v1/settings/ai/models/sync", { method: "POST", body: input });
  }

  async getLogisticsSettings() {
    return this.request<LogisticsSettings>("/api/v1/settings/logistics");
  }

  async saveLogisticsSettings(input: LogisticsSettingsInput) {
    return this.request<LogisticsSettings>("/api/v1/settings/logistics", { method: "PUT", body: input });
  }

  async testLogisticsSettings(input: LogisticsSettingsInput) {
    return this.request<{ ok: boolean; message: string }>("/api/v1/settings/logistics/test", { method: "POST", body: input });
  }

  async listKnowledge(filters: { shopId?: string; status?: KnowledgeStatus; scope?: KnowledgeScope; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params}` : "";
    return this.request<KnowledgePage>(`/api/v1/knowledge${suffix}`);
  }

  async listCuiqiuDomainSettings() {
    return (await this.request<CuiqiuDomainSettings[] | null>("/api/v1/settings/email-providers/cuiqiu")) ?? [];
  }

  async saveCuiqiuDomainSettings(input: CuiqiuDomainSettingsInput) {
    return this.request<CuiqiuDomainSettings>("/api/v1/settings/email-providers/cuiqiu", { method: "PUT", body: input });
  }

  async testCuiqiuDomainSettings(domain: string) {
    return this.request<{ ok: boolean; message: string }>("/api/v1/settings/email-providers/cuiqiu/test", { method: "POST", body: { domain } });
  }

  async createKnowledge(input: CreateKnowledgeInput) {
    return this.request<KnowledgeEntry>("/api/v1/knowledge", { method: "POST", body: input });
  }

  async updateKnowledge(entryId: string, input: UpdateKnowledgeInput) {
    return this.request<KnowledgeEntry>(`/api/v1/knowledge/${encodeURIComponent(entryId)}`, { method: "PATCH", body: input });
  }

  async deleteKnowledge(entryId: string) {
    return this.request<void>(`/api/v1/knowledge/${encodeURIComponent(entryId)}`, { method: "DELETE" });
  }

  async importKnowledge(file: File, input: { scope: KnowledgeScope; shopId?: string; tags?: string }) {
    const body = new FormData();
    body.append("file", file);
    body.append("scope", input.scope);
    if (input.shopId) body.append("shopId", input.shopId);
    if (input.tags?.trim()) body.append("tags", input.tags.trim());
    return this.requestFormData<KnowledgeImportResult>("/api/v1/knowledge/import", body);
  }

  async submitConversationKnowledge(conversationId: string, input: { title: string; answer: string; tags?: string[] }) {
    return this.request<KnowledgeEntry>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/knowledge`, { method: "POST", body: input });
  }

  async generateAIReply(conversationId: string, instruction = "") {
    return this.request<AIReplyResult>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/ai/draft`, {
      method: "POST",
      body: { instruction }
    });
  }

  async transformAIReply(conversationId: string, action: "rewrite" | "translate" | "translate_zh" | "logistics_reply", text: string) {
    return this.request<AIReplyResult>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/ai/transform`, {
      method: "POST",
      body: { action, text }
    });
  }

  async prepareAIReply(conversationId: string) {
    return this.request<AIPreparationResult>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/ai/prepare`, {
      method: "POST"
    });
  }

  async translateMessage(conversationId: string, messageId: string) {
    return this.request<Message>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/translate`, {
      method: "POST"
    });
  }

  async listConversations(filters: { shopId?: string; sourceId?: string; status?: string; kind?: "customer" | "system"; scope?: "assigned" | "all"; search?: string; activeOnly?: boolean; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    const suffix = params.toString() ? `?${params}` : "";
    return (await this.request<Conversation[] | null>(`/api/v1/conversations${suffix}`)) ?? [];
  }

  async createConversation(input: CreateConversationInput) {
    return this.request<Conversation>("/api/v1/conversations", { method: "POST", body: input });
  }

  async updateConversation(conversationId: string, input: UpdateConversationInput) {
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}`, {
      method: "PATCH",
      body: input
    });
  }

  async listRecordCategories() {
    const payload = await this.request<unknown>("/api/v1/settings/record-categories");
    return requireRecordCategoryPayload(payload, "读取处理分类");
  }

  async saveRecordCategories(categories: RecordCategoryOption[]) {
    const payload = await this.request<unknown>("/api/v1/settings/record-categories", {
      method: "PUT",
      body: { categories }
    });
    return requireRecordCategoryPayload(payload, "保存处理分类");
  }

  async autoClassifyConversation(conversationId: string, final = false) {
    const query = final ? "?final=true" : "";
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/record-auto${query}`, {
      method: "POST"
    });
  }

  async updateConversationRecord(conversationId: string, input: ConversationRecordInput) {
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/record`, {
      method: "PATCH",
      body: input
    });
  }

  async listProcessingRecords(filters: ProcessingRecordFilters = {}) {
    const suffix = querySuffix(filters);
    return this.request<ProcessingRecordsResponse>(`/api/v1/processing-records${suffix}`);
  }

  async exportProcessingRecords(filters: ProcessingRecordFilters = {}) {
    const response = await this.requestBlob(`/api/v1/processing-records/export${querySuffix(filters)}`);
    return {
      blob: response.blob,
      filename: decodeAttachmentFilename(response.contentDisposition) || "Xzdesk_处理记录.xlsx"
    };
  }

  async claimConversation(conversationId: string) {
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/claim`, {
      method: "POST"
    });
  }

  async closeConversation(conversationId: string) {
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/close`, {
      method: "POST"
    });
  }

  async reopenConversation(conversationId: string) {
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/reopen`, {
      method: "POST"
    });
  }

  async listMessages(conversationId: string, before = "", pageSize = 50) {
    const params = new URLSearchParams();
    if (before) params.set("before", before);
    params.set("pageSize", String(pageSize));
    return (await this.request<Message[] | null>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages?${params}`)) ?? [];
  }

  async getConversation(conversationId: string) {
    return this.request<Conversation>(`/api/v1/conversations/${encodeURIComponent(conversationId)}`);
  }

  async getConversationSummary(filters: { shopId?: string; sourceId?: string; scope?: "assigned" | "all"; search?: string } = {}) {
    return this.request<ConversationSummary>(`/api/v1/conversations/summary${querySuffix(filters)}`);
  }

  async getConversationShopifyContext(conversationId: string) {
    return this.request<ConversationShopifyContext>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/shopify-context`);
  }

  async markConversationRead(conversationId: string, throughMessageId = "", afterMessageId = "") {
    return this.request<{ ok: boolean }>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/read`, {
      method: "POST",
      body: throughMessageId || afterMessageId ? { throughMessageId, afterMessageId } : undefined
    });
  }

  async addMessage(conversationId: string, input: CreateMessageInput) {
    return this.request<Message>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      body: input
    });
  }

  async addImageMessage(conversationId: string, file: File, caption = "", clientRequestId = "") {
    const body = new FormData();
    body.append("image", file);
    if (caption.trim()) body.append("caption", caption.trim());
    if (clientRequestId.trim()) body.append("clientRequestId", clientRequestId.trim());
    return this.requestFormData<Message>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/attachments`, body);
  }

  resolveAssetURL(path?: string) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path) || /^data:/i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  private async requestFormData<T>(path: string, body: FormData): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.tenantId) headers["X-XZ-Tenant-ID"] = this.tenantId;
    const response = await fetch(`${this.baseUrl}${path}`, { method: "POST", headers, body });
    const text = await response.text();
    const payload = text ? parseJSON(text) : null;
    if (!response.ok) {
      if (response.status === 401 && this.token) window.dispatchEvent(new CustomEvent("xzdesk:session-expired", { detail: this }));
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `Request failed (${response.status})`;
      throw new PlatformAPIError(message, response.status, payload);
    }
    return payload as T;
  }

  async listTransferCandidates(conversationId: string) {
    return (await this.request<TransferCandidate[] | null>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/transfer-candidates`)) ?? [];
  }

  async listConversationTransfers(conversationId: string, status = "") {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return (await this.request<TransferRequest[] | null>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/transfers${suffix}`)) ?? [];
  }

  async createTransfer(conversationId: string, input: { targetAgentId?: string; targetSkillGroup?: string; note?: string }) {
    return this.request<TransferRequest>(`/api/v1/conversations/${encodeURIComponent(conversationId)}/transfers`, { method: "POST", body: input });
  }

  async listTransfers(status = "pending") {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
    return (await this.request<TransferRequest[] | null>(`/api/v1/transfers${suffix}`)) ?? [];
  }

  async resolveTransfer(transferId: string, action: "accept" | "reject" | "cancel") {
    return this.request<TransferRequest>(`/api/v1/transfers/${encodeURIComponent(transferId)}/${action}`, { method: "POST" });
  }

  async listConversationPage(filters: { shopId?: string; sourceId?: string; status?: string; scope?: "assigned" | "all"; search?: string; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams({ includeTotal: "true" });
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, String(value));
    });
    return this.request<ConversationPage>(`/api/v1/conversations?${params}`);
  }

  async listEmailProcessing(filters: { status?: string; category?: string; tag?: string; shopId?: string; sourceId?: string; search?: string; page?: number; pageSize?: number } = {}) {
    return this.request<EmailProcessingPage>(`/api/v1/email-processing${querySuffix(filters)}`);
  }

  async getEmailProcessing(conversationId: string) {
    return this.request<EmailProcessingDetail>(`/api/v1/email-processing/${encodeURIComponent(conversationId)}`);
  }

  async translateEmailProcessingMessage(conversationId: string, messageId: string) {
    return this.request<Message>(`/api/v1/email-processing/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/translate`, {
      method: "POST"
    });
  }

  async updateEmailProcessingTags(conversationId: string, tags: EmailProcessingTag[]) {
    return this.request<EmailProcessingItem>(`/api/v1/email-processing/${encodeURIComponent(conversationId)}/tags`, {
      method: "PUT",
      body: { tags }
    });
  }

  async markEmailProcessingHandled(conversationId: string) {
    return this.request<EmailProcessingActionResponse>(`/api/v1/email-processing/${encodeURIComponent(conversationId)}/handled`, { method: "POST" });
  }

  async reopenEmailProcessing(conversationId: string) {
    return this.request<EmailProcessingActionResponse>(`/api/v1/email-processing/${encodeURIComponent(conversationId)}/reopen`, { method: "POST" });
  }

  async promoteEmailProcessing(conversationId: string) {
    return this.request<{ conversation: Conversation }>(`/api/v1/email-processing/${encodeURIComponent(conversationId)}/promote`, { method: "POST" });
  }

  async listEmailStatistics(filters: EmailStatisticsFilters = {}) {
    return this.request<EmailStatisticsPage>(`/api/v1/email-statistics${querySuffix(filters)}`);
  }

  async refreshEmailStatisticsMailbox(mailbox: string, sourceId?: string) {
    return this.request<{ synced: boolean; mailbox: string; messagesCreated: number; conversationsCreated: number }>("/api/v1/email-statistics/refresh", {
      method: "POST",
      body: { mailbox, sourceId }
    });
  }

  async getEmailStatistics(conversationId: string, messageId: string) {
    return this.request<EmailStatisticsDetail>(`/api/v1/email-statistics/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`);
  }

  async updateEmailStatisticsTags(conversationId: string, tags: EmailProcessingTag[]) {
    return this.request<EmailProcessingTag[]>(`/api/v1/email-statistics/${encodeURIComponent(conversationId)}/tags`, {
      method: "PUT",
      body: { tags }
    });
  }

  async markEmailStatisticsHandled(conversationId: string) {
    return this.request<{ status: string }>(`/api/v1/email-statistics/${encodeURIComponent(conversationId)}/handled`, { method: "POST" });
  }

  async reopenEmailStatistics(conversationId: string) {
    return this.request<{ status: string }>(`/api/v1/email-statistics/${encodeURIComponent(conversationId)}/reopen`, { method: "POST" });
  }

  async createEmailStatisticsExport(filters: EmailStatisticsFilters = {}) {
    return this.request<EmailStatisticsExportJob>(`/api/v1/email-statistics/exports${querySuffix(filters)}`, { method: "POST" });
  }

  async getEmailStatisticsExport(id: string) {
    return this.request<EmailStatisticsExportJob>(`/api/v1/email-statistics/exports/${encodeURIComponent(id)}`);
  }

  async downloadEmailStatisticsExport(job: EmailStatisticsExportJob) {
    const response = await this.requestBlob(`/api/v1/email-statistics/exports/${encodeURIComponent(job.id)}/download`);
    return {
      blob: response.blob,
      filename: decodeAttachmentFilename(response.contentDisposition) || job.filename || "Xzdesk_邮件统计.zip"
    };
  }

  async listTickets(filters: { type?: string; shopId?: string; conversationId?: string; assignedAgentId?: string; participantId?: string; status?: string; priority?: string; search?: string; view?: string; page?: number; pageSize?: number } = {}) {
    const suffix = querySuffix(filters);
    return (await this.request<Ticket[] | null>(`/api/v1/tickets${suffix}`)) ?? [];
  }

  async createTicket(input: CreateTicketInput) {
    return this.request<Ticket>("/api/v1/tickets", { method: "POST", body: input });
  }

  async listTicketAssignees() {
    return (await this.request<User[] | null>("/api/v1/ticket-assignees")) ?? [];
  }

  async searchTicketCustomers(shopId: string, query: string) {
    const suffix = querySuffix({ shopId, query });
    return (await this.request<TicketCustomer[] | null>(`/api/v1/ticket-customers${suffix}`)) ?? [];
  }

  async getTicketSummary(filters: { type?: string; shopId?: string; conversationId?: string; assignedAgentId?: string; participantId?: string; status?: string; priority?: string; search?: string } = {}) {
    return this.request<TicketSummary>(`/api/v1/ticket-summary${querySuffix(filters)}`);
  }

  async getTicket(ticketId: string) {
    return this.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(ticketId)}`);
  }

  async updateTicket(ticketId: string, input: UpdateTicketInput) {
    return this.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(ticketId)}`, { method: "PATCH", body: input });
  }

  async acceptTicket(ticketId: string) {
    return this.request<TicketAcceptance>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/accept`, { method: "POST" });
  }

  async getTicketContext(ticketId: string) {
    return this.request<TicketContext>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/context`);
  }

  async runTicketAction(ticketId: string, action: "complete" | "wait" | "resume" | "review" | "cancel" | "convert-to-customer", input: { reason?: string; note?: string; approved?: boolean; assignedAgentId?: string } = {}) {
    return this.request<Ticket>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/${action}`, { method: "POST", body: input });
  }

  async listTicketComments(ticketId: string) {
    return (await this.request<TicketComment[] | null>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`)) ?? [];
  }

  async addTicketComment(ticketId: string, body: string) {
    return this.request<TicketComment>(`/api/v1/tickets/${encodeURIComponent(ticketId)}/comments`, { method: "POST", body: { body } });
  }

  private async requestBlob(path: string) {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.tenantId) headers["X-XZ-Tenant-ID"] = this.tenantId;
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    if (!response.ok) {
      if (response.status === 401 && this.token) window.dispatchEvent(new CustomEvent("xzdesk:session-expired", { detail: this }));
      const text = await response.text();
      const payload = text ? parseJSON(text) : null;
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `${response.status} ${response.statusText}`;
      throw new PlatformAPIError(message, response.status, payload);
    }
    return { blob: await response.blob(), contentDisposition: response.headers.get("Content-Disposition") || "" };
  }

  private async request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    if (this.tenantId) headers["X-XZ-Tenant-ID"] = this.tenantId;
    let body: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.body);
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method || "GET",
      headers,
      body
    });
    const text = await response.text();
    const payload = text ? parseJSON(text) : null;
    if (!response.ok) {
      if (response.status === 401 && this.token) window.dispatchEvent(new CustomEvent("xzdesk:session-expired", { detail: this }));
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error)
        : `${response.status} ${response.statusText}`;
      throw new PlatformAPIError(message, response.status, payload);
    }
    return payload as T;
  }
}

function querySuffix(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, String(value));
  });
  return params.toString() ? `?${params}` : "";
}

function decodeAttachmentFilename(value: string) {
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/\+/g, "%20"));
    } catch {
      return encoded;
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || "";
}

export class PlatformAPIError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "PlatformAPIError";
    this.status = status;
    this.payload = payload;
  }
}

function requireRecordCategoryPayload(payload: unknown, operation: string): RecordCategoryOption[] {
  if (payload === null) return [];
  if (Array.isArray(payload) && payload.every((item) => (
    item !== null
    && typeof item === "object"
    && typeof (item as RecordCategoryOption).primary === "string"
    && typeof (item as RecordCategoryOption).secondary === "string"
    && Array.isArray((item as RecordCategoryOption).tertiary)
    && (item as RecordCategoryOption).tertiary.every((value) => typeof value === "string")
  ))) {
    return payload as RecordCategoryOption[];
  }
  throw new PlatformAPIError(`${operation}失败：服务端返回格式异常，请重启本地后端。`, 502, payload);
}

export function cleanBaseUrl(value: string) {
  const trimmed = value.trim() || "http://127.0.0.1:8787";
  return trimmed.replace(/\/+$/, "");
}

function parseJSON(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
