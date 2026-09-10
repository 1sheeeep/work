import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionStore } from "../auth/sessionStore";

const mocks = vi.hoisted(() => ({
  auth: {
    session: {
      tenant: { id: "tenant", code: "acme", name: "Acme" },
      user: { id: "user", username: "operator", displayName: "Operator" },
      permissions: [],
    } as {
      tenant: { id: string; code: string; name: string };
      user?: { id: string; username: string; displayName: string };
      platformAdmin?: { id: string; username: string; displayName: string };
      permissions: string[];
      applications?: Array<{ code: string; modules: string[] }>;
    },
    currentTenant: { id: "tenant", code: "acme", name: "Acme" },
    currentUser: { id: "user", username: "operator", displayName: "Operator" },
    hasPermission: (permission: string) => mocks.auth.session.permissions.includes(permission),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  platform: {
    session: null as { admin: { displayName: string } } | null,
    leaveTenant: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
  },
  location: { pathname: "/", searchStr: "" },
  matches: [] as Array<{ staticData?: { title?: string } }>,
  branding: {
    get: vi.fn().mockResolvedValue({
      configured: false,
      watermarkEnabled: false, watermarkUserName: true, watermarkCompanyName: true,
      watermarkTime: true, watermarkPhoneSuffix: false, version: 0,
      updatedByDisplayName: undefined, updatedAt: undefined,
    }),
  },
  firstPartyEntry: {
    open: vi.fn().mockResolvedValue(undefined),
    origin: vi.fn().mockResolvedValue("https://one.example.test"),
  },
  orderCenter: {
    dashboardSummary: vi.fn().mockResolvedValue({
      totalOrders: 7,
      unpaidOrders: 0,
      receivedOrders: 3,
      reviewPendingOrders: 0,
      mergePendingOrders: 0,
      holdOrders: 1,
      readyToFulfillOrders: 1,
      fulfillingOrders: 0,
      shippedOrders: 2,
      deliveredOrders: 0,
      cancelledOrders: 0,
      editableOrders: 5,
      unmatchedLines: 5,
    }),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, activeOptions, activeProps, to, search, ...props }: {
    children: ReactNode;
    to?: string;
    search?: Record<string, string>;
    activeOptions?: { exact?: boolean; includeSearch?: boolean };
    activeProps?: Record<string, unknown>;
  }) => (
    <a
      {...props}
      href={to + (search ? `?${new URLSearchParams(search)}` : "")}
      data-active-exact={activeOptions?.exact}
      data-active-search={activeOptions?.includeSearch}
      data-active-props={activeProps ? Object.keys(activeProps).length : undefined}
    >
      {children}
    </a>
  ),
  Outlet: () => null,
  useMatches: () => mocks.matches,
  useRouterState: ({ select }: { select: (state: { location: typeof mocks.location }) => unknown }) =>
    select({ location: mocks.location }),
}));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("../platform/PlatformAdminContext", () => ({
  usePlatformAdmin: () => mocks.platform,
}));
vi.mock("../modules/enterpriseBrandingApi", () => ({
  ENTERPRISE_BRANDING_CHANGED: "xz-erp.enterprise-branding-changed",
  enterpriseBrandingApi: mocks.branding,
}));
vi.mock("../modules/orderCenterApi", () => ({
  orderCenterApi: mocks.orderCenter,
}));
import { AppShell } from "./AppShell";
import { I18nProvider } from "../i18n/I18nContext";

afterEach(() => {
  cleanup();
  mocks.auth.logout.mockClear();
  mocks.platform.leaveTenant.mockClear();
  mocks.platform.logout.mockClear();
  mocks.auth.session = {
    tenant: { id: "tenant", code: "acme", name: "Acme" },
    user: { id: "user", username: "operator", displayName: "Operator" },
    permissions: [],
  };
  mocks.platform.session = null;
  mocks.location = { pathname: "/", searchStr: "" };
  mocks.matches = [];
  mocks.branding.get.mockReset().mockResolvedValue({
    configured: false,
    watermarkEnabled: false, watermarkUserName: true, watermarkCompanyName: true,
    watermarkTime: true, watermarkPhoneSuffix: false, version: 0,
    updatedByDisplayName: undefined, updatedAt: undefined,
  });
  mocks.firstPartyEntry.open.mockReset().mockResolvedValue(undefined);
  mocks.firstPartyEntry.origin.mockReset().mockResolvedValue("https://one.example.test");
  mocks.orderCenter.dashboardSummary.mockReset().mockResolvedValue({
    totalOrders: 7,
    unpaidOrders: 0,
    receivedOrders: 3,
    reviewPendingOrders: 0,
    mergePendingOrders: 0,
    holdOrders: 1,
    readyToFulfillOrders: 1,
    fulfillingOrders: 0,
    shippedOrders: 2,
    deliveredOrders: 0,
    cancelledOrders: 0,
    editableOrders: 5,
    unmatchedLines: 5,
  });
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  document.documentElement.lang = "zh-CN";
});

describe("AppShell logout routing", () => {
  it("keeps the same filtered master list in sidebar and detail breadcrumb", () => {
    mocks.auth.session.permissions = ["products.read"];
    mocks.location = { pathname: "/products/master/example", searchStr: "?page=2&createdFrom=2026-09-01&sortBy=CREATED_AT&descending=true&mode=edit" };
    mocks.matches = [{ staticData: { title: "主商品详情" } }];
    render(<AppShell />);
    const expected = "/products?view=master&page=2&createdFrom=2026-09-01&sortBy=CREATED_AT&descending=true";
    const breadcrumb = within(screen.getByLabelText("面包屑"));
    expect(breadcrumb.getByRole("link", { name: "主 SKU" }).getAttribute("href")).toBe(expected);
    expect(within(screen.getByRole("navigation", { name: "商品 功能" })).getByRole("link", { name: "主 SKU" }).getAttribute("href")).toBe(expected);
  });
  it("focuses query results without scrolling past the page context", () => {
    const view = render(<AppShell />);
    const main = view.container.querySelector("main")!;
    const focus = vi.spyOn(main, "focus");
    mocks.location = { pathname: "/", searchStr: "?keyword=test" };
    view.rerender(<AppShell />);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
  it.each([null, "", "not-a-number"])("uses the intended sidebar width without a valid saved preference: %s", (stored) => {
    if (stored !== null) window.localStorage.setItem("xz-erp.sidebar-width", stored);
    const view = render(<AppShell />);
    expect((view.container.querySelector(".app-shell") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("224px");
  });

  it("preserves a user's chosen sidebar width", () => {
    window.localStorage.setItem("xz-erp.sidebar-width", "280");
    const view = render(<AppShell />);
    expect((view.container.querySelector(".app-shell") as HTMLElement).style.getPropertyValue("--sidebar-width")).toBe("280px");
  });

  it("isolates the compact drawer, traps Tab, and restores focus after Escape", async () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    window.localStorage.setItem("xz-erp.sidebar-collapsed", "true");
    mocks.auth.session.permissions = ["orders.read"];
    mocks.location = { pathname: "/orders", searchStr: "" };
    const view = render(<AppShell />);
    const sidebar = view.container.querySelector(".sidebar")!;
    expect(sidebar.hasAttribute("inert")).toBe(true);
    const trigger = screen.getByRole("button", { name: "打开二级导航" });
    fireEvent.click(trigger);
    expect(sidebar.hasAttribute("inert")).toBe(false);
    expect(sidebar.getAttribute("role")).toBe("dialog");
    expect(view.container.querySelector(".content-column")?.hasAttribute("inert")).toBe(true);
    expect(view.container.querySelector("header.topbar")?.hasAttribute("inert")).toBe(true);
    const close = within(sidebar as HTMLElement).getByRole("button", { name: "关闭二级导航" });
    expect(document.activeElement).toBe(close);
    const links = sidebar.querySelectorAll<HTMLAnchorElement>("a[href]");
    links[links.length - 1].focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(sidebar.hasAttribute("inert")).toBe(true);
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("renders persisted enterprise watermark content across the business workspace", async () => {
    mocks.branding.get.mockResolvedValueOnce({
      configured: true,
      watermarkEnabled: true, watermarkUserName: true, watermarkCompanyName: true,
      watermarkTime: false, watermarkPhoneSuffix: false, version: 2,
      updatedByDisplayName: "Operator", updatedAt: "2026-08-10T01:00:00Z",
    });

    const view = render(<AppShell />);

    await waitFor(() => expect(view.container.querySelector(".enterprise-watermark-layer")?.textContent)
      .toContain("Operator · Acme"));
    expect(view.container.querySelectorAll(".enterprise-watermark-layer span")).toHaveLength(12);
  });

  it("keeps customer service outside the ERP module navigation", () => {
    mocks.auth.session.permissions = ["customer_service.read"];

    const view = render(<AppShell />);

    expect(screen.getByText("Xinzhi ERP")).toBeTruthy();
    expect(view.container.querySelector(".brand-mark.has-product-logo img")).toBeTruthy();

    const topNavigationElement = screen.getByRole("navigation", { name: "一级业务模块" });
    const topNavigation = within(topNavigationElement);
    expect(topNavigation.queryByText("客服")).toBeNull();
    expect(screen.getByRole("button", { name: "切换应用" })).toBeTruthy();
    expect(topNavigationElement.closest("header")).not.toBeNull();
    expect(view.container.querySelector(".sidebar .top-module-nav")).toBeNull();
    expect(screen.queryByText(/Customer service entry target/)).toBeNull();
  });

  it("groups identity and account operations under one account settings menu", () => {
    render(<AppShell />);

    const trigger = screen.getByRole("button", { name: "打开账号设置" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(screen.getByRole("combobox", { name: "界面主题" })).toBeTruthy();
    fireEvent.click(trigger);
    expect(within(trigger).getByText("Acme")).toBeTruthy();
    expect(within(trigger).getByText("Operator")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "修改密码" })).toBeNull();
    expect(screen.queryByRole("button", { name: "退出登录" })).toBeNull();

    fireEvent.click(trigger);

    const menu = screen.getByRole("region", { name: "账号设置" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(menu).getByText("界面语言")).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "修改密码" })).toBeTruthy();
    expect(within(menu).getByRole("button", { name: "退出登录" })).toBeTruthy();
  });

  it("sends native-credential members to the original password owner without opening an ERP password form", () => {
    vi.spyOn(sessionStore, "accessToken").mockReturnValue(`cs-native_${"a".repeat(43)}`);
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开账号设置" }));
    expect(screen.queryByRole("button", { name: /^修改密码$/ })).toBeNull();
    expect(screen.getByRole("link", { name: "到客服修改密码" }).getAttribute("href")).toBe("/customer-service");
    expect(screen.queryByLabelText("当前密码")).toBeNull();
  });

  it("closes account settings with Escape and restores focus to its trigger", async () => {
    render(<AppShell />);

    const trigger = screen.getByRole("button", { name: "打开账号设置" });
    fireEvent.click(trigger);
    expect(screen.getByRole("region", { name: "账号设置" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("region", { name: "账号设置" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("keeps the compact navigation trigger accessible and shows real order counts", async () => {
    mocks.auth.session.permissions = ["orders.read"];
    mocks.location = {
      pathname: "/orders",
      searchStr: "?stage=PROCESSING&shopId=shop-1&page=2",
    };
    const view = render(<AppShell />);

    const trigger = screen.getByRole("button", { name: "打开二级导航" });
    expect(trigger.querySelector("svg")).toBeTruthy();
    expect(trigger.textContent).toBe("");
    expect(view.container.querySelector(".brand-mark.has-product-logo img")).toBeTruthy();
    const orderManagement = screen.getByRole("group", { name: "订单管理 功能" });
    const secondLevelLabels = Array.from(orderManagement.querySelectorAll("a"))
      .map((item) => item.querySelector("span")?.textContent);
    expect(secondLevelLabels).toEqual([
      "全部订单",
      "未付款",
      "待审核",
      "待合并",
      "待处理",
      "配货中",
      "已发货",
      "已妥投",
      "已作废",
      "客户档案",
    ]);
    expect(screen.getByTitle("待处理").classList.contains("active")).toBe(true);
    expect(screen.getByTitle("全部订单").classList.contains("active")).toBe(false);
    expect(screen.getByTitle("全部订单").getAttribute("data-active-exact")).toBe("true");
    expect(screen.getByTitle("全部订单").getAttribute("data-active-search")).toBe("true");
    expect(screen.getByTitle("全部订单").getAttribute("data-active-props")).toBe("0");
    expect(view.container.querySelector(".navigation-item-context")).toBeNull();
    expect(view.container.querySelector(".sidebar-supplement-target")).toBeNull();
    await waitFor(() => expect(mocks.orderCenter.dashboardSummary).toHaveBeenCalledWith("shop-1"));
    await waitFor(() => expect(
      Array.from(orderManagement.querySelectorAll(".nav-item-count")).map((item) => item.textContent),
    ).toEqual(["7", "0", "0", "0", "5", "0", "2", "0", "0"]));
    expect(screen.getByTitle("客户档案").querySelector(".nav-item-count")).toBeNull();
  });

  it("keeps the ERP product logo independent of enterprise watermark settings", async () => {
    mocks.branding.get.mockResolvedValueOnce({
      configured: true,
      watermarkEnabled: false, watermarkUserName: true, watermarkCompanyName: true,
      watermarkTime: true, watermarkPhoneSuffix: false, version: 3,
      updatedByDisplayName: "Operator", updatedAt: "2026-08-10T01:00:00Z",
    });

    const view = render(<AppShell />);

    await waitFor(() => expect(mocks.branding.get).toHaveBeenCalled());
    const logo = view.container.querySelector<HTMLImageElement>(".brand-mark.has-product-logo img");
    expect(logo?.getAttribute("src")).toBe("/assets/xinzhi-erp-logo.png");
    expect(view.container.querySelector(".brand-mark.has-enterprise-logo")).toBeNull();
  });

  it("routes the customer-service switcher through ERP shared sign-in", async () => {
    mocks.auth.session.applications = [{ code: "CHAT", modules: [] }];
    vi.stubEnv("VITE_CUSTOMER_SERVICE_WORKBENCH_URL", "https://chat.example.test");
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "切换应用" }));
    const peer = screen.getByRole("link", { name: /客服工作台/ });
    expect(peer.getAttribute("href")).toBe("/customer-service");
    // ERP credentials are tab-scoped: do not open a credential-less second tab.
    expect(peer.getAttribute("target")).toBeNull();
    expect(mocks.firstPartyEntry.open).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("navigation", { name: "业务应用" })).toBeNull();
  });

  it("does not show an ungranted peer or treat an operation permission as app access", () => {
    mocks.auth.session.permissions = ["customer_service.read"];
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "切换应用" }));
    expect(screen.queryByRole("link", { name: /客服工作台/ })).toBeNull();
    expect(screen.getByText("当前账号未获其他业务应用授权。")).toBeTruthy();
  });

  it("keeps an ordinary user on the tenant logout path despite a retained platform session", async () => {
    mocks.platform.session = { admin: { displayName: "Root" } };
    render(<AppShell />);
    expect(screen.queryByText("返回平台后台")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "打开账号设置" }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledTimes(1));
    expect(mocks.platform.logout).not.toHaveBeenCalled();
  });

  it("revokes the ERP tenant session before delegating platform logout to One", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.platform.session = { admin: { displayName: "Root" } };
    mocks.auth.session = {
      tenant: { id: "tenant", code: "acme", name: "Acme" },
      platformAdmin: { id: "root", username: "root", displayName: "Root" },
      permissions: [],
    };
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开账号设置" }));
    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledTimes(1));
    expect(mocks.platform.logout).not.toHaveBeenCalled();
  });

  it("revokes the ERP tenant session before returning to the One control plane", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.auth.session = {
      tenant: { id: "tenant", code: "acme", name: "Acme" },
      platformAdmin: { id: "root", username: "root", displayName: "Root" },
      permissions: [],
    };
    render(<AppShell />);
    fireEvent.click(screen.getByRole("button", { name: "打开账号设置" }));
    fireEvent.click(screen.getByRole("button", { name: "返回平台后台" }));

    await waitFor(() => expect(mocks.auth.logout).toHaveBeenCalledTimes(1));
    expect(mocks.platform.leaveTenant).not.toHaveBeenCalled();
    expect(mocks.platform.logout).not.toHaveBeenCalled();
  });

  it("keeps the shop URL under Settings channel authorization for a shop-only user", async () => {
    mocks.auth.session.permissions = ["shop:read"];
    mocks.location = { pathname: "/shops/shop-id", searchStr: "" };
    mocks.matches = [{ staticData: { title: "店铺详情" } }];

    render(<AppShell />);

    const topNavigation = within(screen.getByRole("navigation", { name: "一级业务模块" }));
    expect(topNavigation.getByText("设置")).toBeTruthy();
    expect(topNavigation.queryByText("店铺")).toBeNull();
    expect(screen.getByRole("button", { name: "渠道授权" })).toBeTruthy();
    const breadcrumb = within(screen.getByLabelText("面包屑"));
    expect(breadcrumb.getByText("渠道授权")).toBeTruthy();
    expect(breadcrumb.getByText("店铺详情")).toBeTruthy();
    expect(breadcrumb.getByRole("link", { name: "店铺列表" }).getAttribute("href")).toBe("/shops");
    await waitFor(() => expect(screen.getByTitle("店铺列表").getAttribute("aria-current")).toBe("page"));
  });

  it("renders the complete shop-only navigation path in English", async () => {
    window.localStorage.setItem("xz-erp.locale", "en");
    mocks.auth.session.permissions = ["shop:read"];
    mocks.location = { pathname: "/shops/shop-id", searchStr: "" };
    mocks.matches = [{ staticData: { title: "店铺详情" } }];

    render(<I18nProvider><AppShell /></I18nProvider>);

    const topNavigation = within(screen.getByRole("navigation", { name: "Primary business modules" }));
    expect(topNavigation.getByText("Settings")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Channel Authorization" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open account settings" }));
    expect(screen.getByRole("region", { name: "Account settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change password" }).textContent).toBe("Change password");
    expect(screen.getByRole("button", { name: "Sign out" }).textContent).toBe("Sign out");
    expect(screen.getByRole("button", { name: "Collapse secondary navigation" }).querySelector("svg")).toBeTruthy();
    const breadcrumb = within(screen.getByLabelText("Breadcrumb"));
    expect(breadcrumb.getByText("Store Details")).toBeTruthy();
    await waitFor(() => expect(screen.getByTitle("Store List").getAttribute("aria-current")).toBe("page"));
  });

  it("does not repeat the Settings organization label in the IAM breadcrumb", () => {
    mocks.auth.session.permissions = ["iam:user:read"];
    mocks.location = { pathname: "/settings/iam", searchStr: "" };
    mocks.matches = [{ staticData: { title: "组织与权限" } }];

    render(<AppShell />);

    const breadcrumb = within(screen.getByLabelText("面包屑"));
    expect(breadcrumb.getAllByText("组织与权限")).toHaveLength(1);
  });

  it("separates Settings groups from leaf pages without duplicating the employee entry", () => {
    mocks.auth.session.permissions = ["iam:user:read", "settings.read"];
    mocks.location = { pathname: "/settings/iam", searchStr: "" };
    mocks.matches = [{ staticData: { title: "组织与权限" } }];

    render(<AppShell />);

    expect(screen.getByRole("button", { name: "组织与权限" })).toBeTruthy();
    const organizationItems = screen.getByRole("group", { name: "组织与权限 功能" });
    expect(within(organizationItems).getByTitle("员工与权限").getAttribute("aria-current")).toBe("page");
    expect(within(organizationItems).queryByTitle("员工列表")).toBeNull();
    expect(screen.getByRole("button", { name: "系统设置" })).toBeTruthy();
    expect(screen.queryByTitle("员工列表")).toBeNull();
  });
});
