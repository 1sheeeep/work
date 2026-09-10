export type TenantSummary = {
  id: string;
  code: string;
  name: string;
};

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  phoneNumber?: string;
};

export type PlatformAdminIdentity = {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string;
  displayName: string;
  status: "PENDING_ACTIVATION" | "ACTIVE" | "DISABLED" | "DELETED";
};

export type ApplicationAccess = {
  code: string;
  modules: string[];
};

export type AuthSession = {
  tenant: TenantSummary;
  user?: CurrentUser;
  platformAdmin?: PlatformAdminIdentity;
  permissions: string[];
  applications?: ApplicationAccess[];
  expiresAt?: string;
};

export type StoredCredentials = {
  accessToken?: string;
  tokenType?: "Bearer";
};

type LoginRequestBase = {
  tenantCode: string;
  password: string;
};

export type LoginRequest = LoginRequestBase &
  ({ email: string; username?: never } | { email?: never; username: string });

export type LoginResponse = {
  session: AuthSession;
  credentials?: StoredCredentials;
};

export type SessionResponse = {
  session: AuthSession;
};

export type AuthStatus =
  | "initializing"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

export type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  currentTenant: TenantSummary | null;
  currentUser: CurrentUser | null;
  error: string | null;
  login: (request: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasApplication: (applicationCode: string) => boolean;
  hasApplicationModule: (
    applicationCode: string,
    moduleCode: string,
  ) => boolean;
};
