import { apiClient } from "../api/client";
import {
  isCanonicalOrLegacyIdentity,
  normalizeE164Phone,
} from "../auth/identity";

const API_BASE = "/api/v1/iam";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

export type Page<T> = {
  items: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};
export type Member = {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  version: number;
  updatedAt: string;
};
export type Role = {
  id: string;
  code: string;
  name: string;
  description?: string;
  systemRole: boolean;
  presetRole: boolean;
  version: number;
  updatedAt: string;
};
export type Permission = {
  id: string;
  code: string;
  module: string;
  name: string;
  description?: string;
};
export type AuditLog = {
  id: string;
  actorUserId?: string;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId?: string;
  createdAt: string;
};
export type IssuedCredential = {
  id: string;
  purpose: "ACTIVATION" | "PASSWORD_RESET";
  token: string;
  expiresAt: string;
};
export type Assignment = {
  resourceId: string;
  assignmentIds: string[];
  version: number;
};
export type WarehouseScope = {
  userId: string;
  mode: "ALL" | "SELECTED";
  warehouseIds: string[];
  version: number;
};
export type CredentialMetadata = {
  id: string;
  purpose: "ACTIVATION" | "PASSWORD_RESET";
  status: "ACTIVE" | "EXPIRED" | "CONSUMED" | "REVOKED";
  expiresAt: string;
  createdAt: string;
  consumedAt?: string;
  revokedAt?: string;
};
export type PageRequest = { page: number; size: number };
export type MemberRequest = PageRequest & {
  query?: string;
  status?: Member["status"];
  roleId?: string;
};
export type AuditRequest = PageRequest & {
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
};
export type CreateMemberInput = {
  email?: string;
  phoneNumber?: string;
  displayName: string;
  initialPassword: string;
  roleIds: string[];
};
export type UpdateMemberInput = {
  displayName: string;
  phoneNumber?: string | null;
  version: number;
};
export type ChangeStatusInput = { status: Member["status"]; version: number };
export type ResetMemberPasswordInput = {
  newPassword: string;
  version: number;
};
export type CreateRoleInput = {
  code: string;
  name: string;
  description?: string;
};
export type UpdateRoleInput = {
  name: string;
  description?: string;
  version: number;
};
export type ReplaceAssignmentsInput = { ids: string[]; version: number };
export type ReplaceWarehouseScopeInput = {
  mode: WarehouseScope["mode"];
  warehouseIds: string[];
  version: number;
};
export type IssueCredentialInput = {
  purpose: IssuedCredential["purpose"];
  expiresInMinutes?: number;
};

type UnknownRecord = Record<string, unknown>;

function invalidResponse(): never {
  throw new Error("Invalid IAM response");
}

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    INSTANT_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") invalidResponse();
  return value;
}

function requiredNonEmptyString(value: unknown): string {
  const string = requiredString(value);
  if (!string) invalidResponse();
  return string;
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  return requiredString(value);
}

function optionalUuid(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isUuid(value)) invalidResponse();
  return value;
}

function path(
  endpoint: string,
  request: Record<string, string | number | undefined>,
) {
  const query = new URLSearchParams();
  Object.entries(request).forEach(([key, value]) => {
    if (value !== undefined && value !== "") query.set(key, String(value));
  });
  return `${API_BASE}/${endpoint}?${query.toString()}`;
}

function mapPage<T>(value: unknown, mapper: (item: unknown) => T): Page<T> {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isNonNegativeInteger(value.page) ||
    !isPositiveInteger(value.size) ||
    !isNonNegativeInteger(value.totalElements) ||
    !isNonNegativeInteger(value.totalPages) ||
    value.page > 1_000_000 ||
    value.size > 100
  )
    invalidResponse();
  const expectedPages =
    value.totalElements === 0 ? 0 : Math.ceil(value.totalElements / value.size);
  if (
    value.totalPages !== expectedPages ||
    value.items.length > value.size ||
    value.items.length > value.totalElements
  )
    invalidResponse();
  return {
    items: value.items.map((item) => mapper(item)),
    page: value.page,
    size: value.size,
    totalElements: value.totalElements,
    totalPages: value.totalPages,
  };
}

function mapMember(value: unknown): Member {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !["ACTIVE", "DISABLED"].includes(value.status as Member["status"]) ||
    !isNonNegativeInteger(value.version) ||
    !isInstant(value.updatedAt)
  )
    invalidResponse();
  const username = requiredString(value.username);
  const email = optionalString(value.email);
  const phoneNumber = optionalString(value.phoneNumber);
  if (
    !isCanonicalOrLegacyIdentity(username, email, phoneNumber) ||
    (phoneNumber !== undefined &&
      normalizeE164Phone(phoneNumber) !== phoneNumber)
  )
    invalidResponse();
  return {
    id: value.id,
    username,
    email,
    phoneNumber,
    displayName: requiredString(value.displayName),
    status: value.status as Member["status"],
    version: value.version,
    updatedAt: value.updatedAt,
  };
}

function mapRole(value: unknown): Role {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.systemRole !== "boolean" ||
    typeof value.presetRole !== "boolean" ||
    !isNonNegativeInteger(value.version) ||
    !isInstant(value.updatedAt)
  )
    invalidResponse();
  return {
    id: value.id,
    code: requiredString(value.code),
    name: requiredString(value.name),
    description: optionalString(value.description),
    systemRole: value.systemRole,
    presetRole: value.presetRole,
    version: value.version,
    updatedAt: value.updatedAt,
  };
}

function mapPermission(value: unknown): Permission {
  if (!isRecord(value) || !isUuid(value.id)) invalidResponse();
  return {
    id: value.id,
    code: requiredString(value.code),
    module: requiredString(value.module),
    name: requiredString(value.name),
    description: optionalString(value.description),
  };
}

function mapAuditLog(value: unknown): AuditLog {
  if (!isRecord(value) || !isUuid(value.id) || !isInstant(value.createdAt))
    invalidResponse();
  return {
    id: value.id,
    actorUserId: optionalUuid(value.actorUserId),
    action: requiredString(value.action),
    resourceType: requiredString(value.resourceType),
    resourceId: requiredString(value.resourceId),
    requestId: optionalString(value.requestId),
    createdAt: value.createdAt,
  };
}

function mapCredential(value: unknown): IssuedCredential {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !["ACTIVATION", "PASSWORD_RESET"].includes(
      value.purpose as IssuedCredential["purpose"],
    ) ||
    !isInstant(value.expiresAt)
  )
    invalidResponse();
  return {
    id: value.id,
    purpose: value.purpose as IssuedCredential["purpose"],
    token: requiredNonEmptyString(value.token),
    expiresAt: value.expiresAt,
  };
}

function mapAssignment(value: unknown): Assignment {
  if (
    !isRecord(value) ||
    !isUuid(value.resourceId) ||
    !Array.isArray(value.assignmentIds) ||
    !value.assignmentIds.every(isUuid) ||
    new Set(value.assignmentIds).size !== value.assignmentIds.length ||
    !isNonNegativeInteger(value.version)
  )
    invalidResponse();
  return {
    resourceId: value.resourceId,
    assignmentIds: [...value.assignmentIds],
    version: value.version,
  };
}

function mapWarehouseScope(value: unknown): WarehouseScope {
  if (
    !isRecord(value) ||
    !isUuid(value.userId) ||
    !["ALL", "SELECTED"].includes(value.mode as WarehouseScope["mode"]) ||
    !Array.isArray(value.warehouseIds) ||
    !value.warehouseIds.every(isUuid) ||
    new Set(value.warehouseIds).size !== value.warehouseIds.length ||
    !isNonNegativeInteger(value.version) ||
    (value.mode === "ALL" && value.warehouseIds.length !== 0)
  )
    invalidResponse();
  return {
    userId: value.userId,
    mode: value.mode as WarehouseScope["mode"],
    warehouseIds: [...value.warehouseIds],
    version: value.version,
  };
}

function nullableInstant(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (!isInstant(value)) invalidResponse();
  return value;
}

function mapCredentialMetadata(value: unknown): CredentialMetadata {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isInstant(value.expiresAt) ||
    !isInstant(value.createdAt) ||
    !["ACTIVATION", "PASSWORD_RESET"].includes(value.purpose as string) ||
    !["ACTIVE", "EXPIRED", "CONSUMED", "REVOKED"].includes(
      value.status as string,
    )
  )
    invalidResponse();
  const consumedAt = nullableInstant(value.consumedAt);
  const revokedAt = nullableInstant(value.revokedAt);
  const status = value.status as CredentialMetadata["status"];
  if (
    (status === "CONSUMED" && !consumedAt) ||
    (status === "REVOKED" && !revokedAt) ||
    ((status === "ACTIVE" || status === "EXPIRED") && (consumedAt || revokedAt))
  )
    invalidResponse();
  return {
    id: value.id,
    purpose: value.purpose as CredentialMetadata["purpose"],
    status,
    expiresAt: value.expiresAt,
    createdAt: value.createdAt,
    consumedAt,
    revokedAt,
  };
}

export const iamAdminApi = {
  async listMembers(request: MemberRequest) {
    return mapPage(
      await apiClient.request<unknown>(path("members", request)),
      mapMember,
    );
  },
  createMember(input: CreateMemberInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/members`, { method: "POST", body: input })
      .then(mapMember);
  },
  updateMember(userId: string, input: UpdateMemberInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}`, {
        method: "PATCH",
        body: input,
      })
      .then(mapMember);
  },
  changeMemberStatus(userId: string, input: ChangeStatusInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}/status`, {
        method: "PUT",
        body: input,
      })
      .then(mapMember);
  },
  resetMemberPassword(userId: string, input: ResetMemberPasswordInput) {
    return apiClient.request<void>(`${API_BASE}/members/${userId}/password`, {
      method: "PUT",
      body: input,
    });
  },
  replaceMemberRoles(userId: string, input: ReplaceAssignmentsInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}/roles`, {
        method: "PUT",
        body: input,
      })
      .then(mapAssignment);
  },
  getMemberRoles(userId: string) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}/roles`)
      .then(mapAssignment)
      .then((assignment) => {
        if (assignment.resourceId !== userId) invalidResponse();
        return assignment;
      });
  },
  getMemberWarehouseScope(userId: string) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}/warehouse-scope`)
      .then(mapWarehouseScope)
      .then((scope) => {
        if (scope.userId !== userId) invalidResponse();
        return scope;
      });
  },
  replaceMemberWarehouseScope(
    userId: string,
    input: ReplaceWarehouseScopeInput,
  ) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}/warehouse-scope`, {
        method: "PUT",
        body: input,
      })
      .then(mapWarehouseScope)
      .then((scope) => {
        if (scope.userId !== userId) invalidResponse();
        return scope;
      });
  },
  async listRoles(request: PageRequest) {
    return mapPage(
      await apiClient.request<unknown>(path("roles", request)),
      mapRole,
    );
  },
  createRole(input: CreateRoleInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/roles`, { method: "POST", body: input })
      .then(mapRole);
  },
  updateRole(roleId: string, input: UpdateRoleInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/roles/${roleId}`, {
        method: "PATCH",
        body: input,
      })
      .then(mapRole);
  },
  replaceRolePermissions(roleId: string, input: ReplaceAssignmentsInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/roles/${roleId}/permissions`, {
        method: "PUT",
        body: input,
      })
      .then(mapAssignment);
  },
  getRolePermissions(roleId: string) {
    return apiClient
      .request<unknown>(`${API_BASE}/roles/${roleId}/permissions`)
      .then(mapAssignment)
      .then((assignment) => {
        if (assignment.resourceId !== roleId) invalidResponse();
        return assignment;
      });
  },
  async listPermissions(request: PageRequest) {
    return mapPage(
      await apiClient.request<unknown>(path("permissions", request)),
      mapPermission,
    );
  },
  async listAuditLogs(request: AuditRequest) {
    return mapPage(
      await apiClient.request<unknown>(path("audit-logs", request)),
      mapAuditLog,
    );
  },
  issueCredential(userId: string, input: IssueCredentialInput) {
    return apiClient
      .request<unknown>(`${API_BASE}/members/${userId}/password-credentials`, {
        method: "POST",
        body: input,
      })
      .then(mapCredential);
  },
  revokeCredential(userId: string, credentialId: string) {
    return apiClient.request<void>(
      `${API_BASE}/members/${userId}/password-credentials/${credentialId}`,
      { method: "DELETE" },
    );
  },
  async listCredentialMetadata(userId: string, request: PageRequest) {
    return mapPage(
      await apiClient.request<unknown>(
        path(`members/${userId}/password-credentials`, request),
      ),
      mapCredentialMetadata,
    );
  },
};
