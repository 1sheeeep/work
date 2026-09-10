import { afterEach, describe, expect, it, vi } from "vitest";
import { captureNativeLink, clearNativeLink, NATIVE_LINK_KEY, readNativeLink, saveNativeLink, validProof } from "./nativeLinkState";

const proof = "A".repeat(43);
afterEach(() => { clearNativeLink(); vi.useRealTimers(); vi.restoreAllMocks(); sessionStorage.clear(); localStorage.clear(); history.replaceState(null, "", "/"); });
describe("short-lived native linking proof", () => {
  it("captures a fragment before routing and keeps it out of query, history and localStorage", () => {
    history.replaceState(null, "", "/shopify/link#proof=" + proof);
    captureNativeLink();
    expect(location.href).not.toContain(proof);
    expect(location.pathname).toBe("/shopify/link");
    expect(readNativeLink()?.proof).toBe(proof);
    expect(localStorage.length).toBe(0);
    captureNativeLink();
    expect(readNativeLink()?.proof).toBe(proof);
  });
  it("rejects query proofs, extra fields, repeated fields and noncanonical base64", () => {
    for (const suffix of ["?proof=" + proof, "#proof=" + proof + "&tenantId=other", "#proof=" + proof + "&proof=" + proof, "#proof=" + "B".repeat(43)]) {
      history.replaceState(null, "", "/shopify/link" + suffix);
      captureNativeLink();
      expect(readNativeLink()).toBeNull();
      expect(location.search + location.hash).toBe("");
    }
    expect(validProof(proof)).toBe(true);
  });
  it("expires and rejects overlong or corrupt retained state", () => {
    for (const state of [{ proof, expiresAt: Date.now() - 1 }, { proof, expiresAt: Date.now() + 3600000 },
      { proof, expiresAt: Date.now() + 1000, prepared: { shopId: "not-a-uuid" } }]) {
      sessionStorage.setItem(NATIVE_LINK_KEY, JSON.stringify(state));
      expect(readNativeLink()).toBeNull();
      expect(sessionStorage.getItem(NATIVE_LINK_KEY)).toBeNull();
    }
  });
  it("fails closed when browser storage is unavailable without leaking the fragment", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    history.replaceState(null, "", "/shopify/link#proof=" + proof);
    expect(() => captureNativeLink()).not.toThrow();
    expect(location.hash).toBe("");
    expect(readNativeLink()).toBeNull();
  });
  it("does not capture other routes and clears proofs explicitly", () => {
    history.replaceState(null, "", "/orders#proof=" + proof);
    captureNativeLink();
    expect(location.hash).not.toBe("");
    saveNativeLink({ proof, expiresAt: Date.now() + 60000 });
    clearNativeLink();
    expect(readNativeLink()).toBeNull();
  });
  it("physically clears expired proofs even while the user stays on the login page", () => {
    vi.useFakeTimers();
    saveNativeLink({ proof, expiresAt: Date.now() + 1000 });
    history.replaceState(null, "", "/login?redirect=%2Fshopify%2Flink");
    vi.advanceTimersByTime(1001);
    expect(sessionStorage.getItem(NATIVE_LINK_KEY)).toBeNull();
  });
});
