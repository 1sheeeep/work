import { afterEach, describe, expect, it } from "vitest";
import { sessionStore } from "./sessionStore";

const KEY = "xz-erp.auth.credentials";

afterEach(() => {
  sessionStore.clear();
  window.sessionStorage.clear();
});

describe("sessionStore", () => {
  it("accepts only a bearer tenant credential", () => {
    sessionStore.write({ accessToken: "tenant-token", tokenType: "Bearer" });

    expect(sessionStore.accessToken()).toBe("tenant-token");
  });

  it("clears malformed storage instead of using it as an Authorization token", () => {
    window.sessionStorage.setItem(KEY, JSON.stringify({ accessToken: {} }));

    expect(sessionStore.read()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
    expect(sessionStore.accessToken()).toBeNull();
  });

  it("clears credentials with a non-bearer token type", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ accessToken: "tenant-token", tokenType: "Basic" }),
    );

    expect(sessionStore.read()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });

  it("clears invalid JSON credential storage", () => {
    window.sessionStorage.setItem(KEY, "not-json");

    expect(sessionStore.read()).toBeNull();
    expect(window.sessionStorage.getItem(KEY)).toBeNull();
  });
});
