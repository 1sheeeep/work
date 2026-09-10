import { describe, expect, it } from "vitest";
import {
  parseWarehouseArchiveQuery,
  toWarehouseArchiveUrl,
} from "./WarehouseArchiveShells";

describe("archive-backed warehouse shells", () => {
  it("bounds shareable values and rejects unknown states", () => {
    expect(
      parseWarehouseArchiveQuery(
        "?tab=bad&searchField=sku&status=completed&start=2026-07-31&end=2026-07-01&showDetails=true&page=3&size=20",
        "counts",
      ),
    ).toEqual(expect.objectContaining({
      tab: "",
      searchField: "SKU",
      status: "COMPLETED",
      start: "2026-07-31",
      end: undefined,
      showDetails: true,
      page: 3,
      size: 20,
    }));
    expect(
      toWarehouseArchiveUrl("transfers", {
        tab: "SHIPMENT",
        keyword: "SKU-1",
      }),
    ).toBe("/warehouses/transfers?tab=SHIPMENT&keyword=SKU-1");
    expect(parseWarehouseArchiveQuery("?tab=WMS", "transfers").tab)
      .toBe("RECEIPT");
    expect(
      parseWarehouseArchiveQuery("?status=待签收", "documents").status,
    ).toBe("待签收");
    expect(parseWarehouseArchiveQuery("?page=-1&size=999", "counts"))
      .toEqual(expect.objectContaining({ page: 0, size: 50 }));
    expect(toWarehouseArchiveUrl("counts", { page: 2, size: 100 }))
      .toBe("/warehouses/counts?page=2&size=100");
  });
});
