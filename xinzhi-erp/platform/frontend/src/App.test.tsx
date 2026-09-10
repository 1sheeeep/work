import { describe, expect, it } from "vitest";
import { router } from "./App";
import { splitNavigationTarget } from "./modules/navigationDefinitions";

describe("application routes", () => {
  it.each(["123", "00123", "true", "null", '"literal"', '{"code": "SKU 1"}', "背包 & 蓝色"])("round-trips plain list parameters with the real router: %s", (keyword) => {
    const expected = { view: "master", page: "2", size: "50", descending: "true", keyword };
    const target = splitNavigationTarget(`/products?${new URLSearchParams(expected)}`);
    const result = router.buildLocation({ to: target.pathname, search: target.search as never });
    expect(Object.fromEntries(new URLSearchParams(result.searchStr))).toEqual(expected);
    const parsed = router.options.parseSearch!(result.searchStr);
    expect(Object.fromEntries(new URLSearchParams(router.options.stringifySearch!(parsed)))).toEqual(expected);
  });

  it("keeps login redirect validation and duplicate-query rejection intact", () => {
    const validate = router.routesById["/login"].options.validateSearch as (search: Record<string, unknown>) => { redirect?: string; state?: string };
    const parse = router.options.parseSearch!;
    expect(validate(parse("?redirect=https%3A%2F%2Fevil.example")).redirect).toBeUndefined();
    expect(validate(parse("?redirect=%2Forders&redirect=%2Fshops")).redirect).toBeUndefined();
    expect(validate(parse("?redirect=%2Forders%3Fpage%3D2")).redirect).toBe("/orders?page=2");
    expect(validate(parse("?state=%22literal%22")).state).toBe('"literal"');
  });

  it("preserves nested return URLs and plain order pagination", () => {
    for (const [pathname, expected] of [
      ["/shops", { from: "/orders?keyword=A%26B&page=2&size=50", page: "2", size: "50" }],
      ["/orders", { stage: "REVIEW_PENDING", page: "0", size: "100", descending: "false" }],
    ] as const) {
      const result = router.buildLocation({ to: pathname, search: { ...expected } as never });
      const roundTrip = router.options.stringifySearch!(router.options.parseSearch!(result.searchStr));
      expect(Object.fromEntries(new URLSearchParams(roundTrip))).toEqual(expected);
    }
  });
  it("keeps Shopify native confirmation outside the business shell and ordinary auth redirect", () => {
    const route = router.routesById["/shopify/link"];
    expect(route.parentRoute?.id).toBe("__root__");
    expect(route.options.beforeLoad).toBeUndefined();
  });
  it("does not register retired inventory direction routes", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).not.toContain("inventory");
    expect(paths).not.toContain("inventory/manual");
    expect(paths).not.toContain("inventory/stocktakes");
    expect(paths).not.toContain("inventory/transfers");
    expect(paths).not.toContain("inventory/documents");
  });

  it("registers the shareable order detail route", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).toContain("orders/$orderId");
  });

  it("retires shared sign-in without embedding customer service in ERP", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).not.toContain("application-entry");
    expect(paths).not.toContain("customer-service");
    expect(paths).not.toContain("customer-service/workbench");
  });

  it("registers native ERP management without the One callback", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).not.toContain("auth/one/callback");
    expect(paths).toContain("settings/application-access");
    expect(paths).toContain("platform-admin/login");
    expect(paths).toContain("platform-admin");
  });

  it("registers dedicated master-product creation and detail routes", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).toContain("products/master/new");
    expect(paths).toContain("products/master/$spuId");
  });

  it("registers inventory query without the excluded ledger route", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).toContain("products/inventory-query");
    expect(paths).not.toContain("products/inventory-ledger");
    expect(paths).not.toContain("warehouses/inventory-ledger");
  });

  it("registers the approved warehouse operation entries", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).toContain("warehouses/counts");
    expect(paths).toContain("warehouses/transfers");
    expect(paths).toContain("warehouses/documents");
  });

  it("registers logistics channel management as a dedicated route", () => {
    const paths = Object.values(router.routesById).map(
      (route) => (route.options as { path?: string }).path,
    );

    expect(paths).toContain("logistics/authorizations/$authorizationId/channels");
  });
});
