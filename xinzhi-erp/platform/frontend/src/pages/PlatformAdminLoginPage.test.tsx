import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const mocks = vi.hoisted(() => ({ login: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({
  Navigate: () => <div>redirected</div>,
}));
vi.mock("../platform/PlatformAdminContext", () => ({
  usePlatformAdmin: () => ({
    status: "unauthenticated",
    login: mocks.login,
    error: null,
  }),
}));
import { PlatformAdminLoginPage } from "./PlatformAdminLoginPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlatformAdminLoginPage", () => {
  it("submits trimmed credentials and keeps input on a safe failure", async () => {
    mocks.login.mockRejectedValueOnce(new Error("offline"));
    render(<PlatformAdminLoginPage />);
    expect(screen.getByText("Xinzhi ERP")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "使用 Xinzhi One 登录" })).toBeNull();
    expect(screen.getByRole("button", { name: "登录平台后台" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("邮箱或手机号"), {
      target: { value: " Admin@Example.com " },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录平台后台" }));
    await waitFor(() =>
      expect(mocks.login).toHaveBeenCalledWith({
        email: "admin@example.com",
        password: "password",
      }),
    );
    expect(screen.getByRole("alert").textContent).not.toContain("offline");
    expect((screen.getByLabelText("邮箱或手机号") as HTMLInputElement).value).toBe(
      " Admin@Example.com ",
    );
  });

  it("distinguishes login throttling from authentication service outages", async () => {
    mocks.login.mockRejectedValueOnce(
      new ApiError("Too many failed login attempts", { status: 429 }),
    );
    render(<PlatformAdminLoginPage />);
    fireEvent.change(screen.getByLabelText("邮箱或手机号"), {
      target: { value: "admin@example.com" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录平台后台" }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "登录尝试过多，请稍后再试。",
      ),
    );
    expect(screen.getByRole("alert").textContent).not.toContain(
      "认证服务暂时不可用",
    );
  });
});
