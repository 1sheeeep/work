import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { iamAdminApi, type Member, type Page } from "../modules/iamAdminApi";
import { IamConsolePage, parseIamQuery, toIamUrl } from "./IamConsolePage";

const routerState = vi.hoisted(() => ({
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  permissions: new Set<string>(),
  hasPermission: (permission: string) => authState.permissions.has(permission),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({
    history: {
      push: routerState.push,
      replace: routerState.replace,
    },
  }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { searchStr: routerState.search } }),
}));
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    hasPermission: authState.hasPermission,
    session: {
      user: { id: "97000000-0000-4000-8000-000000000099" },
    },
  }),
}));

const roleId = "97000000-0000-4000-8000-000000000010";
const role = {
  id: roleId,
  code: "operator",
  name: "运营",
  description: undefined,
  systemRole: false,
  presetRole: false,
  version: 1,
  updatedAt: "2026-07-30T00:00:00Z",
};
const oldMember: Member = {
  id: "97000000-0000-4000-8000-000000000011",
  username: "old@example.com",
  email: "old@example.com",
  displayName: "旧响应员工",
  status: "ACTIVE",
  version: 1,
  updatedAt: "2026-07-30T00:00:00Z",
};
const newMember: Member = {
  ...oldMember,
  id: "97000000-0000-4000-8000-000000000012",
  username: "new@example.com",
  email: "new@example.com",
  displayName: "新响应员工",
};
const page = <T,>(
  items: T[],
  pageNumber = 0,
  totalPages = items.length ? 1 : 0,
): Page<T> => ({
  items,
  page: pageNumber,
  size: 20,
  totalElements: items.length,
  totalPages,
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

beforeEach(() => {
  routerState.search = "";
  routerState.push.mockReset();
  routerState.replace.mockReset();
  authState.permissions = new Set(["iam:user:read", "iam:role:read"]);
  vi.spyOn(iamAdminApi, "listMembers").mockResolvedValue(page([oldMember]));
  vi.spyOn(iamAdminApi, "listRoles").mockResolvedValue(page([role]));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IAM 员工服务端筛选与 URL 闭环", () => {
  it("解析并序列化可分享筛选，同时保留其他 IAM 页码", () => {
    const query = parseIamQuery(
      `?view=members&memberPage=3&memberSize=50&memberQuery=%20ALICE%20&memberStatus=DISABLED&memberRoleId=${roleId}&rolePage=2&roleSize=50&permissionPage=4&permissionSize=100&auditPage=5&auditSize=10`,
    );

    expect(query).toMatchObject({
      view: "members",
      memberPage: 3,
      memberSize: 50,
      memberQuery: " ALICE ",
      memberStatus: "DISABLED",
      memberRoleId: roleId,
      rolePage: 2,
      roleSize: 50,
      permissionPage: 4,
      permissionSize: 100,
      auditPage: 5,
      auditSize: 10,
    });
    expect(toIamUrl(query)).toContain("memberQuery=+ALICE+");
    expect(toIamUrl(query)).toContain("memberSize=50");
    expect(toIamUrl(query)).toContain("memberStatus=DISABLED");
    expect(toIamUrl(query)).toContain(`memberRoleId=${roleId}`);
    expect(toIamUrl(query)).toContain("roleSize=50");
    expect(toIamUrl(query)).toContain("permissionSize=100");
    expect(toIamUrl(query)).toContain("auditSize=10");
  });

  it("以 URL 初始化控件和服务端请求，应用筛选时归零员工页码", async () => {
    vi.mocked(iamAdminApi.listMembers).mockResolvedValue(
      page([oldMember], 3, 5),
    );
    routerState.search =
      `?view=members&memberPage=3&memberSize=50&memberQuery=alice&memberStatus=DISABLED&memberRoleId=${roleId}` +
      "&rolePage=2&permissionPage=4&auditPage=5";

    render(<IamConsolePage />);

    expect(
      (
        (await screen.findByRole("searchbox", {
          name: "关键词",
        })) as HTMLInputElement
      ).value,
    ).toBe("alice");
    expect((screen.getByLabelText("账号状态") as HTMLSelectElement).value).toBe(
      "DISABLED",
    );
    await waitFor(() =>
      expect((screen.getByLabelText("角色") as HTMLSelectElement).value).toBe(
        roleId,
      ),
    );
    expect(iamAdminApi.listMembers).toHaveBeenCalledWith({
      page: 3,
      size: 50,
      query: "alice",
      status: "DISABLED",
      roleId,
    });
    expect(
      (
        screen.getByLabelText(
          "员工列表分页每页条数",
        ) as HTMLSelectElement
      ).value,
    ).toBe("50");

    fireEvent.change(screen.getByLabelText("员工列表分页每页条数"), {
      target: { value: "100" },
    });
    await waitFor(() => expect(routerState.push).toHaveBeenCalledTimes(1));
    const sizeTarget = String(routerState.push.mock.calls[0][0]);
    expect(sizeTarget).toContain("memberPage=0");
    expect(sizeTarget).toContain("memberSize=100");
    routerState.push.mockReset();

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(routerState.push).toHaveBeenCalledTimes(1));
    const pageTarget = String(routerState.push.mock.calls[0][0]);
    expect(pageTarget).toContain("memberPage=4");
    expect(pageTarget).toContain("memberQuery=alice");
    expect(pageTarget).toContain("memberStatus=DISABLED");
    expect(pageTarget).toContain(`memberRoleId=${roleId}`);
    routerState.push.mockReset();

    fireEvent.change(screen.getByRole("searchbox", { name: "关键词" }), {
      target: { value: "  Bob  " },
    });
    fireEvent.change(screen.getByLabelText("账号状态"), {
      target: { value: "ACTIVE" },
    });
    fireEvent.submit(screen.getByRole("search", { name: "员工列表筛选" }));

    await waitFor(() => expect(routerState.push).toHaveBeenCalledTimes(1));
    const target = String(routerState.push.mock.calls[0][0]);
    expect(target).toContain("/settings/iam?");
    expect(target).toContain("memberPage=0");
    expect(target).toContain("memberQuery=Bob");
    expect(target).toContain("memberStatus=ACTIVE");
    expect(target).toContain(`memberRoleId=${roleId}`);
    expect(target).toContain("rolePage=2");
  });

  it("响应 back/forward URL，并阻止旧请求覆盖新筛选结果", async () => {
    const oldRequest = deferred<Page<Member>>();
    const newRequest = deferred<Page<Member>>();
    vi.mocked(iamAdminApi.listMembers)
      .mockReset()
      .mockReturnValueOnce(oldRequest.promise)
      .mockReturnValueOnce(newRequest.promise);
    routerState.search = "?view=members&memberQuery=old";

    const view = render(<IamConsolePage />);
    await waitFor(() =>
      expect(iamAdminApi.listMembers).toHaveBeenCalledWith({
        page: 0,
        size: 10,
        query: "old",
        status: undefined,
        roleId: undefined,
      }),
    );

    routerState.search = "?view=members&memberQuery=new";
    view.rerender(<IamConsolePage />);
    await waitFor(() =>
      expect(iamAdminApi.listMembers).toHaveBeenLastCalledWith({
        page: 0,
        size: 10,
        query: "new",
        status: undefined,
        roleId: undefined,
      }),
    );
    expect(
      (screen.getByRole("searchbox", { name: "关键词" }) as HTMLInputElement)
        .value,
    ).toBe("new");

    newRequest.resolve(page([newMember]));
    expect(await screen.findByText("新响应员工")).toBeTruthy();
    oldRequest.resolve(page([oldMember]));
    await waitFor(() =>
      expect(screen.queryByText("旧响应员工")).toBeNull(),
    );
  });

  it("展示失败和筛选空态，并允许重试而不丢失 URL", async () => {
    vi.mocked(iamAdminApi.listMembers)
      .mockReset()
      .mockRejectedValueOnce(
        new ApiError("service unavailable", {
          status: 503,
          code: "service_unavailable",
        }),
      )
      .mockResolvedValueOnce(page([]));
    routerState.search =
      "?view=members&memberQuery=nobody&memberStatus=ACTIVE&memberPage=0";

    render(<IamConsolePage />);

    const retry = await screen.findByRole("button", { name: "重试" });
    expect(
      (screen.getByRole("searchbox", { name: "关键词" }) as HTMLInputElement)
        .value,
    ).toBe("nobody");
    fireEvent.click(retry);

    expect(await screen.findByText("没有符合当前筛选条件的员工。")).toBeTruthy();
    expect(iamAdminApi.listMembers).toHaveBeenLastCalledWith({
      page: 0,
      size: 10,
      query: "nobody",
      status: "ACTIVE",
      roleId: undefined,
    });
    expect(routerState.push).not.toHaveBeenCalled();
  });
});
