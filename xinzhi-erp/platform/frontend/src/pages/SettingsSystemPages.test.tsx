import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { enterpriseProfileApi } from "../modules/enterpriseProfileApi";
import { enterpriseBrandingApi, notifyEnterpriseBrandingChanged } from "../modules/enterpriseBrandingApi";
import { operationalTaskApi } from "../modules/operationalTaskApi";
import { systemGeneralSettingApi } from "../modules/systemGeneralSettingApi";
import {
  parseSettingsTaskManagementQuery,
  SettingsEnterpriseInformationPage,
  SettingsGeneralConfigurationPage,
  SettingsTaskManagementPage,
} from "./SettingsSystemPages";

const push = vi.fn();
const back = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push, back } }),
  useRouterState: ({ select }: { select: (state: { location: { searchStr: string } }) => unknown }) =>
    select({ location: { searchStr: "" } }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ hasPermission: () => true }) }));
vi.mock("../modules/enterpriseProfileApi", () => ({ enterpriseProfileApi: { get: vi.fn(), save: vi.fn() } }));
vi.mock("../modules/enterpriseBrandingApi", () => ({
  enterpriseBrandingApi: { get: vi.fn(), save: vi.fn() },
  notifyEnterpriseBrandingChanged: vi.fn(),
}));
vi.mock("../modules/operationalTaskApi", () => ({ operationalTaskApi: { list: vi.fn(), create: vi.fn(), transition: vi.fn(), completeBatch: vi.fn(), exportCsv: vi.fn() } }));
vi.mock("../modules/systemGeneralSettingApi", () => ({ systemGeneralSettingApi: { get: vi.fn(), save: vi.fn() } }));

const enterpriseProfile = {
  tenantCode: "tenant-a", tenantName: "Tenant A", configured: true,
  companyName: "新知科技", province: "上海", city: "上海", district: "浦东新区",
  detailedAddress: "世纪大道 1 号", contactName: "张三",
  contactEmail: "ops@example.com", contactQq: "12345678",
  contactMobile: "+86 13800000000", contactTelephone: "021-12345678",
  version: 2, createdAt: "2026-08-07T00:00:00Z", updatedAt: "2026-08-07T01:00:00Z",
};
const task = {
  id: "a7890000-0000-4000-8000-000000000090", taskNo: "TASK-20260810-A1B2C3",
  title: "核对 UAT 订单", category: "运营任务", taskObject: "UAT-ORDER-001",
  urgency: "URGENT" as const, assigneeName: "UAT Tester", description: "完成浏览器实测",
  status: "PENDING" as const, createdByDisplayName: "UAT Tester", version: 0,
  createdAt: "2026-08-10T01:00:00Z", updatedAt: "2026-08-10T01:00:00Z",
};
const generalSetting = {
  configured: true, defaultCurrency: "USD", orderPullBlackoutStart: undefined,
  orderPullBlackoutEnd: undefined, version: 1,
  updatedByDisplayName: "UAT Tester", createdAt: "2026-08-10T01:00:00Z",
  updatedAt: "2026-08-10T01:00:00Z",
};
const enterpriseBranding = {
  configured: true,
  watermarkEnabled: false, watermarkUserName: true, watermarkCompanyName: true,
  watermarkTime: true, watermarkPhoneSuffix: false, version: 1,
  updatedByDisplayName: "UAT Tester", updatedAt: "2026-08-10T01:00:00Z",
};

describe("system settings archive pages", () => {
  beforeEach(() => {
    vi.mocked(enterpriseProfileApi.get).mockReset().mockResolvedValue(enterpriseProfile);
    vi.mocked(enterpriseProfileApi.save).mockReset().mockResolvedValue({ ...enterpriseProfile, version: 3 });
    vi.mocked(enterpriseBrandingApi.get).mockReset().mockResolvedValue(enterpriseBranding);
    vi.mocked(enterpriseBrandingApi.save).mockReset().mockResolvedValue({ ...enterpriseBranding, watermarkEnabled: true, version: 3 });
    vi.mocked(notifyEnterpriseBrandingChanged).mockReset();
    vi.mocked(operationalTaskApi.list).mockReset().mockResolvedValue({ items: [task], page: 0, size: 25, totalElements: 1, totalPages: 1 });
    vi.mocked(operationalTaskApi.create).mockReset().mockResolvedValue(task);
    vi.mocked(operationalTaskApi.transition).mockReset().mockResolvedValue({ ...task, status: "IN_PROGRESS", version: 1 });
    vi.mocked(operationalTaskApi.completeBatch).mockReset().mockResolvedValue([{ ...task, status: "COMPLETED", completedAt: "2026-08-10T02:00:00Z", version: 1 }]);
    vi.mocked(operationalTaskApi.exportCsv).mockReset().mockResolvedValue({ filename: "operational-tasks.csv", mediaType: "text/csv;charset=utf-8", rowCount: 1, content: "\uFEFF\"任务编号\",\"任务标题\",\"分类\",\"任务对象\",\"紧急程度\",\"创建人\",\"执行人\",\"创建时间\",\"完成时间\",\"状态\"\r\n" });
    vi.mocked(systemGeneralSettingApi.get).mockReset().mockResolvedValue(generalSetting);
    vi.mocked(systemGeneralSettingApi.save).mockReset().mockResolvedValue({
      ...generalSetting, defaultCurrency: "CNY", orderPullBlackoutStart: "23:00",
      orderPullBlackoutEnd: "06:00", version: 2,
    });
  });
  it("sanitizes the task-management query", () => {
    expect(parseSettingsTaskManagementQuery("?searchBy=执行人&keyword=%20TASK-1%20&startDate=2026-08-01&endDate=nope&status=执行中&urgency=紧急")).toEqual({
      searchBy: "执行人",
      keyword: "TASK-1",
      startDate: "2026-08-01",
      endDate: "",
      status: "执行中",
      urgency: "紧急",
      page: 0,
      size: 25,
    });
  });

  it("loads real tasks and exposes functional lifecycle actions", async () => {
    const view = render(<SettingsTaskManagementPage />);
    const page = within(view.container);
    expect(page.getAllByRole("radio")).toHaveLength(4);
    expect(within(page.getByRole("table")).getAllByRole("columnheader")).toHaveLength(12);
    expect(await page.findByText("TASK-20260810-A1B2C3")).toBeTruthy();
    expect(page.getByRole("button", { name: "创建任务" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(page.getByRole("button", { name: "开始" }));
    fireEvent.click(page.getByRole("button", { name: "确认" }));
    await waitFor(() => expect(operationalTaskApi.transition).toHaveBeenCalledWith(task.id, 0, "IN_PROGRESS"));
  });

  it("creates a task with the entered business fields", async () => {
    const view = render(<SettingsTaskManagementPage />);
    const page = within(view.container);
    fireEvent.click(page.getByRole("button", { name: "创建任务" }));
    const dialog = within(page.getByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("任务标题"), { target: { value: "处理异常订单" } });
    fireEvent.change(dialog.getByLabelText("任务对象"), { target: { value: "ORDER-100" } });
    fireEvent.change(dialog.getByLabelText("执行人"), { target: { value: "仓库一组" } });
    fireEvent.click(dialog.getByRole("button", { name: "创建任务" }));
    await waitFor(() => expect(operationalTaskApi.create).toHaveBeenCalledWith(expect.objectContaining({
      title: "处理异常订单", taskObject: "ORDER-100", assigneeName: "仓库一组", urgency: "NORMAL",
    })));
  });

  it("loads and saves default currency and the Shopify order quiet period", async () => {
    const view = render(<SettingsGeneralConfigurationPage />);
    const page = within(view.container);
    expect(await page.findByDisplayValue("USD")).toBeTruthy();
    fireEvent.change(page.getByLabelText("系统默认币种"), { target: { value: "CNY" } });
    fireEvent.click(page.getByRole("checkbox", { name: "启用禁止拉取时段" }));
    fireEvent.change(page.getByLabelText("禁止拉取开始时间"), { target: { value: "23:00" } });
    fireEvent.change(page.getByLabelText("禁止拉取结束时间"), { target: { value: "06:00" } });
    fireEvent.click(page.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(systemGeneralSettingApi.save).toHaveBeenCalledWith(1, {
      defaultCurrency: "CNY", orderPullBlackoutStart: "23:00",
      orderPullBlackoutEnd: "06:00",
    }));
    expect(await page.findByText("系统设置已保存并立即生效。")).toBeTruthy();
    expect(page.queryByRole("button", { name: /头程费用|扩展属性/ })).toBeNull();
  });

  it("loads and saves the enterprise profile and workspace watermark", async () => {
    render(<SettingsEnterpriseInformationPage />);
    expect(await screen.findByDisplayValue("新知科技")).toBeTruthy();
    expect((screen.getByLabelText("企业编号") as HTMLInputElement).readOnly).toBe(true);
    expect(await screen.findByRole("heading", { name: "页面水印" })).toBeTruthy();
    expect(screen.queryByText("企业 Logo")).toBeNull();
    fireEvent.click(screen.getByLabelText("启用页面水印"));
    expect(screen.getByLabelText("手机号后 4 位").hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByLabelText("手机号后 4 位"));
    fireEvent.click(screen.getByRole("button", { name: "保存水印设置" }));
    await waitFor(() => expect(enterpriseBrandingApi.save).toHaveBeenCalledWith(1, {
      watermarkEnabled: true, watermarkUserName: true, watermarkCompanyName: true,
      watermarkTime: true, watermarkPhoneSuffix: true,
    }));
    fireEvent.change(screen.getByLabelText("企业名称（必填）"), { target: { value: "新知科技有限公司" } });
    fireEvent.click(screen.getByRole("button", { name: "保存企业资料" }));
    await waitFor(() => expect(enterpriseProfileApi.save).toHaveBeenCalledWith(2, expect.objectContaining({
      companyName: "新知科技有限公司", contactEmail: "ops@example.com",
      contactMobile: "+86 13800000000",
    })));
    expect(await screen.findByText("企业基础资料已保存。")).toBeTruthy();
  });
});
