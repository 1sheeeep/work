import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AdvancedFilterPanel,
  AdvancedFilterSection,
} from "./AdvancedFilterPanel";

afterEach(cleanup);

describe("AdvancedFilterPanel", () => {
  it("retains uncontrolled fields in form submissions after closing and reopening", () => {
    render(<form aria-label="筛选"><AdvancedFilterPanel>
      <label>开始日期<input name="from" type="date" defaultValue="2026-09-01" /></label>
    </AdvancedFilterPanel></form>);
    const trigger = screen.getByRole("button", { name: /高级搜索/ });
    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("开始日期"), { target: { value: "2026-09-05" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭高级搜索" }));
    expect(new FormData(screen.getByRole("form") as HTMLFormElement).get("from")).toBe("2026-09-05");
    fireEvent.click(trigger);
    expect((screen.getByLabelText("开始日期") as HTMLInputElement).value).toBe("2026-09-05");
  });

  it("does not close on a rejected submit; closes only when an accepted query changes", () => {
    const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const content = (appliedKey: string) => <form onSubmit={submit}><AdvancedFilterPanel appliedKey={appliedKey} actions={<button type="submit">应用筛选</button>}>
      <label>数量<input required type="number" min="1" defaultValue="0" /></label>
    </AdvancedFilterPanel></form>;
    const view = render(content("initial"));
    fireEvent.click(screen.getByRole("button", { name: /高级搜索/ }));
    fireEvent.click(screen.getByRole("button", { name: "应用筛选" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
    view.rerender(content("accepted"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("progressively discloses grouped filters and reports active conditions", () => {
    const view = render(
      <AdvancedFilterPanel activeCount={0}>
        <AdvancedFilterSection title="订单属性">
          <label>平台<input /></label>
        </AdvancedFilterSection>
      </AdvancedFilterPanel>,
    );

    const trigger = screen.getByRole("button", { name: /高级搜索/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "高级搜索" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "订单属性" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("平台"), {
      target: { value: "Shopify" },
    });

    view.rerender(
      <AdvancedFilterPanel activeCount={2}>
        <AdvancedFilterSection title="订单属性">
          <label>平台<input /></label>
        </AdvancedFilterSection>
      </AdvancedFilterPanel>,
    );
    expect(screen.getAllByText("已设置 2 项")).toHaveLength(2);

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);
    expect(screen.getByLabelText("平台")).toBeTruthy();
  });

  it("keeps active filters collapsed until the user opens the dialog", () => {
    render(
      <AdvancedFilterPanel activeCount={3}>
        <AdvancedFilterSection title="库存范围">内容</AdvancedFilterSection>
      </AdvancedFilterPanel>,
    );

    expect(screen.getByText("已设置 3 项")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
