import { describe, expect, it } from "vitest";
import { parseIamQuery, toIamUrl } from "../IamConsolePage";
import { groupPermissionsByModule } from "./RoleSection";

describe("IAM 工作台 URL 与权限分组", () => {
  it("保留当前视图和既有分页筛选，并拒绝未知视图", () => {
    const query = parseIamQuery(
      "?view=audit&memberPage=2&rolePage=3&permissionPage=4&auditPage=5&action=iam.user.updated&resourceType=member",
    );

    expect(query).toMatchObject({
      view: "audit",
      memberPage: 2,
      rolePage: 3,
      permissionPage: 4,
      auditPage: 5,
      action: "iam.user.updated",
      resourceType: "member",
    });
    expect(toIamUrl(query)).toContain("view=audit");
    expect(parseIamQuery("?view=unknown").view).toBe("members");
  });

  it("按服务端 permission.module 分组并搜索名称、代码与说明", () => {
    const permissions = [
      {
        id: "96000000-0000-4000-8000-000000000001",
        code: "iam:user:read",
        module: "iam",
        name: "查看员工",
        description: "员工目录",
      },
      {
        id: "96000000-0000-4000-8000-000000000002",
        code: "warehouse:read",
        module: "warehouse",
        name: "查看仓库",
      },
    ];

    expect(groupPermissionsByModule(permissions, "")).toEqual([
      { module: "iam", items: [permissions[0]] },
      { module: "warehouse", items: [permissions[1]] },
    ]);
    expect(groupPermissionsByModule(permissions, "员工目录")).toEqual([
      { module: "iam", items: [permissions[0]] },
    ]);
    expect(groupPermissionsByModule(permissions, "warehouse:read")).toEqual([
      { module: "warehouse", items: [permissions[1]] },
    ]);
  });
});
