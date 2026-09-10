# One 身份底座与平级业务迁移

状态：已被 2026-09-04 用户“解除 One 依赖，恢复业务独立登录与管理”取代。以下仅保留历史设计，不再执行或部署；其中源码路径和测试数量可能已失效。当前实现见 [业务原生身份](native-business-identity.md) 与根目录 DEV_STATE.md。

## 已确认边界

- One 拥有统一身份、企业成员、应用开通；ERP 和 CHAT 为平级业务，分别直达自己的域名。One 门户不是登录前置步骤。
- 两个业务分别通过标准 OIDC Authorization Code + PKCE 登录 One，分别创建本地业务会话。不共享浏览器 Token，不传 ERP 登录票据给新客服。
- ERP 不设客服业务菜单；应用切换器可按应用开通状态提供新标签页链接。目标业务必须重新验证 One 应用授权和本地业务权限，链接不是授权凭证。
- 一个 Shopify 公开应用 Xinzhi ERP（原有 App ID、Client ID 不变）包含 ERP 与客服完整业务，以及 Xinzhi Chat Theme App Extension。One 是内部身份底座，不是第三个 Shopify 应用，也不代替业务功能送审。
- 独立 Go Connector 继续拥有安装关系、Token、OAuth、Webhook 和 Shopify API。可与 One 共用基础设施，但不并入身份进程。ERP 订单/库存/履约状态机仍是唯一写入实现。
- 当前 Connector 持久化仍有加密文件实现；不能把目标 PostgreSQL schema 当成已完成迁移。不迁库、不迁 Token、不改主键。
- `kf.xzkj.ai` 生产客服不动；只修改仓库内 `platform/customer-service`。`kf-uat.xzkj.ai` 保留为隔离验证入口，不交换域名。

## 本次身份切片

复制客服新增 `internal/platform/one_identity.go`；复用原有租户隔离容器，但不复用 ERP 身份协议。

1. 固定 issuer 与 CHAT client；校验 discovery 同源端点、RS256 签名、issuer、audience、有效期、nonce、PKCE、浏览器绑定 state；state 五分钟有效且仅消费一次。
2. 同时校验 ID Token 与当前 UserInfo 的 `sub`、`enterprise.id`、`applicationAccess.application=CHAT`。普通入口拒绝 `platformAdministrator=true`；平台委托另行接入，不能伪装企业成员。
3. 通过显式关联表将 One enterprise/sub 对应到**已存在**的隔离客服 tenant/user ID。不按邮箱认领账号，不复制密码，不自动创建企业数据，不覆盖角色或店铺分配。
4. 本地会话最多十五分钟且不超过上游 ID/access token 有效期；当前不使用 refresh token。每十五秒再次检查 UserInfo，失败即失效；原生 WebSocket 定时复核并断开。重启后内存身份映射丢失，旧会话失败关闭。
5. One 模式关闭本地密码登录、首个管理员创建和 ERP entry grant。普通退出只撤销客服本地会话，不自动注销 ERP 或 One。

这是迁移适配器，不是最终成员管理产品。One 任务正在开发版本化、企业/应用绑定的细粒度权限快照；本次不自行设计或消费尚未定稿的快照，不把 `enterpriseRoles` 直接解释为全部客服权限。后续接入须明确快照版本、权限目录、撤销语义与数据范围所有权。

### 非敏感关联文件

`XZDESK_ONE_BINDINGS_FILE` 指向部署专用 JSON 文件。不能仅凭 One 新开通应用创建空租户；必须先通过审核过的数据迁移/初始化流程准备客服租户和账号。示例仅说明结构，不可代替真实关联核对：

```json
[
  {
    "enterpriseId": "11111111-1111-4111-8111-111111111111",
    "tenantId": "existing-isolated-tenant-id",
    "subjects": {
      "22222222-2222-4222-8222-222222222222": "unchanged-local-customer-service-user-id"
    }
  }
]
```

每个企业只绑定一个隔离 tenant；一个本地账号不能绑定两个 One subject。只允许关联已停用旧身份入口后的正确业务账号，禁止关联系统管理员。权限仍取该账号的实时本地记录。

### 隔离环境配置（未启用）

- 复制客服：`XZDESK_ONE_ISSUER`、`XZDESK_ONE_CLIENT_ID`、`XZDESK_ONE_CLIENT_SECRET`、`XZDESK_ONE_BINDINGS_FILE`、`XZDESK_PUBLIC_ORIGIN`。
- 同时配置 `XZDESK_ERP_IAM_BASE_URL` 或 `XZDESK_LOCAL_DEMO=1` 时拒绝启动 One 模式，避免两套身份权威并存。
- CHAT callback 固定为复制客服 origin + `/api/v1/auth/one/callback`；One client 的 callback 白名单需由 One 任务按隔离配置接入，不读取或变更生产 secret。
- ERP 使用已有 `erp.one.oidc.*` 配置；`/api/v1/system/info.identityMode` 决定登录页。One 模式禁止本地密码登录/改密，登录配置不可读时不退回密码表单。
- ERP 代理模板仍有旧 One 路径封锁。没有单独验证业务 OIDC 白名单前，不部署此代码到旧审核栈。平台管理与通配内部身份接口应继续封锁。
- 本次不改生产环境文件、Caddy 生效配置、DNS、真实账号或店铺。未提供的关联与凭据保持缺失，不猜值、不复制生产凭据。

## 权限与业务契约

- ERP 权限/开通：`backend/src/main/java/cn/xzkj/erp/iam` 与 `tenantaccess`；店铺、仓库数据范围仍由 ERP 业务授权检查。
- 客服原生权限：`customer-service/internal/platform/permissions.go`；店铺分配和数据范围：`store.go` 与用户 `ShopScope`、`WorkbenchShopScope`、`ConversationScope`、`DataScopes`。
- `customer_service.*` 仅为旧 ERP 桥接权限；新客服角色使用 `workbench.access`、`conversations.claim/reply/transfer/close`、`tickets.view/manage` 等原生权限，不要求 ERP 角色。
- Connector 标准端口：`customer-service/internal/connectors/shopify/port.go`；继续绑定 canonical tenant/shop，安装关系不得因新身份主键不同而重新建一份。
- ERP 不可用不应阻止客服登录/普通聊天；依赖 ERP 的订单写入必须明确不可用，不能在客服重写状态机。One 不可用时不放宽新登录或到期权限复核。

## 剩余关闭条件

- One 权限快照契约与迁移关联核对完成；CHAT-only、ERP-only、双开通以及禁用后的真实隔离环境联调。
- 完整原生权限、聊天/工单/渠道/插件配置与店铺范围用例；WebSocket 撤销和多标签页登录/退出的浏览器验收。
- ERP 原生会话与 One 撤销传播语义审查，不把前端改用 One 当成全链路权限迁移完成。
- 非 One 本地账号仍为兼容测试模式，不得作为新送审环境的后门。
- Shopify `embedded=true` 与当前状态/只读 App Home 的体验缺口未关闭：须完成符合要求的嵌入式功能体验或取得明确审查指引，再拍最终图/录屏。添加工作区链接不是达标证明。
- 公共应用的安装、重新授权、主题启用、卸载/重装、隐私 Webhook 与两业务联动均需精确版本证据；保持 NO-GO。

## 本地验证（2026-09-04）

- 复制客服 `internal/platform` 与 `cmd/support-server` 指定包测试通过，无失败、13 个用例跳过；新增合成 OIDC 用例使用真实 RS256/JWKS、PKCE 和 UserInfo，经 HTTP 验证 CHAT-only 登录、店铺隔离、会话认领和回复、无权限操作拒绝、退出、撤销、错误 claims/state、过期和重放。
- ERP Windows Maven smoke：66 项通过、零跳过；不是后端全量测试。修正了原 OAuth starter 为 Spring Boot 4 官方对应的 `spring-boot-starter-security-oauth2-client`，保留其他已有依赖改动。
- ERP 入口专项：4 个文件、25 项测试通过；ERP 与客服 TypeScript/构建通过，仍有既有的大包提示。
- 浏览器仅检查本机合成登录配置：两端桌面与 375px 登录布局，客服中英文切换。修复了旧客服 body 最小宽度导致的新登录页溢出。预览没有连接真实身份、数据库、邮箱或店铺，不是业务/用户验收。
- Go race 检查因当前工具链 CGO 未启用而未执行成功；不能宣称 race 验证通过。
- 实际送审检查仍失败关闭：后续同日材料准备复核为 78 项清单未确认（重开旧账号措辞和五项全量验证）、14 个材料占位字段、截图数量和字幕 scope 覆盖缺口；修改规则的测试通过不等于真实包可提交。并行准备结果见 `shopify-review/16-parallel-review-preparation.md`。

原有 ERP One 适配器仍有首次邮箱关联、`enterpriseRoles` 到本地角色的映射和原生会话生命周期。此次没有擅自改写既有平台委托或角色契约；这些差异必须在 One 权限快照接口与迁移数据准备好后逐项关闭，不能把这次登录界面/客服身份切片当成全架构迁移完成。

## 参考

- [go-oidc](https://github.com/coreos/go-oidc)：使用成熟客户端进行发现与签名验证，不自写 JWT 协议。
- [Go OAuth2](https://pkg.go.dev/golang.org/x/oauth2)：授权码和 PKCE。
- [Shopify App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements)：嵌入式体验、可用功能、安装与审核要求；内部架构不代表平台批准。
