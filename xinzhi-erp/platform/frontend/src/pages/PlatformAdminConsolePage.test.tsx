import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { PlatformPage, SystemAdmin } from "../platform/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  logout: vi.fn(),
  enterTenant: vi.fn(),
  search: "",
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ history: { push: mocks.push } }),
  useRouterState: () => mocks.search,
}));
vi.mock("../platform/PlatformAdminContext", () => ({
  usePlatformAdmin: () => ({
    session: {
      admin: {
        id: "00000000-0000-4000-8000-000000000001",
        username: "root@example.com",
        email: "root@example.com",
        displayName: "Root",
      },
    },
    logout: mocks.logout,
    enterTenant: mocks.enterTenant,
  }),
}));

import { httpPlatformAdminAdapter } from "../platform/platformAdminApi";
import {
  parsePlatformQuery,
  PlatformAdminConsolePage,
  toPlatformUrl,
} from "./PlatformAdminConsolePage";
import { ErpOperatorConsolePage } from "./ErpOperatorConsolePage";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "root@example.com",
  email: "root@example.com",
  displayName: "Root",
  status: "ACTIVE" as const,
  createdAt: "2026-07-29T00:00:00Z",
  updatedAt: "2026-07-29T00:00:00Z",
  version: 1,
};
const tenant = {
  id: "00000000-0000-4000-8000-000000000002",
  code: "acme",
  name: "Acme",
  status: "ACTIVE" as const,
  createdAt: "2026-07-29T00:00:00Z",
  updatedAt: "2026-07-29T00:00:00Z",
  version: 1,
  adminCount: 1,
  memberCount: 2,
};
const providerConfig = {
  providerCode: "CHUDA",
  providerName: "触达物流",
  documentationUrl:
    "https://apifox.com/apidoc/shared-6b688401-abee-4e1d-80e7-22172efc817c",
  configurationMode: "SYSTEM_CREDENTIALS" as const,
  configurationSummary: "客户编码、授权码和密钥",
  endpointSummary: "Token 与渠道接口",
  configured: false,
  customerCodeConfigured: false,
  authorizationCodeConfigured: false,
  secretConfigured: false,
  updatedAt: undefined,
  version: 0,
  nameVersion: 0,
};
const builtInProviderConfig = {
  providerCode: "DAYUNJIA",
  providerName: "深圳达运佳国际物流",
  documentationUrl:
    "http://doc.sz56t.com:8090/doc-wiki#/page/share/view?pageId=232",
  configurationMode: "BUILT_IN" as const,
  configurationSummary: "账号密码认证",
  endpointSummary: "下单接口：http://43.138.180.250:8082",
  configured: true,
  customerCodeConfigured: false,
  authorizationCodeConfigured: false,
  secretConfigured: false,
  updatedAt: undefined,
  version: 0,
  nameVersion: 0,
};
const shopifyRelease = {
  appName: "Xinzhi ERP",
  extensionName: "Xinzhi Chat",
  clientId: "6cef3dfc6b0d74e7c2709232f2938696",
  tokenConfigured: false,
  status: "NOT_CONFIGURED" as const,
  version: 0,
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
afterEach(() => {
  cleanup();
  mocks.search = "";
  mocks.push.mockReset();
  mocks.enterTenant.mockReset();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.spyOn(
    httpPlatformAdminAdapter,
    "getShopifyAppRelease",
  ).mockResolvedValue(shopifyRelease);
  vi.spyOn(
    httpPlatformAdminAdapter,
    "listLogisticsProviderConfigs",
  ).mockResolvedValue([providerConfig, builtInProviderConfig]);
});
describe("PlatformAdminConsolePage", () => {
  const openSection = (
    name: "企业" | "系统管理员",
  ) =>
    fireEvent.click(screen.getByRole("tab", { name }));
  const openOperatorSection = (name: "应用发布" | "隐私请求" | "物流接口") =>
    fireEvent.click(screen.getByRole("tab", { name }));

  it("handles Shopify privacy export, delivery confirmation and redaction with explicit operator steps", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant]),
    );
    const requests = [
      {
        eventId: "shopify-compliance/customers/data_request/export-1",
        shopDomain: "one.myshopify.com",
        topic: "CUSTOMER_DATA_REQUEST" as const,
        occurredAt: "2026-08-15T01:00:00Z",
        dueAt: "2026-09-14T01:00:00Z",
        overdue: false,
        status: "PENDING" as const,
        attemptCount: 0,
      },
      {
        eventId: "shopify-compliance/customers/data_request/delivery-1",
        shopDomain: "two.myshopify.com",
        topic: "CUSTOMER_DATA_REQUEST" as const,
        occurredAt: "2026-08-14T01:00:00Z",
        dueAt: "2026-09-13T01:00:00Z",
        overdue: false,
        status: "EXPORT_READY" as const,
        recordCount: 2,
        exportPreparedAt: "2026-08-15T02:00:00Z",
        attemptCount: 1,
      },
      {
        eventId: "shopify-compliance/customers/redact/redact-1",
        shopDomain: "three.myshopify.com",
        topic: "CUSTOMER_REDACT" as const,
        occurredAt: "2026-08-13T01:00:00Z",
        dueAt: "2026-09-12T01:00:00Z",
        overdue: false,
        status: "PENDING" as const,
        attemptCount: 0,
      },
    ];
    vi.spyOn(
      httpPlatformAdminAdapter,
      "listShopifyComplianceRequests",
    ).mockResolvedValue(requests);
    const exportData = vi
      .spyOn(httpPlatformAdminAdapter, "exportShopifyComplianceData")
      .mockResolvedValue(new Blob(["{}"], { type: "application/json" }));
    const confirmDelivery = vi
      .spyOn(
        httpPlatformAdminAdapter,
        "confirmShopifyComplianceExportDelivery",
      )
      .mockResolvedValue({
        ...requests[1],
        status: "COMPLETED",
        completionOutcome: "EXPORTED",
        connectorCompletedAt: "2026-08-15T03:00:00Z",
      });
    const redact = vi
      .spyOn(httpPlatformAdminAdapter, "redactShopifyComplianceData")
      .mockResolvedValue({
        ...requests[2],
        status: "COMPLETED",
        completionOutcome: "ANONYMIZED",
        connectorCompletedAt: "2026-08-15T03:00:00Z",
      });
    const createObjectUrl = vi.fn(() => "blob:privacy-export");
    const revokeObjectUrl = vi.fn();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ErpOperatorConsolePage />);
    openOperatorSection("隐私请求");

    expect(await screen.findByRole("heading", { name: "Shopify 隐私请求" }))
      .toBeTruthy();
    expect(screen.getByText("待处理 3 项")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "下载数据" }));
    await waitFor(() =>
      expect(exportData).toHaveBeenCalledWith(requests[0].eventId),
    );
    expect(createObjectUrl).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:privacy-export");

    fireEvent.click(screen.getByRole("button", { name: "确认已交付" }));
    const deliveryDialog = screen.getByRole("dialog", {
      name: "确认数据已交付",
    });
    expect(confirmDelivery).not.toHaveBeenCalled();
    fireEvent.click(
      within(deliveryDialog).getByRole("button", { name: "确认已交付" }),
    );
    await waitFor(() =>
      expect(confirmDelivery).toHaveBeenCalledWith(requests[1].eventId),
    );

    fireEvent.click(screen.getByRole("button", { name: "执行匿名化" }));
    const redactionDialog = screen.getByRole("dialog", {
      name: "确认匿名化个人信息",
    });
    expect(redact).not.toHaveBeenCalled();
    fireEvent.click(
      within(redactionDialog).getByRole("button", { name: "确认匿名化" }),
    );
    await waitFor(() =>
      expect(redact).toHaveBeenCalledWith(requests[2].eventId),
    );
  });

  it("uses a management menu and shows only the selected module", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant]),
    );

    render(<PlatformAdminConsolePage />);

    expect(screen.getByRole("complementary", { name: "平台管理菜单" }))
      .toBeTruthy();
    expect(await screen.findByRole("heading", { name: "企业" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "平台系统管理员" })).toBeNull();

    openSection("系统管理员");
    expect(await screen.findByRole("heading", { name: "平台系统管理员" }))
      .toBeTruthy();
    expect(screen.queryByRole("heading", { name: "企业" })).toBeNull();

    expect(screen.queryByRole("tab", { name: "物流接口" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "应用发布" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "隐私请求" })).toBeNull();
  });

  it("configures one system-level Shopify token and publishes from the platform console", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "getShopifyAppRelease")
      .mockResolvedValue(shopifyRelease);
    const save = vi
      .spyOn(httpPlatformAdminAdapter, "saveShopifyAppReleaseToken")
      .mockResolvedValue({
        ...shopifyRelease,
        tokenConfigured: true,
        status: "CONFIGURED",
        updatedAt: "2026-08-22T01:00:00Z",
      });
    const publish = vi
      .spyOn(httpPlatformAdminAdapter, "publishShopifyApp")
      .mockResolvedValue({
        ...shopifyRelease,
        tokenConfigured: true,
        status: "SUCCEEDED",
        releaseVersion: "xinzhi-erp-20260822-010203",
        message: "Shopify 应用配置与 Xinzhi Chat 插件已发布。",
        releasedAt: "2026-08-22T01:02:03Z",
        updatedAt: "2026-08-22T01:02:03Z",
        version: 2,
      });

    render(<ErpOperatorConsolePage />);

    expect(await screen.findByRole("heading", { name: "Shopify 应用发布" }))
      .toBeTruthy();
    expect(screen.getByText("尚未配置")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/App Automation Token/), {
      target: { value: "automation-token-for-xinzhi-erp-123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存令牌" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({
      automationToken: "automation-token-for-xinzhi-erp-123456",
      version: 0,
    }));
    expect(
      (screen.getByLabelText(/App Automation Token/) as HTMLInputElement).value,
    ).toBe("");
    expect(document.body.textContent).not.toContain(
      "automation-token-for-xinzhi-erp-123456",
    );

    fireEvent.click(screen.getByRole("button", { name: "发布 Shopify 应用" }));
    const confirmation = screen.getByRole("dialog", {
      name: "确认发布 Shopify 应用",
    });
    expect(publish).not.toHaveBeenCalled();
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "确认发布" }),
    );
    await waitFor(() => expect(publish).toHaveBeenCalledWith(0));
    expect(await screen.findByText("发布成功")).toBeTruthy();
    expect(screen.getByText("xinzhi-erp-20260822-010203")).toBeTruthy();
  });

  it("keeps system logistics credentials in the platform console and never echoes them", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant]),
    );
    const update = vi
      .spyOn(httpPlatformAdminAdapter, "updateLogisticsProviderConfig")
      .mockResolvedValue({
        ...providerConfig,
        configured: true,
        customerCodeConfigured: true,
        authorizationCodeConfigured: true,
        secretConfigured: true,
        updatedAt: "2026-08-13T01:00:00Z",
        version: 1,
      });

    render(<ErpOperatorConsolePage />);
    openOperatorSection("物流接口");

    expect(await screen.findByRole("heading", { name: "物流商接口配置" }))
      .toBeTruthy();
    expect(screen.getByText("深圳达运佳国际物流")).toBeTruthy();
    expect(screen.getByText("下单接口：http://43.138.180.250:8082")).toBeTruthy();
    expect(screen.getByText("已启用")).toBeTruthy();
    expect(screen.queryByLabelText("客户编码")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "配置凭据" }));
    fireEvent.change(screen.getByLabelText("客户编码"), {
      target: { value: "customer-001" },
    });
    fireEvent.change(screen.getByLabelText("授权码"), {
      target: { value: "authorization-value" },
    });
    fireEvent.change(screen.getByLabelText("密钥"), {
      target: { value: "provider-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "安全保存" }));

    await waitFor(() => expect(update).toHaveBeenCalledWith("CHUDA", {
      customerCode: "customer-001",
      authorizationCode: "authorization-value",
      secret: "provider-secret",
      version: 0,
    }));
    expect(await screen.findByText("触达物流接口凭据已安全保存。")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain("customer-001");
    expect(document.body.textContent).not.toContain("authorization-value");
    expect(document.body.textContent).not.toContain("provider-secret");
    expect(screen.getByRole("button", { name: "替换凭据" })).toBeTruthy();
  });

  it("renames a logistics provider without changing its connector configuration", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(page([admin]));
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([tenant]));
    const rename = vi.spyOn(httpPlatformAdminAdapter, "renameLogisticsProvider")
      .mockResolvedValue({ ...builtInProviderConfig, providerName: "达运佳物流", nameVersion: 1 });

    render(<ErpOperatorConsolePage />);
    openOperatorSection("物流接口");
    await screen.findByText("深圳达运佳国际物流");
    const providerRow = screen.getByText("深圳达运佳国际物流").closest("tr") as HTMLTableRowElement;
    fireEvent.click(within(providerRow).getByRole("button", { name: "修改名称" }));
    fireEvent.change(screen.getByLabelText("物流商名称"), { target: { value: " 达运佳物流 " } });
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }));

    await waitFor(() => expect(rename).toHaveBeenCalledWith("DAYUNJIA", {
      providerName: "达运佳物流",
      version: 0,
    }));
    expect(await screen.findByText("物流商名称已更新为“达运佳物流”。")).toBeTruthy();
  });

  it("renders lists, creates an administrator, copies and closes a one-time credential", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant]),
    );
    const createSystemAdmin = vi
      .spyOn(httpPlatformAdminAdapter, "createSystemAdmin")
      .mockResolvedValue({
        admin,
        credential: { token: "one-time", expiresAt: "2026-07-30T00:00:00Z" },
      });
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    render(<PlatformAdminConsolePage />);
    expect(await screen.findByText("Acme")).toBeTruthy();
    openSection("系统管理员");
    fireEvent.click(
      screen.getByRole("button", { name: "新建系统管理员" }),
    );
    fireEvent.change(screen.getByLabelText("邮箱或手机号"), {
      target: { value: "Second@Example.com" },
    });
    fireEvent.change(screen.getByLabelText("姓名"), {
      target: { value: "Second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建管理员" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(createSystemAdmin).toHaveBeenCalledWith({
      email: "second@example.com",
      displayName: "Second",
    });
    fireEvent.click(screen.getByRole("button", { name: "复制凭证" }));
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("one-time"),
    );
    fireEvent.click(screen.getByRole("button", { name: "我已安全保存" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("shows a safe last-administrator conflict without backend text", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([]),
    );
    vi.spyOn(
      httpPlatformAdminAdapter,
      "setSystemAdminStatus",
    ).mockRejectedValue(new ApiError("internal secret", { status: 409 }));
    render(<PlatformAdminConsolePage />);
    openSection("系统管理员");
    fireEvent.click(await screen.findByRole("button", { name: "停用" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("至少保留一位有效管理员");
    expect(alert.textContent).not.toContain("internal secret");
  });
  it("opens a signed-in administrator password reset without asking for the old password", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant]),
    );

    render(<PlatformAdminConsolePage />);
    fireEvent.click(screen.getByRole("button", { name: "重置我的密码" }));
    expect(
      await screen.findByRole("heading", { name: "重置我的密码" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("当前密码")).toBeNull();
    expect(screen.getByLabelText(/^新密码/)).toBeTruthy();
    expect(screen.getByLabelText("确认新密码")).toBeTruthy();
  });
  it("bounds URL state and routes page changes through history", () => {
    expect(
      parsePlatformQuery(
        "?adminPage=-1&adminSize=999&tenantPage=1000000&tenantSize=0&q=" +
          "x".repeat(120),
      ),
    ).toEqual({
      adminPage: 0,
      adminSize: 20,
      tenantPage: 0,
      tenantSize: 20,
      q: "x".repeat(100),
      section: "tenants",
    });
    const url = toPlatformUrl(
      parsePlatformQuery(
        "?adminPage=2&adminSize=37&tenantSize=200&q=acme",
      ),
    );
    expect(url).toContain("adminPage=2");
    expect(url).toContain("adminSize=37");
    expect(url).toContain("tenantSize=200");
  });

  it("keeps independent legal page sizes visible and resets only the changed list", async () => {
    mocks.search = "?adminSize=37&tenantSize=200";
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin], 0, 2, 37),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(
      page([tenant], 0, 2, 200),
    );

    render(<PlatformAdminConsolePage />);

    await screen.findByText("Acme");
    openSection("系统管理员");
    expect(
      (
        screen.getByLabelText(
          "系统管理员列表分页每页条数",
        ) as HTMLSelectElement
      ).value,
    ).toBe("37");
    openSection("企业");
    expect(
      (
        screen.getByLabelText("企业列表分页每页条数") as HTMLSelectElement
      ).value,
    ).toBe("200");

    fireEvent.change(screen.getByLabelText("企业列表分页每页条数"), {
      target: { value: "50" },
    });

    expect(mocks.push).toHaveBeenCalledWith(
      "/platform-admin?adminPage=0&adminSize=37&tenantPage=0&tenantSize=50",
    );
  });

  it("edits an administrator, exposes pending activation safely, and prevents duplicate writes", async () => {
    const pending = {
      ...admin,
      id: "00000000-0000-4000-8000-000000000003",
      username: "pending@example.com",
      email: "pending@example.com",
      status: "PENDING_ACTIVATION" as const,
    };
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(page([admin, pending]));
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([]));
    let resolveUpdate: ((value: typeof admin) => void) | undefined;
    const update = vi.spyOn(httpPlatformAdminAdapter, "updateSystemAdmin").mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve; }),
    );

    render(<PlatformAdminConsolePage />);
    openSection("系统管理员");
    fireEvent.click((await screen.findAllByRole("button", { name: "编辑" }))[0]);
    fireEvent.change(screen.getByDisplayValue("Root"), { target: { value: "Root Renamed" } });
    const save = screen.getByRole("button", { name: "保存" });
    fireEvent.click(save);
    fireEvent.click(save);

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(admin.id, {
      loginIdentifier: "root@example.com",
      displayName: "Root Renamed",
      version: 1,
    });
    expect(screen.getByText("等待激活")).toBeTruthy();
    expect(
      (screen.getAllByRole("button", { name: "重置密码" })[1] as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    resolveUpdate?.({ ...admin, displayName: "Root Renamed", version: 2 });
    await waitFor(() => expect(httpPlatformAdminAdapter.listSystemAdmins).toHaveBeenCalledTimes(2));
  });

  it("keeps a legacy login identifier editable without its display prefix", async () => {
    const legacyAdmin = {
      ...admin,
      username: "system-admin",
      email: undefined,
    };
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([legacyAdmin]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([]));

    render(<PlatformAdminConsolePage />);
    openSection("系统管理员");
    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));

    expect(
      (document.querySelector(
        'input[name="loginIdentifier"]',
      ) as HTMLInputElement).value,
    ).toBe("system-admin");
  });

  it("executes each valid administrator transition with its exact version and closes reset credentials", async () => {
    const disabled = {
      ...admin,
      id: "00000000-0000-4000-8000-000000000005",
      username: "disabled@example.com",
      email: "disabled@example.com",
      status: "DISABLED" as const,
      version: 7,
    };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(
      page([admin, disabled]),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([]));
    const setStatus = vi
      .spyOn(httpPlatformAdminAdapter, "setSystemAdminStatus")
      .mockResolvedValue(admin);
    const reset = vi
      .spyOn(httpPlatformAdminAdapter, "resetSystemAdminPassword")
      .mockResolvedValue(undefined);

    render(<PlatformAdminConsolePage />);
    openSection("系统管理员");
    fireEvent.click(await screen.findByRole("button", { name: "停用" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(
      admin.id,
      "disable",
      admin.version,
    ));
    fireEvent.click(screen.getByRole("button", { name: "启用" }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(
      disabled.id,
      "activate",
      disabled.version,
    ));
    fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]);
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith(
      admin.id,
      "delete",
      admin.version,
    ));
    fireEvent.click(screen.getAllByRole("button", { name: "重置密码" })[1]);
    fireEvent.change(document.querySelector('input[name="newPassword"]')!, {
      target: { value: "new-platform-password" },
    });
    fireEvent.change(document.querySelector('input[name="confirmation"]')!, {
      target: { value: "new-platform-password" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "重置密码" }).at(-1)!);
    await waitFor(() => expect(reset).toHaveBeenCalledWith(disabled.id, {
      newPassword: "new-platform-password",
      version: disabled.version,
    }));
    await waitFor(() =>
      expect(httpPlatformAdminAdapter.listSystemAdmins).toHaveBeenCalledTimes(5),
    );
  });

  it("requires confirmation for dangerous transitions and sends only one request", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(page([admin]));
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([]));
    const setStatus = vi.spyOn(httpPlatformAdminAdapter, "setSystemAdminStatus");

    render(<PlatformAdminConsolePage />);
    openSection("系统管理员");
    fireEvent.click(await screen.findByRole("button", { name: "停用" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(setStatus).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    let resolveDisable: ((value: SystemAdmin) => void) | undefined;
    setStatus.mockImplementation(
      () => new Promise((resolve) => { resolveDisable = resolve; }),
    );
    const disable = screen.getByRole("button", { name: "停用" });
    fireEvent.click(disable);
    fireEvent.click(disable);
    expect(setStatus).toHaveBeenCalledTimes(1);
    resolveDisable?.({ ...admin, status: "DISABLED", version: 2 });
    await waitFor(() => expect(httpPlatformAdminAdapter.listSystemAdmins).toHaveBeenCalledTimes(2));
  });

  it("retains failed form input and maps server failures safely", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(page([]));
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([tenant]));
    vi.spyOn(httpPlatformAdminAdapter, "createTenant").mockRejectedValue(
      new ApiError("do not display", { status: 400 }),
    );

    render(<PlatformAdminConsolePage />);
    fireEvent.click(await screen.findByRole("button", { name: "新建企业" }));
    fireEvent.change(screen.getByLabelText("企业标识"), { target: { value: "新企业" } });
    fireEvent.change(screen.getByLabelText("企业名称"), { target: { value: "New Acme" } });
    fireEvent.change(screen.getByLabelText("管理员邮箱或手机号"), {
      target: { value: "Owner@Example.com" },
    });
    fireEvent.change(screen.getByLabelText("管理员姓名"), { target: { value: "Owner" } });
    fireEvent.change(screen.getByLabelText("管理员初始密码"), {
      target: { value: "initial-owner-password" },
    });
    fireEvent.change(screen.getByLabelText("确认管理员初始密码"), {
      target: { value: "different-owner-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建企业" }));
    expect(httpPlatformAdminAdapter.createTenant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("企业标识"), {
      target: { value: " New-Acme " },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建企业" }));
    expect(httpPlatformAdminAdapter.createTenant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("确认管理员初始密码"), {
      target: { value: "initial-owner-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建企业" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "企业标识只能使用 1–64 位小写英文",
    );
    expect(httpPlatformAdminAdapter.createTenant).toHaveBeenCalledWith({
      code: "new-acme",
      name: "New Acme",
      adminEmail: "owner@example.com",
      adminDisplayName: "Owner",
      adminInitialPassword: "initial-owner-password",
    });
    expect(screen.getByDisplayValue("new-acme")).toBeTruthy();
    expect(screen.queryByText("do not display")).toBeNull();

  });

  it("uses URL page state, filters only the loaded page, and ignores an obsolete refresh response", async () => {
    mocks.search =
      "?adminPage=1&adminSize=50&tenantPage=2&tenantSize=100&q=root&section=admins";
    let resolveFirst: ((value: PlatformPage<SystemAdmin>) => void) | undefined;
    const listAdmins = vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins")
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        ...page([{ ...admin, displayName: "Fresh Root" }], 1, 3, 50),
      });
    const listTenants = vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue({
      ...page([tenant], 2, 4, 100),
    });

    render(<PlatformAdminConsolePage />);
    expect(listAdmins).toHaveBeenCalledWith({ page: 1, size: 50 });
    expect(listTenants).toHaveBeenCalledWith({ page: 2, size: 100 });
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("Fresh Root")).toBeTruthy();
    resolveFirst?.(page([{ ...admin, displayName: "Stale Root" }]));
    await waitFor(() => expect(screen.queryByText("Stale Root")).toBeNull());

    fireEvent.click(screen.getAllByRole("button", { name: "下一页" })[0]);
    expect(mocks.push).toHaveBeenCalledWith(
      "/platform-admin?adminPage=2&adminSize=50&tenantPage=2&tenantSize=100&q=root&section=admins",
    );

    mocks.push.mockReset();
    fireEvent.change(
      screen.getByLabelText("系统管理员列表分页每页条数"),
      { target: { value: "100" } },
    );
    expect(mocks.push).toHaveBeenCalledWith(
      "/platform-admin?adminPage=0&adminSize=100&tenantPage=2&tenantSize=100&q=root&section=admins",
    );
  });

  it("renders permission denial and retryable not-found errors without exposing server details", async () => {
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockRejectedValue(
      new ApiError("forbidden secret", { status: 403 }),
    );
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockRejectedValue(
      new ApiError("missing secret", { status: 404 }),
    );

    render(<PlatformAdminConsolePage />);
    const tenantAlert = await screen.findByRole("alert");
    expect(tenantAlert.textContent).toContain("目标资源不存在");
    expect(tenantAlert.textContent).not.toContain("missing secret");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(httpPlatformAdminAdapter.listTenants).toHaveBeenCalledTimes(2));
    openSection("系统管理员");
    expect(await screen.findByText("当前账号没有读取权限。")).toBeTruthy();
    expect(document.body.textContent).not.toContain("forbidden secret");
  });

  it("manages enterprise administrators from the enterprise detail without asking for the old password", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.search = `?tenantId=${tenant.id}`;
    vi.spyOn(httpPlatformAdminAdapter, "listSystemAdmins").mockResolvedValue(page([]));
    vi.spyOn(httpPlatformAdminAdapter, "listTenants").mockResolvedValue(page([tenant]));
    const enterpriseAdmin = {
      id: "00000000-0000-4000-8000-000000000004",
      username: "owner@example.com",
      email: "owner@example.com",
      displayName: "Owner",
      status: "ACTIVE" as const,
      version: 3,
    };
    vi.spyOn(httpPlatformAdminAdapter, "listEnterpriseAdmins").mockResolvedValue(
      page([enterpriseAdmin]),
    );
    const createEnterpriseAdmin = vi
      .spyOn(httpPlatformAdminAdapter, "createEnterpriseAdmin")
      .mockResolvedValue({
        admin: {
          id: "00000000-0000-4000-8000-000000000005",
          username: "backup@example.com",
          email: "backup@example.com",
          displayName: "Backup",
          status: "DISABLED",
        },
      });
    const resetPassword = vi
      .spyOn(httpPlatformAdminAdapter, "resetEnterpriseAdminPassword")
      .mockResolvedValue(undefined);
    const updateEnterpriseAdmin = vi
      .spyOn(httpPlatformAdminAdapter, "updateEnterpriseAdmin")
      .mockResolvedValue({ ...enterpriseAdmin, status: "DISABLED", version: 4 });
    mocks.enterTenant.mockResolvedValue(undefined);

    render(<PlatformAdminConsolePage />);
    expect(screen.queryByText("管理员操作")).toBeNull();
    expect(await screen.findByRole("heading", { name: "企业管理员" })).toBeTruthy();
    expect(await screen.findByText("owner@example.com")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "重置管理员密码" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "添加管理员" }));
    fireEvent.change(screen.getByLabelText("Acme管理员邮箱或手机号"), {
      target: { value: "Backup@Example.com" },
    });
    fireEvent.change(screen.getByLabelText("Acme管理员姓名"), {
      target: { value: "Backup" },
    });
    fireEvent.change(screen.getByLabelText("Acme管理员初始密码"), {
      target: { value: "initial-backup-password" },
    });
    fireEvent.change(screen.getByLabelText("Acme确认管理员初始密码"), {
      target: { value: "different-backup-password" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "添加管理员" })[1]);
    expect(createEnterpriseAdmin).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Acme确认管理员初始密码"), {
      target: { value: "initial-backup-password" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "添加管理员" })[1]);
    await waitFor(() => expect(createEnterpriseAdmin).toHaveBeenCalledWith(tenant.id, {
      email: "backup@example.com",
      displayName: "Backup",
      initialPassword: "initial-backup-password",
    }));
    expect(screen.queryByText("tenant-one-time")).toBeNull();

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "重置密码" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    expect(
      await screen.findByRole("heading", { name: "重置企业管理员密码" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("当前密码")).toBeNull();
    fireEvent.change(screen.getByLabelText(/^新密码/), {
      target: { value: "new-owner-password" },
    });
    fireEvent.change(screen.getByLabelText("确认新密码"), {
      target: { value: "new-owner-password" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "重置密码" }).at(-1)!);
    await waitFor(() =>
      expect(resetPassword).toHaveBeenCalledWith(tenant.id, enterpriseAdmin.id, {
        newPassword: "new-owner-password",
        version: 3,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "停用" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() =>
      expect(updateEnterpriseAdmin).toHaveBeenCalledWith(
        tenant.id,
        enterpriseAdmin.id,
        {
          displayName: "Owner",
          status: "DISABLED",
          version: 3,
        },
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "进入企业" }));
    await waitFor(() => expect(mocks.enterTenant).toHaveBeenCalledWith(tenant.id));
  });
});
