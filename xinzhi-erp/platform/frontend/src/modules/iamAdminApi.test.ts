import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { iamAdminApi } from "./iamAdminApi";

const memberId = "96000000-0000-4000-8000-000000000010";
const auditId = "96000000-0000-4000-8000-000000000011";
const instant = "2026-07-28T10:00:00Z";

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: memberId,
    username: "agent.lee@example.com",
    email: "agent.lee@example.com",
    phoneNumber: null,
    displayName: "李坐席",
    status: "DISABLED",
    version: 0,
    updatedAt: instant,
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("iamAdminApi", () => {
  it("accepts canonical database UUIDs used by the permission catalog", async () => {
    const permissionId = "70000000-0000-0000-0000-000000000004";
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: permissionId,
          code: "platform:read",
          module: "platform",
          name: "Read platform",
          description: null,
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      iamAdminApi.listPermissions({ page: 0, size: 20 }),
    ).resolves.toMatchObject({
      items: [{ id: permissionId, code: "platform:read" }],
    });
  });

  it("uses only supported audit filters and drops audit details", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [
        {
          id: auditId,
          actorUserId: memberId,
          action: "iam.user.updated",
          resourceType: "member",
          resourceId: memberId,
          requestId: "req",
          createdAt: instant,
          details: { password: "secret" },
        },
      ],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });

    const result = await iamAdminApi.listAuditLogs({
      page: 0,
      size: 20,
      action: "iam.user.updated",
      resourceType: "member",
    });

    expect(request).toHaveBeenCalledWith(
      "/api/v1/iam/audit-logs?page=0&size=20&action=iam.user.updated&resourceType=member",
    );
    expect(result.items[0]).not.toHaveProperty("details");
    expect(JSON.stringify(request.mock.calls[0])).not.toContain("tenantId");
  });

  it("allowlists mutation responses before they reach IAM UI state", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue(
      member({ passwordHash: "must-never-reach-ui" }),
    );

    const result = await iamAdminApi.createMember({
      email: "agent.lee@example.com",
      phoneNumber: "+8613800138000",
      displayName: "李坐席",
      initialPassword: "initial-member-password",
      roleIds: ["96000000-0000-4000-8000-000000000011"],
    });

    expect(apiClient.request).toHaveBeenCalledWith(
      "/api/v1/iam/members",
      {
        method: "POST",
        body: {
          email: "agent.lee@example.com",
          phoneNumber: "+8613800138000",
          displayName: "李坐席",
          initialPassword: "initial-member-password",
          roleIds: ["96000000-0000-4000-8000-000000000011"],
        },
      },
    );
    expect(result).not.toHaveProperty("passwordHash");
    expect(JSON.stringify(result)).not.toContain("must-never-reach-ui");
  });

  it.each([
    ["invalid status", member({ status: "UNSAFE_SERVER_STATUS" })],
    ["invalid UUID", member({ id: "server-member-id" })],
    ["invalid timestamp", member({ updatedAt: "not-a-timestamp" })],
    ["email-backed username without email", member({ email: null })],
    ["mismatched email alias", member({ email: "other@example.com" })],
    [
      "non-canonical email",
      member({
        username: "Agent.Lee@example.com",
        email: "Agent.Lee@example.com",
      }),
    ],
    ["invalid E.164 phone", member({ phoneNumber: "13800138000" })],
    [
      "missing member field",
      {
        id: memberId,
        username: "agent.lee",
        status: "ACTIVE",
        version: 0,
        updatedAt: instant,
      },
    ],
  ])("safely rejects a mutation response with %s", async (_case, payload) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(payload);

    await expect(
      iamAdminApi.createMember({
        email: "agent.lee@example.com",
        displayName: "李坐席",
        initialPassword: "initial-member-password",
        roleIds: [],
      }),
    ).rejects.toThrow("Invalid IAM response");
  });

  it.each([
    ["missing page count", { items: [], page: 0, size: 20, totalElements: 0 }],
    [
      "negative page count",
      { items: [], page: -1, size: 20, totalElements: 0, totalPages: 0 },
    ],
    [
      "inconsistent page count",
      { items: [member()], page: 0, size: 20, totalElements: 1, totalPages: 0 },
    ],
  ])("safely rejects a member page with %s", async (_case, payload) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(payload);

    await expect(
      iamAdminApi.listMembers({ page: 0, size: 20 }),
    ).rejects.toThrow("Invalid IAM response");
  });

  it("uses the assignment and credential query contracts without tenant selectors", async () => {
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValueOnce({
        resourceId: memberId,
        assignmentIds: [auditId],
        version: 3,
        ignored: "not exposed",
      })
      .mockResolvedValueOnce({
        items: [
          {
            id: auditId,
            purpose: "PASSWORD_RESET",
            status: "EXPIRED",
            expiresAt: instant,
            createdAt: instant,
            consumedAt: null,
            revokedAt: null,
            tokenHash: "must-not-reach-ui",
          },
        ],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      });

    expect(await iamAdminApi.getMemberRoles(memberId)).toEqual({
      resourceId: memberId,
      assignmentIds: [auditId],
      version: 3,
    });
    const credentials = await iamAdminApi.listCredentialMetadata(memberId, {
      page: 0,
      size: 20,
    });
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      `/api/v1/iam/members/${memberId}/roles`,
      `/api/v1/iam/members/${memberId}/password-credentials?page=0&size=20`,
    ]);
    expect(JSON.stringify({ credentials })).not.toContain(
      "must-not-reach-ui",
    );
  });

  it.each([
    [
      "bad assignment UUID",
      { resourceId: memberId, assignmentIds: ["bad"], version: 0 },
    ],
    [
      "bad credential timestamp",
      {
        items: [
          {
            id: auditId,
            purpose: "ACTIVATION",
            status: "ACTIVE",
            expiresAt: "bad",
            createdAt: instant,
          },
        ],
        page: 0,
        size: 20,
        totalElements: 1,
        totalPages: 1,
      },
    ],
  ])("rejects malformed new IAM query response: %s", async (_case, payload) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(payload);
    if (_case.includes("assignment"))
      await expect(iamAdminApi.getMemberRoles(memberId)).rejects.toThrow(
        "Invalid IAM response",
      );
    else
      await expect(
        iamAdminApi.listCredentialMetadata(memberId, { page: 0, size: 20 }),
      ).rejects.toThrow("Invalid IAM response");
  });

  it("maps the V40 warehouse scope and sends only the approved replacement body", async () => {
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValueOnce({
        userId: memberId,
        mode: "SELECTED",
        warehouseIds: [],
        version: 3,
        ignored: "not exposed",
      })
      .mockResolvedValueOnce({
        userId: memberId,
        mode: "ALL",
        warehouseIds: [],
        version: 4,
      });

    await expect(
      iamAdminApi.getMemberWarehouseScope(memberId),
    ).resolves.toEqual({
      userId: memberId,
      mode: "SELECTED",
      warehouseIds: [],
      version: 3,
    });
    await expect(
      iamAdminApi.replaceMemberWarehouseScope(memberId, {
        mode: "ALL",
        warehouseIds: [],
        version: 3,
      }),
    ).resolves.toMatchObject({ mode: "ALL", version: 4 });
    expect(request).toHaveBeenNthCalledWith(
      1,
      `/api/v1/iam/members/${memberId}/warehouse-scope`,
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/iam/members/${memberId}/warehouse-scope`,
      {
        method: "PUT",
        body: { mode: "ALL", warehouseIds: [], version: 3 },
      },
    );
    expect(JSON.stringify(request.mock.calls)).not.toContain("tenantId");
  });

  it.each([
    {
      userId: auditId,
      mode: "ALL",
      warehouseIds: [],
      version: 0,
    },
    {
      userId: memberId,
      mode: "ALL",
      warehouseIds: [auditId],
      version: 0,
    },
    {
      userId: memberId,
      mode: "SELECTED",
      warehouseIds: ["bad"],
      version: 0,
    },
    {
      userId: memberId,
      mode: "UNKNOWN",
      warehouseIds: [],
      version: 0,
    },
  ])("rejects a malformed V40 warehouse scope response", async (payload) => {
    vi.spyOn(apiClient, "request").mockResolvedValue(payload);

    await expect(
      iamAdminApi.getMemberWarehouseScope(memberId),
    ).rejects.toThrow("Invalid IAM response");
  });
});
