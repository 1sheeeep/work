import { ApiError, apiClient } from "../api/client";
import { isCanonicalOrLegacyIdentity, normalizeE164Phone } from "./identity";
import type {
  AuthSession,
  LoginRequest,
  LoginResponse,
  SessionResponse,
} from "./types";

export interface AuthAdapter {
  login(request: LoginRequest): Promise<LoginResponse>;
  getSession(): Promise<SessionResponse>;
  logout(): Promise<void>;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type RecordValue = Record<string, unknown>;

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

function text(value: unknown, maximum: number): string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum
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
  return Number.isNaN(new Date(candidate).valueOf())
    ? invalidResponse()
    : candidate;
}

function platformStatus(
  value: unknown,
): "PENDING_ACTIVATION" | "ACTIVE" | "DISABLED" | "DELETED" {
  return value === "PENDING_ACTIVATION" ||
    value === "ACTIVE" ||
    value === "DISABLED" ||
    value === "DELETED"
    ? value
    : invalidResponse();
}

function applicationAccess(value: unknown) {
  const source = record(value);
  return {
    code: text(source.code, 40),
    modules: Array.isArray(source.modules)
      ? source.modules.map((module) => text(module, 64))
      : invalidResponse(),
  };
}

function loginIdentity(source: RecordValue) {
  const username = text(source.username, 254);
  const email = optionalText(source.email, 254);
  const declaredPhoneNumber = optionalText(source.phoneNumber, 16);
  const phoneNumber = declaredPhoneNumber ??
    (normalizeE164Phone(username) === username ? username : undefined);
  if (
    (phoneNumber !== undefined && normalizeE164Phone(phoneNumber) !== phoneNumber) ||
    !isCanonicalOrLegacyIdentity(username, email, phoneNumber)
  ) {
    invalidResponse();
  }
  return { username, email, phoneNumber };
}

function toSession(value: unknown): AuthSession {
  const identity = record(value);
  const tenant = record(identity.tenant);
  const user = identity.user === null ? null : record(identity.user);
  const platformAdmin =
    identity.platformAdmin === null || identity.platformAdmin === undefined
      ? null
      : record(identity.platformAdmin);
  if ((user === null) === (platformAdmin === null)) invalidResponse();

  return {
    tenant: {
      id: uuid(tenant.id),
      code: text(tenant.code, 64),
      name: text(tenant.name, 160),
    },
    ...(user
      ? {
          user: {
            id: uuid(user.id),
            ...loginIdentity(user),
            displayName: text(user.displayName, 160),
          },
        }
      : {
          platformAdmin: {
            id: uuid(platformAdmin?.id),
            ...loginIdentity(platformAdmin!),
            displayName: text(platformAdmin?.displayName, 160),
            status: platformStatus(platformAdmin?.status),
          },
        }),
    permissions: Array.isArray(identity.permissions)
      ? identity.permissions.map((permission) => text(permission, 160))
      : invalidResponse(),
    applications: Array.isArray(identity.applications)
      ? identity.applications.map(applicationAccess)
      : [],
    expiresAt: timestamp(identity.expiresAt),
  };
}

export const httpAuthAdapter: AuthAdapter = {
  async login(request): Promise<LoginResponse> {
    const response = record(await apiClient.request<unknown>(
      "/api/v1/auth/login",
      {
        method: "POST",
        body: request,
        skipAuth: true,
      },
    ));

    if (response.tokenType !== "Bearer") invalidResponse();
    return {
      session: toSession(response),
      credentials: {
        accessToken: text(response.accessToken, 2048),
        tokenType: "Bearer",
      },
    };
  },

  async getSession(): Promise<SessionResponse> {
    const response = await apiClient.request<unknown>("/api/v1/auth/me", {
      // A stale bootstrap response must not invalidate a newer successful login.
      skipUnauthorizedHandler: true,
    });
    return { session: toSession(response) };
  },

  async logout() {
    await apiClient.request<void>("/api/v1/auth/session", {
      method: "DELETE",
    });
  },
};

export function changeTenantPassword(request: {
  currentPassword: string;
  newPassword: string;
}) {
  return apiClient.request<void>("/api/v1/auth/password", {
    method: "PUT",
    body: request,
    skipUnauthorizedHandler: true,
  });
}
