import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { iamAdminApi } from "./iamAdminApi";

describe("IAM 员工筛选 API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("只发送显式筛选并正确编码 URL 参数", async () => {
    const request = vi.spyOn(apiClient, "request").mockResolvedValue({
      items: [],
      page: 2,
      size: 20,
      totalElements: 0,
      totalPages: 0,
    });

    await iamAdminApi.listMembers({
      page: 2,
      size: 20,
      query: "A+B %",
      status: "DISABLED",
      roleId: "97000000-0000-4000-8000-000000000010",
    });

    expect(request).toHaveBeenCalledWith(
      "/api/v1/iam/members?page=2&size=20&query=A%2BB+%25&status=DISABLED&roleId=97000000-0000-4000-8000-000000000010",
    );
  });
});
