import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsInternalNoticesPage, parseInternalNoticeQuery } from "./SettingsInternalNoticesPage";

const runtime = vi.hoisted(() => ({ search: "", push: vi.fn() }));
const noticeApi = vi.hoisted(() => ({
  list: vi.fn(), create: vi.fn(), setPinned: vi.fn(), transition: vi.fn(), archiveBatch: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: runtime.push } }),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) => select({ location: { searchStr: runtime.search } }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock("../modules/internalNoticeApi", () => ({ internalNoticeApi: noticeApi }));

const activeNotice = {
  id: "a7910000-0000-4000-8000-000000000091", title: "仓库交接公告",
  content: "请在交班前完成订单复核。", pinned: false, status: "ACTIVE",
  publishedAt: "2026-08-10T01:00:00Z", archivedAt: undefined,
  createdByDisplayName: "仓库管理员", version: 0,
  createdAt: "2026-08-10T01:00:00Z", updatedAt: "2026-08-10T01:00:00Z",
};

beforeEach(() => {
  runtime.search = ""; runtime.push.mockReset();
  Object.values(noticeApi).forEach((mock) => mock.mockReset());
  noticeApi.list.mockResolvedValue({ items: [activeNotice], page: 0, size: 25, totalElements: 1, totalPages: 1 });
  noticeApi.create.mockResolvedValue(activeNotice);
  noticeApi.setPinned.mockResolvedValue({ ...activeNotice, pinned: true, version: 1 });
  noticeApi.transition.mockResolvedValue({ ...activeNotice, status: "ARCHIVED", archivedAt: "2026-08-10T02:00:00Z", version: 1 });
  noticeApi.archiveBatch.mockResolvedValue([{ ...activeNotice, status: "ARCHIVED", archivedAt: "2026-08-10T02:00:00Z", version: 1 }]);
});
afterEach(cleanup);

describe("SettingsInternalNoticesPage", () => {
  it("parses bounded filters and loads live notices", async () => {
    expect(parseInternalNoticeQuery("?title=%20%E4%BA%A4%E6%8E%A5%20&status=%E5%B7%B2%E5%BD%92%E6%A1%A3&pinned=%E7%BD%AE%E9%A1%B6&page=2&size=50")).toEqual({ title: "交接", status: "已归档", pinned: "置顶", page: 2, size: 50 });
    render(<SettingsInternalNoticesPage />);
    expect(await screen.findByText("仓库交接公告")).toBeTruthy();
    expect(noticeApi.list).toHaveBeenCalledWith(expect.objectContaining({ status: "ACTIVE", page: 0, size: 25 }));
  });

  it("publishes and pins an internal notice", async () => {
    render(<SettingsInternalNoticesPage />);
    await screen.findByText("仓库交接公告");
    fireEvent.click(screen.getByRole("button", { name: "置顶" }));
    await waitFor(() => expect(noticeApi.setPinned).toHaveBeenCalledWith(activeNotice.id, 0, true));
    fireEvent.click(screen.getByRole("button", { name: "发布公告" }));
    const dialog = screen.getByRole("dialog", { name: "发布内部公告" });
    fireEvent.change(within(dialog).getByLabelText("公告标题"), { target: { value: "班次提醒" } });
    fireEvent.change(within(dialog).getByLabelText("公告内容"), { target: { value: "请按计划完成交接。" } });
    fireEvent.click(within(dialog).getByLabelText("置顶显示"));
    fireEvent.click(within(dialog).getByRole("button", { name: "发布公告" }));
    await waitFor(() => expect(noticeApi.create).toHaveBeenCalledWith({ title: "班次提醒", content: "请按计划完成交接。", pinned: true }));
  });

  it("confirms batch archive for selected notices", async () => {
    render(<SettingsInternalNoticesPage />);
    await screen.findByText("仓库交接公告");
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 仓库交接公告" }));
    fireEvent.click(screen.getByRole("button", { name: "批量归档" }));
    const dialog = screen.getByRole("alertdialog", { name: "批量归档公告" });
    fireEvent.click(within(dialog).getByRole("button", { name: "确认" }));
    await waitFor(() => expect(noticeApi.archiveBatch).toHaveBeenCalledWith([{ id: activeNotice.id, version: 0 }]));
  });
});
