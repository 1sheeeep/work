# 店铺应用只读接入准备：实现与隔离演练

2026-09-06。状态：**只读候选切片 / 默认关闭 / 非生产就绪**。

本切片让 ERP 用一个明确绑定的候选店铺应用读取授权事实和一页订单，复用原 SaaS 的 DTO 校验，**不替换现有业务通道、不导入订单、不合并账号**。完整目标及授权边界见 [接入准备](production-customer-service-integration-preparation.md)。

## 已实现的链路

ERP 店铺详情的准备面板 → ERP 现有会话与业务权限 → 只读准备服务 → 受限客服适配器 → Shopify 固定查询。

- 新来源标记为 `CUSTOMER_SERVICE_STORE_APP_READ_ONLY`，与现有 `XZ_ERP_APP` SaaS 来源分开。它不是全局 `ChannelConnectorGateway` Bean，不改变现有订单/商品/库存业务路由。
- ERP 只配置一个候选企业和店铺。客服适配器只接受明确审查的同企业绑定，校验 ERP 店铺、客服店铺、Shopify Shop ID、域名、App client ID、安装 ID 和精确绑定版本；不按显示名或邮箱推断关系。
- 每次读取重新查询 `shop` 与 `currentAppInstallation` 的真实身份及 `accessScopes`。存储记录的 scope 不能授权读取，已知空与未知分开；订单读取要求实际 `read_orders` 或 `write_orders`。
- Shopify 的 Token 只在客服读取适配器与其 Admin API 客户端之间使用；不返回 ERP、浏览器或错误正文。没有任意 URL、任意 GraphQL 或命令代理。
- 仅提供连接核验和订单目录两项读取。安装、增权、重试旧生命周期入口、卸载、库存/订单/履约写入及其他目录读取均拒绝；不失败切换到 SaaS。
- 一个前台请求在途，8 秒服务处理超时，每页最多 25 条；界面每次只预览 10 条，不自动遍历分页、不启动后台回补。此限制**不等于已实现两业务共享 Shopify 成本预算**。
- 界面只手动核验；失败清掉过期成功/订单，旧店铺的延迟结果不覆盖新店铺。中英文及 375 像素窄屏使用既有 ERP 视觉样式，不新增正式切换或写入按钮。

权限核验采用 Shopify 已有查询，而非自建授权推断机制：[currentAppInstallation](https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation)、[实际权限管理](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes)。App 的 `apiKey` 是应用 API 身份标识，不是 Secret；用于和客服既有 App profile 的 client ID 对照。[App 字段说明](https://shopify.dev/docs/api/admin-graphql/latest/objects/App#field-App.fields.apiKey)

## 关闭与配置边界

三个边界独立存在，不能把前端隐藏当作后端隔离：

1. 前端 `VITE_STORE_APP_READ_PREPARATION` 未设置时不渲染准备面板。明确开启时还要求活跃外部店铺、`shop:read` 和 `shop:authorization:write`；预览订单另外要求 `orders.read`。仓库环境文件未启用该开关。
2. ERP 的 `erp.store-app-read-preparation.enabled` 未设置时不创建准备服务和路由。测试明确开启时要求同前缀的 `tenant-id`、`shop-id`、`shop-domain`、`binding-version`、`base-url`、`service-token` 齐全；不完整则启动失败，不回落到其他通道。地址只接受 HTTPS 或回环 HTTP，禁止跳转。
3. Go 的 `NewERPStoreAppReadHandler` **未注册进原 `Server.Routes` 或任何生产入口**。目前只在隔离测试和固定合成演练进程挂载，不是部署后能直接打开的生产功能。正式挂载、服务身份分发、生产账号/店铺关联仍须独立审查与授权。

ERP 接口只接受 GET：

```text
/api/v1/platform-center/shops/{shopId}/store-app-read-preparation
/api/v1/platform-center/shops/{shopId}/store-app-read-preparation/orders?limit=10
```

客服适配器仅接受两个固定 POST 查询：

```text
/internal/v1/erp-store-app/shopify/connection
/internal/v1/erp-store-app/shopify/order-catalog
```

服务请求使用 `X-XZ-ERP-Connector-Token` 和 `X-XZ-Store-App-Binding-Version`；重复头、未知字段、尾随 JSON、查询参数、跨绑定及版本不符都拒绝。成功响应必须有一致的来源与版本头。ERP 响应固定 `readOnly=true`、`productionReady=false`，响应禁止缓存。绑定版本是候选核验版本，**不是正式业务路由切换版本**。

## 可重跑的本地验证

只使用已缓存依赖。未设置、读取或打印任何真实服务凭据。

在仓库根目录：

```text
node platform/scripts/windows-maven-agent-path-gate.mjs --store-app-preparation
node --test platform/scripts/windows-maven-agent-path-gate.test.mjs platform/scripts/customer-service-preservation-check.test.mjs platform/scripts/customer-service-shared-auth.test.mjs platform/customer-service/tools/erp-login-api.test.mjs
```

在 `platform/customer-service`：

```text
go test ./internal/platform ./internal/connectors/shopify/adminapi ./internal/connectors/shopify/installations ./internal/preparation/storeappread -count=1
```

在 `platform/frontend`：

```text
npm.cmd test -- --run
npm.cmd run build
```

Java 固定准备及租户分页回归测试 **61 项全部通过**，包含单元校验、真实 Java → Go 回环进程、真实 Spring Security + 独占 PostgreSQL 16 + Go 链路，以及既有 SaaS、店铺授权和租户分页回归。PostgreSQL 由测试自行创建，拒绝使用外部数据库配置，测试结束停止自己的容器；Go 进程只接受固定合成配置，随机回环端口，并在测试结束关闭。

数据库联调实际比较读取前后的 ERP 店铺、授权、订单、用户、角色和会话六张表摘要不变；使用实际权限过滤，未登录拒绝，缺订单权限返回 403，停用用户返回 401。此处用户是合成 ERP 既有用户，不是新的客服主身份。Go 的四个相关包全量通过，另覆盖原 Routes 拒绝候选 POST、并发忙拒绝及取消后释放读取名额；原 GET 页面兜底使未知 POST 返回 405，这不表示接入路由已挂载。

前端 177 个文件 / **1,238 项全部通过**，含新增的入口默认关闭/权限/店铺状态测试；默认关闭和准备开关开启两种构建均通过，保留既有大包体积警告。离线保护及既有共享登录、Windows 门禁共 **81 项通过**。这些数量不能相加后宣称“完整生产接入已验收”。

合成 Go 进程使用实际内存 Store、读取适配器与 Admin API 客户端，但最末端是**没有网络实现的合成 transport**，仅响应固定 Shopify 只读查询。它不是实际 Shopify 验收，也不是原生产客服数据库恢复。`/rehearsal/evidence` 仅存在于该合成进程，输出只读计数及所有者状态是否变化，不返回 Token。

界面演练页 `platform/frontend/tools/fixtures/store-app-read-preparation.html` 调用实际面板组件，使用固定合成响应，不登录账号、不连接 ERP 数据库或 Shopify。浏览器实查了中文/英文、窄屏与失败后清除旧结果。**它不是登录到订单页的完整跨服务浏览器验收。**

第一次后台全量 1,058 项中有 29 项失败/错误：28 个旧测试仍断言最新迁移为 V122，而仓库已有 V123；仅对齐测试断言，未改迁移脚本或 One/登录业务。只读适配器误沿用旧“重试”入口的问题已补拒绝检查。联调初跑的 Windows Go 缓存、合成用户及店铺授权元数据初始化问题均已修复，未绕过业务约束。

第二次后台全量运行 1,078 项，0 断言失败、1 错误、0 跳过；唯一错误是 TenantListQueryPlanPostgresql16Test 新建回环数据库连接时报告 `No buffer space available (maximum connections reached?): connect`。该类全部 6 项随后连同接入相关检查独立复测，共 61 项通过，错误未复现。未修改分页契约、添加重试/忽略断言、调整 Windows 参数或关闭用户服务；原因尚未确定。**独立复测通过不改变那次全量运行失败的事实，也不等于稳定全量或部署放行。** 最终状态统一记入根目录 [DEV_STATE](../../DEV_STATE.md)。

## 当前不能放行的部分

- 此只读 ERP 入口仍使用既有 ERP 用户与权限，不代表账号合并。后续 [身份后台隔离演练](customer-service-identity-preparation-rehearsal.md) 已验证明确关联、客服密码和独立候选会话；它未挂载本入口，浏览器完整登录、持久核对与可靠撤权仍缺失。
- 没有商品/库存/订单写入通道、共享限额预算、双端命令账本、跨来源事件处理、在途命令排空、原子路由切换或结果未知后的恢复。
- 没有真实保护快照采集器、原聊天/邮件/插件全链路回归、原库备份恢复、完整隔离接入/回退或生产高峰观察。
- 未生成精确候选发布版本、未核查线上依赖/健康、未部署。本地脏工作区不可整体打包到线上；已有 SaaS Connector 与复制客服 UAT 都保持原样。

本切片出现故障时停止准备进程/关闭准备入口即可，不需要恢复数据库、重置密码或切换业务授权。**这只是只读准备功能的撤回，不是完整生产接入的回退演练。** 后续必须逐项关闭身份、写入/切换和数据保护切片，不能将当前通过的读取测试用作一次性正式接入许可。
