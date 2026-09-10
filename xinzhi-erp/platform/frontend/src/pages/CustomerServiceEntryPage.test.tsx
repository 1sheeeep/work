import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ open: vi.fn(), allowed: true, origin: "https://chat.example.test" }));
vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({ session: { applications: [{ code: "CHAT" }] }, hasPermission: () => mocks.allowed }) }));
vi.mock("../i18n/I18nContext", () => ({ useI18n: () => ({ t: (value: string) => value }) }));
vi.mock("../modules/customerServiceEntry", () => ({ usesNativeCustomerService: () => false, customerServiceEntryOrigin: () => mocks.origin, openCustomerServiceEntry: mocks.open, customerServiceEntryErrorMessage: () => "暂时无法打开客服工作台，请稍后重试。" }));
import { CustomerServiceEntryPage } from "./CustomerServiceEntryPage";
beforeEach(() => { mocks.allowed = true; mocks.origin = "https://chat.example.test"; mocks.open.mockReset().mockResolvedValue(undefined); });
afterEach(cleanup);
describe("ERP shared-account customer service entry", () => {
  it("uses the authenticated ERP entry without a second password", async () => {
    render(<CustomerServiceEntryPage />);
    await waitFor(() => expect(mocks.open).toHaveBeenCalledExactlyOnceWith(mocks.origin, "same-window"));
    expect(screen.queryByLabelText(/密码/)).toBeNull();
  });
  it("fails closed when the employee lacks customer service permission", () => {
    mocks.allowed = false;
    render(<CustomerServiceEntryPage />);
    expect(screen.getByRole("alert").textContent).toContain("没有客服访问权限");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("does not navigate when the target is unconfigured", () => {
    mocks.origin = "";
    render(<CustomerServiceEntryPage />);
    expect(screen.getByRole("alert").textContent).toContain("尚未配置");
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it("announces failure and retries explicitly without a redirect loop", async () => {
    mocks.open.mockRejectedValueOnce(new Error("unavailable"));
    render(<CustomerServiceEntryPage />);
    await screen.findByRole("alert");
    expect(mocks.open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(mocks.open).toHaveBeenCalledTimes(2));
  });
});
