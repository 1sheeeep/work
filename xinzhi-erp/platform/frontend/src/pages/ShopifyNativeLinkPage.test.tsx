import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiClient } from "../api/client";
import { readNativeLink, saveNativeLink } from "../shopify/nativeLinkState";

const mocks = vi.hoisted(() => ({ auth: {
  status: "authenticated", session: {
    tenant: { id: "11111111-1111-4111-8111-111111111111", code: "fixture", name: "测试企业" },
    user: { id: "22222222-2222-4222-8222-222222222222", displayName: "测试管理员", username: "fixture-admin" },
  }, hasPermission: vi.fn(() => true), logout: vi.fn(), retry: vi.fn(),
} }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@tanstack/react-router", () => ({ Link: ({ to, search, children }: { to: string; search?: { redirect: string }; children: React.ReactNode }) => <a href={to + (search ? "?redirect=" + encodeURIComponent(search.redirect) : "")}>{children}</a> }));
import { ShopifyNativeLinkPage } from "./ShopifyNativeLinkPage";

const proof = "A".repeat(43);
const prepared = { shopId: "33333333-3333-4333-8333-333333333333", shopDomain: "fixture.myshopify.com", shopName: "验证店铺" };
const pending = () => ({ ...prepared, expiresAt: new Date(Date.now() + 600000).toISOString(), grantedScopes: ["read_products"] });
const preview = () => ({ pending: pending(), existingShop: null, canCreateShop: true });
const request = vi.spyOn(apiClient, "request");
beforeEach(() => {
  request.mockReset(); mocks.auth.status = "authenticated";
  mocks.auth.hasPermission.mockReturnValue(true);
  saveNativeLink({ proof, expiresAt: Date.now() + 600000 });
});
afterEach(() => { cleanup(); sessionStorage.clear(); vi.clearAllMocks(); });

describe("existing-account Shopify native linking", () => {
  it("shows login with a clean return path and does not send proof before native login", () => {
    mocks.auth.status = "unauthenticated";
    render(<ShopifyNativeLinkPage />);
    expect(screen.getByRole("link", { name: "登录已有 ERP 账号" }).getAttribute("href")).toBe("/login?redirect=%2Fshopify%2Flink");
    expect(request).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(proof);
    expect(screen.getByText(/不开放自助注册/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '联系工作人员开通' }).getAttribute('href')).toBe('mailto:support@xzkj.ai');
    expect(screen.queryByRole('button', { name: /注册|开通/ })).toBeNull();
  });
  it("previews only; requires consent then durably prepares before confirming", async () => {
    request.mockResolvedValueOnce(preview()).mockResolvedValueOnce(prepared).mockImplementationOnce(async () => {
      expect(readNativeLink()?.prepared).toEqual(prepared);
      return prepared;
    });
    render(<ShopifyNativeLinkPage />);
    await screen.findByText("fixture.myshopify.com");
    const button = screen.getByRole("button", { name: "确认关联" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); expect(request).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(button);
    await screen.findByText("店铺关联成功");
    expect(request.mock.calls.map(call => call[0])).toEqual([
      "/api/v1/platform-center/shopify/native-link/preview", "/api/v1/platform-center/shopify/native-link/prepare",
      `/api/v1/platform-center/shops/${prepared.shopId}/channels/shopify/native-link/confirm`,
    ]);
    for (const [, options] of request.mock.calls) expect(options?.body).toEqual({ proof });
    expect(readNativeLink()).toBeNull();
  });
  it("unknown confirmation retains proof and shop id; retry does not prepare again", async () => {
    request.mockResolvedValueOnce(preview()).mockResolvedValueOnce(prepared)
      .mockRejectedValueOnce(new ApiError("private error", { status: 503 })).mockResolvedValueOnce(prepared);
    render(<ShopifyNativeLinkPage />); await screen.findByText("fixture.myshopify.com");
    fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "确认关联" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("同一次关联");
    expect(screen.getByRole("alert").textContent).not.toContain("private error");
    expect(readNativeLink()?.prepared).toEqual(prepared);
    fireEvent.click(screen.getByRole("button", { name: "重试同一次关联" }));
    await screen.findByText("店铺关联成功");
    expect(request.mock.calls.filter(call => call[0].endsWith("/prepare"))).toHaveLength(1);
  });
  it("reload after an unknown result restores only the original confirmation", async () => {
    saveNativeLink({ proof, expiresAt: Date.now() + 600000, tenantId: mocks.auth.session.tenant.id,
      userId: mocks.auth.session.user.id, prepared });
    request.mockResolvedValueOnce(prepared);
    render(<ShopifyNativeLinkPage />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重试同一次关联" }));
    await screen.findByText("店铺关联成功");
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain("/confirm");
  });
  it("blocks account switching and does not use an existing prepared shop in another enterprise", () => {
    saveNativeLink({ proof, expiresAt: Date.now() + 600000, tenantId: "99999999-9999-4999-8999-999999999999",
      userId: mocks.auth.session.user.id, prepared });
    render(<ShopifyNativeLinkPage />);
    expect(screen.getByRole("alert").textContent).toContain("另一个 ERP 企业");
    expect(request).not.toHaveBeenCalled();
  });
  it("blocks missing feature permissions without issuing requests", () => {
    mocks.auth.hasPermission.mockReturnValue(false);
    render(<ShopifyNativeLinkPage />);
    expect(screen.getByRole("alert").textContent).toContain("店铺授权权限");
    expect(request).not.toHaveBeenCalled();
  });
  it("requires shop creation permission for a new shop but not an existing shop", async () => {
    request.mockResolvedValueOnce({ ...preview(), canCreateShop: false });
    render(<ShopifyNativeLinkPage />); await screen.findByText("fixture.myshopify.com");
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "确认关联" }) as HTMLButtonElement).disabled).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("cancel clears the proof and does not mutate any store", async () => {
    request.mockResolvedValueOnce(preview());
    render(<ShopifyNativeLinkPage />); await screen.findByText("fixture.myshopify.com");
    fireEvent.click(screen.getByRole("button", { name: "取消关联" }));
    expect(readNativeLink()).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("不会撤销");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("a rejected receipt stops blind retries and tells the user to refresh Shopify", async () => {
    saveNativeLink({ proof, expiresAt: Date.now() + 600000, tenantId: mocks.auth.session.tenant.id,
      userId: mocks.auth.session.user.id, prepared });
    request.mockRejectedValueOnce(new ApiError("private", { status: 409, code: "native_link_unavailable" }));
    render(<ShopifyNativeLinkPage />);
    fireEvent.click(screen.getByRole("button", { name: "重试同一次关联" }));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("alert")));
    expect((screen.getByRole("button", { name: "重试同一次关联" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("Shopify 应用页");
  });
  it("does not start preparation when retry storage cannot be saved", async () => {
    request.mockResolvedValueOnce(preview());
    render(<ShopifyNativeLinkPage />); await screen.findByText("fixture.myshopify.com");
    const storage = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      fireEvent.click(screen.getByRole("checkbox")); fireEvent.click(screen.getByRole("button", { name: "确认关联" }));
      await screen.findByRole("alert");
      expect(screen.getByRole("alert").textContent).toContain("已停止提交");
      expect(request).toHaveBeenCalledTimes(1);
    } finally { storage.mockRestore(); }
  });
  it("reuses the explicitly previewed existing shop and ignores repeated confirmation clicks", async () => {
    request.mockResolvedValueOnce({ ...preview(), existingShop: prepared, canCreateShop: false })
      .mockResolvedValueOnce(prepared).mockResolvedValueOnce(prepared);
    render(<ShopifyNativeLinkPage />); await screen.findByText("fixture.myshopify.com");
    expect(screen.getByText(/沿用当前企业/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "确认关联" });
    fireEvent.click(button); fireEvent.click(button);
    await screen.findByText("店铺关联成功");
    expect(request).toHaveBeenCalledTimes(3);
  });
});
