import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessibleTenantNavigation } from "../modules/navigationDefinitions";
import { QuickNavigation } from "./QuickNavigation";
import { I18nProvider } from "../i18n/I18nContext";

vi.mock("@tanstack/react-router", () => ({ Link: ({ to, search, children, ...props }: { to: string; search?: Record<string, string>; children: ReactNode }) =>
  <a {...props} href={to + (search ? `?${new URLSearchParams(search)}` : "")}>{children}</a> }));
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const navigation = getAccessibleTenantNavigation(permission => ["orders.read", "warehouses.read"].includes(permission));
const props = { navigation, locationKey: "/orders?shopId=shop-a", currentPrimaryId: "orders", search: "?shopId=shop-a&page=4&keyword=ABC" };

describe("QuickNavigation", () => {
  it("keeps master-list context when finding the list from a detail page", () => {
    const search = "?page=2&createdFrom=2026-09-01&sortBy=CREATED_AT&descending=true&mode=edit";
    render(<QuickNavigation navigation={getAccessibleTenantNavigation(() => true)} currentPrimaryId="products" search={search} locationKey={`/products/master/example${search}`} />);
    fireEvent.click(screen.getByRole("button", { name: "查找功能" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "主 SKU" } });
    expect(screen.getByRole("link", { name: /主 SKU/ }).getAttribute("href")).toBe("/products?view=master&page=2&createdFrom=2026-09-01&sortBy=CREATED_AT&descending=true");
  });
  it("searches approved accessible pages and preserves the current order filter context", () => {
    render(<QuickNavigation {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "查找功能" }));
    const input = screen.getByRole("searchbox");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "待审核" } });
    const result = within(screen.getByRole("dialog")).getByRole("link", { name: /待审核/ });
    expect(result.getAttribute("href")).toBe("/orders?shopId=shop-a&keyword=ABC&stage=REVIEW_PENDING");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(document.activeElement).toBe(result);
    fireEvent.change(input, { target: { value: "财务" } });
    expect(screen.getByText("未找到可访问的功能，请换个关键词。")).toBeTruthy();
    fireEvent.change(input, { target: { value: "员工" } });
    expect(within(screen.getByRole("dialog")).queryByRole("link")).toBeNull();
  });

  it("does not carry order search fields into another module", () => {
    render(<QuickNavigation {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "查找功能" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "仓库列表" } });
    expect(screen.getByRole("link", { name: /仓库列表/ }).getAttribute("href")).toBe("/warehouses");
  });

  it("closes on navigation and does not hijack typing or another modal", () => {
    const view = render(<><input aria-label="正在编辑" /><QuickNavigation {...props} /></>);
    fireEvent.keyDown(screen.getByLabelText("正在编辑"), { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(<QuickNavigation {...props} locationKey="/warehouses" />);
    expect(screen.queryByRole("dialog")).toBeNull();
    view.rerender(<><section role="dialog" aria-modal="true" aria-label="其他窗口" /><QuickNavigation {...props} /></>);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.queryByRole("dialog", { name: "查找功能" })).toBeNull();
  });

  it("supports translated page-name search", () => {
    localStorage.setItem("xz-erp.locale", "en");
    render(<I18nProvider><QuickNavigation {...props} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Find a page" }));
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "warehouse" } });
    expect(screen.getAllByRole("link").length).toBeGreaterThan(0);
    expect(screen.getByRole("status").textContent).toMatch(/accessible pages/);
  });
});
