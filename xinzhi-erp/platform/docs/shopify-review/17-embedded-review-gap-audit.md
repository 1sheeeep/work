# Shopify 嵌入式送审缺口核对

2026-09-07 开户决定已确认：任何用户、任何企业均须由我们开通账号并授权，无例外；不开放自助注册，Shopify 安装不授予系统使用权。下方历史测试记录中的新商家入驻缺口现指受控开户流程的精确构建验证，不再要求开发自助注册。该决定不代表部署、真实店铺验收或 Shopify 审核通过。

更新：2026-09-05。仅核对和修改本仓库 ERP／复制客服；未部署、未访问真实店铺或生产客服。应用仍为同一个 Xinzhi ERP，ERP 与 CHAT 的独立业务定位不变。

## 结论

保留 ERP 和复制客服两个独立业务工作台，共用既有 ERP 账号但各自校验业务会话、权限和店铺范围，不再依赖 One，也不要求把完整 ERP 和客服工作台重做进 Shopify Admin。当前要补齐的是 Shopify-owned 安装 → 授权 → 原生 ERP 账号关联 → Admin 内配置、连接管理和必要状态。仅加外链或改名仍不能关闭这些门禁。本地已接通待关联授权、已有原生 ERP 企业管理员的确认页和服务端权限合同；工作人员开户与授权路线已确定；Admin 必要配置及真实两业务/插件端到端仍未闭合。没有操作真实数据归属。

[Shopify 集成指南](https://shopify.dev/docs/apps/build/integrating-with-shopify) 对 ERP 独立工作流、需要持续监控的客服会话列有例外；仍要求在 Admin 内提供必要设置、配置和状态。该指导不等于本应用已获豁免或预先批准，具体边界不清楚时需要向审核方核实，而不是取消 `embedded=true`。

## 代码核对结果

源码路径相对 `platform/customer-service/internal/connectors/shopify/installations/`。

| 缺口 | 当前源码证据 | 关闭条件 |
| --- | --- | --- |
| App Home 必要管理仍不完整 | 已有状态、只读预览、已有 ERP 账号关联和插件设置引导；插件 app-data 只读核对、主题信号与独立客服入口已本地实现，完整连接管理仍有缺口 | Admin 内安装、关联、配置、连接管理及必要状态真实可用；完整 ERP／客服业务保留独立工作台，不在 Go Connector 复制 ERP 写入状态机 |
| Shopify 会话与业务权限是两套边界 | 预览依赖 `authenticateEmbeddedRequest` 和安装关系；Shopify Token 不等同于 ERP 账号或客服业务会话 | Shopify 会话只用于已验证店铺的安装流程；调用业务操作必须另核对 ERP 用户、企业、客服映射坐席、权限和资源，不把 Shopify Token 升级为业务会话 |
| 新店的完整公开应用路径尚未闭合 | 待关联授权、短时证明及 Java/React 原生管理员确认已在本地接通；不返回旧手填域名链接 | 现有账号链路的隔离持久化/真实安装验收；工作人员开户和批准后的关联路径；冲突/重装与客服插件链路。客服日常登录不要求 ERP 会话 |
| 旧 OAuth 完成页只提示返回 ERP | 已移除 `writeOAuthCompletion`；`handleOAuthCallback` 成功保存安装后返回 HTTP 303，目标为已验证店铺的 Shopify Admin 应用入口 | 本地回调返回已修复；真实授权、Admin 重新启动、重装与错误恢复体验仍待隔离验收 |
| 页面的嵌入来源过宽 | 原 `renderEmbeddedApp` 和两份本地代理模板均使用 Shopify 店铺通配符，代理还删除上游 CSP | 本轮本地修复，部署后仍需验证实际响应和 Shopify 框架内行为 |

以上是源码审查结论，不是线上漏洞利用或真实账号测试结果。恢复原生登录不等于新店安装和既有业务映射已完成。历史 One 方案与等待其权限进度的安排已失效。

## 本轮已实现：来源与响应头边界

- `embedded_frame.go` 复用既有 Shopify 域名规范化、ID Token 和 HMAC 验证，不新增认证依赖。
- App Home 仅对已验证的当前店铺和 `https://admin.shopify.com` 设置嵌入许可；不接受裸 `shop`、`host`、Origin、Referer、重复查询参数或跨店铺凭据作为许可。
- 支持有效 ID Token（请求头或 `id_token`）及带 HMAC 的初始启动请求；HMAC 启动证明采用本地五分钟时限和五秒未来时钟容差。这些限制只确定框架来源，不授予业务会话；JSON 接口仍逐次验证 App Bridge Token。
- 无效、过期或缺少启动证明时，公开静态页仍返回 200，但 `frame-ancestors 'none'` 禁止嵌入。必须从 Shopify 重新取得有效启动上下文，不能把旧带凭据 URL 保存为永久链接。真实 Shopify 刷新、长时间停留后重开，以及获取新 Token 的恢复体验仍待隔离验收，不宣称已完成自动恢复。
- App Home 使用 `no-store`、`no-referrer`，不创建 Cookie、不交换 Token、不在 HTML 中回显启动凭据。指南及法务/支持静态页面禁止嵌入，保留原正文与样式。
- `platform/infra/review/Caddyfile` 和复制客服 `deploy/caddy/Caddyfile.template` 只修改 ERP Shopify 响应头规则：透传 Connector 策略，缺失时默认禁止嵌入，不再删除后端 CSP 或恢复通配符。域名、上游、One、生产客服及其他业务站点配置不变；这两份只是本地模板，并未应用到服务器。
- 公开页面检查器现在验证无凭据请求的禁止嵌入、隐私响应头及首页禁止缓存。其通过不证明带签名的 Shopify 框架内操作已成功；旧线上 7/7 不认证本次改造。

## OAuth 成功回调返回（本地新增）

- 回调先验证 HMAC、唯一且可解析的查询参数、签名 state、浏览器绑定 Cookie 与店铺对应关系。取消/错误回调、缺少 code、重复参数及过期 state 均不进入成功返回。
- `oauth_return.go` 只从已验证店铺和配置中的公开 App API Key 生成 `https://<shop>.myshopify.com/admin/apps/<app-key>`。不使用回调 `host`、`redirect`、`returnTo`、请求 Host 或转发头指定目标；不向返回地址附加授权码、state、HMAC、Token 或企业/店铺内部 ID。
- 仅当既有 `CompleteOAuth` 完成令牌交换、范围校验和安装保存后才返回 303；供应方或保存失败不跳转。一次性授权仍只消费一次，成功及已消费后的失败继续清除浏览器绑定 Cookie；回调响应均禁止缓存与 Referer 传递。
- 返回 Shopify-owned 应用入口以获取新的启动上下文；生产代码不签发 Shopify ID Token，也不把回调成功当成 ERP/CHAT 登录成功。测试中模拟的新 Token 仅用于本地 fixture。
- 当前 TOML 仍是 `embedded=true`、`use_legacy_install_flow=false`。本次修复的是现有 authorization-code 回调兼容路径，不更改托管安装配置，不证明新店铺的 managed-install/账号关联问题已经关闭。
- 本轮未改法务正文、scope、域名、代理模板或 One 代码，也未提交/部署。未运行真实 Shopify 浏览器流程。

## 本地验证与发布边界

- 最新 Go Shopify Connector 四个包共 346 项通过，其中 installations 包 198 项；相同四包 `go vet` 通过。新增回调用例覆盖固定返回目标、拒绝伪造/重复/跨店参数、取消、供应方/保存失败、保存后返回、重放，以及模拟撤销后重新授权保持原店铺绑定。此前页面嵌入安全用例仍通过。
- 材料门禁、公开页和公司主体检查器共 65 项合成测试通过；代理模板与既有业务边界另 6 项静态检查通过。不是 ERP／客服全量回归。
- 两份本地代理模板均通过现有 Caddy 镜像的配置解析/配置装载校验：Docker Desktop 本机、断网、只读挂载、无服务端口，临时容器执行后自动移除。保留既有转发头冗余警告；校验时健康探测随校验结束取消，不作为应用健康检查。没有加载到运行中的代理或申请线上证书。
- 精确发布前必须核对实际边缘配置：本地模板与当前线上配置不是同一证据。还应确认代理访问日志不会保存 `id_token`、OAuth code、Authorization 等敏感值；本轮没有读取或修改线上日志配置。
- 本轮没有真实 Shopify 框架浏览器测试、账号操作、业务写入或正式截图；公开页面本地显示证据沿用 `16` 的上一轮记录，不能据此勾选完整嵌入式验收。

## 托管安装原始诊断（2026-09-04，以下保留修复前依据）

以下是待关联实现之前的只读审查，不代表最新代码；最新结果见下一节。

- `embedded_session.go` 在 Token exchange 前要求 `ResolveIdentityByDomain` 成功；`embedded_app.go` 的 `ERP_LINK_REQUIRED` 引导用户到 ERP `/shops`。这是新店授权先于账号关联的缺口，不是再建身份底座的理由。
- `repository.go` 的安装记录和 OAuth grant 都必须持有既有 canonical tenant/shop 与 legacy shop ID；`CompleteInstallation` 同时保存绑定与凭据。目前没有不依赖业务店铺的待关联安装记录。不能向现有表结构塞入虚拟企业/店铺 ID，或按域名/邮箱自动认领。
- ERP `ShopCenterService.createShop` 先建立 ERP 店铺；`XzErpAppChannelConnectorGateway.startShopifyAuthorization` 随后把 ERP tenant/shop 传给 Connector。复制客服 `shopify_erp_status.go` 仍通过 `erpTenantId` / `erpCanonicalShopId` 查询共享连接。保留此既有 canonical 归属；客服通过同一 ERP 账号进入后仍建立独立业务会话、校验映射坐席，不代表每个业务各发一份 Shopify 授权。
- 再次核对 Shopify 官方要求 2.3.1：安装和配置不得要求商家手工输入店铺域名；店铺上下文应来自 Shopify-owned 安装入口并验证。本条与先认证再进行其他操作的 2.3.2 是两个独立检查项。既有手工建店/关联路径不能直接当成公共应用的新安装方案；不因此擅自删除 ERP 的历史店铺管理能力。
- 此前核对过的 One 企业/权限文件仅属退役方案历史，不是当前实现依据或等待条件；以 `../native-business-identity.md` 及 `00-submission-product-boundary.md` 为准。

## 新店授权后待关联切片（本地实现，未部署）

- `pending_installation.go`：只接收经过 HTTP 层验证的 Shopify ID Token 所属店铺；换取 expiring offline grant、校验 scope、通过现有 GraphQL provider 验证店铺信息后，保存独立待关联记录。复用已有 AES-GCM 文件存储和原子提交，不另建存储服务或申请额外 scope。
- 待关联记录不含 ERP tenant/shop/legacy ID，不创建或修改企业、账号、店铺归属，不进入安装索引。不读取商品/订单/客户，不配置插件 app-data，不自动关联客服。该记录不通过既有业务凭据读取接口提供 Token。
- 待关联可用期最多 15 分钟，并受提供商令牌实际寿命约束；有效期内重复打开复用待关联授权，避免重复轮换。到期时重新经当前 Shopify 会话授权，不能继续使用到期待关联记录。运行入口启动时清理过期项、每分钟扫一次，失败安全记录并重试；停止进程时停止清理。保留期不是“精确第 15 分钟必已删除”的承诺，清理失败和备份仍须运维核验。
- 有效 `app/uninstalled` 和 `shop/redact` 在无 ERP 绑定时也会删除待关联凭据；保存失败不回成功状态、删除失败返回 503 让 Shopify 重试。仓库版本屏障防止卸载期间未完成的令牌交换重新写回凭据。所有测试只用本机合成数据，未执行真实整店删除。
- App Home 中英文都显示“Shopify 已授权，ERP 尚未关联”，业务预览保持隐藏，移除未绑定店铺的旧手工域名关联跳转。后续原生关联入口切片已提供已有 ERP 账号的明确确认，不把它当作完整新商家开户或可提交流程。
- 既有 canonical 映射、已安装读取、ERP 账号与客服坐席映射、原 OAuth 兼容路径与固定回调保留。本切片只保存待关联状态，不签发跨业务登录令牌，不将待关联凭据自动提升为安装。旧兼容流程仍需后续结合明确关联校验审查，不能用裸域名或仅有 `SaveBinding` 作为新认领证明。

验证包括：有效/无效 ID Token、URL 店铺不能覆盖签名店铺、权限/令牌寿命/店铺不符、并发重复打开、到期、加密重开、旧文件写入冲突、磁盘保存失败、卸载与交换并发、隐私删除、清理重试与退出。JSDOM 执行实际 Go HTML 内联脚本，检查中英文、切换语言、重试及业务锁定；不加载 Shopify SDK 或外部资源，不等于真实浏览器验收。Go `-race` 未运行成功：本机 CGO 未启用且没有找到 C 编译器。

依据：[Shopify access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens) 对 ID Token、离线授权、令牌寿命与轮换的区分；沿用当前内置 token-exchange 实现。应用权限与本地业务权限仍分开校验。

### 当前最小路线（保留已确认归属，不另建共享身份）

沿用既有应用、ERP／Connector 授权归属和两业务店铺关联。Shopify 授权完成后，在未关联状态禁止订单/客户读取和插件配置；由经验证的原生 ERP 管理员显式确认对应企业/店铺，再启用既有 Connector。复制客服通过短时单次凭证核验同一 ERP 账号，再建立自己的业务会话并检查既有映射坐席、权限和店铺范围；原始 ERP Token 和密码不进入客服。该共享账号入口不改变 ERP canonical 店铺归属。

待关联存储、Connector 证明/原子消费/恢复合同和 ERP 管理员确认页已在本地接通。员工级店铺资源范围尚未完整实现，因此首次关联限定原生企业管理员，另复核当前授权/建店权限。冲突失败关闭，不更换既有 canonical key，不按邮箱、裸域名或先到先得认领。内部服务认证不是原生用户权限验证；不授权真实账号、店铺或数据迁移。

不再要求用户重复确认 One 共享店铺方案。只有发现必须改变既有归属合同、迁移数据或恢复无原生凭据账号时，才提出具体冲突并另行确认；不借安装修复偷偷扩大权限或重置账号。

## 下一项

插件引导/配置状态、客服入口、卸载持久化重放保护和首次迟到通知的当前授权核对已完成本地切片。下一步继续审查 Admin 内必要连接管理与现有授权更新/解绑路径；首次迟到与过期刷新仍缺真实 Shopify 时序证据。准备获准隔离环境的 Java＋数据库＋Go 安装持久化及一套 ERP 审核账号跨业务免二次密码验收，不重复实现客服运营页面。开户路线现已确定为工作人员核准、开户并授权；原先自助开户待决项已取消，具体受控入驻模式仍需向审核如实说明并验证。现有回调 303 与本地确认均不能代替真实安装、重装、主题启用、双向消息和卸载联动证据。独立网页保留，不取消 `embedded=true`。真实 Shopify 登录、安装、主题操作、录屏和正式提交遵守人工边界。

## Connector 原生关联合同（2026-09-05，本地实现）

新增 `native_link.go`、`native_link_http.go` 和测试。复用既有 32 字节随机值、SHA-256、恒定时间比较、UUID 库、AES-GCM 快照与文件代际提交；未引入包、数据库或身份底座。

| 接口 | 已实现的认证与行为 |
| --- | --- |
| `POST /shopify/session/link-grant` | 验证 Shopify ID Token；仅从其店铺的有效待关联授权签发证明。拒绝查询/请求体指定店铺；只返回证明与安全店铺摘要，不返回 URL 或 ERP 身份。 |
| `POST /api/v1/shopify-connector/installations/native-link/preview` | 内部服务认证，JSON 仅接收 `proof`；返回 `contractVersion` 和 `pending`（域名、名称、scopes、有效期）。已消费证明不再可预览。 |
| `POST /api/v1/shopify-connector/installations/native-link/confirm` | 内部服务认证，JSON 接收 `identity`、`context`、`legacyShopId`、`shopDomain`、`actorId`、`proof`；成功返回 `contractVersion` 和无凭据 `installation`。普通 Shopify 会话不能认证此接口。 |

合同版本 `shopify.connector.native_link.v1`。证明原文不持久化，仓库只存哈希；签发新证明替换旧证明，不延长待关联授权最多 15 分钟的可用期。内部接口不接受查询参数，严格拒绝未知/多段/超长 JSON。错误不回显证明、凭据或供应方原始错误。

确认在一个仓库提交内完成：校验证明/有效期/scopes、拒绝既有归属和 legacy 索引冲突、保存 canonical/legacy 绑定与安装凭据、消费待关联记录、写入原生用户 ID 和短时重试收据。即使此前单独保存了相同域名绑定也不能借此提升待关联授权；原 OAuth 兼容路径保持不变。相同证明仅能在有效期内由相同用户、相同 canonical/legacy/域名重试，HTTP Request ID 改变不创建第二次绑定。过期、改绑、换用户或卸载后的重放均拒绝。

归属落盘后才调用既有 app-data 配置器，期间 `NativeLinkPending` 锁住商品/订单、共用业务读取及连接状态。配置成功还需以同一安装收据再次提交；网络/保存失败保留归属和锁定状态，不能报告连接成功。相同确认可续办；证明过期后，有效 Shopify Admin 会话只可续办已记录归属，不能换企业或重新消费证明。完成收据哈希/用户 ID 作为加密安装元数据保留，证明在原到期时间失效；它不是待关联凭据继续可用的许可。

测试覆盖签发与替换、认证分离、原子消费、跨店/用户重放、过期、取消、并发归属竞争、已有 legacy 冲突、响应脱敏、配置失败锁定、卸载竞态、加密重开及两阶段保存失败恢复。11 个顶层测试，含子用例共 29 项通过，另连续 30 轮通过；7 个定向 Go 包合计 1131 项通过、13 项跳过、零失败，相同包 vet 通过。Node 77 项通过。没有运行 Java/ERP 前端或真实浏览器/Shopify；此前 CGO 限制仍在，不能把重复运行写成 race detector 通过。

**原生调用方边界：** 已由下述 Java/React 切片实现原生会话、当前管理员角色/权限、固定企业店铺、明确确认/取消和短时证明处理。普通员工店铺数据范围未因此完成，不对其开放首次关联。结果未知时重试原归属，不能因 ERP 事务回滚而删除已被 Connector 使用的 canonical key 或另建店铺。

Connector-only 阶段尚未增加页面/代理入口，已由后续本地切片接通；运行中的公网路由没有更新。内部接口不直接验证 ERP 用户角色，由 Java 原生调用方负责。卸载竞态测试仅证明本地不恢复凭据/业务访问，不证明已经发出的 Shopify 外部写入被取消。未部署、不碰生产客服、不操作真实店铺；完整安装送审门禁保持未关闭。

## 原生 ERP 确认入口（2026-09-05，本地实现）

- `NativeShopifyLinkController` 仅接受规范的 32 字节 base64url `proof`，拒绝 query、未知 JSON 字段以及客户端企业/用户/域名。Spring 原生会话和方法权限先校验；服务再查本企业 `tenant_admin`、当前 `shop:authorization:write`。系统管理员代入、普通员工、跨租户店铺均拒绝。新增店铺还要求 `shop:write`。
- `POST /api/v1/platform-center/shopify/native-link/preview`：只读验证证明并返回店铺摘要、当前企业的同域名已有店和建店权限，不创建店铺或确认远端归属。
- `POST /api/v1/platform-center/shopify/native-link/prepare`：重新验证证明；独立 `REQUIRES_NEW` 事务锁平台，复用当前企业同域名活跃店，或用既有 `ShopCenterService` 新建店和未授权记录。归档店拒绝，不自动恢复。提交后才返回固定店铺 ID，响应丢失可同证明重试。
- `POST /api/v1/platform-center/shops/{shopId}/channels/shopify/native-link/confirm`：锁定当前企业活跃 Shopify 店，从服务端推导域名、canonical/legacy ID 和原生用户，调用 Connector 并投影既有授权/审计。重试不再预览已经消费的证明，而依赖 Connector 的原用户/原店收据。远端失败不删除此前已提交的店铺。
- `XzErpAppChannelConnectorGateway` 严格校验合同版本、有效期、域名、冻结权限的完整覆盖、返回归属/状态/时间及无额外字段；凭据和提供商错误不回显。只有明确 `NATIVE_LINK_UNAVAILABLE` 映射为停止盲重试的 409，其余未知结果保守重试原确认。
- 实际 App Home 按用户点击获取新 ID Token 和 link grant，再呈现固定 `/shopify/link#proof=...` 新标签页链接；不自动导航，不使用供应方返回的 redirect。验证证明格式、店铺对应关系和有效期。新 grant 不解锁业务。
- React 在路由初始化前清除 fragment；原生登录只接收干净 `/shopify/link` 返回路径。证明不进入 query、localStorage 或页面文本；仅同标签 sessionStorage 短时保存，设置到期清理并在恢复/读取时复核。后台休眠不承诺精确删除时刻，服务端过期验证仍为最终边界。成功/取消立即清除。确认前展示目标店铺、企业、管理员和必选同意；准备与确认之间先保存固定店 ID，存储失败停止确认。刷新恢复时只能重试原用户/店铺；切换企业或管理员不接管旧尝试。
- `platform/infra/review/Caddyfile` 与复制客服 `deploy/caddy/Caddyfile.template` 仅为 Connector 路由补 `/shopify/session/link-grant`。`/shopify/link` 仍走 ERP，保留非嵌入式框架边界；未改域名、上游或运行中网关。

验证：Java 6 套件 83 项通过，覆盖 HTTP 401/403、原生身份推导、拒绝客户端身份/额外字段、同企业已有店复用、独立提交、跨租户拒绝、严格 Connector 响应和错误脱敏。前端 5 文件 38 项通过，类型检查/构建通过；7 个相关 Go 包 test/vet 通过。系统 Chrome 使用脚本 `platform/scripts/shopify-native-link-browser-fixture.mjs` 的本地合成 API，跑通实际 App Home/ERP 页面、未知结果、刷新和同店重试，计数预览 2/准备 1/确认 2；未连接真实后端/数据库/Shopify。375×812、812×375 无横向溢出，语言按钮对比度已修复。该脚本禁用环境文件和代理、仅绑定 loopback，不用于部署或正式审核素材。

未关闭：完整 Java/数据库/Go 持久化联调、无 ERP 账号的新商家路径、Admin 内必要管理、同一 ERP 审核账号到既有客服映射坐席的真实权限与插件双向消息、真实卸载/重装、最终素材与人工提交。上述本地样例不等于业务验收或 Shopify 审核通过。

## 插件设置引导切片（2026-09-05，仅本地）

- 新增 `POST /shopify/session/chat-setup`。只接受 App Bridge JWT 中的店铺，不接受查询或请求体传入企业、域名、地址。复用既有安装归属与过期凭据刷新路径；未绑定、未完成配置或已撤销的安装不能获得入口。不创建店铺、交换新的安装令牌或写入 app-data。
- 只读查询 `currentAppInstallation` 下既有 `xinzhi_support.service_origin` 和 `tenant_id`，与 canonical 企业及既有逐店铺地址配置精确匹配。返回 `CONFIGURED`、`MISMATCH` 或 `UNAVAILABLE`，只有匹配时返回受信配置中的 HTTPS origin。再次检查安装状态，拒绝安装变更后的迟到结果。不回传企业主键、店铺主键、Token 或提供商错误。`CONFIGURED` 不等于共享 ERP 账号入口、映射坐席、业务权限、店铺范围或双向消息已验收。
- 页面默认“尚未检查”，由用户点击检查后读取；英文/中文同一状态机。主题编辑器使用现有 App API key 与 `xinzhi-chat` 文件名生成官方深链，提醒已发布主题、开关及 Save。独立客服入口使用核对后的逐店铺 origin；无 ERP 会话转交，无自动导航、DNS/网关/域名交换、插件重发版或主题写入。
- App Bridge `app.extensions()` 不增加 scope，仅用于已发布主题信号；缺失、不支持、异常、超时或含糊响应显示未知/需核对。`active` 仅显示“检测到插件，请核对开关并保存”，不显示“已启用/消息已通过”。异步代际屏障防止重新连接后旧结果恢复入口。
- 验证：6 个 Node 测试文件共 106 项通过，包含新增 25 项实际 Go HTML/JSDOM 状态测试；7 个相关 Go 包 test/vet 通过。新增 Go 测试覆盖只读 app-data、地址/企业错配、未知/未完成归属、安装变更、JWT/参数拒绝和错误脱敏。系统 Chrome 仅使用本机合成样例，核对匹配/不匹配状态、入口、安全目标、双语、小屏和键盘焦点；375×812、812×375 无横向溢出，新入口/检查按钮高度至少 44px。没有 Java/真实数据库/Shopify 端到端或真实主题启用证据，未重新构建无改动的 ERP React 应用。
- 两份本地 Caddy 模板添加新路由并通过边界测试；未部署。原生产客服、真实账号、真实店铺、最终截图/视频与正式提交均未操作。最终媒体和未完成清单仍保留 NO-GO。

本次核对的官方依据：[Theme App Extension 配置与深链](https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration)、[App Bridge 扩展 API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/app-api)、[AppInstallation](https://shopify.dev/docs/api/admin-graphql/latest/objects/AppInstallation)。Shopify 仓库仍有[停用 embed 返回 active 的未关闭问题报告](https://github.com/Shopify/shopify-app-bridge/issues/548)；这是采取保守提示的依据，不宣称已在本应用真实店铺复现。

本轮 Node 门禁/公开页/公司主体/代理边界/实际 App Home 脚本共 81 项通过，无跳过；公开页测试使用合成响应，未访问生产页面。真实材料检查仍为 NO-GO：14 份文档、18 次占位字段出现、78 项未确认、2 张最终图片、28 条旧字幕（225 秒）。scope 配置 5 处仍一致；未勾选审核项或提升图片。前端构建保留大包警告。本轮浏览器临时视口已恢复，创建的测试标签页与本地样例服务已关闭。

设计对照：[Shopify 官方托管安装与 Token exchange](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node)；[OWASP OAuth 安全实践](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)。本地关联证明仅是业务关联能力凭据，不是新 OAuth、跨业务登录票据或 Shopify 官方签发令牌。

依据（2026-09-04 核对）：[Shopify App Store requirements](https://shopify.dev/docs/apps/launch/shopify-app-store/app-store-requirements) 2.2.2、2.3.2–2.3.4；[Shopify iframe protection](https://shopify.dev/docs/apps/build/security/set-up-iframe-protection)；[ID Token 验证](https://shopify.dev/docs/apps/build/authentication-authorization/id-tokens)；[官方 Token exchange 示例](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/docs/reference/auth/tokenExchange.md)；[Caddy 响应头默认值与覆盖规则](https://caddyserver.com/docs/caddyfile/directives/header)。文档引用是实现依据，不代表平台预先批准。

OAuth 返回地址对照 [Shopify 官方嵌入式 URL 实现](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/lib/auth/get-embedded-app-url.ts) 及其[店铺 Admin 路径测试](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/lib/auth/__tests__/get-embedded-app-url.test.ts)；[官方 OAuth 指南](https://github.com/Shopify/shopify-app-js/blob/main/packages/apps/shopify-api/docs/guides/oauth.md)仍推荐嵌入式应用使用 managed installation 与 token exchange，本次不倒退配置。

## 卸载通知重放保护（2026-09-05，仅本地）

审查中先用合成测试复现两处缺陷：旧 `app/uninstalled` 在重装后重试会撤销新授权；未关联店的旧通知会删除后来生成的待关联授权。原因是原入口先删除 pending、再调用通用 Revoke，outbox 的同 ID 检查发生在撤销之后，不能保护新安装。

新增 `uninstall_webhook.go`，复用现有 Service canonical 锁、AES-GCM 文件仓库和快照代际提交，没有新增依赖、数据库迁移或后台服务。

- 先验证原始 body HMAC、topic 和 body/header 店铺一致性，再校验 delivery ID（必需）及 event ID（可选）。ID 缺失或格式无效返回 400，不再为卸载通知退回 body 哈希 ID；相同 payload 可以属于不同合法卸载事件。HMAC 不覆盖时间头，不能把未经签名的 `Triggered-At` 当成安装代际证明。
- delivery/event 键包含已验证店铺和固定 topic 的隔离信息，只持久化摘要、店铺、归属、状态与收件时间，不保存原始请求或联系人数据。相同 event 的新 delivery 与旧收据关联；相同 ID 却不同 payload、不同 event 或冲突收据返回 503，不能修改授权或吞掉问题。
- 首次接收在一个保存中完成：记录收据、删除 pending 并提升版本屏障、清空已绑定店凭据、写撤销 outbox。未关联店只写无业务归属的收据，不虚构 canonical key。获取 canonical 锁期间发生首次归属变更会失败重试，不能在未持锁时撤销新归属。
- 收据区分 `effects_pending`、`completed`、`superseded` 与 `no_installation`。重复消息绝不再次撤销：仅在当前仍撤销时续做清理；当前已重装则结束旧收据，不对新安装执行旧清理。清理/完成收据失败返回 503；已持久化的清理不重复调用。相同已完成 delivery 不再次写文件。
- 能识别旧版本 outbox 中同店、同归属、同 delivery 的撤销记录，不能用其他店的同名 ID 阻止本店卸载。不存在旧收据/可匹配 outbox 的历史事件无法凭空补证据。
- 新事件即使 body 完全相同仍正常撤销；canonical tenant/shop、legacy shop 映射不变。共享 Connector，不共享或改动两业务原生登录，也不添加 ERP 客服运营页面。

验证：新增 13 个顶层测试（含子用例 17 项），卸载相关测试连续 30 轮通过。9 个相关 Go 包 `test` 合计 1184 项通过、13 项跳过、零失败；同范围 `vet` 通过。7 个 Node 文件共 127 项通过。覆盖持久化重开、尚未关联/已绑定重放、同 event 不同 delivery、合法新卸载、加密无明文、落盘失败不改变内存/磁盘、清理失败与完成失败恢复、旧 outbox、并发重装、归属竞态、ID 冲突和无效签名/店铺拒绝。所有仓库使用内存或测试临时文件；重复执行不是 race detector，既有 CGO 限制未解除。Java/React 构建与浏览器没有重跑。

**此去重切片的边界：** Shopify 不保证 webhook 顺序；此前从未记录的旧卸载事件无法单靠去重识别代际，不根据未签名头、body 的普通 shop 更新时间或过短收据 TTL 猜测丢弃。后续已接入下节的当前授权核对，保护仍有效的新授权；这不是对完整事件先后顺序的还原。真实卸载/重装及多运行实例下分布式互斥仍未验收。

实际材料门禁仍 NO-GO：14 份文档、18 次占位字段出现、78 项未确认、2 张最终图片、28 条旧字幕（225 秒），5 处 scope 一致。没有勾选要求、提升最终图片、访问生产客服或真实店铺、部署或正式提交。

官方依据（本轮核对）：[验证及去重 webhook](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries)、[delivery 与 event 标识](https://shopify.dev/docs/apps/build/webhooks/delivery-structure)、[webhook 顺序与实践](https://shopify.dev/docs/apps/build/webhooks)。采用官方持久化幂等模式；本地通过不代表 Shopify 审核批准。

## 首次迟到通知的当前授权核对（2026-09-05，仅本地）

不尝试从普通 Shop payload 还原安装代际。`ReceiveUninstallWebhook` 先核对现有收据/同归属旧 outbox；只有首次事件需要读取当前授权。绑定店保持既有 canonical 锁，未关联店用 pending revision；外部核对统一限时 3 秒。`CheckCurrentInstallation` 固定只读查询 `currentAppInstallation { id }` 和 `shop { myshopifyDomain }`，严格校验安装 GID 与域名，不访问商品、订单、客户或主题。

| 核对结果 | 本地处理 |
| --- | --- |
| 当前凭据获 Shopify 确认有效 | 保存 `authorization_active` 收据；不撤销安装、不清除 pending、不提升 pending 屏障、不调用客服撤销清理。 |
| 当前访问令牌被明确拒绝且尚未临近本地到期 | 已验签卸载事件结合被拒凭据进入既有原子撤销/清理；不把 403 当成这种结果。 |
| 被拒令牌已过期/临近过期，刷新后核对有效 | 沿用原归属加密保存轮换凭据，保留安装；不把普通过期当卸载。 |
| 刷新令牌已到期或提供商明确返回官方终止响应 | 结合已验签卸载事件清理本地不可续用凭据；下次商家打开应用需重新认证，不推断终止的具体原因。 |
| 403、429、网络/超时、5xx、含糊/部分响应、未知刷新错误或保存失败 | 返回 503，保留凭据与恢复条件，不保存成功收据或吞掉事件。刷新已成功提交但后续核对失败时，保留新凭据供重试。 |

提供商 401 新增更窄的 `ErrProviderTokenRejected`，仍兼容原 `ErrProviderAuthorization` 判断；403 保持普通授权错误。刷新只把官方列出的 401/error/description 组合标记为终止，其他响应仍未知。该终止码也可能代表过期、已替换或未知刷新令牌，**不是“应用一定已卸载”**。OAuth 客户端禁止带凭据跟随重定向，不改共享 HTTP 客户端实例策略。

落盘时比较核对过的安装记录指纹（或本次已持久化轮换的记录）和 pending revision；不能在提供商请求返回后随意读取新记录并套用旧结果。核对期间新授权、轮换或首次关联改变状态会拒绝本次处理并重试。新增活动授权收据可加密重开；同 event 后续 delivery 复用它，不再调用提供商或修改授权。没有开启新 scope、改变 callback/域名/业务身份或创建新应用。

本轮新增 10 个顶层测试（含子用例 28 项）；9 个相关 Go 包合计 1212 项通过、13 项跳过、零失败，相同包 vet 通过；相关卸载/刷新测试连续 30 轮通过，7 个 Node 文件 127 项通过。覆盖提供商固定只读请求与严格状态分类、已绑定和未关联的新授权保护、真实新事件清理、过期刷新、终止/未知响应、保存失败、并发记录/版本变化、加密重开与重定向拒绝。全部使用合成传输、loopback HTTP 和临时文件，未访问真实店铺/凭据，未部署或进行浏览器、Java/数据库/React 构建验收。

剩余：真实 Shopify 撤销生效时序、刷新与重装、长期网络故障后的重试恢复及整体卸载联动仍待人工隔离验收。未知状态依赖 HTTP 非成功响应触发 Shopify 重试，不宣称已建设持久化异步任务队列、无限重试或多实例互斥。本轮未生成最终媒体、填写真实账号或提交应用，材料门禁仍 NO-GO。

依据：[当前 AppInstallation 查询](https://shopify.dev/docs/api/admin-graphql/latest/queries/currentAppInstallation)、[访问令牌生命周期](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens)、[刷新成功、终止与暂态响应的官方说明](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node)。上述是工程处理依据，不代表真实店铺或 Shopify 审核验收。

## App Home 连接管理（2026-09-05，仅本地）

- 使用既有 Go HTML、App Bridge 和 session exchange，不加业务框架、依赖、scope、迁移或新端点。ERP/复制客服现共用 ERP 账号、独立业务会话与权限；身份归属与原生产客服不变。
- 新增可重复使用的连接重查按钮，清除旧商品/订单预览、插件链接和权限检查状态；请求代际防止旧响应在重查后恢复显示。会话令牌、HTTP 和响应解析整体限时 12 秒，超时中止 fetch；晚到的 ID Token 不再启动请求。超时不等于服务器未执行，继续沿用现有安装/关联重试语义。
- 当前权限只在点击后调用 `shopify.scopes.query()`，严格核对 granted/required/optional 列表。缺少权限、已发布 required 与 Connector 配置不同、未知/错误/超时分别显示；失败不输出提供商原始错误。语言切换不重发请求，待关联状态不会因权限检查成功变为已绑定。
- 「凭据最近更新」仅描述持久化时间。概览中的 saved permissions、Shopify 当前权限、Connector API 读取和原生业务账号权限是不同证据，不相互替代。删除原先「去 ERP 更新 Shopify 授权」误导文案；所需 scope 随 Shopify 管理的版本发布/商家确认更新，不调用仅适用于 optional scopes 的 request/revoke。
- 通过官方 App Bridge 导航机制进入当前店 `shopify://admin/settings/apps`；商家在 Shopify 选择本应用并确认卸载。明确同时影响 ERP、客服及 Xinzhi Chat，但不删除独立业务账号。打开设置无本地撤销、账号删除或归属更换副作用；真实设置路由及 Shopify 角色/确认步骤仍需人工验证。
- UI/UX 技能仅用于现有界面的信息分层、状态反馈、可访问性和小屏检查；未套用其移动端技术栈或营销页视觉建议。中英管理控件至少 44px，高风险说明单独分隔。

验证：新增 18 项实际 HTML/JSDOM 测试；8 个 Node 文件合计 145 项通过，9 个相关 Go 包 test/vet 通过。本机 Chrome 合成样例验证权限成功、重查清空、中英文切换、键盘到达权限按钮，以及 375×812 和 812×375 无横向溢出。仅本机合成 API；没有 Shopify SDK 真实通信、数据库、部署或最终媒体。无改动的 Java/React 构建未重跑，既有 race/CGO 限制未改变。

剩余：现有 session exchange 遇到已绑定凭据终止刷新仍可能返回不可用，本轮没有把按钮命名为「修复授权」或宣称已恢复；后续应在已验证 Shopify 会话中沿原归属安全恢复，并覆盖未知保存结果及 NativeLinkPending。新商家无 ERP 账号开户、完整两业务关联/管理、真实权限变更、卸载/重装和插件会话仍未闭合。实际门禁仍为 78 项未确认、18 次占位字段出现、2 张已有最终图和旧字幕，NO-GO 不变。

官方依据：[Scopes API](https://shopify.dev/docs/api/app-home/latest/apis/authentication-and-data/scopes-api)、[管理访问权限](https://shopify.dev/docs/apps/build/authentication-authorization/manage-access-scopes)、[托管安装](https://shopify.dev/docs/apps/build/authentication-authorization/app-installation)、[App Bridge 导航](https://shopify.dev/docs/api/app-home/latest/apis/user-interface-and-interactions/navigation-api)、[Shopify 卸载步骤](https://help.shopify.com/en/manual/apps/uninstalling-apps)。

## 终止刷新恢复与部署前核验（2026-09-05）

用户要求继续完成目标并部署。新增 App Home 终止凭据恢复，使用现有已验证 Shopify JWT 的会话入口。仅当已有绑定安装的刷新明确终止或 refresh TTL 到期才进行 session token exchange；普通网络/服务错误及未知轮换落盘结果仍失败重试，不直接多次交换。新令牌先验证 expiring 结构、所需 scope 和提供商店铺身份（已配置时），再沿原 canonical 锁及 expected refresh token 原子轮换。取消、撤销或更新凭据后到达的旧交换结果不能覆盖新状态。安装时间、legacy 映射、ShopName、原生关联证明/操作人/到期时间保留；不通过 CompleteInstallation 重建身份记录。

NativeLinkPending 仍保持锁定：恢复后的凭据持久化，但 app-data 配置成功及原收据最终落盘之前不开放业务。配置失败本身不触发另一次交换；未知已提交响应的重试读取已持久化凭据。新增 7 个顶层测试，相关原生关联/恢复回归连续 20 轮通过，9 个 Go 包 test/vet 通过，8 个 Node 文件 145 项通过。仅合成数据与临时加密文件，没有真实 Shopify 交换或全栈端到端；没有 UI、scope、回调、端点或数据库迁移变更。

部署实证：通过既有 SSH 接入只读核对 ERP 测试和复制客服 UAT，当前版本均为 `20260903T163153Z-shopify-two-workspace-c352249b`，六个目标容器 healthy，两组 loopback readyz 均为 200。磁盘可用约 67 GB。构建工具 Docker 可用，现有打包器要求平台/复制客服改动已提交，当前其他任务脏文件全部保留，未整批提交或上传。

**当时阻止切换的账号条件已被后续共享 ERP 账号方案取代：** 当次只读核对看到 ERP 4 个账号有密码字段、审核账号 ACTIVE，但字段存在不是实际登录验证；复制客服已有租户分区中的 `erp-seat-…@iam.invalid` 是既有坐席映射，不再要求为其恢复第二套原生密码。后续实现改为由 ERP 短时单次凭证建立客服业务会话，保留坐席权限和店铺范围。当前仍需用户用真实 ERP 审核账号人工验证登录、客服入口、直接网址、退出/撤权及 WebSocket 失效；不得从邮箱猜测关联、复制或重置密码。

依据：[Shopify 访问令牌生命周期](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens)、[Token exchange 与终止刷新](https://shopify.dev/docs/apps/build/authentication-authorization/implement-token-exchange?lang=node)。用户授权部署不等于授权重置密码、改变账号归属或正式提交应用。新商家开户、共享 ERP 账号到客服映射坐席的完整权限与插件会话验收以及最终媒体仍未完成，NO-GO 不变。

## 送审账号叙事一致性（2026-09-05，仅本地）

当时审核截图/视频计划、Partner 填写稿、准备计划与缺口交接统一为一套 ERP 企业标识、账号和密码。2026-09-06 用户进一步要求简化直接入口，客服页改为填写同一 ERP 账号密码，不再通过 Continue with ERP 跳转；ERP 已登录入口仍免二次密码。直接登录由服务器向 ERP 认证并兑换短时单次凭证，再校验既有映射坐席、权限和店铺范围；密码不写入客服账号库，ERP Token 不返回客服浏览器。旧“客服独立账号/第二套密码”仍然废弃。经用户确认，新表单已以 `69d5cad2` 发布至复制客服 UAT，服务与公网表单检查通过；真实账号验收仍待人工，不能用历史入口检查代替。

`shopify-review-readiness-gate.mjs` 现在对当前审核叙事和公开指南执行失败关闭检查，防止旧客服凭据路线回归。8 个 `shopify-*.test.mjs` 文件共 146 项通过；定向门禁文件 30 项通过。真实材料门禁仍按设计失败：仅 2 张最终图、旧字幕缺 9 项 scope 名称、78 项未确认、14 处真实占位。没有勾选要求、提升图片、生成伪字幕、访问账号/店铺、部署或正式提交。
