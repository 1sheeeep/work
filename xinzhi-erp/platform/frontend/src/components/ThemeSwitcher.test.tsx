import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThemeSwitcher } from "./ThemeSwitcher";
import { applyTheme, DEFAULT_THEME, ERP_THEMES, readSavedTheme, THEME_STORAGE_KEY } from "../theme";
import { I18nProvider } from "../i18n/I18nContext";

beforeEach(() => { localStorage.clear(); delete document.documentElement.dataset.erpTheme; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); delete document.documentElement.dataset.erpTheme; });

it("defaults to porcelain slate blue and lists all nine themes", () => {
  expect(DEFAULT_THEME).toBe("slate");
  applyTheme(readSavedTheme());
  render(<ThemeSwitcher />);
  expect((screen.getByRole("combobox", { name: "界面主题" }) as HTMLSelectElement).value).toBe(DEFAULT_THEME);
  expect(screen.getAllByRole("option")).toHaveLength(9);
  expect((screen.getByRole("option", { name: "瓷白石墨蓝" }) as HTMLOptionElement).selected).toBe(true);
});

it.each(ERP_THEMES)("applies and persists $id without remounting content", ({ id }) => {
  const view = render(<><input aria-label="草稿" defaultValue="未保存内容" /><ThemeSwitcher /></>);
  const draft = screen.getByRole("textbox", { name: "草稿" });
  fireEvent.change(screen.getByRole("combobox"), { target: { value: id } });
  expect(document.documentElement.dataset.erpTheme).toBe(id);
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe(id);
  expect(screen.getByRole("textbox", { name: "草稿" })).toBe(draft);
  view.unmount();
  delete document.documentElement.dataset.erpTheme;
  applyTheme(readSavedTheme());
  render(<ThemeSwitcher />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe(id);
});

it("rejects unknown saved preferences", () => {
  localStorage.setItem(THEME_STORAGE_KEY, "not-a-theme");
  applyTheme(readSavedTheme());
  expect(document.documentElement.dataset.erpTheme).toBe(DEFAULT_THEME);
});

it("falls back when reading browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  expect(readSavedTheme()).toBe(DEFAULT_THEME);
});

it("still applies theme when persistence fails and explains the limitation", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
  const view = render(<ThemeSwitcher />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "rose" } });
  expect(document.documentElement.dataset.erpTheme).toBe("rose");
  expect(screen.getByRole("status").textContent).toContain("浏览器禁止保存");
  view.unmount();
  render(<ThemeSwitcher />);
  expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("rose");
});

it("translates the theme controls and names", () => {
  localStorage.setItem("xz-erp.locale", "en");
  render(<I18nProvider><ThemeSwitcher /></I18nProvider>);
  expect(screen.getByRole("combobox", { name: "Theme" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Apricot Oatmeal" })).toBeTruthy();
});
