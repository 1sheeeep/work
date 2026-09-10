import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { sessionStore } from "../auth/sessionStore";
import {
  PlatformAdminProvider,
  usePlatformAdmin,
} from "./PlatformAdminContext";
import type { PlatformAdminAdapter } from "./platformAdminApi";
import { platformSessionStore } from "./platformSessionStore";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "root",
  displayName: "Root",
  status: "ACTIVE" as const,
};
function adapter(): PlatformAdminAdapter {
  return {
    login: vi.fn().mockResolvedValue({
      session: { admin, expiresAt: "2026-07-29T00:00:00Z" },
      credentials: { tokenType: "Bearer", accessToken: "platform-token" },
    }),
    getSession: vi.fn(),
    logoutPlatform: vi.fn(),
    logoutTenant: vi.fn(),
    listSystemAdmins: vi.fn(),
    createSystemAdmin: vi.fn(),
    updateSystemAdmin: vi.fn(),
    setSystemAdminStatus: vi.fn(),
    resetSystemAdmin: vi.fn(),
    resetSystemAdminPassword: vi.fn(),
    listTenants: vi.fn(),
    getTenantEntitlements: vi.fn(),
    updateTenantEntitlements: vi.fn(),
    listLogisticsProviderConfigs: vi.fn(),
    getShopifyAppRelease: vi.fn(),
    saveShopifyAppReleaseToken: vi.fn(),
    clearShopifyAppReleaseToken: vi.fn(),
    publishShopifyApp: vi.fn(),
    updateLogisticsProviderConfig: vi.fn(),
    renameLogisticsProvider: vi.fn(),
    listShopifyComplianceRequests: vi.fn(),
    exportShopifyComplianceData: vi.fn(),
    confirmShopifyComplianceExportDelivery: vi.fn(),
    redactShopifyComplianceData: vi.fn(),
    createTenant: vi.fn(),
    updateTenant: vi.fn(),
    deleteTenant: vi.fn(),
    createEnterpriseAdmin: vi.fn(),
    listEnterpriseAdmins: vi.fn(),
    updateEnterpriseAdmin: vi.fn(),
    resetEnterpriseAdminPassword: vi.fn(),
    redeemPasswordCredential: vi.fn(),
    enterTenant: vi.fn().mockResolvedValue({
      credentials: { tokenType: "Bearer", accessToken: "tenant-token" },
      session: {
        tenant: {
          id: "00000000-0000-4000-8000-000000000002",
          code: "acme",
          name: "Acme",
        },
        platformAdmin: admin,
        permissions: ["orders.read"],
        expiresAt: "2026-07-29T00:00:00Z",
      },
    }),
  };
}
function Probe() {
  const platform = usePlatformAdmin();
  return (
    <>
      <output data-testid="status">{platform.status}</output>
      <button
        onClick={() =>
          void platform.login({ username: "root", password: "not-logged" })
        }
      >
        login
      </button>
      <button onClick={() => void platform.enterTenant("t")}>enter</button>
      <button onClick={() => void platform.leaveTenant()}>leave</button>
      <button onClick={() => void platform.logout()}>logout</button>
    </>
  );
}
afterEach(() => {
  cleanup();
  platformSessionStore.clear();
  sessionStore.clear();
  vi.restoreAllMocks();
});
describe("PlatformAdminProvider", () => {
  it(
    "keeps platform and tenant tokens isolated, then clears both on platform logout",
    async () => {
    const platformAdapter = adapter();
    render(
      <PlatformAdminProvider adapter={platformAdapter}>
        <Probe />
      </PlatformAdminProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
    await act(async () => {
      screen.getByRole("button", { name: "login" }).click();
    });
    expect(platformSessionStore.accessToken()).toBe("platform-token");
    expect(sessionStore.accessToken()).toBeNull();
    expect(
      window.sessionStorage.getItem("xz-erp.platform-admin.credentials"),
    ).toContain("platform-token");
    expect(window.sessionStorage.getItem("xz-erp.auth.credentials")).toBeNull();
    await act(async () => {
      screen.getByRole("button", { name: "enter" }).click();
    });
    expect(platformSessionStore.accessToken()).toBe("platform-token");
    expect(sessionStore.accessToken()).toBe("tenant-token");
    expect(
      window.sessionStorage.getItem("xz-erp.platform-admin.credentials"),
    ).toContain("platform-token");
    expect(window.sessionStorage.getItem("xz-erp.auth.credentials")).toContain(
      "tenant-token",
    );
    await act(async () => {
      screen.getByRole("button", { name: "logout" }).click();
    });
    expect(platformSessionStore.accessToken()).toBeNull();
    expect(sessionStore.accessToken()).toBeNull();
    expect(
      window.sessionStorage.getItem("xz-erp.platform-admin.credentials"),
    ).toBeNull();
    expect(window.sessionStorage.getItem("xz-erp.auth.credentials")).toBeNull();
    },
  );

  it("restores the platform session after a refresh from only its independent key", async () => {
    platformSessionStore.write({
      tokenType: "Bearer",
      accessToken: "restored-platform",
    });
    sessionStore.write({ tokenType: "Bearer", accessToken: "tenant-token" });
    const platformAdapter = adapter();
    platformAdapter.getSession = vi
      .fn()
      .mockResolvedValue({ admin, expiresAt: "2026-07-29T00:00:00Z" });
    render(
      <PlatformAdminProvider adapter={platformAdapter}>
        <Probe />
      </PlatformAdminProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("authenticated"),
    );
    expect(platformAdapter.getSession).toHaveBeenCalledTimes(1);
    expect(sessionStore.accessToken()).toBe("tenant-token");
  });

  it("revokes only the platform tenant session when returning to the control plane", async () => {
    const platformAdapter = adapter();
    render(
      <PlatformAdminProvider adapter={platformAdapter}>
        <Probe />
      </PlatformAdminProvider>,
    );
    await act(async () => {
      screen.getByRole("button", { name: "login" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "enter" }).click();
    });
    await act(async () => {
      screen.getByRole("button", { name: "leave" }).click();
    });

    expect(platformAdapter.logoutTenant).toHaveBeenCalledTimes(1);
    expect(platformSessionStore.accessToken()).toBe("platform-token");
    expect(sessionStore.accessToken()).toBeNull();
    expect(platformAdapter.logoutPlatform).not.toHaveBeenCalled();
  });

  it("clears both isolated credentials after an expired platform session", async () => {
    platformSessionStore.write({
      tokenType: "Bearer",
      accessToken: "expired-platform",
    });
    sessionStore.write({ tokenType: "Bearer", accessToken: "tenant-token" });
    const platformAdapter = adapter();
    platformAdapter.getSession = vi
      .fn()
      .mockRejectedValue(new ApiError("expired", { status: 401 }));
    render(
      <PlatformAdminProvider adapter={platformAdapter}>
        <Probe />
      </PlatformAdminProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("status").textContent).toBe("unauthenticated"),
    );
    expect(platformSessionStore.accessToken()).toBeNull();
    expect(sessionStore.accessToken()).toBeNull();
  });
});
