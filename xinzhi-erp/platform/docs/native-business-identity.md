# ERP 与复制客服原生身份（已取代）

状态：2026-09-05 用户明确改为 ERP 与复制客服共用 ERP 账号、免二次登录，见 [共用账号方案](shared-erp-customer-service-identity.md)。下文仅保留历史实现证据，不再执行复制客服原生密码恢复或按此方案部署。

日期：2026-09-04。用户明确要求解除 One 依赖；本地实现完成，实际环境尚未发布或验收。

## 设计与入口

沿用已有 IAM 和客服本地账号模型，不新建身份底座或复制密码。参考 [OWASP 多租户安全](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)：租户输入只是数据分区选择，身份和权限必须在目标分区内验证；不按邮箱自动认领账号。

| 业务 | 登录与管理 | 权限边界 |
| --- | --- | --- |
| ERP 企业 | `/login`；原有 IAM 企业/员工/角色/店铺管理；`/settings/application-access` | ERP 本地账号、企业开通、员工应用权限、操作权限及资源范围 |
| ERP 平台管理员 | `/platform-admin/login`；`/platform-admin` | 原平台管理员身份，不能伪装普通企业成员；委托路径仍由原有服务校验 |
| 复制客服 | 自身网页登录；输入既有客服企业标识（可用 `?tenant=...` 预填）；原有坐席、店铺与权限配置 | 既有租户分区内的密码、有效会话、角色、店铺及会话范围；不依赖 ERP/One 登录 |

ERP 的员工应用权限页只维护 ERP 保存的访问记录，不是其他独立系统的统一账号管理器。平级应用链接不携带凭据、不授予目标业务访问权。ERP 不新增客服业务入口。

## 认证退役与数据保留

- ERP 删除 One OIDC 客户端/回调/跨应用登录票据运行入口，系统身份固定为 local；旧配置不能禁用原生登录。去掉 Host=One 时跳过 ERP 应用权限检查的分支。
- 复制客服启动固定为 `NewNativeTenantMux`。旧 `XZDESK_ONE_ISSUER` / `XZDESK_ERP_IAM_BASE_URL` 不再选择登录模式。只用 `ExistingStoreForTenant` 读取已存在的文件或 PostgreSQL 租户分区，不退到默认 store，也不创建未知租户。
- 原生会话使用独立前缀和浏览器存储键。旧联合登录 Token 不被升级为密码登录凭据；需要重新原生登录。HTTP 验证有效本地会话，WebSocket 定时复核本地用户/会话和权限。
- One 登录/ERP 票据/公开管理员初始化入口在复制客服关闭。现有 Connector 业务鉴权和 Shopify 流程保持原样；独立登录不等于拆除业务集成。
- 数据库迁移、映射字段、主键、用户、角色、店铺和历史数据保留。本轮没有数据迁移或密码重置。不要删除历史迁移来“清除 One”。

## 本地证据

- ERP 前端 `npm exec vitest run -- --maxWorkers=2`：172 文件 / 1191 项通过；构建通过。
- ERP 后端干净编译后定向 41 项通过，0 跳过：`AuthControllerTest,BearerTokenAuthenticationFilterTest,SystemInfoControllerTest,LoginServiceTest,IamAdministrationIntegrationTest,IamPasswordCredentialIntegrationTest,IamSessionManagementIntegrationTest,PlatformAdminIntegrationTest`。IAM/平台管理使用本机临时 PostgreSQL 16；会话回归特意保留失效 One 开关，仍通过原生登录。
- 后端全量未通过且中止，不与上述定向结果混同；旧 122/123 版本断言、临时数据库未就绪和旧编译残留需要单独处理。实际数据库没有改动。
- 复制客服指定平台/启动包测试及 vet 通过。新增文件存储回归涵盖登录、管理员新增/停用/审计、普通员工拒绝、跨租户拒绝、未知租户拒绝且不创建、旧 Token 拒绝、重开文件分区及退出。前端构建通过，存在既有 bundle 大包提示。
- Chrome 本机合成数据检查了 ERP 两类登录入口、客服原生登录、坐席管理与退出。客服中文 375×812、英文 812×375 登录页无横向溢出；只对未登录页解除旧桌面工作台的最小宽度约束，不改变已登录工作台。不等于 ERP 实际账号端到端、部署、真实店铺或用户业务验收。

可选浏览器夹具仅通过 `go test -tags nativeidentityfixture ./internal/platform -run '^TestNativeIdentityBrowserFixture$' -v -timeout 11m` 显式启动，十分钟自动结束。它只用内存合成账号，不启动提供商后台任务；不进入普通测试或生产二进制。

## 实际发布前阻断条件

1. 先在获准的隔离环境检查原生管理员及员工凭据可用性；One 关联账号可能没有本地密码，禁止猜测、复制或自动重置。
2. 确认复制客服既有数据位于租户分区，并取得准确的原分区标识。默认 store 不自动转换为租户分区；若实际环境尚未分区，应另行确认安全适配方案，不直接切换配置。
3. 保留现状备份和可回退发布版本；用管理员/普通员工验证登录、账号管理、店铺/业务范围、禁用、退出和服务重启。生产操作需要单独明确授权。
4. 未完成真实环境验证前，不能宣布业务已在线解除依赖或 One 可安全停机。原生产客服、共享 Caddy/TLS/网络及 Shopify 地址不变。用户随后已恢复本地送审准备；以 `shopify-review/00-submission-product-boundary.md` 为当前范围，原生身份不自动关闭真实安装、账号或部署门禁。
