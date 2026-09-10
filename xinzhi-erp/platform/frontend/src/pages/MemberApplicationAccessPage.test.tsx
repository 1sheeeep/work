import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberApplicationAccessPage } from "./MemberApplicationAccessPage";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("../modules/memberApplicationAccessApi", () => ({
  memberApplicationAccessApi: api,
}));

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({
    currentTenant: { id: "10000000-0000-4000-8000-000000000001", name: "新知" },
    session: {
      applications: [
        { code: "ERP", modules: ["ORDERS"] },
        { code: "CHAT", modules: ["WORKSPACE"] },
      ],
    },
    hasPermission: () => true,
  }),
}));

describe("MemberApplicationAccessPage", () => {
  beforeEach(() => {
    api.list.mockResolvedValue({
      items: [{
        id: "20000000-0000-4000-8000-000000000001",
        username: "operator@example.test",
        email: "operator@example.test",
        displayName: "运营员工",
        status: "ACTIVE",
        version: 2,
        enterpriseAdministrator: false,
        applications: ["ERP"],
      }],
      page: 0,
      size: 20,
      totalElements: 1,
      totalPages: 1,
    });
    api.replace.mockResolvedValue({
      version: 3,
      enterpriseAdministrator: false,
      applications: ["ERP", "CHAT"],
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lets an enterprise administrator assign enabled applications to an employee", async () => {
    render(<MemberApplicationAccessPage />);

    expect(await screen.findByText("运营员工")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "配置" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Xinzhi Chat/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存权限" }));

    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(
      "20000000-0000-4000-8000-000000000001",
      { version: 2, applications: ["ERP", "CHAT"] },
    ));
    expect(await screen.findByText("Xinzhi Chat")).toBeTruthy();
  });
});
