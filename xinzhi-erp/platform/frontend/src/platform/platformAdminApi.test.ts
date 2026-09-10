import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, ApiError } from "../api/client";
import {
  httpPlatformAdminAdapter,
  resetPlatformAdminOwnPassword,
} from "./platformAdminApi";
import { platformSessionStore } from "./platformSessionStore";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  username: "admin@example.com",
  email: "admin@example.com",
  displayName: "Admin",
  status: "PENDING_ACTIVATION",
  version: 1,
  createdAt: "2026-07-29T00:00:00Z",
  updatedAt: "2026-07-29T00:00:00Z",
};
const tenant = {
  id: "10000000-0000-0000-0000-000000000001",
  code: "acme",
  name: "Acme",
  status: "ACTIVE",
  version: 1,
  createdAt: "2026-07-29T00:00:00Z",
  updatedAt: "2026-07-29T00:00:00Z",
  adminCount: 1,
  memberCount: 1,
};
const enterpriseAdmin = {
  id: "00000000-0000-4000-8000-000000000003",
  username: "owner@example.com",
  email: "owner@example.com",
  phoneNumber: "+8613800138000",
  displayName: "Owner",
  status: "DISABLED",
};
afterEach(() => {
  platformSessionStore.clear();
  vi.restoreAllMocks();
});
describe("platform administrator adapter", () => {
  it("resets the signed-in platform administrator without an old password", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(undefined);

    await expect(
      resetPlatformAdminOwnPassword({ newPassword: "new-platform-password" }),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      "/api/v1/platform-admin/auth/password/reset",
      {
        method: "PUT",
        body: { newPassword: "new-platform-password" },
        authScope: "platform",
        skipUnauthorizedHandler: true,
      },
    );
  });
  it("loads and updates an enterprise application entitlement set through platform scope", async () => {
    const entitlements = {
      version: 4,
      applications: [
        {
          code: "ERP",
          name: "Xinzhi ERP",
          description: "企业资源管理",
          integrationStatus: "AVAILABLE",
          enabled: true,
          modules: [
            { code: "ORDERS", name: "订单", enabled: true },
            { code: "PRODUCTS", name: "商品", enabled: false },
          ],
        },
        {
          code: "ZHAOYAOJING",
          name: "照妖镜",
          description: "广告业务系统",
          integrationStatus: "PENDING_INTEGRATION",
          enabled: false,
          modules: [],
        },
      ],
    };
    const request = vi.spyOn(apiClient, "request")
      .mockResolvedValueOnce(entitlements)
      .mockResolvedValueOnce({ ...entitlements, version: 5 });

    const loaded = await httpPlatformAdminAdapter.getTenantEntitlements(tenant.id);
    const updated = await httpPlatformAdminAdapter.updateTenantEntitlements(
      tenant.id,
      {
        version: loaded.version,
        applications: [{ code: "ERP", modules: ["ORDERS"] }],
      },
    );

    expect(loaded.applications[0]).toMatchObject({
      code: "ERP",
      enabled: true,
      modules: [
        { code: "ORDERS", name: "订单", enabled: true },
        { code: "PRODUCTS", name: "商品", enabled: false },
      ],
    });
    expect(updated.version).toBe(5);
    expect(request).toHaveBeenNthCalledWith(
      1,
      `/api/v1/platform-admin/tenants/${tenant.id}/entitlements`,
      { authScope: "platform" },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      `/api/v1/platform-admin/tenants/${tenant.id}/entitlements`,
      {
        method: "PUT",
        body: {
          version: 4,
          applications: [{ code: "ERP", modules: ["ORDERS"] }],
        },
        authScope: "platform",
      },
    );
  });

  it("uses the delegated ERP operator endpoint for Shopify privacy operations and validates the pending list", async () => {
    const pending = {
      eventId: "shopify-compliance/customers/data_request/event-1",
      shopDomain: "example.myshopify.com",
      topic: "CUSTOMER_DATA_REQUEST",
      occurredAt: "2026-08-15T01:00:00Z",
      dueAt: "2026-09-14T01:00:00Z",
      overdue: false,
      status: "EXPORT_READY",
      recordCount: 1,
      exportPreparedAt: "2026-08-15T02:00:00Z",
      dataRedactedAt: null,
      deliveryConfirmedAt: null,
      completionOutcome: null,
      connectorCompletedAt: null,
      attemptCount: 1,
      lastAttemptAt: "2026-08-15T02:00:00Z",
      lastErrorCode: null,
      referenceIds: ["customer:6001"],
    };
    const completed = {
      ...pending,
      status: "COMPLETED",
      deliveryConfirmedAt: "2026-08-15T03:00:00Z",
      completionOutcome: "EXPORTED",
      connectorCompletedAt: "2026-08-15T03:00:00Z",
    };
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValueOnce([pending])
      .mockResolvedValueOnce(completed)
      .mockResolvedValueOnce({
        ...completed,
        topic: "CUSTOMER_REDACT",
        completionOutcome: "ANONYMIZED",
      });
    const blob = new Blob(["{}"], { type: "application/json" });
    const requestBlob = vi.spyOn(apiClient, "requestBlob").mockResolvedValue(blob);

    const listed = await httpPlatformAdminAdapter.listShopifyComplianceRequests();
    await expect(
      httpPlatformAdminAdapter.exportShopifyComplianceData(pending.eventId),
    ).resolves.toBe(blob);
    const delivered =
      await httpPlatformAdminAdapter.confirmShopifyComplianceExportDelivery(
        pending.eventId,
      );
    const redacted = await httpPlatformAdminAdapter.redactShopifyComplianceData(
      pending.eventId,
    );

    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain("referenceIds");
    expect(delivered.completionOutcome).toBe("EXPORTED");
    expect(redacted.completionOutcome).toBe("ANONYMIZED");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/erp-operator/shopify-compliance-requests",
      { authScope: "tenant" },
    );
    expect(requestBlob).toHaveBeenCalledWith(
      "/api/v1/erp-operator/shopify-compliance-requests/export",
      expect.objectContaining({
        method: "POST",
        body: { eventId: pending.eventId },
        authScope: "tenant",
        acceptedContentTypes: ["application/json"],
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/erp-operator/shopify-compliance-requests/confirm-export-delivery",
      expect.objectContaining({
        method: "POST",
        authScope: "tenant",
        body: {
          eventId: pending.eventId,
          confirmation: "DELIVERED_TO_STORE_OWNER",
        },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/v1/erp-operator/shopify-compliance-requests/redact",
      expect.objectContaining({
        method: "POST",
        authScope: "tenant",
        body: {
          eventId: pending.eventId,
          confirmation: "ANONYMIZE_SHOPIFY_DATA",
        },
      }),
    );
  });

  it("uses delegated ERP operator scope for logistics provider credentials and strips secret response fields", async () => {
    const response = {
      providerCode: "CHUDA",
      providerName: "触达物流",
      documentationUrl:
        "https://apifox.com/apidoc/shared-6b688401-abee-4e1d-80e7-22172efc817c",
      configurationMode: "SYSTEM_CREDENTIALS",
      configurationSummary: "客户编码、授权码和密钥",
      endpointSummary: "Token 与渠道接口",
      configured: true,
      customerCodeConfigured: true,
      authorizationCodeConfigured: true,
      secretConfigured: true,
      updatedAt: "2026-08-13T01:00:00Z",
      version: 1,
      nameVersion: 0,
      secret: "must-be-dropped",
    };
    const builtIn = {
      providerCode: "DAYUNJIA",
      providerName: "深圳达运佳国际物流",
      documentationUrl:
        "http://doc.sz56t.com:8090/doc-wiki#/page/share/view?pageId=232",
      configurationMode: "BUILT_IN",
      configurationSummary: "账号密码认证",
      endpointSummary: "下单接口：http://43.138.180.250:8082",
      configured: true,
      customerCodeConfigured: false,
      authorizationCodeConfigured: false,
      secretConfigured: false,
      updatedAt: null,
      version: 0,
      nameVersion: 0,
    };
    const request = vi.spyOn(apiClient, "request")
      .mockResolvedValueOnce([response, builtIn])
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ...builtIn, providerName: "达运佳物流", nameVersion: 1 });

    const listed = await httpPlatformAdminAdapter.listLogisticsProviderConfigs();
    const updated = await httpPlatformAdminAdapter.updateLogisticsProviderConfig(
      "CHUDA",
      {
        customerCode: "customer-001",
        authorizationCode: "authorization-value",
        secret: "provider-secret",
        version: 1,
      },
    );
    const renamed = await httpPlatformAdminAdapter.renameLogisticsProvider(
      "DAYUNJIA",
      { providerName: "达运佳物流", version: 0 },
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/erp-operator/logistics-provider-configs",
      { authScope: "tenant" },
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/v1/erp-operator/logistics-provider-configs/DAYUNJIA/name",
      expect.objectContaining({
        method: "PUT",
        authScope: "tenant",
        body: { providerName: "达运佳物流", version: 0 },
      }),
    );
    expect(renamed.providerName).toBe("达运佳物流");
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/erp-operator/logistics-provider-configs/CHUDA",
      expect.objectContaining({ method: "PUT", authScope: "tenant" }),
    );
    expect(JSON.stringify({ listed, updated })).not.toContain("must-be-dropped");
    expect(listed[1]).toMatchObject({
      providerCode: "DAYUNJIA",
      configurationMode: "BUILT_IN",
      configured: true,
    });
  });

  it("stores and publishes the Shopify app through the ERP operator API without echoing the token", async () => {
    const configured = {
      appName: "Xinzhi ERP",
      extensionName: "Xinzhi Chat",
      clientId: "6cef3dfc6b0d74e7c2709232f2938696",
      tokenConfigured: true,
      status: "CONFIGURED",
      releaseVersion: null,
      message: null,
      releasedAt: null,
      updatedAt: "2026-08-22T01:00:00Z",
      version: 0,
      automationToken: "must-be-dropped",
    };
    const published = {
      ...configured,
      status: "SUCCEEDED",
      releaseVersion: "xinzhi-erp-20260822-010203",
      message: "Shopify 应用配置与 Xinzhi Chat 插件已发布。",
      releasedAt: "2026-08-22T01:02:03Z",
      updatedAt: "2026-08-22T01:02:03Z",
      version: 2,
    };
    const cleared = {
      ...configured,
      tokenConfigured: false,
      status: "NOT_CONFIGURED",
      updatedAt: null,
      version: 0,
    };
    const request = vi
      .spyOn(apiClient, "request")
      .mockResolvedValueOnce(configured)
      .mockResolvedValueOnce(configured)
      .mockResolvedValueOnce(published)
      .mockResolvedValueOnce(cleared);

    const loaded = await httpPlatformAdminAdapter.getShopifyAppRelease();
    const saved = await httpPlatformAdminAdapter.saveShopifyAppReleaseToken({
      automationToken: "automation-token-value",
      version: 0,
    });
    const released = await httpPlatformAdminAdapter.publishShopifyApp(0);
    const removed = await httpPlatformAdminAdapter.clearShopifyAppReleaseToken(2);

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/erp-operator/shopify-app-release",
      { authScope: "tenant" },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/erp-operator/shopify-app-release/token",
      expect.objectContaining({
        method: "PUT",
        authScope: "tenant",
        body: { automationToken: "automation-token-value", version: 0 },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/v1/erp-operator/shopify-app-release/publish",
      expect.objectContaining({
        method: "POST",
        authScope: "tenant",
        body: { version: 0 },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      4,
      "/api/v1/erp-operator/shopify-app-release/token",
      expect.objectContaining({
        method: "DELETE",
        authScope: "tenant",
        body: { version: 2 },
      }),
    );
    expect(JSON.stringify({ loaded, saved, released, removed }))
      .not.toContain("must-be-dropped");
    expect(released.releaseVersion).toBe("xinzhi-erp-20260822-010203");
    expect(removed.tokenConfigured).toBe(false);
  });

  it("rejects a Shopify release response for any other app identity", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      appName: "Another App",
      extensionName: "Xinzhi Chat",
      clientId: "6cef3dfc6b0d74e7c2709232f2938696",
      tokenConfigured: false,
      status: "NOT_CONFIGURED",
      version: 0,
    });

    await expect(httpPlatformAdminAdapter.getShopifyAppRelease())
      .rejects.toThrow();
  });

  it("uses the isolated platform token scope and whitelists one-time credentials", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      ...admin,
      secret: "drop",
      activationCredential: {
        token: "one-time",
        expiresAt: "2026-07-30T00:00:00Z",
        password: "drop",
      },
    });
    const result = await httpPlatformAdminAdapter.createSystemAdmin({
      email: "admin@example.com",
      displayName: "Admin",
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/platform-admin/system-admins",
      expect.objectContaining({
        method: "POST",
        body: { email: "admin@example.com", displayName: "Admin" },
        authScope: "platform",
      }),
    );
    expect(result).toEqual({
      admin,
      credential: { token: "one-time", expiresAt: "2026-07-30T00:00:00Z" },
    });
    expect(JSON.stringify(result)).not.toContain("drop");
  });
  it("rejects malformed responses instead of inventing a production fallback", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({ items: "not-an-array" });
    await expect(
      httpPlatformAdminAdapter.listTenants({ page: 0, size: 20 }),
    ).rejects.toMatchObject({
      code: "invalid_response",
      status: 0,
    } satisfies Partial<ApiError>);
  });
  it.each([
    [
      "email-backed username without email",
      { ...admin, email: null },
    ],
    [
      "mismatched email alias",
      { ...admin, email: "other@example.com" },
    ],
    [
      "non-canonical email",
      {
        ...admin,
        username: "Admin@example.com",
        email: "Admin@example.com",
      },
    ],
  ])("rejects an impossible V42 %s identity", async (_case, payload) => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [payload],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      httpPlatformAdminAdapter.listSystemAdmins({ page: 0, size: 20 }),
    ).rejects.toMatchObject({ code: "invalid_response", status: 0 });
  });
  it("accepts a long canonical enterprise-admin email and strict E.164 phone", async () => {
    const longEmail = `${"a".repeat(64)}@${"b".repeat(60)}.example.com`;
    const longIdentity = {
      ...enterpriseAdmin,
      username: longEmail,
      email: longEmail,
    };
    vi.spyOn(apiClient, "request").mockResolvedValue({
      tenant,
      enterpriseAdmin: longIdentity,
    });

    await expect(
      httpPlatformAdminAdapter.createTenant({
        code: "acme",
        name: "Acme",
        adminEmail: longEmail,
        adminDisplayName: "Owner",
        adminInitialPassword: "initial-owner-password",
      }),
    ).resolves.toEqual({ tenant, enterpriseAdmin: longIdentity });
  });
  it("rejects a non-E.164 enterprise-admin phone", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      admin: { ...enterpriseAdmin, phoneNumber: "13800138000" },
    });

    await expect(
      httpPlatformAdminAdapter.createEnterpriseAdmin(tenant.id, {
        email: "owner@example.com",
        displayName: "Owner",
        initialPassword: "initial-owner-password",
      }),
    ).rejects.toMatchObject({ code: "invalid_response", status: 0 });
  });
  it("uses the dedicated platform tenant-session revoke endpoint", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(undefined);
    await httpPlatformAdminAdapter.logoutTenant();
    expect(request).toHaveBeenCalledWith(
      "/api/v1/platform-admin/tenant-session",
      { method: "DELETE", authScope: "tenant", skipUnauthorizedHandler: true },
    );
  });
  it("redeems credentials through the approved public endpoint", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(undefined);
    await httpPlatformAdminAdapter.redeemPasswordCredential({
      token: "one-time",
      newPassword: "long-enough-password",
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/platform-admin/auth/password-credentials/redeem",
      expect.objectContaining({ skipAuth: true, authScope: "platform" }),
    );
  });
  it("creates a tenant with a direct password and ignores obsolete activation data", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      tenant,
      enterpriseAdmin,
      activationCredential: {
        token: "tenant-one-time",
        expiresAt: "2026-07-30T00:00:00Z",
      },
    });

    await expect(
      httpPlatformAdminAdapter.createTenant({
        code: "acme",
        name: "Acme",
        adminEmail: "owner@example.com",
        adminDisplayName: "Owner",
        adminInitialPassword: "initial-owner-password",
      }),
    ).resolves.toEqual({
      tenant,
      enterpriseAdmin,
    });
    expect(request).toHaveBeenCalledWith(
      "/api/v1/platform-admin/tenants",
      expect.objectContaining({
        body: {
          code: "acme",
          name: "Acme",
          adminEmail: "owner@example.com",
          adminDisplayName: "Owner",
          adminInitialPassword: "initial-owner-password",
        },
      }),
    );
  });
  it("creates an enterprise administrator without consuming an activation response", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      admin: enterpriseAdmin,
      activationCredential: {
        token: "obsolete-token",
        expiresAt: "2026-07-30T00:00:00Z",
      },
    });
    await expect(
      httpPlatformAdminAdapter.createEnterpriseAdmin(tenant.id, {
        email: "owner@example.com",
        displayName: "Owner",
        initialPassword: "initial-owner-password",
      }),
    ).resolves.toEqual({ admin: enterpriseAdmin });
    expect(request).toHaveBeenCalledWith(
      `/api/v1/platform-admin/tenants/${tenant.id}/enterprise-admins`,
      expect.objectContaining({
        body: {
          email: "owner@example.com",
          displayName: "Owner",
          initialPassword: "initial-owner-password",
        },
      }),
    );
  });
  it("lists enterprise administrators for the selected enterprise", async () => {
    const target = { ...enterpriseAdmin, version: 3 };
    const response = {
      items: [target],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    };
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(response);

    await expect(
      httpPlatformAdminAdapter.listEnterpriseAdmins(tenant.id, {
        page: 0,
        size: 20,
      }),
    ).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/platform-admin/tenants/${tenant.id}/enterprise-admins?page=0&size=20`,
      { authScope: "platform" },
    );
  });
  it("updates enterprise administrator status through platform scope", async () => {
    const target = { ...enterpriseAdmin, version: 4 };
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(target);

    await expect(
      httpPlatformAdminAdapter.updateEnterpriseAdmin(
        tenant.id,
        enterpriseAdmin.id,
        {
          displayName: "Owner",
          status: "DISABLED",
          version: 3,
        },
      ),
    ).resolves.toEqual(target);
    expect(request).toHaveBeenCalledWith(
      `/api/v1/platform-admin/tenants/${tenant.id}/enterprise-admins/${enterpriseAdmin.id}`,
      {
        method: "PUT",
        body: {
          displayName: "Owner",
          status: "DISABLED",
          version: 3,
        },
        authScope: "platform",
      },
    );
  });
  it("resets an enterprise administrator password without an old password", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue(undefined);

    await expect(
      httpPlatformAdminAdapter.resetEnterpriseAdminPassword(
        tenant.id,
        enterpriseAdmin.id,
        { newPassword: "new-owner-password", version: 3 },
      ),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      `/api/v1/platform-admin/tenants/${tenant.id}/enterprise-admins/${enterpriseAdmin.id}/password`,
      {
        method: "PUT",
        body: { newPassword: "new-owner-password", version: 3 },
        authScope: "platform",
      },
    );
  });
  it("rejects a non-bearer or non-instant platform login without storing it", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      tokenType: "Token",
      accessToken: "platform-token",
      expiresAt: "2026-07-30",
      admin,
    });

    await expect(
      httpPlatformAdminAdapter.login({ username: "admin", password: "password" }),
    ).rejects.toMatchObject({ code: "invalid_response", status: 0 });
    expect(platformSessionStore.accessToken()).toBeNull();
  });
  it("rejects a non-ISO-instant platform login expiry", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      tokenType: "Bearer",
      accessToken: "platform-token",
      expiresAt: "2026-07-30",
      admin,
    });

    await expect(
      httpPlatformAdminAdapter.login({ username: "admin", password: "password" }),
    ).rejects.toMatchObject({ code: "invalid_response", status: 0 });
    expect(platformSessionStore.accessToken()).toBeNull();
  });
  it("rejects tenant access with a non-bearer token type", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      tokenType: "Token",
      accessToken: "tenant-token",
      expiresAt: "2026-07-30T00:00:00Z",
      tenant: { id: tenant.id, code: tenant.code, name: tenant.name },
      platformAdmin: {
        id: admin.id,
        username: admin.username,
        email: admin.email,
        displayName: admin.displayName,
        status: "ACTIVE",
      },
      permissions: ["orders.read"],
    });

    await expect(httpPlatformAdminAdapter.enterTenant(tenant.id)).rejects.toMatchObject({
      code: "invalid_response",
      status: 0,
    });
  });
  it("rejects page metadata that cannot describe its returned items", async () => {
    vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [tenant],
      page: 0,
      size: 0,
      totalElements: 1,
      totalPages: 1,
    });

    await expect(
      httpPlatformAdminAdapter.listTenants({ page: 0, size: 20 }),
    ).rejects.toMatchObject({ code: "invalid_response", status: 0 });
  });
});
