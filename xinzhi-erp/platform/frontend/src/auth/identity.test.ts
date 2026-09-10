import { describe, expect, it } from "vitest";
import {
  displayLoginPhone,
  isCanonicalOrLegacyIdentity,
  normalizeLoginIdentifier,
  normalizeLoginPhone,
} from "./identity";

describe("email or phone login identity", () => {
  it("normalizes mainland China mobile numbers for storage and login", () => {
    expect(normalizeLoginPhone("180 0262 9295")).toBe("+8618002629295");
    expect(normalizeLoginIdentifier("18002629295")).toEqual({
      username: "+8618002629295",
    });
    expect(displayLoginPhone("+8618002629295")).toBe("18002629295");
  });

  it("accepts canonical phone-backed identities and keeps legacy accounts", () => {
    expect(
      isCanonicalOrLegacyIdentity(
        "+8618002629295",
        undefined,
        "+8618002629295",
      ),
    ).toBe(true);
    expect(isCanonicalOrLegacyIdentity("system-admin")).toBe(true);
  });
});
