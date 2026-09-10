import { apiClient } from "../api/client";

const BASE = "/api/v1/iam/member-applications";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MemberApplicationAccess = {
  id: string;
  username: string;
  email?: string;
  phoneNumber?: string;
  displayName: string;
  status: "ACTIVE" | "DISABLED";
  version: number;
  enterpriseAdministrator: boolean;
  applications: string[];
};

export type MemberApplicationPage = {
  items: MemberApplicationAccess[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
};

function invalidResponse(): never {
  throw new Error("Invalid member application access response");
}

function member(value: unknown): MemberApplicationAccess {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidResponse();
  }
  const item = value as Record<string, unknown>;
  if (
    typeof item.id !== "string" || !UUID.test(item.id) ||
    typeof item.username !== "string" ||
    typeof item.displayName !== "string" ||
    (item.status !== "ACTIVE" && item.status !== "DISABLED") ||
    !Number.isSafeInteger(item.version) || Number(item.version) < 0 ||
    typeof item.enterpriseAdministrator !== "boolean" ||
    !Array.isArray(item.applications) ||
    !item.applications.every((code) => typeof code === "string")
  ) return invalidResponse();
  return {
    id: item.id,
    username: item.username,
    email: typeof item.email === "string" ? item.email : undefined,
    phoneNumber: typeof item.phoneNumber === "string" ? item.phoneNumber : undefined,
    displayName: item.displayName,
    status: item.status,
    version: Number(item.version),
    enterpriseAdministrator: item.enterpriseAdministrator,
    applications: [...new Set(item.applications as string[])],
  };
}

function page(value: unknown): MemberApplicationPage {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return invalidResponse();
  }
  const source = value as Record<string, unknown>;
  if (
    !Array.isArray(source.items) ||
    !Number.isSafeInteger(source.page) ||
    !Number.isSafeInteger(source.size) ||
    !Number.isSafeInteger(source.totalElements) ||
    !Number.isSafeInteger(source.totalPages)
  ) return invalidResponse();
  return {
    items: source.items.map(member),
    page: Number(source.page),
    size: Number(source.size),
    totalElements: Number(source.totalElements),
    totalPages: Number(source.totalPages),
  };
}

export const memberApplicationAccessApi = {
  async list(input: { page: number; size: number; query?: string }) {
    const query = new URLSearchParams({
      page: String(input.page),
      size: String(input.size),
    });
    if (input.query) query.set("query", input.query);
    return page(await apiClient.request<unknown>(`${BASE}?${query}`));
  },

  async replace(
    userId: string,
    input: { version: number; applications: string[] },
  ) {
    const result = await apiClient.request<unknown>(
      `${BASE}/${userId}/applications`,
      { method: "PUT", body: input },
    );
    if (result === null || typeof result !== "object" || Array.isArray(result)) {
      return invalidResponse();
    }
    const source = result as Record<string, unknown>;
    if (
      source.userId !== userId ||
      !Number.isSafeInteger(source.version) ||
      typeof source.enterpriseAdministrator !== "boolean" ||
      !Array.isArray(source.applications) ||
      !source.applications.every((code) => typeof code === "string")
    ) return invalidResponse();
    return {
      version: Number(source.version),
      enterpriseAdministrator: source.enterpriseAdministrator,
      applications: [...new Set(source.applications as string[])],
    };
  },
};
