import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: "?token=one-time",
  replace: vi.fn(),
  redeem: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => mocks.search,
}));
vi.mock("../platform/platformAdminApi", () => ({
  httpPlatformAdminAdapter: { redeemPasswordCredential: mocks.redeem },
}));
import { PlatformCredentialPage } from "./PlatformCredentialPage";

describe("PlatformCredentialPage", () => {
  it("removes the URL token, enforces the password cap, and redeems only once", async () => {
    const replace = vi.spyOn(window.history, "replaceState");
    window.history.pushState(null, "", "/platform-admin/activate?token=one-time");
    render(<PlatformCredentialPage />);
    expect(replace).toHaveBeenCalled();
    const tooLong = "x".repeat(129);
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: tooLong },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: tooLong },
    });
    fireEvent.click(screen.getByRole("button", { name: "设置密码" }));
    expect(mocks.redeem).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(
      "密码设置不符合要求，请重新设置。",
    );
    mocks.redeem.mockResolvedValueOnce(undefined);
    fireEvent.change(screen.getByLabelText("新密码"), {
      target: { value: "123456" },
    });
    fireEvent.change(screen.getByLabelText("确认密码"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "设置密码" }));
    await waitFor(() =>
      expect(mocks.redeem).toHaveBeenCalledWith({
        token: "one-time",
        newPassword: "123456",
      }),
    );
    expect(await screen.findByText("密码设置完成")).toBeTruthy();
  });
});
