import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  InventoryAgingSection,
  InventoryReportSection,
  InventorySyncExceptionsArchiveSection,
  InventorySyncRulesSection,
} from "./ProductArchiveShells";
import { inventoryPeriodReportApi } from "../modules/inventoryPeriodReportApi";
import { inventoryAgingReportApi } from "../modules/inventoryAgingReportApi";
import { warehouseCenterApi } from "../modules/warehouseCenterApi";

vi.mock("../modules/inventoryPeriodReportApi", async () => { const actual = await vi.importActual<typeof import("../modules/inventoryPeriodReportApi")>("../modules/inventoryPeriodReportApi"); return { ...actual, inventoryPeriodReportApi: { summarize: vi.fn() } }; });
vi.mock("../modules/inventoryAgingReportApi", async () => { const actual = await vi.importActual<typeof import("../modules/inventoryAgingReportApi")>("../modules/inventoryAgingReportApi"); return { ...actual, inventoryAgingReportApi: { summarize: vi.fn(), exportCsv: vi.fn() } }; });
vi.mock("../modules/warehouseCenterApi", async () => { const actual = await vi.importActual<typeof import("../modules/warehouseCenterApi")>("../modules/warehouseCenterApi"); return { ...actual, warehouseCenterApi: { listWarehouses: vi.fn() } }; });

beforeEach(() => {
  vi.mocked(inventoryAgingReportApi.summarize).mockResolvedValue({ items: [], totalQuantity: 0, age0To30Quantity: 0, age31To60Quantity: 0, age61To90Quantity: 0, age91To365Quantity: 0, ageOver365Quantity: 0, page: 0, size: 50, totalElements: 0, totalPages: 0 });
  vi.mocked(warehouseCenterApi.listWarehouses).mockResolvedValue({ items: [], page: 0, size: 200, totalElements: 0, totalPages: 0 });
});

afterEach(cleanup);

describe("archive-backed product inventory shells", () => {
  it("renders real aging controls while keeping synchronization rules independent", async () => {
    const { rerender } = render(<InventoryAgingSection keyword="" cutoff="2026-08-10" onFilter={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "库龄分析" })).toBeTruthy();
    expect(await screen.findByText("暂无符合条件的在库库存")).toBeTruthy();

    rerender(
      <InventorySyncRulesSection
        canRead={false}
        canWrite={false}
        onShopChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "同步规则管理" }),
    ).toBeTruthy();
    expect(screen.getByRole("status").textContent)
      .toContain("当前账号无法管理同步规则");
  });

  it("submits bounded archive-visible inventory report filters", () => {
    const onFilter = vi.fn();
    vi.mocked(inventoryPeriodReportApi.summarize).mockResolvedValue({ items: [], totalOpeningQuantity: 0, totalIncreasedQuantity: 0, totalDecreasedQuantity: 0, totalClosingQuantity: 0, page: 0, size: 50, totalElements: 0, totalPages: 0 });
    render(
      <InventoryReportSection
        keyword="SKU-1"
        start="2026-07-01"
        end="2026-07-31"
        onFilter={onFilter}
        onReset={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("SKU / 商品 / 仓库"), {
      target: { value: " SKU-2 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onFilter).toHaveBeenCalledWith(
      "SKU-2",
      "2026-07-01",
      "2026-07-31",
    );
  });

  it("submits archive-visible synchronization exception filters only", () => {
    const onFilter = vi.fn();
    render(
      <InventorySyncExceptionsArchiveSection
        platform="SHOPIFY"
        shop="旗舰店"
        start="2026-07-01"
        end="2026-07-31"
        keyword="failed"
        onFilter={onFilter}
      />,
    );
    fireEvent.change(screen.getByLabelText("同步异常搜索内容"), {
      target: { value: " timeout " },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(onFilter).toHaveBeenCalledWith(
      "SHOPIFY",
      "旗舰店",
      "2026-07-01",
      "2026-07-31",
      "timeout",
    );
    expect(screen.getByRole("status").textContent)
      .toContain("暂无库存同步异常");
  });
});
