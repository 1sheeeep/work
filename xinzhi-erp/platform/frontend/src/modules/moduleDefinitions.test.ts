import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "./moduleDefinitions";

describe("moduleDefinitions", () => {
  it("marks implemented business workbenches as foundations", () => {
    const statuses = new Map(
      moduleDefinitions.map((module) => [module.id, module.status]),
    );

    expect(statuses.get("shops")).toBe("foundation");
    expect(statuses.get("orders")).toBe("foundation");
    expect(statuses.get("logistics")).toBe("foundation");
    expect(statuses.get("procurement")).toBe("foundation");
    expect(statuses.get("analytics")).toBe("foundation");
    expect(statuses.has("finance")).toBe(false);
    expect(statuses.has("suppliers")).toBe(false);
    expect(statuses.has("customer-service")).toBe(false);
    expect(moduleDefinitions.find((module) => module.id === "products")?.capabilities)
      .not.toContain("平台刊登");
  });

  it("keeps contractless business modules in planned state", () => {
    const statuses = new Map(
      moduleDefinitions.map((module) => [module.id, module.status]),
    );

    for (const id of ["automation"]) {
      expect(statuses.get(id)).toBe("planned");
    }
  });
});
