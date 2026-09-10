import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsPageHeader } from "./SettingsPageLayout";

afterEach(cleanup);

describe("SettingsPageHeader", () => {
  it("keeps the settings hierarchy and optional actions accessible", () => {
    const { container } = render(
      <SettingsPageHeader
        id="settings-example-title"
        section="参数设置"
        title="示例设置"
        description="维护示例参数。"
        actions={<button type="button">刷新</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "示例设置", level: 1 }).id).toBe("settings-example-title");
    expect(screen.getByText("参数设置")).toBeTruthy();
    expect(screen.getByText("维护示例参数。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "刷新" })).toBeTruthy();
    expect(container.querySelector(".settings-page-header-actions")).toBeTruthy();
  });
});
