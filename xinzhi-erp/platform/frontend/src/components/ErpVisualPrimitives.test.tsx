import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ErpActionButton, ErpEmptyState } from "./ErpVisualPrimitives";

describe("ERP visual primitives", () => {
  it("renders readable row actions without icon-only controls", () => {
    render(<ErpActionButton label="编辑仓库" type="button" />);

    const button = screen.getByRole("button", { name: "编辑仓库" });
    expect(button.textContent).toBe("编辑仓库");
  });

  it("renders a compact empty state with an optional action", () => {
    render(
      <ErpEmptyState
        action={<button type="button">清除筛选</button>}
        description="请调整查询条件后重试。"
        title="暂无匹配数据"
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("暂无匹配数据");
    expect(screen.getByRole("button", { name: "清除筛选" })).toBeTruthy();
  });
});
