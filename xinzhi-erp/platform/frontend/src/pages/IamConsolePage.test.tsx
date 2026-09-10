import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { iamAdminApi } from "../modules/iamAdminApi";
import { IamConsolePage, parseIamQuery, toIamUrl } from "./IamConsolePage";

const routerState = vi.hoisted(() => ({ search: "", push: vi.fn() }));
const authState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  hasPermission: (permission: string) => authState.permissions.has(permission),
  session: {
    user: {
      id: "96000000-0000-4000-8000-000000000001",
    } as { id: string } | undefined,
    platformAdmin: undefined as { id: string } | undefined,
  },
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: routerState.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: authState.hasPermission,
    session: authState.session,
  }),
}));

const member = {
  id: "96000000-0000-4000-8000-000000000010",
  username: "agent.lee",
  displayName: "Lee",
  status: "ACTIVE" as const,
  version: 3,
  updatedAt: "2026-07-29T00:00:00Z",
};
const role = {
  id: "96000000-0000-4000-8000-000000000011",
  code: "support",
  name: "Support",
  description: "Support role",
  systemRole: false,
  presetRole: false,
  version: 4,
  updatedAt: "2026-07-29T00:00:00Z",
};
const systemRole = {
  ...role,
  id: "96000000-0000-4000-8000-000000000012",
  name: "Tenant admin",
  systemRole: true,
};
const presetRole = {
  ...role,
  id: "96000000-0000-4000-8000-000000000016",
  code: "customer_service_manager",
  name: "客服主管",
  description: "负责客服团队管理",
  presetRole: true,
};
const permission = {
  id: "96000000-0000-4000-8000-000000000013",
  code: "iam:user:read",
  module: "iam",
  name: "Read members",
  description: undefined,
};
const page = <T,>(
  items: T[],
  pageNumber = 0,
  totalPages = 1,
  size = 20,
) => ({
  items,
  page: pageNumber,
  size,
  totalElements: items.length,
  totalPages,
});
const assignment = {
  resourceId: member.id,
  assignmentIds: [role.id],
  version: 7,
};

beforeEach(() => {
  routerState.search = "";
  routerState.push.mockReset();
  authState.permissions = new Set([
    "iam:user:read",
    "iam:user:write",
    "iam:role:read",
    "iam:role:write",
    "iam:permission:read",
    "iam:permission:assign",
    "iam:audit:read",
  ]);
  authState.session.user = {
    id: "96000000-0000-4000-8000-000000000001",
  };
  authState.session.platformAdmin = undefined;
  vi.spyOn(iamAdminApi, "listMembers").mockResolvedValue(page([member]));
  vi.spyOn(iamAdminApi, "listRoles").mockResolvedValue(
    page([role, systemRole]),
  );
  vi.spyOn(iamAdminApi, "listPermissions").mockResolvedValue(
    page([permission]),
  );
  vi.spyOn(iamAdminApi, "listAuditLogs").mockResolvedValue(page([]));
  vi.spyOn(iamAdminApi, "getMemberRoles").mockResolvedValue(assignment);
  vi.spyOn(iamAdminApi, "getRolePermissions").mockResolvedValue({
    ...assignment,
    resourceId: role.id,
    assignmentIds: [permission.id],
  });
  vi.spyOn(iamAdminApi, "listCredentialMetadata").mockResolvedValue(
    page([
      {
        id: "96000000-0000-4000-8000-000000000015",
        purpose: "PASSWORD_RESET",
        status: "EXPIRED",
        expiresAt: "2026-07-29T00:00:00Z",
        createdAt: "2026-07-28T00:00:00Z",
      },
    ]),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IAM console assignment and session loops", () => {
  it("creates a member with an initial password and selected non-system roles", async () => {
    const create = vi.spyOn(iamAdminApi, "createMember").mockResolvedValue({
      ...member,
      id: "96000000-0000-4000-8000-000000000099",
      email: "new.agent@example.com",
      displayName: "New Agent",
      version: 0,
    });
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "新增员工账号" }));
    const dialog = await screen.findByRole("dialog", {
      name: "新增员工账号",
    });
    fireEvent.change(within(dialog).getByLabelText(/^邮箱/), {
      target: { value: "new.agent@example.com" },
    });
    fireEvent.change(within(dialog).getByLabelText("员工姓名"), {
      target: { value: "New Agent" },
    });
    expect(within(dialog).queryByText(/12[–-]128/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^初始密码/), {
      target: { value: "123456" },
    });
    fireEvent.change(within(dialog).getByLabelText("确认初始密码"), {
      target: { value: "123456" },
    });
    const support = await within(dialog).findByRole("checkbox", {
      name: /Support/,
    });
    fireEvent.click(support);
    expect(
      within(dialog).queryByRole("checkbox", { name: /Tenant admin/ }),
    ).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        email: "new.agent@example.com",
        displayName: "New Agent",
        initialPassword: "123456",
        roleIds: [role.id],
      }),
    );
    expect(screen.queryByRole("dialog", { name: "新增员工账号" })).toBeNull();
  });

  it("keeps a phone-only member's primary login identity read-only", async () => {
    const phoneMember = {
      ...member,
      username: "+8613800138000",
      email: undefined,
      phoneNumber: "+8613800138000",
    };
    vi.mocked(iamAdminApi.listMembers).mockResolvedValue(page([phoneMember]));
    const update = vi.spyOn(iamAdminApi, "updateMember").mockResolvedValue({
      ...phoneMember,
      displayName: "Phone User",
      version: 4,
    });

    render(<IamConsolePage />);
    await screen.findByText("13800138000");
    fireEvent.click(screen.getByRole("button", { name: "编辑资料" }));
    const dialog = await screen.findByRole("dialog", {
      name: "编辑员工资料",
    });
    expect(
      within(dialog).getByText("该手机号是主登录账号，当前不支持直接修改。"),
    ).toBeTruthy();
    expect(within(dialog).queryByLabelText("手机号（可选）")).toBeNull();

    fireEvent.change(within(dialog).getByLabelText("员工姓名"), {
      target: { value: "Phone User" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(phoneMember.id, {
        displayName: "Phone User",
        version: phoneMember.version,
      }),
    );
  });

  it("does not request or expose gated assignment and catalog UI", async () => {
    authState.permissions = new Set(["iam:user:read"]);
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    expect(screen.queryByRole("button", { name: "查看角色" })).toBeNull();
    expect(iamAdminApi.listRoles).not.toHaveBeenCalled();
    expect(iamAdminApi.listPermissions).not.toHaveBeenCalled();
  });

  it("allows a platform administrator in tenant context to reset employee passwords", async () => {
    authState.session.user = undefined;
    authState.session.platformAdmin = {
      id: "96000000-0000-4000-8000-000000000099",
    };
    authState.permissions = new Set(["iam:user:read", "iam:user:write"]);

    render(<IamConsolePage />);

    await screen.findByText("agent.lee");
    expect(screen.getByRole("button", { name: "重置密码" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "会话" })).toBeNull();
  });

  it("preselects member roles and sends the exact replacement version", async () => {
    const replace = vi
      .spyOn(iamAdminApi, "replaceMemberRoles")
      .mockResolvedValue(assignment);
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看/分配角色" }));
    await screen.findByRole("dialog", { name: "员工角色：Lee" });
    expect(
      (screen.getByRole("checkbox", { name: /Support/ }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "保存角色" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(member.id, {
        ids: [role.id],
        version: 7,
      }),
    );
  });

  it("keeps member role choices disabled until the authoritative assignment arrives", async () => {
    let resolveAssignment!: (value: typeof assignment) => void;
    const assignmentRequest = new Promise<typeof assignment>((resolve) => {
      resolveAssignment = resolve;
    });
    vi.spyOn(iamAdminApi, "getMemberRoles").mockReturnValue(assignmentRequest);
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看/分配角色" }));
    const dialog = await screen.findByRole("dialog", { name: "员工角色：Lee" });
    const choice = await within(dialog).findByRole("checkbox", {
      name: /Support/,
    });
    expect(choice).toHaveProperty("disabled", true);
    resolveAssignment(assignment);
    await waitFor(() =>
      expect((choice as HTMLInputElement).disabled).toBe(false),
    );
    expect((choice as HTMLInputElement).checked).toBe(true);
  });

  it("loads permissions only with permission read and protects system roles", async () => {
    routerState.search = "?view=roles";
    render(<IamConsolePage />);
    const systemRow = (await screen.findByText("Tenant admin")).closest("tr")!;
    fireEvent.click(
      within(systemRow).getByRole("button", { name: "权限" }),
    );
    await screen.findByRole("dialog", { name: "角色权限：Tenant admin" });
    expect(
      screen.queryByRole("button", { name: "保存权限" }),
    ).toBeNull();
    expect(screen.getByText("系统角色受保护，仅可查看权限。")).toBeTruthy();
  });

  it("标记预设角色并保护固定权限矩阵", async () => {
    routerState.search = "?view=roles";
    vi.mocked(iamAdminApi.listRoles).mockResolvedValue(
      page([role, presetRole, systemRole]),
    );

    render(<IamConsolePage />);

    const presetRow = (await screen.findByText("客服主管")).closest("tr")!;
    expect(within(presetRow).getByText("预设角色")).toBeTruthy();
    expect(
      within(presetRow).queryByRole("button", { name: "编辑" }),
    ).toBeNull();
    fireEvent.click(within(presetRow).getByRole("button", { name: "权限" }));
    const dialog = await screen.findByRole("dialog", {
      name: "角色权限：客服主管",
    });
    expect(within(dialog).getByText("预设角色受保护，仅可查看权限。")).toBeTruthy();
    expect(
      within(dialog).queryByRole("button", { name: "保存权限" }),
    ).toBeNull();
  });

  it("loads the shared role page size from URL and resets the role page when it changes", async () => {
    vi.mocked(iamAdminApi.listRoles).mockResolvedValue(page([role], 2, 3, 50));
    routerState.search = "?view=roles&rolePage=2&roleSize=50";

    render(<IamConsolePage />);

    expect(await screen.findByText("Support")).toBeTruthy();
    expect(iamAdminApi.listRoles).toHaveBeenCalledWith({
      page: 2,
      size: 50,
    });
    expect(
      (
        screen.getByLabelText(
          "角色列表分页每页条数",
        ) as HTMLSelectElement
      ).value,
    ).toBe("50");

    fireEvent.change(screen.getByLabelText("角色列表分页每页条数"), {
      target: { value: "100" },
    });

    await waitFor(() => expect(routerState.push).toHaveBeenCalledTimes(1));
    const target = String(routerState.push.mock.calls[0][0]);
    expect(target).toContain("rolePage=0");
    expect(target).toContain("roleSize=100");
  });

  it("resets a member password directly without issuing a credential token", async () => {
    const reset = vi
      .spyOn(iamAdminApi, "resetMemberPassword")
      .mockResolvedValue();
    const issue = vi.spyOn(iamAdminApi, "issueCredential");
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    const dialog = await screen.findByRole("dialog", {
      name: "重置员工密码",
    });
    expect(within(dialog).queryByText(/12[–-]128/)).toBeNull();
    fireEvent.change(within(dialog).getByLabelText(/^新密码/), {
      target: { value: "123456" },
    });
    fireEvent.change(within(dialog).getByLabelText("确认新密码"), {
      target: { value: "123456" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "重置密码" }),
    );
    await waitFor(() =>
      expect(reset).toHaveBeenCalledWith(member.id, {
        newPassword: "123456",
        version: member.version,
      }),
    );
    expect(issue).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("dialog", { name: "重置员工密码" }),
    ).toBeNull();
  });

  it("preserves selection on conflicts, redacts all standard errors, and restores focus on Escape", async () => {
    vi.spyOn(iamAdminApi, "replaceMemberRoles").mockRejectedValue(
      new ApiError("secret", { status: 409 }),
    );
    render(<IamConsolePage />);
    const trigger = await screen.findByRole("button", {
      name: "查看/分配角色",
    });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("checkbox", { name: /Support/ });
    fireEvent.click(screen.getByRole("checkbox", { name: /Support/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存角色" }));
    expect((await screen.findByRole("alert")).textContent).not.toContain(
      "secret",
    );
    expect(
      (screen.getByRole("checkbox", { name: /Support/ }) as HTMLInputElement)
        .checked,
    ).toBe(false);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });

  it.each([401, 403, 404, 500])(
    "renders a redacted member read error for HTTP %i",
    async (status) => {
      vi.spyOn(iamAdminApi, "listMembers").mockRejectedValue(
        new ApiError("server secret", { status }),
      );
      render(<IamConsolePage />);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toContain("server secret");
    },
  );

  it("prevents duplicate password resets and preserves the dialog after failure", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    const reset = vi
      .spyOn(iamAdminApi, "resetMemberPassword")
      .mockReturnValue(pending);
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    const dialog = await screen.findByRole("dialog", {
      name: "重置员工密码",
    });
    fireEvent.change(within(dialog).getByLabelText(/^新密码/), {
      target: { value: "new-member-password" },
    });
    fireEvent.change(within(dialog).getByLabelText("确认新密码"), {
      target: { value: "new-member-password" },
    });
    const confirm = within(dialog).getByRole("button", {
      name: "重置密码",
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(reset).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveProperty("disabled", true);
    reject(new ApiError("server secret", { status: 500 }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).not.toContain("server secret");
    expect(
      within(dialog).getByRole("button", { name: "重置密码" }),
    ).toBeTruthy();
  });

  it("retains selections across role catalog pages and submits every selected ID after a 409", async () => {
    const secondRole = {
      ...role,
      id: "96000000-0000-4000-8000-000000000018",
      name: "Second role",
    };
    vi.spyOn(iamAdminApi, "listRoles").mockImplementation(
      ({ page: pageNumber, size }) =>
        Promise.resolve(
          size === 100 && pageNumber === 1
            ? page([secondRole], 1, 2)
            : page([role], 0, 2),
        ),
    );
    const replace = vi
      .spyOn(iamAdminApi, "replaceMemberRoles")
      .mockRejectedValue(new ApiError("server secret", { status: 409 }));
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看/分配角色" }));
    const dialog = await screen.findByRole("dialog", { name: "员工角色：Lee" });
    await within(dialog).findByRole("checkbox", { name: /Support/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    const second = await within(dialog).findByRole("checkbox", {
      name: /Second role/,
    });
    fireEvent.click(second);
    fireEvent.click(within(dialog).getByRole("button", { name: "保存角色" }));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(member.id, {
        ids: [role.id, secondRole.id],
        version: 7,
      }),
    );
    expect(
      (await within(dialog).findByRole("alert")).textContent,
    ).not.toContain("server secret");
    fireEvent.click(within(dialog).getByRole("button", { name: "上一页" }));
    expect(
      (
        (await within(dialog).findByRole("checkbox", {
          name: /Support/,
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);
  });

  it("ignores an old role catalog page after a faster page switch", async () => {
    const staleRole = {
      ...role,
      id: "96000000-0000-4000-8000-000000000019",
      name: "Stale role",
    };
    let resolveStale!: (data: ReturnType<typeof page<typeof role>>) => void;
    const stale = new Promise<ReturnType<typeof page<typeof role>>>(
      (resolve) => {
        resolveStale = resolve;
      },
    );
    vi.spyOn(iamAdminApi, "listRoles").mockImplementation(
      ({ page: pageNumber, size }) => {
        if (size === 100 && pageNumber === 1) return stale;
        return Promise.resolve(page([role], 0, size === 100 ? 2 : 1));
      },
    );
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看/分配角色" }));
    const dialog = await screen.findByRole("dialog", { name: "员工角色：Lee" });
    await within(dialog).findByRole("checkbox", { name: /Support/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "关闭" }));
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看/分配角色" }));
    const reopened = await screen.findByRole("dialog", {
      name: "员工角色：Lee",
    });
    await within(reopened).findByRole("checkbox", { name: /Support/ });
    resolveStale(page([staleRole], 1, 2));
    await waitFor(() =>
      expect(within(reopened).queryByText("Stale role")).toBeNull(),
    );
  });

  it("clears the old catalog page during a failed page change and offers recovery", async () => {
    vi.spyOn(iamAdminApi, "listRoles").mockImplementation(
      ({ page: pageNumber, size }) => {
        if (size === 100 && pageNumber === 1)
          return Promise.reject(new ApiError("server secret", { status: 500 }));
        return Promise.resolve(page([role], 0, size === 100 ? 2 : 1));
      },
    );
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看/分配角色" }));
    const dialog = await screen.findByRole("dialog", { name: "员工角色：Lee" });
    await within(dialog).findByRole("checkbox", { name: /Support/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).not.toContain("server secret");
    expect(within(dialog).queryByText("Support")).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "上一页角色" }),
    );
    await within(dialog).findByRole("checkbox", { name: /Support/ });
  });

  it("clears the old permission catalog page during a failed page change", async () => {
    vi.spyOn(iamAdminApi, "listPermissions").mockImplementation(
      ({ page: pageNumber, size }) => {
        if (size === 100 && pageNumber === 1)
          return Promise.reject(new ApiError("server secret", { status: 500 }));
        return Promise.resolve(page([permission], 0, size === 100 ? 2 : 1));
      },
    );
    routerState.search = "?view=roles";
    render(<IamConsolePage />);
    const row = (await screen.findByText("Support")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "权限" }));
    const dialog = await screen.findByRole("dialog", {
      name: "角色权限：Support",
    });
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(permission.code),
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    const alert = await within(dialog).findByRole("alert");
    expect(alert.textContent).not.toContain("server secret");
    expect(within(dialog).queryByText(permission.code)).toBeNull();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "上一页权限" }),
    );
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(permission.code),
    });
  });

  it("preselects custom role permissions and sends their assignment version", async () => {
    const replace = vi
      .spyOn(iamAdminApi, "replaceRolePermissions")
      .mockResolvedValue({
        resourceId: role.id,
        assignmentIds: [permission.id],
        version: 7,
      });
    routerState.search = "?view=roles";
    render(<IamConsolePage />);
    const row = (await screen.findByText("Support")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "权限" }));
    const dialog = await screen.findByRole("dialog", {
      name: "角色权限：Support",
    });
    expect(
      (
        (await within(dialog).findByRole("checkbox", {
          name: new RegExp(permission.code),
        })) as HTMLInputElement
      ).checked,
    ).toBe(true);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "保存权限" }),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(role.id, {
        ids: [permission.id],
        version: 7,
      }),
    );
  });

  it("keeps permission selections across catalog pages", async () => {
    const secondPermission = {
      ...permission,
      id: "96000000-0000-4000-8000-000000000020",
      code: "iam:user:write",
      name: "Write members",
    };
    vi.spyOn(iamAdminApi, "listPermissions").mockImplementation(
      ({ page: pageNumber, size }) =>
        Promise.resolve(
          size === 100 && pageNumber === 1
            ? page([secondPermission], 1, 2)
            : page([permission], 0, size === 100 ? 2 : 1),
        ),
    );
    const replace = vi
      .spyOn(iamAdminApi, "replaceRolePermissions")
      .mockResolvedValue({
        resourceId: role.id,
        assignmentIds: [permission.id, secondPermission.id],
        version: 7,
      });
    routerState.search = "?view=roles";
    render(<IamConsolePage />);
    const row = (await screen.findByText("Support")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "权限" }));
    const dialog = await screen.findByRole("dialog", {
      name: "角色权限：Support",
    });
    await within(dialog).findByRole("checkbox", {
      name: new RegExp(permission.code),
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "下一页" }));
    fireEvent.click(
      await within(dialog).findByRole("checkbox", {
        name: new RegExp(secondPermission.code),
      }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", { name: "保存权限" }),
    );
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith(role.id, {
        ids: [permission.id, secondPermission.id],
        version: 7,
      }),
    );
  });

  it("separates assignment read from write permissions", async () => {
    authState.permissions = new Set(["iam:user:read", "iam:role:read"]);
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    fireEvent.click(screen.getByRole("button", { name: "查看角色" }));
    const dialog = await screen.findByRole("dialog", { name: "员工角色：Lee" });
    await within(dialog).findByRole("checkbox", { name: /Support/ });
    expect(
      within(dialog).queryByRole("button", { name: "保存角色" }),
    ).toBeNull();
    expect(iamAdminApi.getMemberRoles).toHaveBeenCalledWith(member.id);
    cleanup();
    vi.restoreAllMocks();
    authState.permissions = new Set(["iam:user:read", "iam:role:write"]);
    vi.spyOn(iamAdminApi, "listMembers").mockResolvedValue(page([member]));
    vi.spyOn(iamAdminApi, "listAuditLogs").mockResolvedValue(page([]));
    const getRoles = vi
      .spyOn(iamAdminApi, "getMemberRoles")
      .mockResolvedValue(assignment);
    render(<IamConsolePage />);
    await screen.findByText("agent.lee");
    expect(screen.queryByRole("button", { name: "查看角色" })).toBeNull();
    expect(getRoles).not.toHaveBeenCalled();
  });

  it("does not request permission assignments without read, and is read-only without assign", async () => {
    authState.permissions = new Set(["iam:user:read", "iam:role:read"]);
    routerState.search = "?view=roles";
    render(<IamConsolePage />);
    await screen.findByText("Support");
    expect(screen.queryByRole("button", { name: "权限" })).toBeNull();
    expect(iamAdminApi.getRolePermissions).not.toHaveBeenCalled();
    expect(iamAdminApi.listPermissions).not.toHaveBeenCalled();
    cleanup();
    vi.restoreAllMocks();
    authState.permissions = new Set([
      "iam:user:read",
      "iam:role:read",
      "iam:permission:read",
    ]);
    vi.spyOn(iamAdminApi, "listMembers").mockResolvedValue(page([member]));
    vi.spyOn(iamAdminApi, "listRoles").mockResolvedValue(page([role]));
    vi.spyOn(iamAdminApi, "listPermissions").mockResolvedValue(
      page([permission]),
    );
    vi.spyOn(iamAdminApi, "listAuditLogs").mockResolvedValue(page([]));
    vi.spyOn(iamAdminApi, "getRolePermissions").mockResolvedValue({
      resourceId: role.id,
      assignmentIds: [permission.id],
      version: 7,
    });
    routerState.search = "?view=roles";
    render(<IamConsolePage />);
    const row = (await screen.findByText("Support")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "权限" }));
    const dialog = await screen.findByRole("dialog", {
      name: "角色权限：Support",
    });
    expect(
      (
        (await within(dialog).findByRole("checkbox", {
          name: new RegExp(permission.code),
        })) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      within(dialog).queryByRole("button", { name: "保存权限" }),
    ).toBeNull();
  });
});

describe("IAM query state", () => {
  it("bounds and serializes URL pagination", () => {
    expect(
      parseIamQuery(
        "?memberPage=-1&memberSize=999&roleSize=999&permissionSize=0&auditPage=1000001&auditSize=999",
      ),
    ).toEqual(
      expect.objectContaining({
        memberPage: 0,
        memberSize: 10,
        roleSize: 20,
        permissionSize: 20,
        auditPage: 0,
        auditSize: 20,
      }),
    );
    const query = parseIamQuery(
      "?memberSize=100&rolePage=2&roleSize=50&permissionSize=100&auditSize=10",
    );
    expect(query).toEqual(
      expect.objectContaining({
        memberSize: 100,
        rolePage: 2,
        roleSize: 50,
        permissionSize: 100,
        auditSize: 10,
      }),
    );
    const url = toIamUrl(query);
    expect(url).toContain("rolePage=2");
    expect(url).toContain("roleSize=50");
    expect(url).toContain("permissionSize=100");
    expect(url).toContain("auditSize=10");
  });
});
