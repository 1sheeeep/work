import type {
  AuthSession,
  PlatformAdminIdentity,
  StoredCredentials,
} from "../auth/types";

export type PlatformSession = {
  admin: PlatformAdminIdentity;
  expiresAt: string;
};

export type PlatformStatus =
  | "initializing"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

type PlatformLoginRequestBase = {
  password: string;
};

export type PlatformLoginRequest = PlatformLoginRequestBase &
  ({ email: string; username?: never } | { email?: never; username: string });

export type PlatformLoginResponse = {
  session: PlatformSession;
  credentials: StoredCredentials;
};

export type ActivationCredential = {
  token: string;
  expiresAt: string;
};

export type PlatformPage<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

export type SystemAdminStatus =
  | "PENDING_ACTIVATION"
  | "ACTIVE"
  | "DISABLED"
  | "DELETED";

export type SystemAdmin = PlatformAdminIdentity & {
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type EnterpriseStatus = "ACTIVE" | "SUSPENDED" | "DISABLED";

export type Enterprise = {
  id: string;
  code: string;
  name: string;
  status: EnterpriseStatus;
  createdAt: string;
  updatedAt: string;
  version: number;
  adminCount: number;
  memberCount: number;
};

export type TenantModuleEntitlement = {
  code: string;
  name: string;
  enabled: boolean;
};

export type TenantApplicationEntitlement = {
  code: string;
  name: string;
  description: string;
  integrationStatus: "AVAILABLE" | "PENDING_INTEGRATION";
  enabled: boolean;
  modules: TenantModuleEntitlement[];
};

export type TenantEntitlements = {
  version: number;
  applications: TenantApplicationEntitlement[];
};

export type EnterpriseAdmin = {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
};

export type EnterpriseAdminPasswordTarget = EnterpriseAdmin & {
  version: number;
};

export type LogisticsProviderConfig = {
  providerCode: string;
  providerName: string;
  documentationUrl: string;
  configurationMode: "SYSTEM_CREDENTIALS" | "BUILT_IN";
  configurationSummary: string;
  endpointSummary: string;
  configured: boolean;
  customerCodeConfigured: boolean;
  authorizationCodeConfigured: boolean;
  secretConfigured: boolean;
  updatedAt?: string;
  version: number;
  nameVersion: number;
};

export type ShopifyAppReleaseStatus =
  | "NOT_CONFIGURED"
  | "CONFIGURED"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED";

export type ShopifyAppRelease = {
  appName: string;
  extensionName: string;
  clientId: string;
  tokenConfigured: boolean;
  status: ShopifyAppReleaseStatus;
  releaseVersion?: string;
  message?: string;
  releasedAt?: string;
  updatedAt?: string;
  version: number;
};

export type ShopifyComplianceTopic =
  | "CUSTOMER_DATA_REQUEST"
  | "CUSTOMER_REDACT"
  | "SHOP_REDACT";

export type ShopifyComplianceOutcome =
  | "EXPORTED"
  | "ANONYMIZED"
  | "DELETED"
  | "NOT_FOUND";

export type ShopifyComplianceStatus =
  | "PENDING"
  | "EXPORT_READY"
  | "LOCAL_REDACTION_COMPLETE"
  | "RETRY_REQUIRED"
  | "COMPLETED";

export type ShopifyComplianceRequest = {
  eventId: string;
  shopDomain: string;
  topic: ShopifyComplianceTopic;
  occurredAt: string;
  dueAt: string;
  overdue: boolean;
  status: ShopifyComplianceStatus;
  recordCount?: number;
  exportPreparedAt?: string;
  dataRedactedAt?: string;
  deliveryConfirmedAt?: string;
  completionOutcome?: ShopifyComplianceOutcome;
  connectorCompletedAt?: string;
  attemptCount: number;
  lastAttemptAt?: string;
  lastErrorCode?: string;
};

export type TenantAccess = {
  session: AuthSession;
  credentials: StoredCredentials;
};

export type PlatformAuthContextValue = {
  status: PlatformStatus;
  session: PlatformSession | null;
  error: string | null;
  login: (request: PlatformLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  enterTenant: (tenantId: string) => Promise<TenantAccess>;
  leaveTenant: () => Promise<void>;
};
