import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, useI18n } from "./I18nContext";
import { LanguageSwitcher } from "./LanguageSwitcher";

function TestSurface() {
  const { t } = useI18n();
  return (
    <>
      <LanguageSwitcher />
      <p>{t("工作台")}</p>
      <p>{t("第 {current} / {total} 页", { current: 2, total: 5 })}</p>
    </>
  );
}

describe("I18nProvider", () => {
  beforeEach(() => {
    window.localStorage.setItem("xz-erp.locale", "zh-CN");
    document.documentElement.lang = "zh-CN";
  });

  afterEach(() => {
    window.localStorage.clear();
    document.documentElement.lang = "zh-CN";
  });

  it("switches the whole interface to English and persists the choice", () => {
    render(<I18nProvider><TestSurface /></I18nProvider>);

    expect(screen.getByText("工作台")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "切换至英文" }));

    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Page 2 of 5")).toBeTruthy();
    expect(document.documentElement.lang).toBe("en");
    expect(window.localStorage.getItem("xz-erp.locale")).toBe("en");
    expect(screen.getByRole("button", { name: "Switch to Chinese" })).toBeTruthy();
  });
});
