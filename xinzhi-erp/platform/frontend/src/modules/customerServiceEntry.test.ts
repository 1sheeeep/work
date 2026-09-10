import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../api/client", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("../api/client")>();
  return { ...original, apiClient: { request: mocks.request } };
});

import {
  issueCustomerServiceEntryGrant,
  openCustomerServiceEntry,
  resolveCustomerServiceEntryOrigin,
} from "./customerServiceEntry";

const grant = {
  grant: "a".repeat(43),
  entryUrl: "http://127.0.0.1:8787/api/v1/auth/erp/entry",
  tenantId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  expiresAt: "2026-08-01T09:01:00Z",
};

beforeEach(() => {
  mocks.request.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("original customer service entry", () => {
  it("exchanges a one-use grant at the original workbench without sending ERP credentials", async () => {
    vi.stubEnv("VITE_CUSTOMER_SERVICE_ENTRY_MODE", "native");
    mocks.request.mockResolvedValue({...grant,entryUrl:"https://kf.xzkj.ai/api/v1/auth/erp/entry"});
    const submitted=vi.spyOn(HTMLFormElement.prototype,"submit").mockImplementation(function(this:HTMLFormElement){
      expect(this.action).toBe("https://kf.xzkj.ai/api/v1/auth/erp/entry");
      expect(Array.from(this.elements).map(e=>(e as HTMLInputElement).name)).toEqual(["grant","tenantId","userId"]);
    });
    await openCustomerServiceEntry("https://kf.xzkj.ai","same-window");
    expect(submitted).toHaveBeenCalledOnce();
    expect(mocks.request).toHaveBeenCalledWith("/api/v1/customer-service/native-entry-grants",{method:"POST",body:{targetOrigin:"https://kf.xzkj.ai"}});
    await expect(openCustomerServiceEntry("https://kf-uat.xzkj.ai")).rejects.toThrow("无效的安全响应");
  });
});

describe("customer-service passwordless entry", () => {
  it("allows development loopback and production HTTPS origins only", () => {
    expect(resolveCustomerServiceEntryOrigin("http://127.0.0.1:8787/"))
      .toBe("http://127.0.0.1:8787");
    expect(resolveCustomerServiceEntryOrigin("https://support.example.test/"))
      .toBe("https://support.example.test");
    expect(resolveCustomerServiceEntryOrigin("http://support.example.test/")).toBeNull();
    expect(resolveCustomerServiceEntryOrigin("https://user:secret@support.example.test/")).toBeNull();
    expect(resolveCustomerServiceEntryOrigin("https://support.example.test/?grant=secret")).toBeNull();
  });

  it("accepts only a grant response bound to the configured target origin", async () => {
    mocks.request.mockResolvedValue(grant);
    await expect(issueCustomerServiceEntryGrant("http://127.0.0.1:8787"))
      .resolves.toEqual(grant);
    expect(mocks.request).toHaveBeenCalledWith(
      "/api/v1/customer-service/entry-grants",
      { method: "POST", body: { targetOrigin: "http://127.0.0.1:8787" } },
    );

    mocks.request.mockResolvedValue({ ...grant, entryUrl: "https://wrong.example.test/api/v1/auth/erp/entry" });
    await expect(issueCustomerServiceEntryGrant("http://127.0.0.1:8787"))
      .rejects.toThrow("无效的安全响应");
  });

  it("accepts canonical internal UUIDs without RFC version bits", async () => {
    const internalGrant = {
      ...grant,
      tenantId: "10000000-0000-0000-0000-000000000001",
    };
    mocks.request.mockResolvedValue(internalGrant);

    await expect(issueCustomerServiceEntryGrant("http://127.0.0.1:8787"))
      .resolves.toEqual(internalGrant);
  });

  it("posts only the opaque grant and immutable binding fields to a new window", async () => {
    mocks.request.mockResolvedValue(grant);
    const popup = { opener: window, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const submitted: Record<string, string> = {};
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
      for (const input of Array.from(this.elements)) {
        if (input instanceof HTMLInputElement) submitted[input.name] = input.value;
      }
      expect(this.action).toBe(grant.entryUrl);
      expect(this.method).toBe("post");
    });

    await openCustomerServiceEntry("http://127.0.0.1:8787");

    expect(popup.opener).toBeNull();
    expect(submitted).toEqual({
      grant: grant.grant,
      tenantId: grant.tenantId,
      userId: grant.userId,
    });
    expect(Object.values(submitted).join(" ")).not.toContain("Bearer");
  });

  it("can submit the same one-time grant in the current window", async () => {
    mocks.request.mockResolvedValue(grant);
    const open = vi.spyOn(window, "open");
    let submittedTarget = "";
    vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
      submittedTarget = this.target;
    });

    await openCustomerServiceEntry("http://127.0.0.1:8787", "same-window");

    expect(open).not.toHaveBeenCalled();
    expect(submittedTarget).toBe("_self");
  });
});
