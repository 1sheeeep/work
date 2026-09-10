import { ApiError, apiClient } from "../api/client";
import {
  isCanonicalOrLegacyIdentity,
  normalizeE164Phone,
} from "../auth/identity";
import type { PlatformAdminIdentity } from "../auth/types";
import type {
  ActivationCredential,
  EnterpriseAdmin,
  EnterpriseAdminPasswordTarget,
  Enterprise,
  EnterpriseStatus,
  LogisticsProviderConfig,
  PlatformLoginRequest,
  PlatformLoginResponse,
  PlatformPage,
  PlatformSession,
  ShopifyComplianceOutcome,
  ShopifyComplianceRequest,
  ShopifyComplianceStatus,
  ShopifyComplianceTopic,
  ShopifyAppRelease,
  SystemAdmin,
  SystemAdminStatus,
  TenantEntitlements,
  TenantAccess,
} from "./types";

const BASE = "/api/v1/platform-admin";
const ERP_OPERATOR_BASE = "/api/v1/erp-operator";
const MAX_PAGE_NUMBER = 1_000_000;
const MAX_PAGE_SIZE = 200;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
type RecordValue = Record<string, unknown>;

export const SHOPIFY_EXPORT_DELIVERY_CONFIRMATION =
  "DELIVERED_TO_STORE_OWNER";
export const SHOPIFY_REDACTION_CONFIRMATION = "ANONYMIZE_SHOPIFY_DATA";

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function invalidResponse(): never {
  throw new ApiError("服务返回了无法识别的数据格式，请稍后重试。", {
    status: 0,
    code: "invalid_response",
  });
}

function record(value: unknown): RecordValue {
  return isRecord(value) ? value : invalidResponse();
}

function text(value: unknown, maximum = 500): string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum
    ? value
    : invalidResponse();
}

function optionalText(value: unknown, maximum: number): string | undefined {
  return value === null || value === undefined
    ? undefined
    : text(value, maximum);
}

function uuid(value: unknown): string {
  const candidate = text(value, 36);
  return UUID.test(candidate) ? candidate : invalidResponse();
}

function timestamp(value: unknown): string {
  const candidate = text(value, 64);
  return !ISO_INSTANT.test(candidate) || Number.isNaN(new Date(candidate).valueOf())
    ? invalidResponse()
    : candidate;
}

function optionalTimestamp(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : timestamp(value);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalidResponse();
}

function optionalCount(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : count(value);
}

function bool(value: unknown): boolean {
  return typeof value === "boolean" ? value : invalidResponse();
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : invalidResponse();
}

function systemAdminStatus(value: unknown): SystemAdminStatus {
  return value === "PENDING_ACTIVATION" ||
    value === "ACTIVE" ||
    value === "DISABLED" ||
    value === "DELETED"
    ? value
    : invalidResponse();
}

function enterpriseStatus(value: unknown): EnterpriseStatus {
  return value === "ACTIVE" || value === "SUSPENDED" || value === "DISABLED"
    ? value
    : invalidResponse();
}

function loginIdentity(source: RecordValue) {
  const username = text(source.username, 254);
  const email = optionalText(source.email, 254);
  const phoneNumber = optionalText(source.phoneNumber, 16);
  if (!isCanonicalOrLegacyIdentity(username, email, phoneNumber)) invalidResponse();
  return { username, email, phoneNumber };
}

function adminIdentity(value: unknown): PlatformAdminIdentity {
  const source = record(value);
  return {
    id: uuid(source.id),
    ...loginIdentity(source),
    displayName: text(source.displayName, 160),
    status: systemAdminStatus(source.status),
  };
}

function toSession(value: unknown): PlatformSession {
  const source = record(value);
  return {
    admin: adminIdentity(source.admin),
    expiresAt: timestamp(source.expiresAt),
  };
}

function activationCredential(value: unknown): ActivationCredential {
  const source = record(value);
  return {
    token: text(source.token, 2048),
    expiresAt: timestamp(source.expiresAt),
  };
}

function systemAdmin(value: unknown): SystemAdmin {
  const source = record(value);
  return {
    ...adminIdentity(source),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
    version: count(source.version),
  };
}

function enterprise(value: unknown): Enterprise {
  const source = record(value);
  return {
    id: uuid(source.id),
    code: text(source.code, 64),
    name: text(source.name, 160),
    status: enterpriseStatus(source.status),
    createdAt: timestamp(source.createdAt),
    updatedAt: timestamp(source.updatedAt),
    version: count(source.version),
    adminCount: count(source.adminCount),
    memberCount: count(source.memberCount),
  };
}

function tenantEntitlements(value: unknown): TenantEntitlements {
  const source = record(value);
  return {
    version: count(source.version),
    applications: list(source.applications).map((value) => {
      const application = record(value);
      const integrationStatus = application.integrationStatus;
      if (
        integrationStatus !== "AVAILABLE" &&
        integrationStatus !== "PENDING_INTEGRATION"
      ) {
        invalidResponse();
      }
      return {
        code: text(application.code, 40),
        name: text(application.name, 160),
        description: text(application.description, 500),
        integrationStatus,
        enabled: bool(application.enabled),
        modules: list(application.modules).map((value) => {
          const module = record(value);
          return {
            code: text(module.code, 64),
            name: text(module.name, 160),
            enabled: bool(module.enabled),
          };
        }),
      };
    }),
  };
}

function enterpriseAdmin(value: unknown): EnterpriseAdmin {
  const source = record(value);
  if (source.status !== "ACTIVE" && source.status !== "DISABLED") {
    return invalidResponse();
  }
  const phoneNumber = optionalText(source.phoneNumber, 16);
  if (
    phoneNumber !== undefined &&
    normalizeE164Phone(phoneNumber) !== phoneNumber
  )
    invalidResponse();
  return {
    id: uuid(source.id),
    ...loginIdentity(source),
    displayName: text(source.displayName, 160),
    status: source.status,
  };
}

function enterpriseAdminPasswordTarget(
  value: unknown,
): EnterpriseAdminPasswordTarget {
  const source = record(value);
  return {
    ...enterpriseAdmin(source),
    version: count(source.version),
  };
}

function logisticsProviderConfig(value: unknown): LogisticsProviderConfig {
  const source = record(value);
  const documentationUrl = text(source.documentationUrl, 500);
  let url: URL;
  try {
    url = new URL(documentationUrl);
  } catch {
    return invalidResponse();
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username ||
    url.password
  ) {
    return invalidResponse();
  }
  return {
    providerCode: text(source.providerCode, 64),
    providerName: text(source.providerName, 120),
    documentationUrl,
    configurationMode:
      source.configurationMode === "SYSTEM_CREDENTIALS" ||
      source.configurationMode === "BUILT_IN"
        ? source.configurationMode
        : invalidResponse(),
    configurationSummary: text(source.configurationSummary, 240),
    endpointSummary: text(source.endpointSummary, 500),
    configured: bool(source.configured),
    customerCodeConfigured: bool(source.customerCodeConfigured),
    authorizationCodeConfigured: bool(source.authorizationCodeConfigured),
    secretConfigured: bool(source.secretConfigured),
    updatedAt:
      source.updatedAt === null || source.updatedAt === undefined
        ? undefined
        : timestamp(source.updatedAt),
    version: count(source.version),
    nameVersion: count(source.nameVersion),
  };
}

function shopifyAppRelease(value: unknown): ShopifyAppRelease {
  const source = record(value);
  const appName = text(source.appName, 120);
  const extensionName = text(source.extensionName, 120);
  const clientId = text(source.clientId, 128);
  const status = source.status;
  if (
    appName !== "Xinzhi ERP" ||
    extensionName !== "Xinzhi Chat" ||
    clientId !== "6cef3dfc6b0d74e7c2709232f2938696"
  )
    invalidResponse();
  if (
    status !== "NOT_CONFIGURED" &&
    status !== "CONFIGURED" &&
    status !== "RUNNING" &&
    status !== "SUCCEEDED" &&
    status !== "FAILED"
  )
    invalidResponse();
  const tokenConfigured = bool(source.tokenConfigured);
  if (tokenConfigured !== (status !== "NOT_CONFIGURED")) invalidResponse();
  return {
    appName,
    extensionName,
    clientId,
    tokenConfigured,
    status,
    releaseVersion: optionalText(source.releaseVersion, 120),
    message: optionalText(source.message, 4000),
    releasedAt: optionalTimestamp(source.releasedAt),
    updatedAt: optionalTimestamp(source.updatedAt),
    version: count(source.version),
  };
}

function shopifyComplianceTopic(value: unknown): ShopifyComplianceTopic {
  return value === "CUSTOMER_DATA_REQUEST" ||
    value === "CUSTOMER_REDACT" ||
    value === "SHOP_REDACT"
    ? value
    : invalidResponse();
}

function shopifyComplianceStatus(value: unknown): ShopifyComplianceStatus {
  return value === "PENDING" ||
    value === "EXPORT_READY" ||
    value === "LOCAL_REDACTION_COMPLETE" ||
    value === "RETRY_REQUIRED" ||
    value === "COMPLETED"
    ? value
    : invalidResponse();
}

function optionalShopifyComplianceOutcome(
  value: unknown,
): ShopifyComplianceOutcome | undefined {
  if (value === null || value === undefined) return undefined;
  return value === "EXPORTED" ||
    value === "ANONYMIZED" ||
    value === "DELETED" ||
    value === "NOT_FOUND"
    ? value
    : invalidResponse();
}

function shopifyComplianceRequest(value: unknown): ShopifyComplianceRequest {
  const source = record(value);
  const shopDomain = text(source.shopDomain, 253);
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shopDomain)) {
    return invalidResponse();
  }
  return {
    eventId: text(source.eventId, 260),
    shopDomain,
    topic: shopifyComplianceTopic(source.topic),
    occurredAt: timestamp(source.occurredAt),
    dueAt: timestamp(source.dueAt),
    overdue: bool(source.overdue),
    status: shopifyComplianceStatus(source.status),
    recordCount: optionalCount(source.recordCount),
    exportPreparedAt: optionalTimestamp(source.exportPreparedAt),
    dataRedactedAt: optionalTimestamp(source.dataRedactedAt),
    deliveryConfirmedAt: optionalTimestamp(source.deliveryConfirmedAt),
    completionOutcome: optionalShopifyComplianceOutcome(
      source.completionOutcome,
    ),
    connectorCompletedAt: optionalTimestamp(source.connectorCompletedAt),
    attemptCount: count(source.attemptCount),
    lastAttemptAt: optionalTimestamp(source.lastAttemptAt),
    lastErrorCode: optionalText(source.lastErrorCode, 80),
  };
}

function page<T>(
  value: unknown,
  mapper: (item: unknown) => T,
): PlatformPage<T> {
  const source = record(value);
  const items = list(source.items).map(mapper);
  const pageNumber = count(source.page);
  const size = count(source.size);
  const totalElements = count(source.totalElements);
  const totalPages = count(source.totalPages);
  const expectedTotalPages = Math.ceil(totalElements / size);
  const expectedItems = Math.min(
    size,
    Math.max(totalElements - pageNumber * size, 0),
  );
  if (
    pageNumber > MAX_PAGE_NUMBER ||
    size < 1 ||
    size > MAX_PAGE_SIZE ||
    totalPages !== expectedTotalPages ||
    items.length !== expectedItems
  ) {
    return invalidResponse();
  }
  return { items, page: pageNumber, size, totalElements, totalPages };
}

function tenantAccess(value: unknown): TenantAccess {
  const source = record(value);
  const tenant = record(source.tenant);
  const platformAdmin = adminIdentity(source.platformAdmin);
  return {
    credentials: {
      accessToken: text(source.accessToken, 2048),
      tokenType: source.tokenType === "Bearer" ? "Bearer" : invalidResponse(),
    },
    session: {
      tenant: {
        id: uuid(tenant.id),
        code: text(tenant.code, 64),
        name: text(tenant.name, 160),
      },
      platformAdmin,
      permissions: list(source.permissions).map((permission) =>
        text(permission, 160),
      ),
      applications: (source.applications === undefined
        ? []
        : list(source.applications)).map((value) => {
        const application = record(value);
        return {
          code: text(application.code, 40),
          modules: list(application.modules).map((module) => text(module, 64)),
        };
      }),
      expiresAt: timestamp(source.expiresAt),
    },
  };
}

function query(request: { page: number; size: number }): string {
  return new URLSearchParams({
    page: String(request.page),
    size: String(request.size),
  }).toString();
}

export type PlatformAdminAdapter = {
  login(request: PlatformLoginRequest): Promise<PlatformLoginResponse>;
  getSession(): Promise<PlatformSession>;
  logoutPlatform(): Promise<void>;
  logoutTenant(): Promise<void>;
  listSystemAdmins(request: {
    page: number;
    size: number;
  }): Promise<PlatformPage<SystemAdmin>>;
  createSystemAdmin(request: {
    email?: string;
    phoneNumber?: string;
    displayName: string;
  }): Promise<{
    admin: SystemAdmin;
    credential: ActivationCredential;
  }>;
  updateSystemAdmin(
    id: string,
    request: { loginIdentifier: string; displayName: string; version: number },
  ): Promise<SystemAdmin>;
  setSystemAdminStatus(
    id: string,
    action: "activate" | "disable" | "delete",
    version: number,
  ): Promise<SystemAdmin>;
  resetSystemAdmin(id: string): Promise<ActivationCredential>;
  resetSystemAdminPassword(
    id: string,
    request: { newPassword: string; version: number },
  ): Promise<void>;
  listTenants(request: {
    page: number;
    size: number;
  }): Promise<PlatformPage<Enterprise>>;
  getTenantEntitlements(id: string): Promise<TenantEntitlements>;
  updateTenantEntitlements(
    id: string,
    request: {
      version: number;
      applications: Array<{ code: string; modules: string[] }>;
    },
  ): Promise<TenantEntitlements>;
  listLogisticsProviderConfigs(): Promise<LogisticsProviderConfig[]>;
  getShopifyAppRelease(): Promise<ShopifyAppRelease>;
  saveShopifyAppReleaseToken(request: {
    automationToken: string;
    version: number;
  }): Promise<ShopifyAppRelease>;
  clearShopifyAppReleaseToken(version: number): Promise<ShopifyAppRelease>;
  publishShopifyApp(version: number): Promise<ShopifyAppRelease>;
  updateLogisticsProviderConfig(
    providerCode: string,
    request: {
      customerCode: string;
      authorizationCode: string;
      secret: string;
      version: number;
    },
  ): Promise<LogisticsProviderConfig>;
  renameLogisticsProvider(
    providerCode: string,
    request: { providerName: string; version: number },
  ): Promise<LogisticsProviderConfig>;
  listShopifyComplianceRequests(): Promise<ShopifyComplianceRequest[]>;
  exportShopifyComplianceData(eventId: string): Promise<Blob>;
  confirmShopifyComplianceExportDelivery(
    eventId: string,
  ): Promise<ShopifyComplianceRequest>;
  redactShopifyComplianceData(
    eventId: string,
  ): Promise<ShopifyComplianceRequest>;
  createTenant(request: {
    code: string;
    name: string;
    adminEmail?: string;
    adminPhoneNumber?: string;
    adminDisplayName: string;
    adminInitialPassword: string;
  }): Promise<{
    tenant: Enterprise;
    enterpriseAdmin: EnterpriseAdmin;
  }>;
  updateTenant(
    id: string,
    request: { name: string; status: EnterpriseStatus; version: number },
  ): Promise<Enterprise>;
  deleteTenant(id: string, version: number): Promise<Enterprise>;
  createEnterpriseAdmin(
    id: string,
    request: {
      email?: string;
      phoneNumber?: string;
      displayName: string;
      initialPassword: string;
    },
  ): Promise<{ admin: EnterpriseAdmin }>;
  listEnterpriseAdmins(
    id: string,
    request: { page: number; size: number },
  ): Promise<PlatformPage<EnterpriseAdminPasswordTarget>>;
  updateEnterpriseAdmin(
    tenantId: string,
    userId: string,
    request: {
      displayName: string;
      status: EnterpriseAdmin["status"];
      version: number;
    },
  ): Promise<EnterpriseAdminPasswordTarget>;
  resetEnterpriseAdminPassword(
    tenantId: string,
    userId: string,
    request: { newPassword: string; version: number },
  ): Promise<void>;
  enterTenant(id: string): Promise<TenantAccess>;
  redeemPasswordCredential(request: {
    token: string;
    newPassword: string;
  }): Promise<void>;
};

export const httpPlatformAdminAdapter: PlatformAdminAdapter = {
  async login(request) {
    const response = await apiClient.request<unknown>(`${BASE}/auth/login`, {
      method: "POST",
      body: request,
      skipAuth: true,
      authScope: "platform",
    });
    const source = record(response);
    return {
      session: toSession(source),
      credentials: {
        accessToken: text(source.accessToken, 2048),
        tokenType: source.tokenType === "Bearer" ? "Bearer" : invalidResponse(),
      },
    };
  },
  async getSession() {
    return toSession(
      await apiClient.request<unknown>(`${BASE}/auth/me`, {
        authScope: "platform",
        skipUnauthorizedHandler: true,
      }),
    );
  },
  async logoutPlatform() {
    await apiClient.request<void>(`${BASE}/auth/session`, {
      method: "DELETE",
      authScope: "platform",
      skipUnauthorizedHandler: true,
    });
  },
  async logoutTenant() {
    await apiClient.request<void>(`${BASE}/tenant-session`, {
      method: "DELETE",
      authScope: "tenant",
      skipUnauthorizedHandler: true,
    });
  },
  async listSystemAdmins(request) {
    return page(
      await apiClient.request<unknown>(
        `${BASE}/system-admins?${query(request)}`,
        { authScope: "platform" },
      ),
      systemAdmin,
    );
  },
  async createSystemAdmin(request) {
    const response = record(
      await apiClient.request<unknown>(`${BASE}/system-admins`, {
        method: "POST",
        body: request,
        authScope: "platform",
      }),
    );
    return {
      admin: systemAdmin(response),
      credential: activationCredential(response.activationCredential),
    };
  },
  async updateSystemAdmin(id, request) {
    return systemAdmin(
      await apiClient.request<unknown>(
        `${BASE}/system-admins/${encodeURIComponent(id)}`,
        { method: "PUT", body: request, authScope: "platform" },
      ),
    );
  },
  async setSystemAdminStatus(id, action, version) {
    return systemAdmin(
      await apiClient.request<unknown>(
        `${BASE}/system-admins/${encodeURIComponent(id)}/${action}`,
        { method: "POST", body: { version }, authScope: "platform" },
      ),
    );
  },
  async resetSystemAdmin(id) {
    return activationCredential(
      await apiClient.request<unknown>(
        `${BASE}/system-admins/${encodeURIComponent(id)}/password-credentials`,
        { method: "POST", authScope: "platform" },
      ),
    );
  },
  async resetSystemAdminPassword(id, request) {
    await apiClient.request<void>(
      `${BASE}/system-admins/${encodeURIComponent(id)}/password`,
      { method: "PUT", body: request, authScope: "platform" },
    );
  },
  async listTenants(request) {
    return page(
      await apiClient.request<unknown>(`${BASE}/tenants?${query(request)}`, {
        authScope: "platform",
      }),
      enterprise,
    );
  },
  async getTenantEntitlements(id) {
    return tenantEntitlements(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}/entitlements`,
        { authScope: "platform" },
      ),
    );
  },
  async updateTenantEntitlements(id, request) {
    return tenantEntitlements(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}/entitlements`,
        { method: "PUT", body: request, authScope: "platform" },
      ),
    );
  },
  async listLogisticsProviderConfigs() {
    return list(
      await apiClient.request<unknown>(
        `${ERP_OPERATOR_BASE}/logistics-provider-configs`,
        { authScope: "tenant" },
      ),
    ).map(logisticsProviderConfig);
  },
  async getShopifyAppRelease() {
    return shopifyAppRelease(
      await apiClient.request<unknown>(`${ERP_OPERATOR_BASE}/shopify-app-release`, {
        authScope: "tenant",
      }),
    );
  },
  async saveShopifyAppReleaseToken(request) {
    return shopifyAppRelease(
      await apiClient.request<unknown>(`${ERP_OPERATOR_BASE}/shopify-app-release/token`, {
        method: "PUT",
        body: request,
        authScope: "tenant",
      }),
    );
  },
  async clearShopifyAppReleaseToken(version) {
    return shopifyAppRelease(
      await apiClient.request<unknown>(`${ERP_OPERATOR_BASE}/shopify-app-release/token`, {
        method: "DELETE",
        body: { version },
        authScope: "tenant",
      }),
    );
  },
  async publishShopifyApp(version) {
    return shopifyAppRelease(
      await apiClient.request<unknown>(`${ERP_OPERATOR_BASE}/shopify-app-release/publish`, {
        method: "POST",
        body: { version },
        authScope: "tenant",
      }),
    );
  },
  async updateLogisticsProviderConfig(providerCode, request) {
    return logisticsProviderConfig(
      await apiClient.request<unknown>(
        `${ERP_OPERATOR_BASE}/logistics-provider-configs/${encodeURIComponent(providerCode)}`,
        { method: "PUT", body: request, authScope: "tenant" },
      ),
    );
  },
  async renameLogisticsProvider(providerCode, request) {
    return logisticsProviderConfig(
      await apiClient.request<unknown>(
        `${ERP_OPERATOR_BASE}/logistics-provider-configs/${encodeURIComponent(providerCode)}/name`,
        { method: "PUT", body: request, authScope: "tenant" },
      ),
    );
  },
  async listShopifyComplianceRequests() {
    return list(
      await apiClient.request<unknown>(
        `${ERP_OPERATOR_BASE}/shopify-compliance-requests`,
        { authScope: "tenant" },
      ),
    ).map(shopifyComplianceRequest);
  },
  async exportShopifyComplianceData(eventId) {
    return apiClient.requestBlob(
      `${ERP_OPERATOR_BASE}/shopify-compliance-requests/export`,
      {
        method: "POST",
        body: { eventId },
        authScope: "tenant",
        acceptedContentTypes: ["application/json"],
      },
    );
  },
  async confirmShopifyComplianceExportDelivery(eventId) {
    return shopifyComplianceRequest(
      await apiClient.request<unknown>(
        `${ERP_OPERATOR_BASE}/shopify-compliance-requests/confirm-export-delivery`,
        {
          method: "POST",
          body: {
            eventId,
            confirmation: SHOPIFY_EXPORT_DELIVERY_CONFIRMATION,
          },
          authScope: "tenant",
        },
      ),
    );
  },
  async redactShopifyComplianceData(eventId) {
    return shopifyComplianceRequest(
      await apiClient.request<unknown>(
        `${ERP_OPERATOR_BASE}/shopify-compliance-requests/redact`,
        {
          method: "POST",
          body: {
            eventId,
            confirmation: SHOPIFY_REDACTION_CONFIRMATION,
          },
          authScope: "tenant",
        },
      ),
    );
  },
  async createTenant(request) {
    const response = record(
      await apiClient.request<unknown>(`${BASE}/tenants`, {
        method: "POST",
        body: request,
        authScope: "platform",
      }),
    );
    return {
      tenant: enterprise(response.tenant),
      enterpriseAdmin: enterpriseAdmin(response.enterpriseAdmin),
    };
  },
  async updateTenant(id, request) {
    return enterprise(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}`,
        { method: "PUT", body: request, authScope: "platform" },
      ),
    );
  },
  async deleteTenant(id, version) {
    return enterprise(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}/delete`,
        { method: "POST", body: { version }, authScope: "platform" },
      ),
    );
  },
  async createEnterpriseAdmin(id, request) {
    const response = record(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}/enterprise-admins`,
        { method: "POST", body: request, authScope: "platform" },
      ),
    );
    return {
      admin: enterpriseAdmin(response.admin),
    };
  },
  async listEnterpriseAdmins(id, request) {
    return page(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}/enterprise-admins?${query(request)}`,
        { authScope: "platform" },
      ),
      enterpriseAdminPasswordTarget,
    );
  },
  async updateEnterpriseAdmin(tenantId, userId, request) {
    return enterpriseAdminPasswordTarget(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(tenantId)}/enterprise-admins/${encodeURIComponent(userId)}`,
        { method: "PUT", body: request, authScope: "platform" },
      ),
    );
  },
  async resetEnterpriseAdminPassword(tenantId, userId, request) {
    await apiClient.request<void>(
      `${BASE}/tenants/${encodeURIComponent(tenantId)}/enterprise-admins/${encodeURIComponent(userId)}/password`,
      {
        method: "PUT",
        body: request,
        authScope: "platform",
      },
    );
  },
  async enterTenant(id) {
    return tenantAccess(
      await apiClient.request<unknown>(
        `${BASE}/tenants/${encodeURIComponent(id)}/enter`,
        { method: "POST", authScope: "platform" },
      ),
    );
  },
  async redeemPasswordCredential(request) {
    await apiClient.request<void>(`${BASE}/auth/password-credentials/redeem`, {
      method: "POST",
      body: request,
      skipAuth: true,
      authScope: "platform",
    });
  },
};

export function resetPlatformAdminOwnPassword(request: {
  newPassword: string;
}) {
  return apiClient.request<void>(`${BASE}/auth/password/reset`, {
    method: "PUT",
    body: request,
    authScope: "platform",
    skipUnauthorizedHandler: true,
  });
}
