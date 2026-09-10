import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsApprovalDocumentsPage, SettingsTaskListPage } from "./SettingsTaskAnnouncementPages";

const runtime = vi.hoisted(() => ({ search: "", history: { push: vi.fn() } }));
const taskApi = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 })),
  create: vi.fn(), transition: vi.fn(), completeBatch: vi.fn(), exportCsv: vi.fn(),
}));
const procurementApi = vi.hoisted(() => ({
  list: vi.fn(async () => ({ items: [], page: 0, size: 25, totalElements: 0, totalPages: 0 })),
  review: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ history: runtime.history }), useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }) }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ currentUser: { displayName: "仓库操作员" }, hasPermission: () => true }) }));
vi.mock("../modules/operationalTaskApi", () => ({ operationalTaskApi: taskApi }));
vi.mock("../modules/procurementOrderApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../modules/procurementOrderApi")>();
  return { ...actual, procurementOrderApi: { ...actual.procurementOrderApi, ...procurementApi } };
});
beforeEach(() => { runtime.search = ""; runtime.history.push.mockReset(); }); afterEach(cleanup);

describe("settings task and announcement archive shells", () => {
  it("uses the real procurement review workspace for approval documents", async () => {
    render(<SettingsApprovalDocumentsPage />);
    expect(screen.getByRole("heading", { name: "审核单据" })).toBeTruthy();
    expect(await screen.findByRole("table", { name: "采购审核列表" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("输入查询内容"), { target: { value: " PO-UAT-2 " } });
    fireEvent.click(screen.getByRole("button", { name: "搜索" }));
    expect(runtime.history.push).toHaveBeenCalledWith("/settings/tasks/approvals?keyword=PO-UAT-2");
    expect(procurementApi.list).toHaveBeenCalled();
  });
  it("uses the real operational-task workspace for the task list", async () => {
    const view = render(<SettingsTaskListPage />);
    expect(screen.getByRole("heading", { name: "任务列表" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeTruthy();
    expect(await screen.findByText("暂无任务数据")).toBeTruthy();
    expect(taskApi.list).toHaveBeenCalled();
    view.unmount();
  });
});
