import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { httpAuthAdapter } from "./authApi";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpAuthAdapter", () => {
  it("maps the IAM login and current-user wire payloads at the adapter boundary", async () => {
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValueOnce({
        tokenType: "Bearer",
        accessToken: "opaque-token",
        expiresAt: "2026-07-28T20:00:00Z",
        tenant: { id: "10000000-0000-0000-0000-000000000001", code: "acme", name: "Acme" },
        user: { id: "00000000-0000-4000-8000-000000000002", username: "operator", displayName: "Operator" },
        permissions: ["orders.read"],
      })
      .mockResolvedValueOnce({
        expiresAt: "2026-07-28T20:00:00Z",
        tenant: { id: "10000000-0000-0000-0000-000000000001", code: "acme", name: "Acme" },
        user: { id: "00000000-0000-4000-8000-000000000002", username: "operator", displayName: "Operator" },
        permissions: ["orders.read"],
      });

    const login = await httpAuthAdapter.login({
      tenantCode: "acme",
      username: "operator",
      password: "not-a-real-password",
    });
    const current = await httpAuthAdapter.getSession();

    expect(login).toEqual({
      credentials: { accessToken: "opaque-token", tokenType: "Bearer" },
      session: current.session,
    });
    expect(request).toHaveBeenNthCalledWith(1, "/api/v1/auth/login", {
      method: "POST",
      body: {
        tenantCode: "acme",
        username: "operator",
        password: "not-a-real-password",
      },
      skipAuth: true,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/api/v1/auth/me", {
      skipUnauthorizedHandler: true,
    });
  });

  it("ends the current server session with the IAM DELETE endpoint", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(undefined);

    await httpAuthAdapter.logout();

    expect(request).toHaveBeenCalledWith("/api/v1/auth/session", {
      method: "DELETE",
    });
  });

  it("maps a refreshed platform tenant-access identity without inventing a tenant user", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      expiresAt: "2026-07-28T20:00:00Z",
      tenant: { id: "10000000-0000-0000-0000-000000000001", code: "acme", name: "Acme" },
      user: null,
      platformAdmin: {
        id: "00000000-0000-4000-8000-000000000003",
        username: "+8618002629295",
        phoneNumber: "+8618002629295",
        displayName: "Root",
        status: "ACTIVE",
      },
      permissions: ["orders.read"],
    });
    const current = await httpAuthAdapter.getSession();
    expect(current.session.user).toBeUndefined();
    expect(current.session.platformAdmin).toEqual({
      id: "00000000-0000-4000-8000-000000000003",
      username: "+8618002629295",
      phoneNumber: "+8618002629295",
      displayName: "Root",
      status: "ACTIVE",
    });
  });

  it("accepts a canonical phone tenant session from an older backend response", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      expiresAt: "2026-07-28T20:00:00Z",
      tenant: {
        id: "10000000-0000-0000-0000-000000000001",
        code: "acme",
        name: "Acme",
      },
      user: null,
      platformAdmin: {
        id: "00000000-0000-4000-8000-000000000003",
        username: "+8618002629295",
        displayName: "Root",
        status: "ACTIVE",
      },
      permissions: ["orders.read"],
    });

    const current = await httpAuthAdapter.getSession();

    expect(current.session.platformAdmin?.phoneNumber).toBe("+8618002629295");
  });

  it.each([
    [
      "email-backed username without email",
      { username: "operator@example.com", email: null },
    ],
    [
      "mismatched email alias",
      { username: "operator@example.com", email: "other@example.com" },
    ],
    [
      "non-canonical email",
      { username: "Operator@example.com", email: "Operator@example.com" },
    ],
  ])("rejects an impossible V42 %s identity", async (_case, identity) => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      expiresAt: "2026-07-28T20:00:00Z",
      tenant: {
        id: "10000000-0000-0000-0000-000000000001",
        code: "acme",
        name: "Acme",
      },
      user: {
        id: "00000000-0000-4000-8000-000000000002",
        ...identity,
        displayName: "Operator",
      },
      permissions: ["orders.read"],
    });

    await expect(httpAuthAdapter.getSession()).rejects.toMatchObject({
      code: "invalid_response",
      status: 0,
    });
  });
});
